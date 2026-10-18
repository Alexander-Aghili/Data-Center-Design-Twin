import type { ViewAction } from '@twin/schema'
import type { PlanStore } from '../../contracts.js'
import { defineTool, failure, success, type AgentTool } from './schema.js'

/** Numbers revision-cloud tags 1, 2, 3, … across annotate and propose_change, for the whole session. */
export interface TagCounter {
  next(): number
}

export function createTagCounter(): TagCounter {
  let last = 0
  return { next: () => ++last }
}

type FocusKind = Extract<ViewAction, { type: 'focus' }>['target']['kind']

/** Returns an error when the id does not name an object of that kind in the current plan. */
function checkTarget(store: PlanStore, kind: FocusKind, id: string): string | null {
  const { plan, evaluation } = store.state()
  const placements = plan.placements.map((p) => p.id)
  const known: Record<FocusKind, () => string[]> = {
    rack: () => placements,
    row: () => plan.hall.rows.map((r) => r.id),
    bay: () => plan.hall.bays.map((b) => b.id),
    equipment: () => [...plan.hall.positions.map((p) => p.id), ...evaluation.equipment.map((e) => e.key)],
    gpu: () => placements,
  }
  const ids = known[kind]()
  const found = kind === 'gpu' ? ids.some((p) => id.startsWith(p)) : ids.includes(id)
  if (found) return null
  const sample = ids.slice(0, 12).join(', ')
  return kind === 'gpu'
    ? `No rack holds GPU "${id}". GPU ids start with a placement id such as ${ids[0] ?? 'R1-00'}.`
    : `No ${kind} "${id}" in the plan. Known ${kind} ids include: ${sample}${ids.length > 12 ? ', …' : ''}`
}

export function viewTools(deps: { store: PlanStore; emitView: (a: ViewAction) => void; tags: TagCounter }): AgentTool[] {
  const { store, emitView, tags } = deps
  return [
    defineTool(
      'set_layer',
      'Switches the app to a layer (site, workload, compute, layout, cooling, power or network) with its default camera shot and overlay. Use it when the conversation moves to another layer so the person sees what you are talking about. Returns a confirmation.',
      (input) => {
        emitView({ type: 'setLayer', layer: input.layer })
        return success(`Layer set to ${input.layer}.`, `Showed the ${input.layer} layer`)
      },
    ),
    defineTool(
      'focus',
      'Moves the camera to a rack, row, floor bay, piece of equipment or GPU and selects it. Use it whenever you discuss a specific object, for example the worst floor bay or an overloaded CDU. Fails with a list of known ids when the id does not exist.',
      (input) => {
        const problem = checkTarget(store, input.kind, input.id)
        if (problem) return failure(problem)
        emitView({ type: 'focus', target: { kind: input.kind, id: input.id }, ...(input.shot ? { shot: input.shot } : {}) })
        return success(`Focused ${input.kind} ${input.id}.`, `Focused ${input.kind} ${input.id}`)
      },
    ),
    defineTool(
      'set_overlay',
      'Shows a data overlay on the 3D hall: liquid flow, air flow, temperature, floor load, power, network, or none. Use it to make a cooling, floor or power argument visible. Returns a confirmation.',
      (input) => {
        emitView({ type: 'setOverlay', overlay: input.overlay })
        return success(`Overlay set to ${input.overlay}.`, `Showed the ${input.overlay} overlay`)
      },
    ),
    defineTool(
      'annotate',
      'Draws a revision cloud with a numbered tag around 3D objects, such as the objectIds of a failing check. Use it to point at a problem while you explain it; problem severity draws in red. Returns the tag number so you can refer to it in your message.',
      (input) => {
        const tag = tags.next()
        emitView({ type: 'annotate', annotation: { tag, objectIds: input.objectIds, label: input.label, severity: input.severity } })
        return success({ tag }, `Marked ${input.label} (tag ${tag})`)
      },
    ),
    defineTool(
      'clear_annotations',
      'Removes every revision cloud from the 3D view. Use it when earlier marks no longer match the conversation, for example after a fix was applied. Returns a confirmation.',
      () => {
        emitView({ type: 'clearAnnotations' })
        return success('Annotations cleared.', 'Cleared the marks')
      },
    ),
  ]
}
