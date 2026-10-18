import { CommandError, placementId, type CatalogIndex, type Plan, type RackGroup } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { count, formatSlots, listSome, pad } from '../format'
import { claim, findEntry, occupancy, requireGroup, requirePlacement, requireRow, slotProblem, widthResolver } from '../lookup'

/** The group's rack width (one slot when its rack type is missing) and display name for slot messages. */
function rackOf(plan: Plan, catalog: CatalogIndex, group: RackGroup): { width: number; name: string } {
  const rack = findEntry(plan, catalog, group.rackTypeId, 'rack')
  return { width: rack?.slotsWide ?? 1, name: rack?.name ?? group.name }
}

const groupName = (plan: Plan, groupId: string) => plan.rackGroups.find((g) => g.id === groupId)?.name ?? groupId

const CONTAINMENT_LABEL = { none: 'none', hotAisle: 'hot aisle', coldAisle: 'cold aisle' } as const

const placeRacks = defineCommand({
  type: 'placeRacks',
  layer: 'layout',
  title: 'Place racks',
  description:
    'Places racks of a rack group in one row at the given slot numbers (0-based, leftmost slot of each rack). A rack N slots wide also takes the next N-1 slots. Every slot must be free and inside the row, or nothing is placed. Placement ids are "<row>-<slot>" with two digits, e.g. R3-07.',
  apply(draft, payload, ctx) {
    const group = requireGroup(draft, payload.groupId)
    const row = requireRow(draft, payload.rowId)
    const { width, name } = rackOf(draft, ctx.catalog, group)
    const occ = occupancy(draft, widthResolver(draft, ctx.catalog))
    for (const slot of payload.slots) {
      const id = placementId(row.id, slot)
      const problem = slotProblem(occ, row, slot, width, name)
      if (problem) throw new CommandError(problem, 'payload.slots')
      claim(occ, row, slot, width, id)
      draft.placements.push({ id, groupId: group.id, rowId: row.id, slot })
    }
  },
  summarize: (payload, plan) => {
    const n = payload.slots.length
    return `Placed ${n} ${groupName(plan, payload.groupId)} ${n === 1 ? 'rack' : 'racks'} in ${payload.rowId} at ${n === 1 ? 'slot' : 'slots'} ${formatSlots(payload.slots)}`
  },
})

const fillRow = defineCommand({
  type: 'fillRow',
  layer: 'layout',
  title: 'Fill row',
  description:
    'Places `count` racks of a rack group in one row, walking east from slot `from` and using the first free slots that fit (occupied slots are skipped). It never wraps to another row: if fewer than `count` racks fit before the row end, nothing is placed and the error says how many fit.',
  apply(draft, payload, ctx) {
    const group = requireGroup(draft, payload.groupId)
    const row = requireRow(draft, payload.rowId)
    if (payload.from >= row.slotCount) {
      throw new CommandError(`Slot ${placementId(row.id, payload.from)} is past the end of the row; ${row.id} has slots 00–${pad(row.slotCount - 1)}`, 'payload.from')
    }
    const { width } = rackOf(draft, ctx.catalog, group)
    const occ = occupancy(draft, widthResolver(draft, ctx.catalog))
    const slots: number[] = []
    for (let slot = payload.from; slot < row.slotCount; ) {
      if (slotProblem(occ, row, slot, width, group.name)) {
        slot++
        continue
      }
      claim(occ, row, slot, width, placementId(row.id, slot))
      slots.push(slot)
      slot += width
    }
    if (slots.length < payload.count) {
      throw new CommandError(
        `${row.id} has room for ${slots.length} ${group.name} racks from slot ${pad(payload.from)} to the row end; ${payload.count} were asked for. Nothing was placed.`,
        'payload.count',
      )
    }
    for (const slot of slots.slice(0, payload.count)) {
      draft.placements.push({ id: placementId(row.id, slot), groupId: group.id, rowId: row.id, slot })
    }
  },
  summarize: (payload, plan) =>
    `Filled ${payload.rowId} with ${payload.count} ${groupName(plan, payload.groupId)} ${payload.count === 1 ? 'rack' : 'racks'} starting at slot ${pad(payload.from)}`,
})

