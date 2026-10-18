import { Edges, Line } from '@react-three/drei'
import { loadBuiltins } from '@twin/catalog'
import { applyCommands } from '@twin/commands'
import { evaluate, makeCatalogIndex } from '@twin/engine'
import {
  CommandError,
  placementId,
  type CatalogIndex,
  type Command,
  type Evaluation,
  type Plan,
  type Proposal,
  type SizedEquipment,
} from '@twin/schema'
import { useMemo } from 'react'
import { Box3, Vector3 } from 'three'
import { useTwinStore } from '../../state/store'
import { objectIdForPlacement, positionWorld, rackSize, slotWorld } from '../geometry'
import { PALETTE } from '../palette'
import { useSceneRegistry, type SceneObject } from '../registry'
import { rowsLabel } from '../../strips/parts'
import { SceneTag } from './FloorLoad'

const catalogs = new WeakMap<Plan, CatalogIndex>()

/** The catalog the engine uses for a plan: built-ins with the plan's own entries winning. Cached per plan object. */
export function planCatalog(plan: Plan): CatalogIndex {
  let catalog = catalogs.get(plan)
  if (!catalog) {
    catalog = makeCatalogIndex([...loadBuiltins().entries, ...Object.values(plan.catalog)])
    catalogs.set(plan, catalog)
  }
  return catalog
}

export interface PlanState {
  plan: Plan
  evaluation: Evaluation
}

export interface GhostDiff {
  /** Scene ids only in the preview: racks in placement order, then equipment units. */
  added: string[]
  /** Scene ids only in the base plan. */
  removed: string[]
  /** Scene ids in both whose rack group, rack type, cooling method or equipment model differs. */
  changed: string[]
  /** Racks moved by `moveRack` commands; their ids change with their place, so they are paired here instead. */
  moved: { from: string; to: string }[]
}

function rackSignatures(plan: Plan): Map<string, string> {
  const groups = new Map(plan.rackGroups.map((g) => [g.id, g]))
  return new Map(
    plan.placements.map((p) => {
      const g = groups.get(p.groupId)
      return [objectIdForPlacement(p.id), `${p.groupId}|${g?.rackTypeId}|${g?.coolingMethodId}`]
    }),
  )
}

function unitModels(evaluation: Evaluation): Map<string, string | null> {
  return new Map(evaluation.equipment.flatMap((e) => e.objectIds.map((id) => [id, e.modelId] as const)))
}

/** Final place of every rack a `moveRack` sequence moved, keyed by its new id, valued by its id in the base plan. */
function moveOrigins(commands: Command[]): Map<string, string> {
  const origins = new Map<string, string>()
  for (const cmd of commands) {
    if (cmd.type !== 'moveRack') continue
    const { placementId: from, rowId, slot } = cmd.payload as { placementId: string; rowId: string; slot: number }
    const origin = origins.get(from) ?? from
    origins.delete(from)
    origins.set(placementId(rowId, slot), origin)
  }
  return origins
}

/** Objects the proposal adds, removes, changes or moves, by scene id. Pure: compares two plan states. */
export function ghostDiff(base: PlanState, preview: PlanState, commands: Command[] = []): GhostDiff {
  const compare = <V,>(before: Map<string, V>, after: Map<string, V>) => ({
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
  })
  const racks = compare(rackSignatures(base.plan), rackSignatures(preview.plan))
  const units = compare(unitModels(base.evaluation), unitModels(preview.evaluation))

  const moved: GhostDiff['moved'] = []
  for (const [to, from] of moveOrigins(commands)) {
    const pair = { from: objectIdForPlacement(from), to: objectIdForPlacement(to) }
    if (pair.from !== pair.to && racks.removed.includes(pair.from) && racks.added.includes(pair.to)) moved.push(pair)
  }
  const wasMoved = (id: string) => moved.some((m) => m.from === id || m.to === id)
  return {
    added: [...racks.added.filter((id) => !wasMoved(id)), ...units.added],
    removed: [...racks.removed.filter((id) => !wasMoved(id)), ...units.removed],
    changed: [...racks.changed, ...units.changed],
    moved,
  }
}

