import { CommandError, type CatalogEntry, type CatalogIndex, type Plan } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { KIND_LABEL, assertWidthFits, findEntry, widthResolver } from '../lookup'

/** Rejects references from a custom entry to catalog entries that do not exist. */
function assertReferences(plan: Plan, catalog: CatalogIndex, entry: CatalogEntry): void {
  if (entry.kind === 'rack' && entry.gpuId !== undefined && !findEntry(plan, catalog, entry.gpuId, 'gpu')) {
    throw new CommandError(`gpuId: unknown GPU "${entry.gpuId}"`, 'payload.entry.gpuId')
  }
  if (entry.kind === 'rackCooling' && entry.coolantId !== undefined && !findEntry(plan, catalog, entry.coolantId, 'coolant')) {
    throw new CommandError(`coolantId: unknown coolant "${entry.coolantId}"`, 'payload.entry.coolantId')
  }
}

/** Plan fields that refer to a catalog id, as paths. */
function usesOf(plan: Plan, id: string): string[] {
  const uses: string[] = []
  if (plan.site.climateId === id) uses.push('site.climateId')
  if (plan.cooling.heatRejectionId === id) uses.push('cooling.heatRejectionId')
  for (const g of plan.rackGroups) {
    if (g.rackTypeId === id) uses.push(`rackGroups.${g.id}.rackTypeId`)
    if (g.coolingMethodId === id) uses.push(`rackGroups.${g.id}.coolingMethodId`)
  }
  for (const o of plan.overrides) if (o.modelId === id) uses.push(`overrides.${o.key}.modelId`)
  for (const e of Object.values(plan.catalog)) {
    if (e.kind === 'rack' && e.gpuId === id) uses.push(`catalog.${e.id}.gpuId`)
    if (e.kind === 'rackCooling' && e.coolantId === id) uses.push(`catalog.${e.id}.coolantId`)
  }
  return uses
}

/** The plan's custom entry with this id, `builtin` for built-in ids, or undefined. */
function customEntry(plan: Plan, catalog: CatalogIndex, id: string): CatalogEntry | 'builtin' | undefined {
  const own = plan.catalog[id]
  if (own?.custom === true) return own
  return own || catalog.get(id) ? 'builtin' : undefined
}

const describeEntry = (entry: { kind: CatalogEntry['kind']; name: string; id: string }) => `custom ${KIND_LABEL[entry.kind]} "${entry.name}" (${entry.id})`

const addCatalogEntry = defineCommand({
  type: 'addCatalogEntry',
  layer: 'catalog',
  title: 'Add catalog entry',
  description:
    'Adds a custom catalog entry (GPU, rack type, rack cooling method, heat rejection, coolant, equipment or climate) to the plan, in the same shape as built-in entries. Numbers are quantities { value, unit, basis? }; a missing basis becomes "user". The id must be new; the entry is marked custom. Once added it can be used like a built-in.',
  apply(draft, payload, ctx) {
    const entry: CatalogEntry = { ...payload.entry, custom: true }
    if (draft.catalog[entry.id] || ctx.catalog.get(entry.id)) {
      throw new CommandError(
        `A catalog entry with id "${entry.id}" already exists. Pick a new id, or use updateCatalogEntry to change a custom entry.`,
        'payload.entry.id',
      )
    }
    assertReferences(draft, ctx.catalog, entry)
    draft.catalog[entry.id] = entry
  },
  summarize: (payload) => `Added ${describeEntry(payload.entry)}`,
})

const updateCatalogEntry = defineCommand({
  type: 'updateCatalogEntry',
  layer: 'catalog',
  title: 'Update catalog entry',
  description:
    'Replaces a custom catalog entry, matched by id, with a new full version of the same kind. Built-in entries cannot be changed; add a custom copy with a new id instead. A wider rack type is rejected if its placed racks would no longer fit.',
  apply(draft, payload, ctx) {
    const entry: CatalogEntry = { ...payload.entry, custom: true }
    const old = customEntry(draft, ctx.catalog, entry.id)
    if (old === 'builtin') {
      throw new CommandError(`${entry.id} is a built-in entry and cannot be changed. Add a custom copy with a new id instead.`, 'payload.entry.id')
    }
    if (!old) throw new CommandError(`No custom catalog entry "${entry.id}". Use addCatalogEntry to create it.`, 'payload.entry.id')
    if (old.kind !== entry.kind) {
      throw new CommandError(`${entry.id} is a ${KIND_LABEL[old.kind]}; an update cannot change it to a ${KIND_LABEL[entry.kind]}`, 'payload.entry.kind')
    }
    assertReferences(draft, ctx.catalog, entry)
    if (entry.kind === 'rack') {
      const groupIds = draft.rackGroups.filter((g) => g.rackTypeId === entry.id).map((g) => g.id)
      const widthOf = widthResolver(draft, ctx.catalog)
      assertWidthFits(draft, (id) => (groupIds.includes(id) ? entry.slotsWide : widthOf(id)), entry.name, entry.slotsWide, groupIds)
    }
    draft.catalog[entry.id] = entry
  },
  summarize: (payload) => `Updated ${describeEntry(payload.entry)}`,
})

const removeCatalogEntry = defineCommand({
  type: 'removeCatalogEntry',
  layer: 'catalog',
  title: 'Remove catalog entry',
  description:
    'Removes a custom catalog entry by id. Built-in entries cannot be removed, and an entry still used by the plan (site, cooling, rack groups, overrides or other custom entries) is rejected with the paths that use it.',
  apply(draft, payload, ctx) {
    const entry = customEntry(draft, ctx.catalog, payload.id)
    if (entry === 'builtin') throw new CommandError(`${payload.id} is a built-in entry and cannot be removed`, 'payload.id')
    if (!entry) throw new CommandError(`No custom catalog entry "${payload.id}"`, 'payload.id')
    const uses = usesOf(draft, payload.id)
    if (uses.length > 0) throw new CommandError(`${payload.id} is in use by ${uses.join(', ')}. Change those first.`, 'payload.id')
    delete draft.catalog[payload.id]
  },
  summarize: (payload, plan) => {
    const entry = plan.catalog[payload.id]
    return entry ? `Removed ${describeEntry(entry)}` : `Removed custom entry ${payload.id}`
  },
})

export const commands: AnyCommandDef[] = [addCatalogEntry, updateCatalogEntry, removeCatalogEntry]
