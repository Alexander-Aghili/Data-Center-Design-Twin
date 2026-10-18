import { COMMAND_TOOL_PREFIX } from '@twin/schema'
import type { PlanStore } from '../../contracts.js'
import type { PlanEngine } from './propose.js'
import { checkSummary, compactDiff, defineTool, failure, guard, parseInput, success, type AgentTool } from './schema.js'

/**
 * One `cmd_<type>` tool per registry command, with the command's own JSON Schema and description,
 * so every UI capability is an agent capability. Each applies through the store as author `agent`.
 */
export function commandTools(store: PlanStore, engine: PlanEngine): AgentTool[] {
  return engine.registry.listCommands().map((info): AgentTool => {
    const def = engine.registry.registry.get(info.type)
    if (!def) throw new Error(`Command "${info.type}" is listed but not registered`)
    return {
      name: `${COMMAND_TOOL_PREFIX}${info.type}`,
      description: info.description,
      inputSchema: info.jsonSchema,
      async run(input) {
        const parsed = parseInput(def.payload, input)
        if (!parsed.ok) return failure(parsed.error)
        return guard(() => {
          const prev = store.state().evaluation
          const result = store.dispatch({ type: info.type, payload: parsed.data }, 'agent')
          if (!result.ok) return failure(result.error)
          const next = store.state().evaluation
          return success({ applied: result.summary, diff: compactDiff(engine.diff(prev, next)), checksAfter: checkSummary(next) }, result.summary)
        })
      },
    }
  })
}

export function historyTools(store: PlanStore): AgentTool[] {
  const step = (direction: 'undo' | 'redo') => {
    const label = store.state().history.last
    const done = direction === 'undo' ? store.undo() : store.redo()
    if (!done) return failure(`There is nothing to ${direction}.`)
    const { history } = store.state()
    const verb = direction === 'undo' ? 'Undid' : 'Redid'
    const what = direction === 'undo' && label ? `: ${label}` : ''
    return success({ done: `${verb} the last change${what}`, history }, `${verb} the last change${what}`)
  }
  return [
    defineTool(
      'undo',
      'Undoes the most recent change to the plan, whoever made it. Use it only when the person asks to undo or to go back. Returns what was undone and whether more undo or redo steps remain.',
      () => step('undo'),
    ),
    defineTool(
      'redo',
      'Re-applies the change that was last undone. Use it only when the person asks to redo. Returns the new undo and redo state.',
      () => step('redo'),
    ),
  ]
}
