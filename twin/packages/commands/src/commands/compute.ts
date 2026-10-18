import { CommandError, type CatalogIndex, type Plan, type RackCoolingEntry, type RackEntry } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { count } from '../format'
import { assertWidthFits, entryName, groupLabel, groupRowsLabel, nextId, requireEntry, requireGroup, widthResolver } from '../lookup'

/** Rejects a rack and cooling-method pair the rack type does not list in `supportedCooling`. */
export function assertSupports(rack: RackEntry, method: RackCoolingEntry, path: string): void {
  if (rack.supportedCooling.includes(method.category)) return
  throw new CommandError(
    `${rack.name} does not support ${method.category} cooling (${method.name}). It supports: ${rack.supportedCooling.join(', ') || 'nothing listed'}.`,
    path,
  )
}

function assertUniqueName(plan: Plan, name: string, exceptId?: string): void {
  const clash = plan.rackGroups.find((g) => g.id !== exceptId && g.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) throw new CommandError(`A rack group named "${clash.name}" already exists (${clash.id})`, 'payload.name')
}

function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new CommandError('A rack group name cannot be blank', 'payload.name')
  return trimmed
}

/** Rejects a rack type whose width would make the group's placed racks overlap or overrun a row. */
function assertRackFits(plan: Plan, catalog: CatalogIndex, groupId: string, rack: RackEntry): void {
  const widthOf = widthResolver(plan, catalog)
  assertWidthFits(plan, (id) => (id === groupId ? rack.slotsWide : widthOf(id)), rack.name, rack.slotsWide, [groupId])
}

const createRackGroup = defineCommand({
  type: 'createRackGroup',
  layer: 'compute',
  title: 'Create rack group',
  description:
    'Creates an empty rack group: a named set of racks sharing one rack type and one rack cooling method. Both ids must exist in the catalog (kinds rack and rackCooling) and the rack type must support the cooling category. The new group id (g1, g2, ...) is in the result; place racks for it with placeRacks or fillRow.',
  apply(draft, payload, ctx) {
    const name = cleanName(payload.name)
    assertUniqueName(draft, name)
    const rack = requireEntry(draft, ctx.catalog, payload.rackTypeId, 'rack', 'payload.rackTypeId')
    const method = requireEntry(draft, ctx.catalog, payload.coolingMethodId, 'rackCooling', 'payload.coolingMethodId')
    assertSupports(rack, method, 'payload.coolingMethodId')
    const id = nextId('g', draft.rackGroups.map((g) => g.id))
    draft.rackGroups.push({ id, name, rackTypeId: rack.id, coolingMethodId: method.id })
  },
  summarize: (payload, plan) =>
    `Created rack group ${nextId('g', plan.rackGroups.map((g) => g.id))} "${payload.name.trim()}" (${entryName(plan, payload.rackTypeId)}, ${entryName(plan, payload.coolingMethodId)})`,
})

const setRackType = defineCommand({
  type: 'setRackType',
  layer: 'compute',
  title: 'Set rack type',
  description:
    'Changes the rack type (catalog kind rack) of every rack in a group, e.g. to switch rows of air-cooled racks to GB300 NVL72. The cooling method is not changed, so the evaluation may then flag cooling; fix it with setCoolingMethod. Rejected if a wider rack type would make placed racks overlap or run past a row end.',
  apply(draft, payload, ctx) {
    const group = requireGroup(draft, payload.groupId)
    const rack = requireEntry(draft, ctx.catalog, payload.rackTypeId, 'rack', 'payload.rackTypeId')
    assertRackFits(draft, ctx.catalog, group.id, rack)
    group.rackTypeId = rack.id
  },
  summarize: (payload, plan) => `${groupLabel(plan, payload.groupId)} set to ${entryName(plan, payload.rackTypeId)}`,
})

const renameRackGroup = defineCommand({
  type: 'renameRackGroup',
  layer: 'compute',
  title: 'Rename rack group',
  description: 'Renames a rack group. Names must be unique (case-insensitive) and not blank; the group id stays the same.',
  apply(draft, payload) {
    const group = requireGroup(draft, payload.groupId)
    const name = cleanName(payload.name)
    assertUniqueName(draft, name, group.id)
    group.name = name
  },
  summarize: (payload, plan) => {
    const old = plan.rackGroups.find((g) => g.id === payload.groupId)?.name ?? payload.groupId
    return `Rack group "${old}" renamed to "${payload.name.trim()}"`
  },
})

const deleteRackGroup = defineCommand({
  type: 'deleteRackGroup',
  layer: 'compute',
  title: 'Delete rack group',
  description:
    'Deletes a rack group and the notes attached to it (target group:<id>). Rejected while the group still has placed racks; remove them first with removeRacks.',
  apply(draft, payload) {
    const group = requireGroup(draft, payload.groupId)
    const placed = draft.placements.filter((p) => p.groupId === group.id).length
    if (placed > 0) {
      throw new CommandError(
        `${group.name} still has ${count(placed, 'placed rack')} in ${groupRowsLabel(draft, group.id)}. Remove them with removeRacks first.`,
        'payload.groupId',
      )
    }
    draft.rackGroups = draft.rackGroups.filter((g) => g.id !== group.id)
    draft.notes = draft.notes.filter((n) => n.target !== `group:${group.id}`)
  },
  summarize: (payload, plan) => {
    const name = plan.rackGroups.find((g) => g.id === payload.groupId)?.name ?? payload.groupId
    const notes = plan.notes.filter((n) => n.target === `group:${payload.groupId}`).length
    return `Deleted rack group "${name}"${notes > 0 ? ` and ${count(notes, 'note')} on it` : ''}`
  },
})

export const commands: AnyCommandDef[] = [createRackGroup, setRackType, renameRackGroup, deleteRackGroup]
