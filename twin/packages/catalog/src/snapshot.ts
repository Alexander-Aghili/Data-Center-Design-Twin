import type { CatalogEntry, Plan } from '@twin/schema'

/** Ids a plan names directly. */
function planReferences(plan: Plan): string[] {
  return [
    plan.site.climateId,
    plan.cooling.heatRejectionId,
    ...plan.rackGroups.flatMap((g) => [g.rackTypeId, g.coolingMethodId]),
    ...plan.overrides.flatMap((o) => (o.modelId === undefined ? [] : [o.modelId])),
  ]
}

/** Ids an entry names. */
function entryReferences(entry: CatalogEntry): string[] {
  if (entry.kind === 'rack' && entry.gpuId !== undefined) return [entry.gpuId]
  if (entry.kind === 'rackCooling' && entry.coolantId !== undefined) return [entry.coolantId]
  return []
}

/**
 * Returns the plan with `catalog` holding the entries it uses (directly or through a rack's
 * GPU or a cooling method's coolant) plus every custom entry, so the plan file stands alone.
 * A copy already in the plan wins over `entries`, matching how the engine resolves the catalog.
 * Ids found nowhere stay unresolved; the engine reports them.
 */
export function snapshotCatalog(plan: Plan, entries: readonly CatalogEntry[]): Plan {
  const available = new Map<string, CatalogEntry>(entries.map((e) => [e.id, e]))
  for (const entry of Object.values(plan.catalog)) available.set(entry.id, entry)

  const custom = [...available.values()].filter((e) => e.custom === true).map((e) => e.id)
  const pending = [...planReferences(plan), ...custom]
  const catalog: Record<string, CatalogEntry> = {}
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const entry = available.get(id)
    if (!entry || id in catalog) continue
    catalog[id] = structuredClone(entry)
    pending.push(...entryReferences(entry))
  }
  return { ...plan, catalog: Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : 1))) }
}
