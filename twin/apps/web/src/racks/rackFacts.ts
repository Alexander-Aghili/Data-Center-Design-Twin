import type { CatalogIndex, Placement, Plan, RackCoolingCategory, RackCoolingEntry, RackEntry, Row } from '@twin/schema'

/** "B300" from "NVIDIA B300 (HGX, SXM)", "MI455X" from "AMD Instinct MI455X": the model, without vendor or variant. */
export function gpuShortName(name: string): string {
  const words = name.replace(/\s*\([^)]*\)/g, '').trim().split(/\s+/)
  return words.at(-1) || name
}

export const ROLE_LABEL: Record<RackEntry['role'], string> = { compute: 'Compute', network: 'Network', storage: 'Storage' }

/** What a rack carries in a word or two: its GPU model, or "Network" and "Storage" for racks without GPUs. */
export function rackCarries(rack: RackEntry | undefined, catalog: CatalogIndex): string {
  if (!rack) return 'Unknown rack'
  const gpu = rack.gpuId ? catalog.get(rack.gpuId, 'gpu') : undefined
  return gpu ? gpuShortName(gpu.name) : ROLE_LABEL[rack.role]
}

/** The GPU's full name without the variant in brackets: "NVIDIA B300". */
export function gpuName(rack: RackEntry, catalog: CatalogIndex): string | null {
  const gpu = rack.gpuId ? catalog.get(rack.gpuId, 'gpu') : undefined
  return gpu ? gpu.name.replace(/\s*\([^)]*\)/g, '').trim() : null
}

const COOLING_LABEL: Record<RackCoolingCategory, string> = {
  air: 'air',
  rdhx: 'rear door',
  'dlc-1p': 'direct-to-chip',
  'dlc-2p': 'two-phase direct-to-chip',
  'immersion-1p': 'immersion',
  'immersion-2p': 'two-phase immersion',
  custom: 'custom cooling',
}

const or = new Intl.ListFormat('en-US', { type: 'disjunction' })

/** "Air or rear door": the cooling a rack type takes, in sentence case. */
export function coolingTaken(rack: RackEntry): string {
  const text = or.format(rack.supportedCooling.map((c) => COOLING_LABEL[c]))
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'No cooling listed'
}

/** Rack types for the card grid: GPU racks first, then network and storage, each in catalog order. */
export function rackTypes(catalog: CatalogIndex): RackEntry[] {
  const racks = catalog.all().filter((e): e is RackEntry => e.kind === 'rack')
  return [...racks.filter((r) => r.role === 'compute'), ...racks.filter((r) => r.role !== 'compute')]
}

/** Methods the rack takes, grouped by the order of its `supportedCooling`, smallest capacity first within a category. */
export function coolingMethodsFor(rack: RackEntry, catalog: CatalogIndex): RackCoolingEntry[] {
  const rank = (m: RackCoolingEntry) => rack.supportedCooling.indexOf(m.category)
  return catalog
    .all()
    .filter((e): e is RackCoolingEntry => e.kind === 'rackCooling' && rank(e) >= 0)
    .sort((a, b) => rank(a) - rank(b) || (a.maxRackW.value ?? Infinity) - (b.maxRackW.value ?? Infinity))
}

/** The method a new group starts on: the smallest mainstream one that carries the rack's load. */
export function defaultMethod(rack: RackEntry, catalog: CatalogIndex): RackCoolingEntry | undefined {
  const methods = coolingMethodsFor(rack, catalog)
  const mainstream = methods.filter((m) => m.status === 'mainstream')
  const pool = mainstream.length > 0 ? mainstream : methods
  const load = rack.nominalPowerW.value ?? 0
  const bySize = pool.toSorted((a, b) => (a.maxRackW.value ?? Infinity) - (b.maxRackW.value ?? Infinity))
  return bySize.find((m) => (m.maxRackW.value ?? 0) >= load) ?? bySize.at(-1)
}

/** True when the method's rated rack load is below what the rack draws. */
export function methodTooSmall(method: RackCoolingEntry, rack: RackEntry): boolean {
  const limit = method.maxRackW.value
  const load = rack.nominalPowerW.value
  return limit !== null && load !== null && limit < load
}

/** The group's racks in hall order: by row as the hall lists them, then by slot. */
export function groupRacks(plan: Plan, groupId: string): Placement[] {
  const rowOrder = new Map(plan.hall.rows.map((r, i) => [r.id, i]))
  return plan.placements
    .filter((p) => p.groupId === groupId)
    .sort((a, b) => (rowOrder.get(a.rowId) ?? 0) - (rowOrder.get(b.rowId) ?? 0) || a.slot - b.slot)
}

/** The rack group a selection belongs to: the group itself, or the group of a selected rack or GPU. */
export function selectedGroupId(plan: Plan, selection: { kind: string; id: string } | null): string | null {
  if (!selection) return null
  if (selection.kind === 'group') return selection.id
  if (selection.kind !== 'rack' && selection.kind !== 'gpu') return null
  return plan.placements.find((p) => p.id === selection.id)?.groupId ?? null
}

const widthOf = (plan: Plan, catalog: CatalogIndex, groupId: string) => {
  const group = plan.rackGroups.find((g) => g.id === groupId)
  return (group && catalog.get(group.rackTypeId, 'rack')?.slotsWide) || 1
}

/**
 * The slots where racks `width` slots wide would go in a row, walking east from slot 0 over the free slots
 * the way `fillRow` does, so `fillRow` from 0 with up to this many racks always succeeds.
 */
export function freeStarts(plan: Plan, catalog: CatalogIndex, row: Row, width: number): number[] {
  const taken = Array.from({ length: row.slotCount }, () => false)
  for (const p of plan.placements) {
    if (p.rowId !== row.id) continue
    const w = widthOf(plan, catalog, p.groupId)
    for (let k = p.slot; k < Math.min(p.slot + w, row.slotCount); k++) taken[k] = true
  }
  const starts: number[] = []
  for (let slot = 0; slot + width <= row.slotCount; ) {
    if (taken.slice(slot, slot + width).some(Boolean)) {
      slot++
      continue
    }
    starts.push(slot)
    slot += width
  }
  return starts
}

/** "Rack group 3", or the next free number, so a new group's suggested name never clashes. */
export function suggestedName(plan: Plan): string {
  const names = new Set(plan.rackGroups.map((g) => g.name.trim().toLowerCase()))
  let n = plan.rackGroups.length + 1
  while (names.has(`rack group ${n}`)) n++
  return `Rack group ${n}`
}
