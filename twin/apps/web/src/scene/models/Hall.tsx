import { num, type Evaluation, type Plan, type SizedEquipment } from '@twin/schema'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Object3D, type Group, type InstancedMesh } from 'three'
import { selectOpenness, useRackOpenness } from '../camera/openness'
import { objectIdForEquipment, objectIdForPlacement, slotWorld } from '../geometry'
import { FINISH, LOUVER_TILE_M } from '../Lighting'
import { useRegistered } from '../Scene'
import { Busway } from './Busway'
import { Cdu, CDU_SIZE } from './Cdu'
import { Crah, CRAH_SIZE } from './Crah'
import { LeafSwitch } from './LeafSwitch'
import { PLANT_PITCH_M, plantCategory } from './Plant'
import { DOOR_MATERIALS, Rack, SHELL_MATERIALS, catalogEntry, panelGeometry, rackDoorGeometry, rackModel, rackShellGeometry } from './Rack'

/** Above this many placements the closed racks draw as instanced meshes, one per rack type. */
export const INSTANCE_THRESHOLD = 40

export const UNIT_KINDS = ['cdu', 'crah', 'plant', 'busway', 'ups', 'transformer', 'leaf', 'bufferTank'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]

/** One drawn piece of equipment, placed in hall meters (origin north-west corner, x east, z south). */
export interface EquipmentUnit {
  objectId: string
  key: string
  kind: UnitKind
  modelId: string | null
  x: number
  z: number
  rotY: number
  /** Row a busway or CDU belongs to. */
  rowId: string | null
}

type EquipmentSource = Pick<SizedEquipment, 'key' | 'modelId' | 'count' | 'positionIds' | 'objectIds'>

const isUnitKind = (k: string): k is UnitKind => (UNIT_KINDS as readonly string[]).includes(k)

/** Racks whose cooling method needs a CDU, by row. */
function liquidRows(plan: Plan): Set<string> {
  const rows = new Set<string>()
  for (const p of plan.placements) {
    const group = plan.rackGroups.find((g) => g.id === p.groupId)
    if (group && catalogEntry(plan, group.coolingMethodId, 'rackCooling')?.requiresCdu) rows.add(p.rowId)
  }
  return rows
}

/**
 * Stand-in for `Evaluation.equipment` while the engine sizes nothing: one unit per hall position (CDUs only on rows
 * that need one), one busway per occupied row, and plant units = rack nominal power / unit capacity, rounded up.
 */
function positionEquipment(plan: Plan): EquipmentSource[] {
  const liquid = liquidRows(plan)
  const out: EquipmentSource[] = []
  const one = (key: string, positionIds: string[], modelId: string | null = null) =>
    out.push({ key, modelId, count: 1, positionIds, objectIds: [] })
  for (const p of plan.hall.positions) {
    if (p.kind === 'crah') one(`crah:${p.id}`, [p.id])
    if (p.kind === 'leaf') one(`leaf:${p.id}`, [p.id])
    if (p.kind === 'cdu' && p.servesRows.some((r) => liquid.has(r))) one(`cdu:${p.servesRows[0]}`, [p.id])
    if (p.kind === 'electrical') {
      one('ups', [p.id])
      one('transformer', [p.id])
    }
    if (p.kind === 'plant') {
      const plant = catalogEntry(plan, plan.cooling.heatRejectionId, 'heatRejection')
      const unitW = plant ? num(plant.unitCapacityW) : null
      const itW = plan.placements.reduce((sum, pl) => {
        const group = plan.rackGroups.find((g) => g.id === pl.groupId)
        const rack = group ? catalogEntry(plan, group.rackTypeId, 'rack') : undefined
        return sum + (rack ? (num(rack.nominalPowerW) ?? 0) : 0)
      }, 0)
      const count = unitW ? Math.max(1, Math.ceil(itW / unitW)) : 1
      out.push({ key: 'plant', modelId: plan.cooling.heatRejectionId, count, positionIds: [p.id], objectIds: [] })
    }
  }
  for (const row of plan.hall.rows) {
    if (plan.placements.some((p) => p.rowId === row.id)) one(`busway:${row.id}`, [])
  }
  if (plan.cooling.bufferTankM3 > 0) one('bufferTank', [])
  return out
}

