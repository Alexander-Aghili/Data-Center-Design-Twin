import { CommandError, LAYER_IDS, type Note, type Plan } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { excerpt } from '../format'
import { nextId, requireGroup, requirePlacement } from '../lookup'

const IMPORTANCE_LABEL = { must: 'Must', prefer: 'Prefer', fyi: 'FYI' } as const

function resolvesInPlan(plan: Plan, path: string): boolean {
  let node: unknown = plan
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) return false
    node = (node as Record<string, unknown>)[key]
  }
  return true
}

/** Rejects a note target that does not name something in the plan. */
function assertTarget(plan: Plan, target: string): void {
  const colon = target.indexOf(':')
  const kind = target.slice(0, colon)
  const id = target.slice(colon + 1)
  const path = 'payload.target'
  if (kind === 'decision') {
    if (!id || !resolvesInPlan(plan, id)) {
      throw new CommandError(`Unknown decision "${id}". Decision paths are plan fields, e.g. cooling.facilitySupplyC.`, path)
    }
  } else if (kind === 'group') requireGroup(plan, id, path)
  else if (kind === 'rack') requirePlacement(plan, id, path)
  else if (kind === 'layer') {
    if (!(LAYER_IDS as readonly string[]).includes(id)) throw new CommandError(`Unknown layer "${id}". Layers: ${LAYER_IDS.join(', ')}`, path)
  } else {
    throw new CommandError(`Note target "${target}" must start with decision:, group:, layer: or rack:`, path)
  }
}

function targetLabel(plan: Plan, target: string): string {
  const [kind, id] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)]
  if (kind === 'group') return `rack group "${plan.rackGroups.find((g) => g.id === id)?.name ?? id}"`
  if (kind === 'layer') return `the ${id} layer`
  if (kind === 'rack') return `rack ${id}`
  return id
}

function requireNote(plan: Plan, id: string): Note {
  const note = plan.notes.find((n) => n.id === id)
  if (note) return note
  throw new CommandError(`Unknown note "${id}". Notes: ${plan.notes.map((n) => n.id).join(', ') || 'none'}`, 'payload.id')
}

const addNote = defineCommand({
  type: 'addNote',
  layer: 'notes',
  title: 'Add note',
  description:
    'Attaches a note to a decision or object, written as an owner role. target is "decision:<plan path>" (e.g. decision:cooling.heatRejectionId), "group:<groupId>", "layer:<layer>" or "rack:<placementId>". importance is must, prefer or fyi. Use it to record constraints and preferences the person states.',
  apply(draft, payload) {
    assertTarget(draft, payload.target)
    draft.notes.push({
      id: nextId('note-', draft.notes.map((n) => n.id)),
      target: payload.target,
      importance: payload.importance,
      authorRole: payload.authorRole,
      text: payload.text.trim(),
      createdAt: new Date().toISOString(),
    })
  },
  summarize: (payload, plan) => `${IMPORTANCE_LABEL[payload.importance]} note on ${targetLabel(plan, payload.target)}: "${excerpt(payload.text.trim())}"`,
})

const editNote = defineCommand({
  type: 'editNote',
  layer: 'notes',
  title: 'Edit note',
  description: 'Changes the text and/or importance (must, prefer, fyi) of an existing note by id (e.g. note-1). Send at least one of the two.',
  apply(draft, payload) {
    const note = requireNote(draft, payload.id)
    if (payload.text === undefined && payload.importance === undefined) throw new CommandError('editNote needs text, importance or both', 'payload')
    if (payload.text !== undefined) note.text = payload.text.trim()
    if (payload.importance !== undefined) note.importance = payload.importance
  },
  summarize: ({ id, text, importance }) => {
    if (text !== undefined && importance !== undefined) return `Note ${id} text changed and set to ${importance}`
    return text !== undefined ? `Note ${id} text changed` : `Note ${id} changed to ${importance}`
  },
})

const removeNote = defineCommand({
  type: 'removeNote',
  layer: 'notes',
  title: 'Remove note',
  description: 'Deletes a note by id (e.g. note-1). Only do this when the person asks; notes record what owners want.',
  apply(draft, payload) {
    requireNote(draft, payload.id)
    draft.notes = draft.notes.filter((n) => n.id !== payload.id)
  },
  summarize: (payload, plan) => {
    const text = plan.notes.find((n) => n.id === payload.id)?.text
    return `Removed note ${payload.id}${text ? ` ("${excerpt(text)}")` : ''}`
  },
})

export const commands: AnyCommandDef[] = [addNote, editNote, removeNote]