const moveRack = defineCommand({
  type: 'moveRack',
  layer: 'layout',
  title: 'Move rack',
  description:
    'Moves one placed rack to another row and slot. The rack id changes to match its new place ("<row>-<slot>", e.g. R6-11) and notes on the rack follow it. The target slots must be free (the rack may overlap its own old slots) and inside the row.',
  apply(draft, payload, ctx) {
    const placement = requirePlacement(draft, payload.placementId, 'payload.placementId')
    const row = requireRow(draft, payload.rowId)
    const group = requireGroup(draft, placement.groupId)
    const { width, name } = rackOf(draft, ctx.catalog, group)
    const occ = occupancy(draft, widthResolver(draft, ctx.catalog), placement.id)
    const problem = slotProblem(occ, row, payload.slot, width, name)
    if (problem) throw new CommandError(problem, 'payload.slot')
    const oldId = placement.id
    const newId = placementId(row.id, payload.slot)
    Object.assign(placement, { id: newId, rowId: row.id, slot: payload.slot })
    for (const note of draft.notes) if (note.target === `rack:${oldId}`) note.target = `rack:${newId}`
  },
  summarize: (payload) => `Moved rack ${payload.placementId} to ${placementId(payload.rowId, payload.slot)}`,
})

const removeRacks = defineCommand({
  type: 'removeRacks',
  layer: 'layout',
  title: 'Remove racks',
  description:
    'Removes placed racks by placement id (e.g. ["R3-07", "R3-08"]) together with the notes on those racks. Every id must exist, or nothing is removed. The rack group itself stays.',
  apply(draft, payload) {
    const ids = new Set(payload.placementIds)
    const unknown = [...ids].filter((id) => !draft.placements.some((p) => p.id === id))
    if (unknown.length > 0) throw new CommandError(`Unknown racks: ${unknown.join(', ')}. Nothing was removed.`, 'payload.placementIds')
    draft.placements = draft.placements.filter((p) => !ids.has(p.id))
    draft.notes = draft.notes.filter((n) => !(n.target.startsWith('rack:') && ids.has(n.target.slice('rack:'.length))))
  },
  summarize: (payload, plan) => {
    const ids = [...new Set(payload.placementIds)]
    const targets = new Set(ids.map((id) => `rack:${id}`))
    const notes = plan.notes.filter((n) => targets.has(n.target)).length
    return `Removed ${count(ids.length, 'rack')} (${listSome(ids)})${notes > 0 ? ` and ${count(notes, 'note')} on them` : ''}`
  },
})

const setContainment = defineCommand({
  type: 'setContainment',
  layer: 'layout',
  title: 'Set containment',
  description:
    'Sets aisle containment for the hall: none, hotAisle or coldAisle. Containment raises the usable air temperature difference, so air-cooled racks need less airflow per kW.',
  apply(draft, payload) {
    draft.cooling.containment = payload.containment
  },
  summarize: (payload) => (payload.containment === 'none' ? 'Containment removed' : `Containment set to ${CONTAINMENT_LABEL[payload.containment]}`),
})

const assignZone = defineCommand({
  type: 'assignZone',
  layer: 'layout',
  title: 'Assign zone',
  description:
    'Sets which rows an equipment position (CDU, CRAH, plant, electrical or leaf position, by id such as cdu-E3 or crah-W2) serves. A row belongs to one position of each kind, so the rows are taken away from other positions of the same kind. An empty list leaves the position serving nothing.',
  apply(draft, payload) {
    const position = draft.hall.positions.find((p) => p.id === payload.positionId)
    if (!position) {
      throw new CommandError(
        `Unknown equipment position "${payload.positionId}". Known positions: ${draft.hall.positions.map((p) => p.id).join(', ')}`,
        'payload.positionId',
      )
    }
    for (const rowId of payload.rowIds) requireRow(draft, rowId, 'payload.rowIds')
    const rows = new Set(payload.rowIds)
    for (const other of draft.hall.positions) {
      if (other.kind === position.kind && other !== position) other.servesRows = other.servesRows.filter((r) => !rows.has(r))
    }
    position.servesRows = [...rows]
  },
  summarize: (payload, plan) => {
    const position = plan.hall.positions.find((p) => p.id === payload.positionId)
    const rows = new Set(payload.rowIds)
    const from = plan.hall.positions
      .filter((p) => p.kind === position?.kind && p.id !== payload.positionId && p.servesRows.some((r) => rows.has(r)))
      .map((p) => p.id)
    const served = rows.size > 0 ? [...rows].join(', ') : 'no rows'
    return `${payload.positionId} now serves ${served}${from.length > 0 ? ` (taken from ${from.join(', ')})` : ''}`
  },
})

export const commands: AnyCommandDef[] = [placeRacks, fillRow, moveRack, removeRacks, setContainment, assignZone]