/** Places every unit of sized equipment (or, before the engine sizes any, of the hall's positions). */
export function equipmentUnits(plan: Plan, evaluation: Evaluation | null): EquipmentUnit[] {
  const source: EquipmentSource[] = evaluation && evaluation.equipment.length > 0 ? evaluation.equipment : positionEquipment(plan)
  const positions = new Map(plan.hall.positions.map((p) => [p.id, p]))
  const rowRot = (rowId: string | undefined) => {
    const row = plan.hall.rows.find((r) => r.id === rowId)
    return row ? (row.hotAisle === 'south' ? 0 : Math.PI) : 0
  }
  const units: EquipmentUnit[] = []
  for (const e of source) {
    const [head = '', rest = null] = e.key.split(/:(.*)/s)
    if (!isUnitKind(head)) continue
    const count = Math.max(0, Math.round(e.count))
    const at = e.positionIds.map((id) => positions.get(id)).filter((p) => p !== undefined)
    for (let k = 0; k < count; k++) {
      const base = { objectId: e.objectIds[k] ?? objectIdForEquipment(e.key, k), key: e.key, kind: head, modelId: e.modelId }
      const p = at[k % Math.max(1, at.length)]
      const j = Math.floor(k / Math.max(1, at.length))
      const m = Math.ceil((count - (k % Math.max(1, at.length))) / Math.max(1, at.length))
      const centered = (pitch: number) => (j - (m - 1) / 2) * pitch
      if (head === 'busway') {
        const row = plan.hall.rows.find((r) => r.id === rest)
        if (row) units.push({ ...base, x: row.x, z: row.z + row.rackDepthM / 2 + centered(0.3), rotY: 0, rowId: row.id })
        continue
      }
      if (head === 'bufferTank') {
        const plant = plan.hall.positions.find((q) => q.kind === 'plant')
        const plantUnits = source.find((s) => s.key === 'plant')?.count ?? 1
        const pitch = PLANT_PITCH_M[plantCategory(plan, null)]
        units.push({
          ...base,
          x: (plant?.x ?? 0) - (plantUnits * pitch) / 2 - 3 - centered(4),
          z: plant?.z ?? -6,
          rotY: 0,
          rowId: null,
        })
        continue
      }
      if (!p) continue
      const row = head === 'cdu' ? (p.servesRows[0] ?? null) : null
      switch (head) {
        case 'cdu':
          units.push({ ...base, x: p.x + CDU_SIZE.w / 2 + j * (CDU_SIZE.w + 0.1), z: p.z, rotY: rowRot(row ?? undefined), rowId: row })
          break
        case 'crah':
          units.push({ ...base, x: p.x, z: p.z + centered(CRAH_SIZE.w + 0.2), rotY: -Math.PI / 2, rowId: null })
          break
        case 'leaf':
          units.push({ ...base, x: p.x, z: p.z + centered(0.7), rotY: rowRot(p.servesRows[0]), rowId: null })
          break
        case 'plant':
          units.push({ ...base, x: p.x + centered(PLANT_PITCH_M[plantCategory(plan, e.modelId)]), z: p.z, rotY: 0, rowId: null })
          break
        case 'ups':
        case 'transformer':
          units.push({ ...base, x: p.x + (head === 'transformer' ? 2.4 : 0), z: p.z + centered(1.4), rotY: Math.PI / 2, rowId: null })
          break
      }
    }
  }
  return units
}

const proxyGeometry = new BoxGeometry(1, 1, 1)

/** Invisible stand-in that gives an instanced rack its id, world box and pick target. */
function RackProxy({ id, x, z, rotY, size }: { id: string; x: number; z: number; rotY: number; size: { w: number; d: number; h: number } }) {
  const ref = useRegistered<Object3D>(id, 'rack')
  return (
    <mesh
      ref={ref}
      geometry={proxyGeometry}
      visible={false}
      position={[x, size.h / 2, z]}
      rotation-y={rotY}
      scale={[size.w, size.h, size.d]}
    />
  )
}

interface InstancedRacksProps {
  plan: Plan
  rackTypeId: string
  coolingMethodId: string
  racks: { id: string; x: number; z: number; rotY: number }[]
}

