import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { loadBuiltins } from '@twin/catalog'
import { makeCatalogIndex } from '@twin/engine'
import type { Plan } from '@twin/schema'
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { fmtNumber } from '../../format'
import { useTwinStore } from '../../state/store'
import { rackSize, slotWorld } from '../geometry'
import { PALETTE } from '../palette'

/**
 * Categorical hues for rack groups, kept clear of the physics colors (blue, amber, red, green, ochre).
 * Checked with the dataviz palette validator on the clay surface, all pairs: worst CVD ΔE 15.0, worst
 * normal-vision ΔE 19.7. Teal sits below 3:1 on clay, so every group also carries a text label in the
 * scene and in the legend. Past three groups hues stop separating reliably; later groups share graphite
 * and are told apart by their labels.
 */
const GROUP_HUES = ['#6250D6', '#13A3A0', '#9C2F6F'] as const
const OTHER_HUE = PALETTE.graphite

const PURPOSE: Record<Plan['workload']['purpose'], string> = {
  training: 'Training',
  inference: 'Inference',
  mixed: 'Mixed training and inference',
}

const NBSP = ' '

// Drawing proportions: a cap thin enough to keep the clay model readable, a floor band that runs a little
// into both aisles so a group reads as one block from the hall shot.
const CAP_M = 0.04
const BAND_MARGIN_M = 0.3
const BAND_H_M = 0.01
const BAND_OPACITY = 0.3
const TAG_LIFT_M = 0.8

interface WorkloadGroup {
  id: string
  name: string
  color: string
  racks: number
}

/** Rack groups in plan order, each with its tint and placed rack count. */
export function workloadGroups(plan: Plan): WorkloadGroup[] {
  return plan.rackGroups.map((g, i) => ({
    id: g.id,
    name: g.name,
    color: GROUP_HUES[i] ?? OTHER_HUE,
    racks: plan.placements.filter((p) => p.groupId === g.id).length,
  }))
}

interface RackTint {
  groupId: string
  color: string
  x: number
  z: number
  w: number
  d: number
  h: number
  /** Width of the slots the rack occupies, so neighbouring bands join up. */
  slotsW: number
}

/** One tint per placement whose rack type resolves; a copy in the plan wins over the built-in catalog. */
function rackTints(plan: Plan): RackTint[] {
  const catalog = makeCatalogIndex([...loadBuiltins().entries, ...Object.values(plan.catalog)])
  const colors = new Map(workloadGroups(plan).map((g) => [g.id, g.color]))
  const groups = new Map(plan.rackGroups.map((g) => [g.id, g]))
  const rows = new Map(plan.hall.rows.map((r) => [r.id, r]))
  return plan.placements.flatMap((p) => {
    const group = groups.get(p.groupId)
    const entry = group && catalog.get(group.rackTypeId, 'rack')
    const row = rows.get(p.rowId)
    if (!entry || !row) return []
    const { x, z } = slotWorld(plan, p.rowId, p.slot, entry.slotsWide)
    return [
      {
        groupId: p.groupId,
        color: colors.get(p.groupId) ?? OTHER_HUE,
        x,
        z,
        ...rackSize(entry),
        slotsW: entry.slotsWide * row.slotPitchM,
      },
    ]
  })
}

type Vec3 = [number, number, number]

const capBox = (t: RackTint): [Vec3, Vec3] => [
  [t.x, t.h + CAP_M / 2, t.z],
  [t.w, CAP_M, t.d],
]

const bandBox = (t: RackTint): [Vec3, Vec3] => [
  [t.x, BAND_H_M / 2, t.z],
  [t.slotsW, BAND_H_M, t.d + 2 * BAND_MARGIN_M],
]

/** Tint marks never take clicks meant for the racks underneath. */
const noRaycast = () => undefined

