import type { Plan } from '@twin/schema'
import { useEffect, useMemo } from 'react'
import { CylinderGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GROUND_Y } from '../Ground'
import { FINISH } from '../Lighting'
import { useRegistered } from '../hooks'
import { CDU_SIZE } from './Cdu'
import { CRAH_SIZE } from './Crah'
import type { EquipmentUnit } from './Hall'
import { plantUnitLength } from './Plant'

export type Point = [number, number, number]

export interface PipeRun {
  /** Scene id is `pipe:<id>`. */
  id: string
  loop: 'facility' | 'technical'
  side: 'supply' | 'return'
  points: Point[]
  radius: number
}

/**
 * Pipe radii from flow at 1.3 m/s: facility mains carry about 40 L/s (1 MW at a 6 K rise:
 * 1e6 / (4186 × 6)), which needs DN200; a 1.2 MW CDU's 24 L/s technical loop needs DN150.
 */
const FACILITY_R = 0.1
const TECHNICAL_R = 0.075
/** Supply and return run side by side, this far from the route centerline. */
const PAIR_OFFSET = { facility: 0.17, technical: 0.12 }
/** Distance below the raised-floor deck and below the ceiling for under-floor and overhead routes. */
const UNDER_FLOOR_Y = -0.3
const UNDER_CEILING = 0.45
/** The main header runs along the north wall this far into the hall. */
const MAIN_Z = 1.0
const YARD_Y = GROUND_Y + 0.55

/**
 * Piping as straight runs: the yard header across the plant, the feed through the north wall, the main header,
 * branches to the CRAHs (west wall) and CDUs (row ends), and each CDU's technical loop along its row's hot aisle.
 * Raised floors route under the deck, otherwise under the ceiling.
 */
export function pipeRuns(plan: Plan, units: EquipmentUnit[]): PipeRun[] {
  const plants = units.filter((u) => u.kind === 'plant')
  const crahs = units.filter((u) => u.kind === 'crah')
  const cdus = units.filter((u) => u.kind === 'cdu')
  const tanks = units.filter((u) => u.kind === 'bufferTank')
  if (plants.length === 0 || crahs.length + cdus.length === 0) return []

  const overhead = plan.cooling.pipingRoute === 'overhead' || plan.hall.floor.type === 'slab'
  const yIn = overhead ? plan.hall.ceilingM - UNDER_CEILING : UNDER_FLOOR_Y
  const plantLength = plantUnitLength(plan, plants[0]!.modelId)
  const yardZ = Math.max(...plants.map((p) => p.z)) + plantLength / 2 + 0.9
  const yardXs = [...plants, ...tanks].map((u) => u.x)
  const entryX = plants.reduce((s, p) => s + p.x, 0) / plants.length
  const westX = crahs.length ? Math.max(...crahs.map((c) => c.x)) + CRAH_SIZE.d / 2 + 0.6 : entryX
  const eastX = cdus.length ? Math.max(...cdus.map((c) => c.x)) + CDU_SIZE.w / 2 + 0.9 : entryX
  const mainWest = Math.min(westX, entryX)
  const mainEast = Math.max(eastX, entryX)

  // Centerlines; each becomes a supply and a return run.
  const routes: { id: string; loop: PipeRun['loop']; points: Point[] }[] = [
    { id: 'yard', loop: 'facility', points: [[Math.min(...yardXs), YARD_Y, yardZ], [Math.max(...yardXs), YARD_Y, yardZ]] },
    ...[...plants, ...tanks].map((u) => ({
      id: `yard:${u.objectId}`,
      loop: 'facility' as const,
      points: [[u.x, YARD_Y, u.z], [u.x, YARD_Y, yardZ]] as Point[],
    })),
    {
      id: 'feed',
      loop: 'facility',
      points: [[entryX, YARD_Y, yardZ], [entryX, YARD_Y, -0.6], [entryX, yIn, -0.6], [entryX, yIn, MAIN_Z]],
    },
    { id: 'main', loop: 'facility', points: [[mainWest, yIn, MAIN_Z], [mainEast, yIn, MAIN_Z]] },
  ]
  const unitY = (h: number) => (overhead ? h : 0)
  if (crahs.length) {
    routes.push({ id: 'crah', loop: 'facility', points: [[westX, yIn, MAIN_Z], [westX, yIn, Math.max(...crahs.map((c) => c.z))]] })
    for (const c of crahs) {
      routes.push({
        id: `crah:${c.objectId}`,
        loop: 'facility',
        points: [[westX, yIn, c.z], [c.x, yIn, c.z], [c.x, unitY(CRAH_SIZE.h), c.z]],
      })
    }
  }
  if (cdus.length) {
    routes.push({ id: 'cdu', loop: 'facility', points: [[eastX, yIn, MAIN_Z], [eastX, yIn, Math.max(...cdus.map((c) => c.z))]] })
    for (const c of cdus) {
      routes.push({
        id: `cdu:${c.objectId}`,
        loop: 'facility',
        points: [[eastX, yIn, c.z], [c.x, yIn, c.z], [c.x, unitY(CDU_SIZE.h), c.z]],
      })
      const row = plan.hall.rows.find((r) => r.id === c.rowId)
      if (!row) continue
      const headerZ = row.hotAisle === 'south' ? row.z + row.rackDepthM + 0.4 : row.z - 0.4
      routes.push({
        id: `row:${row.id}:${c.objectId}`,
        loop: 'technical',
        points: [[c.x, unitY(CDU_SIZE.h), c.z], [c.x, yIn, c.z], [c.x, yIn, headerZ], [row.x, yIn, headerZ]],
      })
    }
  }

  return routes.flatMap((r) =>
    (['supply', 'return'] as const).map((side) => {
      const o = (side === 'supply' ? -1 : 1) * PAIR_OFFSET[r.loop]
      return {
        id: `${r.loop}:${side}:${r.id}`,
        loop: r.loop,
        side,
        radius: r.loop === 'facility' ? FACILITY_R : TECHNICAL_R,
        points: r.points.map(([x, y, z]): Point => [x + o, y, z + o]),
      }
    }),
  )
}

const UP = new Vector3(0, 1, 0)

function runGeometry(run: PipeRun): BufferGeometry {
  const parts: BufferGeometry[] = []
  const pts = run.points.map((p) => new Vector3(...p))
  pts.forEach((a, i) => {
    parts.push(new SphereGeometry(run.radius * 1.12, 16, 10).translate(a.x, a.y, a.z).toNonIndexed())
    const b = pts[i + 1]
    if (!b) return
    const length = a.distanceTo(b)
    if (length < 1e-6) return
    const dir = b.clone().sub(a).normalize()
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const segment = new CylinderGeometry(run.radius, run.radius, length, 18, 1, true)
    segment.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir)).translate(mid.x, mid.y, mid.z)
    parts.push(segment.toNonIndexed())
  })
  return mergeGeometries(parts)
}

function PipeMesh({ run }: { run: PipeRun }) {
  const ref = useRegistered<Mesh>(`pipe:${run.id}`, 'pipe')
  const geometry = useMemo(() => runGeometry(run), [run])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh ref={ref} geometry={geometry} material={FINISH.pipe} castShadow receiveShadow />
}

/** Facility and technical loop piping as neutral painted pipe; the liquid overlay adds flow and color on top. */
export function Pipes({ runs }: { runs: PipeRun[] }) {
  return (
    <group>
      {runs.map((r) => (
        <PipeMesh key={r.id} run={r} />
      ))}
    </group>
  )
}