function InstancedRacks({ plan, rackTypeId, coolingMethodId, racks }: InstancedRacksProps) {
  const model = useMemo(() => rackModel(plan, rackTypeId, coolingMethodId), [plan, rackTypeId, coolingMethodId])
  const shell = useRef<InstancedMesh>(null)
  const door = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const dummy = new Object3D()
    racks.forEach((r, i) => {
      dummy.position.set(r.x, 0, r.z)
      dummy.rotation.set(0, r.rotY, 0)
      dummy.updateMatrix()
      shell.current?.setMatrixAt(i, dummy.matrix)
      door.current?.setMatrixAt(i, dummy.matrix)
    })
    for (const mesh of [shell.current, door.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.computeBoundingBox()
    }
  }, [racks])
  const ids = racks.map((r) => r.id)
  return (
    <>
      <instancedMesh
        key={`shell${racks.length}`}
        ref={shell}
        args={[rackShellGeometry(model.size), SHELL_MATERIALS, racks.length]}
        userData={{ role: 'rackBody', objectIds: ids }}
        castShadow
        receiveShadow
      />
      <instancedMesh
        key={`door${racks.length}`}
        ref={door}
        args={[rackDoorGeometry(model.size, true), DOOR_MATERIALS, racks.length]}
        userData={{ role: 'rackDoor', objectIds: ids }}
        castShadow
        receiveShadow
      />
      {racks.map((r) => (
        <RackProxy key={r.id} id={r.id} x={r.x} z={r.z} rotY={r.rotY} size={model.size} />
      ))}
    </>
  )
}

/** UPS module or dry-type transformer in the electrical room: a plain clay cabinet. */
function Cabinet({ unit }: { unit: EquipmentUnit }) {
  const ref = useRegistered<Group>(unit.objectId, unit.kind)
  const [w, h, d] = unit.kind === 'ups' ? [1.2, 2.0, 0.9] : [1.8, 2.2, 1.2]
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      <mesh position={[0, h / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh position={[0, h * 0.55, -d / 2 - 0.002]} geometry={panelGeometry(w * 0.8, h * 0.6, LOUVER_TILE_M)} material={FINISH.louver} />
    </group>
  )
}

interface HallProps {
  plan: Plan
  units: EquipmentUnit[]
  /** The rack the camera rig opens (`useRackOpenness`); drawn in full with trays and GPUs. */
  openRack: string | null
}

/** The open rack, driven by the camera rig's openness slice. */
function RigRack({ placementId }: { placementId: string }) {
  const openness = useRackOpenness(selectOpenness(placementId))
  const tray = useRackOpenness((s) => (s.placementId === placementId ? s.tray : null))
  return <Rack placementId={placementId} openness={openness} tray={tray} />
}

/** Racks in their slots (instanced when there are many), the one open rack, and the equipment inside the hall. */
export function Hall({ plan, units, openRack }: HallProps) {
  const instanced = plan.placements.length > INSTANCE_THRESHOLD
  const open = openRack && plan.placements.some((p) => p.id === openRack) ? openRack : null

  const batches = useMemo(() => {
    if (!instanced) return []
    const byType = new Map<string, InstancedRacksProps>()
    for (const p of plan.placements) {
      if (p.id === open) continue
      const group = plan.rackGroups.find((g) => g.id === p.groupId)
      if (!group) continue
      const slotsWide = catalogEntry(plan, group.rackTypeId, 'rack')?.slotsWide ?? 1
      const at = slotWorld(plan, p.rowId, p.slot, slotsWide)
      const key = `${group.rackTypeId}|${group.coolingMethodId}`
      const batch = byType.get(key) ?? { plan, rackTypeId: group.rackTypeId, coolingMethodId: group.coolingMethodId, racks: [] }
      batch.racks.push({ id: objectIdForPlacement(p.id), x: at.x, z: at.z, rotY: at.rotY })
      byType.set(key, batch)
    }
    return [...byType.entries()]
  }, [plan, instanced, open])

  return (
    <group>
      {instanced
        ? batches.map(([key, batch]) => <InstancedRacks key={key} {...batch} />)
        : plan.placements
            .filter((p) => p.id !== open)
            .map((p) => <Rack key={p.id} placementId={p.id} openness={0} interior={false} />)}
      {open ? <RigRack key={`open-${open}`} placementId={open} /> : null}
      {units.map((u) => {
        switch (u.kind) {
          case 'cdu':
            return <Cdu key={u.objectId} unit={u} />
          case 'crah':
            return <Crah key={u.objectId} unit={u} />
          case 'leaf':
            return <LeafSwitch key={u.objectId} unit={u} plan={plan} />
          case 'busway':
            return <Busway key={u.objectId} unit={u} plan={plan} />
          case 'ups':
          case 'transformer':
            return <Cabinet key={u.objectId} unit={u} />
          default:
            return null
        }
      })}
    </group>
  )
}
