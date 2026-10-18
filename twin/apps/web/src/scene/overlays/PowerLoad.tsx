import type { Evaluation, Plan, Status } from '@twin/schema'
import { useMemo } from 'react'
import { Box3, Vector3 } from 'three'
import { useTwinStore } from '../../state/store'
import { useSceneRegistry, type SceneObject } from '../registry'
import { LoadScale, OverlayLegend, SceneTag, StatusCounts, utilizationColor } from './FloorLoad'

export interface BuswayLoad {
  rowId: string
  /** Busway current from the engine's row loads. */
  loadA: number
  /** Design limit from the row's `power.busway` check; null when there is no check. */
  limitA: number | null
  utilization: number | null
  status: Status
  /** Scene ids of the row's busway units. */
  objectIds: string[]
}

/** Each row's busway current, joined with its `power.busway` check and its busway's scene objects. */
export function buswayLoads(plan: Plan, evaluation: Evaluation): BuswayLoad[] {
  const rowIds = new Set(plan.hall.rows.map((r) => r.id))
  const checks = new Map(evaluation.checks.filter((c) => c.kind === 'power.busway').map((c) => [c.subject.id, c]))
  const busways = new Map(evaluation.equipment.filter((e) => e.category === 'busway').map((e) => [e.key, e]))
  return evaluation.rows
    .filter((row) => rowIds.has(row.rowId))
    .map((row) => {
      const check = checks.get(row.rowId)
      return {
        rowId: row.rowId,
        loadA: row.buswayLoadA,
        limitA: check?.limit ?? null,
        utilization: check?.utilization ?? null,
        status: check?.status ?? 'unknown',
        objectIds: busways.get(`busway:${row.rowId}`)?.objectIds ?? [],
      }
    })
}

const amps = (a: number) => `${Math.round(a).toLocaleString('en-US')} A`

// Sleeve around the rendered busway, so the load color wraps the model instead of z-fighting with it.
const SLEEVE_M = 0.03

function unionBox(ids: string[], objects: Map<string, SceneObject>): Box3 | null {
  const box = new Box3()
  for (const id of ids) {
    const entry = objects.get(id)
    if (entry) box.expandByObject(entry.ref)
  }
  return box.isEmpty() ? null : box
}

/** Overhead busways colored by load against their rating (0–120% scale), each tagged with its current and limit. */
export function PowerLoad() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const objects = useSceneRegistry((s) => s.objects)
  const loads = useMemo(() => (plan && evaluation ? buswayLoads(plan, evaluation) : []), [plan, evaluation])
  const placed = useMemo(
    () => loads.flatMap((load) => {
      const box = unionBox(load.objectIds, objects)
      return box ? [{ load, center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()), box }] : []
    }),
    [loads, objects],
  )
  if (loads.length === 0) return null
  return (
    <group name="overlay:power">
      {placed.map(({ load, center, size, box }) => (
        <group key={load.rowId}>
          <mesh position={center} raycast={() => null}>
            <boxGeometry args={[size.x + 2 * SLEEVE_M, size.y + 2 * SLEEVE_M, size.z + 2 * SLEEVE_M]} />
            <meshBasicMaterial color={utilizationColor(load.utilization)} toneMapped={false} />
          </mesh>
          <SceneTag position={[box.min.x, box.max.y + 0.25, center.z]} status={load.status}>
            {load.rowId} {amps(load.loadA)}
            {load.limitA === null ? '' : ` of ${amps(load.limitA)}`}
          </SceneTag>
        </group>
      ))}
      <OverlayLegend title="Busway load against rating">
        <LoadScale />
        <StatusCounts
          statuses={loads.map((l) => l.status)}
          noun={{ fail: 'Rows over rating', warn: 'Rows near rating', unknown: 'Rows with unknown load' }}
        />
      </OverlayLegend>
    </group>
  )
}