function TintInstances({ tints, box, opacity }: { tints: RackTint[]; box: (t: RackTint) => [Vec3, Vec3]; opacity?: number }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const matrix = new Matrix4()
    const rotation = new Quaternion()
    const color = new Color()
    tints.forEach((t, i) => {
      const [position, scale] = box(t)
      mesh.setMatrixAt(i, matrix.compose(new Vector3(...position), rotation, new Vector3(...scale)))
      mesh.setColorAt(i, color.set(t.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [tints, box])
  return (
    <instancedMesh key={tints.length} ref={ref} args={[undefined, undefined, tints.length]} raycast={noRaycast}>
      <boxGeometry />
      {opacity === undefined ? (
        <meshStandardMaterial roughness={0.85} />
      ) : (
        <meshBasicMaterial transparent opacity={opacity} depthWrite={false} />
      )}
    </instancedMesh>
  )
}

const css = `
.workload-swatch {
  flex: none;
  align-self: center;
  width: 10px;
  height: 10px;
  border-radius: 1px;
  background: var(--swatch);
}
.workload-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 7px 2px 5px;
  border: var(--rule);
  border-radius: var(--radius);
  background: var(--panel-raised);
  color: var(--ink);
  font-family: var(--font);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  font-stretch: var(--stretch-label);
  line-height: var(--leading-tight);
  white-space: nowrap;
  user-select: none;
}
.workload-legend {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  flex: 1 1 auto;
  min-width: 0;
}
.workload-legend__groups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
}
.workload-legend__group {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
.workload-legend__name {
  font-weight: var(--weight-medium);
}
.workload-legend__count {
  color: var(--graphite);
  font-size: var(--text-sm);
}
.workload-legend__purpose {
  margin-left: auto;
  color: var(--graphite);
  font-size: var(--text-sm);
  font-stretch: var(--stretch-label);
  text-align: right;
}
`

function WorkloadStyles() {
  return (
    <style href="twin-workload-tint" precedence="twin">
      {css}
    </style>
  )
}

function Swatch({ color }: { color: string }) {
  return <span className="workload-swatch" style={{ '--swatch': color } as CSSProperties} aria-hidden="true" />
}

/** Racks tinted by their rack group: a colored cap on each rack, a light band on the floor and one name tag per group. */
export function WorkloadTint() {
  const plan = useTwinStore((s) => s.plan)
  const tints = useMemo(() => (plan ? rackTints(plan) : []), [plan])
  // drei's Html remounts (and drops its content) when the canvas event target attaches; wait for it.
  const eventsReady = Boolean(useThree((s) => s.events.connected))
  const tags = useMemo(() => {
    if (!plan) return []
    return workloadGroups(plan).flatMap((g) => {
      const racks = tints.filter((t) => t.groupId === g.id)
      if (racks.length === 0) return []
      const mean = (f: (t: RackTint) => number) => racks.reduce((s, t) => s + f(t), 0) / racks.length
      const top = Math.max(...racks.map((t) => t.h))
      return [{ ...g, position: [mean((t) => t.x), top + TAG_LIFT_M, mean((t) => t.z)] as Vec3 }]
    })
  }, [plan, tints])

  if (tints.length === 0) return null
  return (
    <group name="workload-tint">
      <TintInstances tints={tints} box={capBox} />
      <TintInstances tints={tints} box={bandBox} opacity={BAND_OPACITY} />
      {eventsReady &&
        tags.map((g) => (
        <Html key={g.id} position={g.position} center zIndexRange={[9, 1]} pointerEvents="none">
          <WorkloadStyles />
          <span className="workload-tag">
            <Swatch color={g.color} />
            {g.name}
          </span>
        </Html>
      ))}
    </group>
  )
}

/** Key to the workload tint: each group's color, name and rack count, then the plan's purpose and compute target. */
export function WorkloadLegend() {
  const plan = useTwinStore((s) => s.plan)
  const placed = useTwinStore((s) => s.evaluation?.headline.placedPflops)
  if (!plan) return null
  const target = `Target ${fmtNumber(plan.workload.targetPflops, 0)}${NBSP}PFLOPS`
  const placedText = placed === undefined ? '' : `, ${fmtNumber(placed, 0)} placed`
  return (
    <div className="workload-legend">
      <WorkloadStyles />
      <ul className="workload-legend__groups" aria-label="Rack groups">
        {workloadGroups(plan).map((g) => (
          <li key={g.id} className="workload-legend__group">
            <Swatch color={g.color} />
            <span className="workload-legend__name">{g.name}</span>
            <span className="workload-legend__count">{`${g.racks}${NBSP}${g.racks === 1 ? 'rack' : 'racks'}`}</span>
          </li>
        ))}
      </ul>
      <p className="workload-legend__purpose">{`${PURPOSE[plan.workload.purpose]}. ${target}${placedText}.`}</p>
    </div>
  )
}