/** The plan and evaluation after the proposal's commands; null when they no longer apply (the proposal is stale). */
function previewState(plan: Plan, proposal: Proposal): PlanState | null {
  try {
    const next = applyCommands(plan, proposal.commands, planCatalog(plan)).plan
    return { plan: next, evaluation: evaluate(next, loadBuiltins()) }
  } catch (error) {
    if (error instanceof CommandError) return null
    throw error
  }
}

type Mode = 'added' | 'removed' | 'changed'

export interface GhostBox {
  id: string
  mode: Mode
  box: Box3
  /** Groups boxes under one tag across rows, e.g. "changed|Cooling: Direct-to-chip" or "added|cdu|<model>". */
  tagKey: string
  /** Tag text for a group of `n` boxes. */
  label: (n: number) => string
  /** Row of a rack ghost, named in its group's tag; null for equipment and moves. */
  row: string | null
  /** Tag at the west end instead of the middle: for long equipment runs such as busways. */
  tagWest: boolean
}

// Equipment longer than any cabinet is a run along a row, such as a busway.
const LONG_RUN_M = 4

function rackBox(state: PlanState, id: string): Box3 | null {
  const placement = state.plan.placements.find((p) => objectIdForPlacement(p.id) === id)
  const group = placement && state.plan.rackGroups.find((g) => g.id === placement.groupId)
  const entry = group && planCatalog(state.plan).get(group.rackTypeId, 'rack')
  if (!placement || !entry) return null
  // Racks turn by 0 or π only, so the footprint stays axis-aligned and rotation can be ignored.
  const { x, z } = slotWorld(state.plan, placement.rowId, placement.slot, entry.slotsWide)
  const { w, d, h } = rackSize(entry)
  return new Box3().setFromCenterAndSize(new Vector3(x, h / 2, z), new Vector3(w, h, d))
}

// Cabinet envelope for CDUs not yet in the scene: Vertiv CoolChip CDU 1350, 900 × 1243 × 2122 mm
// (the reference product of the catalog's cdu.1200kw entry). Other categories copy a rendered sibling's size.
const ENVELOPE_M: Record<string, Vector3> = { cdu: new Vector3(0.9, 2.122, 1.243) }

/**
 * Box of an equipment unit the scene does not render yet. Unit i of n goes to position ⌊i · positions / n⌋ (the
 * engine's floor-load rule); units sharing a position stand side by side along z.
 */
function unitBox(state: PlanState, item: SizedEquipment, id: string, objects: Map<string, SceneObject>): Box3 | null {
  const n = item.objectIds.length
  const p = item.positionIds.length
  const i = item.objectIds.indexOf(id)
  if (p === 0 || i < 0) return null
  const positionOf = (j: number) => Math.floor((j * p) / n)
  const atSame = item.objectIds.map((_, j) => j).filter((j) => positionOf(j) === positionOf(i))
  const sibling = [...objects.entries()].find(([key]) => key.startsWith(`eq:${item.category}:`))
  const size = sibling ? new Box3().setFromObject(sibling[1].ref).getSize(new Vector3()) : ENVELOPE_M[item.category]
  if (!size) return null
  const at = positionWorld(state.plan, item.positionIds[positionOf(i)]!)
  const offset = (atSame.indexOf(i) - (atSame.length - 1) / 2) * size.z
  const center = new Vector3(at.x, size.y / 2, at.z + offset)
  return new Box3().setFromCenterAndSize(center, size)
}

function describeRackChange(base: PlanState, preview: PlanState, id: string): string {
  const groupOf = (s: PlanState) => {
    const p = s.plan.placements.find((x) => objectIdForPlacement(x.id) === id)
    return s.plan.rackGroups.find((g) => g.id === p?.groupId)
  }
  const before = groupOf(base)
  const after = groupOf(preview)
  if (!after) return 'Rack group removed'
  const catalog = planCatalog(preview.plan)
  if (before?.coolingMethodId !== after.coolingMethodId)
    return `Cooling: ${catalog.get(after.coolingMethodId, 'rackCooling')?.name ?? after.coolingMethodId}`
  if (before?.rackTypeId !== after.rackTypeId) return `Rack type: ${catalog.get(after.rackTypeId, 'rack')?.name ?? after.rackTypeId}`
  return `Group: ${after.name}`
}

