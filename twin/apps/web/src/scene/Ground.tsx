import type { Plan } from '@twin/schema'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useStable } from './hooks'
import { FINISH, FLOOR_TILE_M } from './Lighting'
import type { PipeRun } from './models/Pipes'

/** Site grade sits one raised-floor void (600 mm, mid-range of the common 450–900 mm) below the hall's deck at y = 0. */
export const GROUND_Y = -0.6
const DECK_T = 0.04
/** Open trench around under-floor pipes: lifted tiles, the drafting cutaway for a raised floor. */
const TRENCH_MARGIN = 0.32

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/** Under-floor pipe segments inside the hall, inflated into trench rectangles. */
export function trenches(plan: Plan, runs: PipeRun[]): Rect[] {
  const { widthM, depthM } = plan.hall
  const out: Rect[] = []
  for (const run of runs) {
    run.points.forEach((a, i) => {
      const b = run.points[i + 1]
      if (!b || a[1] >= 0 || b[1] >= 0) return
      const m = TRENCH_MARGIN + run.radius
      const rect = {
        x0: Math.max(0, Math.min(a[0], b[0]) - m),
        x1: Math.min(widthM, Math.max(a[0], b[0]) + m),
        z0: Math.max(0, Math.min(a[2], b[2]) - m),
        z1: Math.min(depthM, Math.max(a[2], b[2]) + m),
      }
      if (rect.x1 > rect.x0 && rect.z1 > rect.z0) out.push(rect)
    })
  }
  return out
}

/** The deck rectangle minus the holes, as cells of the grid every hole edge cuts, merged along x. */
export function deckPanels(width: number, depth: number, holes: Rect[]): Rect[] {
  const xs = [...new Set([0, width, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b)
  const zs = [...new Set([0, depth, ...holes.flatMap((h) => [h.z0, h.z1])])].sort((a, b) => a - b)
  const out: Rect[] = []
  for (let j = 0; j < zs.length - 1; j++) {
    const z0 = zs[j]!
    const z1 = zs[j + 1]!
    let open: Rect | null = null
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i]!
      const x1 = xs[i + 1]!
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const solid = !holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)
      if (solid && open) open.x1 = x1
      else if (solid) open = { x0, z0, x1, z1 }
      else if (open) {
        out.push(open)
        open = null
      }
    }
    if (open) out.push(open)
  }
  return out
}

function deckGeometry(panels: Rect[]): BufferGeometry {
  const merged = mergeGeometries(
    panels.map((r) =>
      new BoxGeometry(r.x1 - r.x0, DECK_T, r.z1 - r.z0)
        .translate((r.x0 + r.x1) / 2, -DECK_T / 2, (r.z0 + r.z1) / 2)
        .toNonIndexed(),
    ),
  )
  // World-space UVs so the 600 mm tile joints line up across panels.
  const pos = merged.getAttribute('position')
  const uv = merged.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / FLOOR_TILE_M, pos.getZ(i) / FLOOR_TILE_M)
  return merged
}

/** Site grade, the slab under the hall, and the hall's tiled deck (raised floors open where pipes run beneath). */
export function Ground({ plan, runs }: { plan: Plan; runs: PipeRun[] }) {
  const { widthM, depthM } = plan.hall
  const raised = plan.hall.floor.type === 'raised'
  const panels = useStable(deckPanels(widthM, depthM, raised ? trenches(plan, runs) : []))
  const deck = useMemo(() => deckGeometry(panels), [panels])
  useEffect(() => () => deck.dispose(), [deck])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[widthM / 2, GROUND_Y, depthM / 2]} material={FINISH.ground} receiveShadow>
        <planeGeometry args={[800, 800]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[widthM / 2, GROUND_Y + 0.004, depthM / 2]} material={FINISH.clayDark} receiveShadow>
        <planeGeometry args={[widthM, depthM]} />
      </mesh>
      <mesh geometry={deck} material={FINISH.floor} receiveShadow castShadow />
    </group>
  )
}
