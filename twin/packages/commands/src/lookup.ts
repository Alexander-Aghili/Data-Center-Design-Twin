import {
  CommandError,
  placementId,
  type CatalogEntry,
  type CatalogEntryOfKind,
  type CatalogIndex,
  type CatalogKind,
  type Placement,
  type Plan,
  type RackGroup,
  type Row,
} from '@twin/schema'
import { count, formatRows, pad } from './format'

export const KIND_LABEL: Record<CatalogKind, string> = {
  gpu: 'GPU',
  rack: 'rack type',
  rackCooling: 'rack cooling method',
  heatRejection: 'heat rejection method',
  coolant: 'coolant',
  equipment: 'equipment model',
  climate: 'climate',
}

/**
 * Finds a catalog entry, looking in the plan's own catalog first (it holds custom entries added
 * earlier in the same batch), then in the resolved catalog.
 */
export function findEntry<K extends CatalogKind>(plan: Plan, catalog: CatalogIndex, id: string, kind: K): CatalogEntryOfKind<K> | undefined {
  const own = plan.catalog[id]
  if (own) return own.kind === kind ? (own as CatalogEntryOfKind<K>) : undefined
  return catalog.get(id, kind)
}

/** Every entry visible to the plan: the resolved catalog with the plan's own entries over it. */
export function allEntries(plan: Plan, catalog: CatalogIndex): CatalogEntry[] {
  const byId = new Map(catalog.all().map((e) => [e.id, e]))
  for (const entry of Object.values(plan.catalog)) byId.set(entry.id, entry)
  return [...byId.values()]
}

interface RequireOptions<K extends CatalogKind> {
  label?: string
  accept?: (entry: CatalogEntryOfKind<K>) => boolean
}

/** Like `findEntry`, but throws a CommandError that lists the valid ids. */
export function requireEntry<K extends CatalogKind>(
  plan: Plan,
  catalog: CatalogIndex,
  id: string,
  kind: K,
  path: string,
  options: RequireOptions<K> = {},
): CatalogEntryOfKind<K> {
  const label = options.label ?? KIND_LABEL[kind]
  const accept = options.accept ?? (() => true)
  const entry = findEntry(plan, catalog, id, kind)
  if (entry && accept(entry)) return entry
  const known = allEntries(plan, catalog)
    .filter((e): e is CatalogEntryOfKind<K> => e.kind === kind && accept(e as CatalogEntryOfKind<K>))
    .map((e) => e.id)
  throw new CommandError(`Unknown ${label} "${id}". Known ${label}s: ${known.join(', ') || 'none'}`, path)
}

/** The display name of a catalog entry the plan already holds, or its id. */
export function entryName(plan: Plan, id: string): string {
  return plan.catalog[id]?.name ?? id
}

export function requireGroup(plan: Plan, groupId: string, path = 'payload.groupId'): RackGroup {
  const group = plan.rackGroups.find((g) => g.id === groupId)
  if (group) return group
  const known = plan.rackGroups.map((g) => `${g.id} (${g.name})`).join(', ') || 'none'
  throw new CommandError(`Unknown rack group "${groupId}". Known rack groups: ${known}`, path)
}

export function requireRow(plan: Plan, rowId: string, path = 'payload.rowId'): Row {
  const row = plan.hall.rows.find((r) => r.id === rowId)
  if (row) return row
  throw new CommandError(`Unknown row "${rowId}". Known rows: ${plan.hall.rows.map((r) => r.id).join(', ')}`, path)
}

export function requirePlacement(plan: Plan, id: string, path: string): Placement {
  const placement = plan.placements.find((p) => p.id === id)
  if (placement) return placement
  throw new CommandError(`Unknown rack "${id}". Rack ids are "<row>-<slot>", e.g. R1-00; the plan's placements list them.`, path)
}

/** Rows a group has racks in, as "rows R3–R5" (empty when nothing is placed). */
export function groupRowsLabel(plan: Plan, groupId: string): string {
  const rows = new Set(plan.placements.filter((p) => p.groupId === groupId).map((p) => p.rowId))
  if (rows.size === 0) return ''
  return `${rows.size === 1 ? 'row' : 'rows'} ${formatRows(plan, rows)}`
}