function rackRow(state: PlanState, id: string): string {
  return state.plan.placements.find((p) => objectIdForPlacement(p.id) === id)?.rowId ?? ''
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`
}

/** Ghost boxes and their tags for a diff. Existing objects take their rendered box; new ones are placed from the plan. */
function ghostBoxes(diff: GhostDiff, base: PlanState, preview: PlanState, objects: Map<string, SceneObject>): GhostBox[] {
  const items = (s: PlanState) => new Map(s.evaluation.equipment.flatMap((e) => e.objectIds.map((id) => [id, e] as const)))
  const baseUnits = items(base)
  const previewUnits = items(preview)
  const rendered = (id: string) => {
    const entry = objects.get(id)
    return entry ? new Box3().setFromObject(entry.ref) : null
  }
  const modelName = (item: SizedEquipment) =>
    (item.modelId && planCatalog(preview.plan).get(item.modelId, 'equipment')?.name) || item.category

  const out: GhostBox[] = []
  const push = (id: string, mode: Mode, box: Box3 | null, tagKey: string, label: (n: number) => string, row: string | null = null) => {
    if (!box || box.isEmpty()) return
    const longRun = !id.startsWith('rack:') && box.max.x - box.min.x > LONG_RUN_M
    out.push({ id, mode, box, tagKey, label, row, tagWest: longRun })
  }
  const units = (text: string) => (n: number) => (n === 1 ? text : `${text}, ${n} units`)
  const rackName = (id: string) => id.slice('rack:'.length)
  for (const id of diff.added.filter((x) => x.startsWith('rack:'))) {
    push(id, 'added', rackBox(preview, id), 'added|rack', (n) => plural(n, 'New rack', 'new racks'), rackRow(preview, id))
  }
  for (const id of diff.removed.filter((x) => x.startsWith('rack:'))) {
    push(id, 'removed', rendered(id) ?? rackBox(base, id), 'removed|rack', (n) => plural(n, 'Rack removed', 'racks removed'), rackRow(base, id))
  }
  for (const { from, to } of diff.moved) {
    push(from, 'removed', rendered(from) ?? rackBox(base, from), 'moved|from', (n) => (n === 1 ? `Moved to ${rackName(to)}` : `${n} racks moved out`))
    push(to, 'added', rackBox(preview, to), 'moved|to', (n) => (n === 1 ? `Moved from ${rackName(from)}` : `${n} racks moved in`))
  }
  for (const id of diff.changed) {
    if (id.startsWith('rack:')) {
      const tag = describeRackChange(base, preview, id)
      push(id, 'changed', rendered(id) ?? rackBox(preview, id), `changed|${tag}`, () => tag, rackRow(preview, id))
    } else {
      const item = previewUnits.get(id)
      if (item) push(id, 'changed', rendered(id) ?? unitBox(preview, item, id, objects), `changed|${item.category}|${item.modelId}`, units(`Model: ${modelName(item)}`))
    }
  }
  for (const id of diff.added.filter((x) => !x.startsWith('rack:'))) {
    const item = previewUnits.get(id)
    if (item) push(id, 'added', unitBox(preview, item, id, objects), `added|${item.category}|${item.modelId}`, units(`New ${modelName(item)}`))
  }
  for (const id of diff.removed.filter((x) => !x.startsWith('rack:'))) {
    const item = baseUnits.get(id)
    if (item) push(id, 'removed', rendered(id) ?? unitBox(base, item, id, objects), `removed|${item.category}|${item.modelId}`, units(`Removed ${modelName(item)}`))
  }
  return out
}

export interface GhostTag {
  key: string
  /** One line per kind of change at this place. */
  lines: string[]
  position: [number, number, number]
}

// Tags whose anchors are closer than this on the floor (m) merge into one: at the hall shot they would overlap.
const TAG_MERGE_M = 4

/**
 * One tag per kind of change, however many rows or units it spans ("Cooling: Direct-to-chip, rows 3–5",
 * "New row CDU, 3 units"), over the middle of what it groups; long runs take theirs at the west end. Kinds of
 * change at the same place (a CRAH removed and its replacement) share one tag, a line each.
 */
export function ghostTags(ghosts: GhostBox[]): GhostTag[] {
  const groups = new Map<string, { ghosts: GhostBox[]; box: Box3 }>()
  for (const g of ghosts) {
    const group = groups.get(g.tagKey)
    if (group) {
      group.ghosts.push(g)
      group.box.union(g.box)
    } else groups.set(g.tagKey, { ghosts: [g], box: g.box.clone() })
  }
  const tags: GhostTag[] = []
  for (const [key, { ghosts: members, box }] of groups) {
    const first = members[0]!
    const rows = members.flatMap((g) => (g.row ? [g.row] : []))
    const line = rows.length > 0 ? `${first.label(members.length)}, ${rowsLabel(rows, false)}` : first.label(members.length)
    const c = box.getCenter(new Vector3())
    const position: GhostTag['position'] = [first.tagWest ? box.min.x : c.x, box.max.y + TAG_ABOVE_M, c.z]
    const near = tags.find((t) => Math.hypot(t.position[0] - position[0], t.position[2] - position[2]) < TAG_MERGE_M)
    if (near) {
      near.lines.push(line)
      near.position[1] = Math.max(near.position[1], position[1])
    } else tags.push({ key, lines: [line], position })
  }
  return tags
}

// Tags float this far above the top of what they describe.
const TAG_ABOVE_M = 0.35

// The move arrow runs just above the floor tiles.
const MOVE_LINE_Y_M = 0.05

// Ghosts sit just outside the objects they outline so their edges are not hidden by the model's own faces.
const INFLATE_M = 0.02

function GhostOutline({ ghost }: { ghost: GhostBox }) {
  const size = ghost.box.getSize(new Vector3()).addScalar(2 * INFLATE_M)
  const center = ghost.box.getCenter(new Vector3())
  const removed = ghost.mode === 'removed'
  return (
    <mesh position={center} raycast={() => null} renderOrder={2}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial color={PALETTE.clay.light} transparent opacity={removed ? 0 : 0.35} depthWrite={false} />
      <Edges
        color={removed ? PALETTE.graphite : PALETTE.ink}
        lineWidth={removed ? 1 : 1.5}
        dashed={removed}
        dashSize={0.12}
        gapSize={0.08}
        raycast={() => null}
      />
    </mesh>
  )
}

/** Translucent outlines of what the previewed proposal adds, removes, moves or changes, with one tag per group. */
export function Ghost() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const proposal = useTwinStore((s) => (s.previewProposalId === null ? undefined : s.proposals[s.previewProposalId]))
  const objects = useSceneRegistry((s) => s.objects)

  const preview = useMemo(() => (plan && proposal ? previewState(plan, proposal) : null), [plan, proposal])
  const { ghosts, moved } = useMemo(() => {
    if (!plan || !evaluation || !proposal || !preview) return { ghosts: [], moved: [] }
    const base = { plan, evaluation }
    const diff = ghostDiff(base, preview, proposal.commands)
    return { ghosts: ghostBoxes(diff, base, preview, objects), moved: diff.moved }
  }, [plan, evaluation, proposal, preview, objects])
  if (ghosts.length === 0) return null

  const boxOf = (id: string, mode: Mode) => ghosts.find((g) => g.id === id && g.mode === mode)?.box

  return (
    <group name="overlay:ghost">
      {ghosts.map((g) => (
        <GhostOutline key={`${g.mode}:${g.id}`} ghost={g} />
      ))}
      {moved.map(({ from, to }) => {
        const a = boxOf(from, 'removed')
        const b = boxOf(to, 'added')
        if (!a || !b) return null
        const points = [a.getCenter(new Vector3()).setY(MOVE_LINE_Y_M), b.getCenter(new Vector3()).setY(MOVE_LINE_Y_M)]
        return <Line key={to} points={points} color={PALETTE.ink} lineWidth={1} dashed dashSize={0.2} gapSize={0.12} raycast={() => null} />
      })}
      {ghostTags(ghosts).map((t) => (
        <SceneTag key={t.key} position={t.position}>
          {t.lines.map((line, i) => (
            <span key={i} style={{ display: 'block' }}>
              {line}
            </span>
          ))}
        </SceneTag>
      ))}
    </group>
  )
}
