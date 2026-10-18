import { NETWORK_OVERSUBSCRIPTION_RANGE, POWER_OVERSUBSCRIPTION_RANGE, type CatalogEntry, type CatalogIndex, type CatalogKind, type ClimateEntry, type Plan, type Rules } from '@twin/schema'

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

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value))

/**
 * The plan with its oversubscription decisions inside the schema's ranges. Commands and import already
 * reject values outside them; this keeps a plan built some other way from dividing loads by almost zero
 * and sizing unbounded equipment counts.
 */
export function withinRanges(plan: Plan): Plan {
  const power = clamp(plan.power.oversubscription, POWER_OVERSUBSCRIPTION_RANGE)
  const network = clamp(plan.network.oversubscription, NETWORK_OVERSUBSCRIPTION_RANGE)
  if (power === plan.power.oversubscription && network === plan.network.oversubscription) return plan
  return { ...plan, power: { ...plan.power, oversubscription: power }, network: { ...plan.network, oversubscription: network } }
}