/** "Training block (rows R3–R5)", or just the name when the group has no racks. */
export function groupLabel(plan: Plan, groupId: string): string {
  const group = plan.rackGroups.find((g) => g.id === groupId)
  const name = group?.name ?? groupId
  const rows = groupRowsLabel(plan, groupId)
  return rows ? `${name} (${rows})` : name
}

export type WidthOf = (groupId: string) => number

/**
 * Slots a group's racks take. A group whose rack type is not in the catalog counts as one slot
 * wide, so geometry stays defined while the engine reports the missing entry.
 */
export function widthResolver(plan: Plan, catalog: CatalogIndex): WidthOf {
  return (groupId) => {
    const group = plan.rackGroups.find((g) => g.id === groupId)
    return (group && findEntry(plan, catalog, group.rackTypeId, 'rack')?.slotsWide) ?? 1
  }
}

/** Slot → id of the placement covering it, per row. */
export type Occupancy = Map<string, Map<number, string>>

export function occupancy(plan: Plan, widthOf: WidthOf, exceptId?: string): Occupancy {
  const occ: Occupancy = new Map(plan.hall.rows.map((r) => [r.id, new Map()]))
  for (const p of plan.placements) {
    if (p.id === exceptId) continue
    const row = occ.get(p.rowId)
    if (!row) continue
    for (let s = p.slot; s < p.slot + widthOf(p.groupId); s++) if (!row.has(s)) row.set(s, p.id)
  }
  return occ
}

/** Why a rack of `width` slots cannot stand at `slot`, or null when it fits. */
export function slotProblem(occ: Occupancy, row: Row, slot: number, width: number, rackName: string): string | null {
  const last = slot + width - 1
  if (last >= row.slotCount) {
    const range = `${row.id} has slots 00–${pad(row.slotCount - 1)}`
    if (width === 1) return `Slot ${placementId(row.id, slot)} is past the end of the row; ${range}`
    return `${rackName} is ${width} slots wide, so a rack at ${placementId(row.id, slot)} needs slots ${pad(slot)}–${pad(last)}, but ${range}`
  }
  const taken = occ.get(row.id)!
  for (let s = slot; s <= last; s++) {
    const owner = taken.get(s)
    if (owner) return `Slot ${placementId(row.id, s)} is taken by ${owner}`
  }
  return null
}

export function claim(occ: Occupancy, row: Row, slot: number, width: number, id: string): void {
  const taken = occ.get(row.id)!
  for (let s = slot; s < slot + width; s++) taken.set(s, id)
}

/** Every placement that does not fit, in plan order, as `{ index, message }`. */
export function layoutProblems(plan: Plan, widthOf: WidthOf): { index: number; message: string }[] {
  const occ: Occupancy = new Map(plan.hall.rows.map((r) => [r.id, new Map()]))
  const problems: { index: number; message: string }[] = []
  plan.placements.forEach((p, index) => {
    const row = plan.hall.rows.find((r) => r.id === p.rowId)
    if (!row) return
    const width = widthOf(p.groupId)
    const problem = slotProblem(occ, row, p.slot, width, `Rack ${p.id}`)
    if (problem) problems.push({ index, message: problem })
    else claim(occ, row, p.slot, width, p.id)
  })
  return problems
}

/** Rejects a rack-width change that would make placed racks overlap or overrun their rows. */
export function assertWidthFits(plan: Plan, widthOf: WidthOf, rackName: string, width: number, groupIds: string[]): void {
  const problems = layoutProblems(plan, widthOf)
  if (problems.length === 0) return
  const names = plan.rackGroups.filter((g) => groupIds.includes(g.id)).map((g) => g.name).join(', ')
  const more = problems.length > 1 ? ` (and ${count(problems.length - 1, 'more conflict')})` : ''
  throw new CommandError(`${rackName} is ${count(width, 'slot')} wide; the placed racks of ${names} would not fit: ${problems[0]!.message}${more}`)
}

/** Next free id of the form `<prefix><n>`. */
export function nextId(prefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const max = existing.reduce((m, id) => Math.max(m, Number(pattern.exec(id)?.[1] ?? 0)), 0)
  return `${prefix}${max + 1}`
}
