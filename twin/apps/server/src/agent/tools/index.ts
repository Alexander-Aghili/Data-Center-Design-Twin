import type { AgentTool, ToolDeps } from './schema.js'
import { commandTools, historyTools } from './act.js'
import { documentTools } from './documents.js'
import { defaultEngine, proposeTools } from './propose.js'
import { readTools } from './read.js'
import { createTagCounter, viewTools } from './view.js'

export { ProposalBook, type PlanEngine, type ProposalApplyResult, type ProposalDraft } from './propose.js'
export type { AgentTool, BriefGenerator, ToolDeps, ToolEvent, ToolOutcome } from './schema.js'

/**
 * Every agent tool, in a fixed order (stable for prompt caching): read, act (undo, redo and one cmd_ tool
 * per registry command), propose, view, documents.
 */
export function buildTools(deps: ToolDeps): AgentTool[] {
  const engine = deps.engine ?? defaultEngine
  const tags = createTagCounter()
  return [
    ...readTools(deps.store),
    ...historyTools(deps.store),
    ...commandTools(deps.store, engine),
    ...proposeTools({ proposals: deps.proposals, tags, emitView: deps.emitView }),
    ...viewTools({ store: deps.store, emitView: deps.emitView, tags }),
    ...documentTools(deps),
  ]
}

const MAX_NUMBERS = 200
const NUMBER_IN_TEXT = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi

/**
 * Distinct numeric values in a tool result, in order of appearance (at most 200), for the `toolResult` event's
 * grounding marks. JSON results are walked value by value; plain text (Markdown) is scanned for numbers.
 */
export function toolResultNumbers(content: string): number[] {
  const found = new Set<number>()
  const add = (n: number) => {
    if (found.size < MAX_NUMBERS && Number.isFinite(n)) found.add(n)
  }
  const walk = (value: unknown): void => {
    if (found.size >= MAX_NUMBERS) return
    if (typeof value === 'number') add(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    for (const match of content.matchAll(NUMBER_IN_TEXT)) add(Number(match[0]))
    return [...found]
  }
  walk(parsed)
  return [...found]
}
