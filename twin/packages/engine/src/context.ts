import type { CatalogEntry, CatalogIndex, CatalogKind, ClimateEntry, Plan, Rules } from '@twin/schema'

export type { CatalogIndex } from '@twin/schema'

export interface EvalContext {
  plan: Plan
  catalog: CatalogIndex
  rules: Rules
  climate: ClimateEntry
}

/** Indexes entries by id; a later entry with the same id replaces an earlier one. */
export function makeCatalogIndex(entries: CatalogEntry[]): CatalogIndex {
  const byId = new Map<string, CatalogEntry>()
  for (const entry of entries) byId.set(entry.id, entry)
  return {
    get<K extends CatalogKind>(id: string, kind?: K) {
      const entry = byId.get(id)
      if (!entry || (kind !== undefined && entry.kind !== kind)) return undefined
      return entry as Extract<CatalogEntry, { kind: K }>
    },
    all: () => [...byId.values()],
  }
}
