import { formatIssues } from '@twin/commands'
import type { Check, EvalDiff, Evaluation, Plan, Proposal, ToolInputs, ToolName, ViewAction } from '@twin/schema'
import { ToolInputSchemas } from '@twin/schema'
import { z } from 'zod'
import type { PlanStore } from '../../contracts.js'
import type { PlanEngine, ProposalBook } from './propose.js'

/** Side events a tool asks the runtime to emit into the thread; the runtime adds the `messageId`. */
export type ToolEvent = { kind: 'link'; label: string; href: string } | { kind: 'proposal'; proposal: Proposal }

/** `content` goes back to the model; `summary` is the one-line change record shown in the thread. */
export type ToolOutcome = { ok: true; content: string; summary: string; events?: ToolEvent[] } | { ok: false; error: string }

export interface AgentTool {
  name: string
  description: string
  /** JSON Schema with top-level `type: "object"`. */
  inputSchema: object
  run(input: unknown): Promise<ToolOutcome>
}

/** Same signature as `generateBrief` (Task 18), so the server passes it straight in. */
export type BriefGenerator = (plan: Plan, evaluation: Evaluation, target: 'openfoam', agentNotes?: string) => string

export interface ToolDeps {
  store: PlanStore
  emitView: (a: ViewAction) => void
  proposals: ProposalBook
  brief: BriefGenerator
  /** Generated briefs go to `<dataDir>/briefs/`. */
  dataDir: string
  /** Defaults to the built-in registry, `evaluate` and `diffEvaluations`. */
  engine?: PlanEngine
}

export const success = (content: unknown, summary: string, events?: ToolEvent[]): ToolOutcome => ({
  ok: true,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  summary,
  ...(events ? { events } : {}),
})

export const failure = (error: string): ToolOutcome => ({ ok: false, error })

/** Runs a tool body; a thrown error becomes `ok: false` with its message, so the model sees it as is_error. */
export async function guard(body: () => ToolOutcome | Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await body()
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

/** Parses tool input; failures read as `path: problem` lines. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: formatIssues(parsed.error) }
}

// Property descriptions the zod contract cannot carry; merged into the generated JSON Schema.
const PROPERTY_DESCRIPTIONS: Partial<Record<ToolName, Record<string, string>>> = {
  get_plan: { section: 'Top-level plan key, e.g. "cooling", "rackGroups", "placements", "hall". Omit for the whole plan.' },
  get_evaluation: { detail: '"summary" for headline and problem checks, "full" for every metric, check, rack, equipment item, row and bay.' },
  explain_check: { checkId: 'Check id as "<kind>:<subjectId>", e.g. "layout.floorBay:B3-2".' },
  get_hourly: {
    series: 'Hourly series to return, e.g. ["pue", "facilityW"].',
    fromHour: 'First hour of the year, 0 to 8759. Default 0.',
    toHour: 'Last hour of the year (inclusive), 0 to 8759. Default 8759.',
    step: 'Return every n-th hour. Default keeps the result near 168 points.',
  },
  list_catalog: { kind: 'Only entries of this kind.', query: 'Case-insensitive text matched against id, name, vendor and summary.' },
  get_notes: { target: 'Note target or a prefix of one, e.g. "group:g2", "layer:cooling", "decision:cooling".' },
  search_knowledge: { query: 'Plain-language search, e.g. "rack 130 kW air cooling limit".', limit: 'Maximum hits, default 5.' },
  read_knowledge: { slug: 'Knowledge slug from search_knowledge or a catalog risk, e.g. "cooling/air-containment".' },
  propose_change: {
    title: 'Short card title in sentence case.',
    rationale: 'Why this change, in one or two sentences.',
    commands: 'Commands applied together if the person accepts. Each is {type, payload}; type is a command name (the part after "cmd_") and payload matches that cmd_ tool\'s input schema.',
    respectsNotes: 'Ids of the notes this change respects.',
    violatesNotes: 'Ids of the notes this change breaks. Say so in the rationale too.',
    annotate: 'Optional revision cloud on the 3D objects the proposal concerns.',
  },
  what_if: { commands: 'Commands to try, each {type, payload} as for the matching cmd_ tool.' },
  focus: { kind: 'What to look at.', id: 'Placement id ("R3-07"), row id ("R3"), bay id ("B3-2"), equipment key or position id.', shot: 'Optional camera shot; defaults by kind.' },
  annotate: { objectIds: '3D object ids such as a check\'s subject.objectIds, or plan ids: a rack placement (R3-07), a row (R3), a floor bay (B3-2) or an equipment key (cdu:R3).', label: 'Short label next to the tag.' },
  generate_simulation_brief: { agentNotes: 'Your narrative for the engineer: what to simulate first, what to compare, what to watch for.' },
}

/** JSON Schema of a non-command tool: the contract's zod schema plus property descriptions, closed to extra keys. */
function toolInputSchema(name: ToolName): object {
  const schema = z.toJSONSchema(ToolInputSchemas[name], { io: 'input' }) as { properties?: Record<string, Record<string, unknown>> }
  const descriptions = PROPERTY_DESCRIPTIONS[name] ?? {}
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, prop]) => [key, descriptions[key] ? { ...prop, description: descriptions[key] } : prop]),
  )
  return { ...schema, type: 'object', properties, additionalProperties: false }
}

/** Defines a non-command tool: validates input against the contract, turns thrown errors into `ok: false`. */
export function defineTool<N extends ToolName>(
  name: N,
  description: string,
  run: (input: ToolInputs[N]) => ToolOutcome | Promise<ToolOutcome>,
): AgentTool {
  // Indexing the schema record by a generic key loses the per-tool output type; ToolInputs restores it.
  const schema = ToolInputSchemas[name] as unknown as z.ZodType<ToolInputs[N]>
  return {
    name,
    description,
    inputSchema: toolInputSchema(name),
    async run(input) {
      const parsed = parseInput(schema, input)
      return parsed.ok ? guard(() => run(parsed.data)) : failure(parsed.error)
    },
  }
}

// ---------- compact shapes shared by several tools ----------

export function compactCheck(c: Check) {
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    value: c.value,
    limit: c.limit,
    unit: c.unit,
    utilization: c.utilization,
    ...(c.worstFailure && c.worstFailure.status !== c.status ? { worstFailure: c.worstFailure } : {}),
  }
}

/** The diff without check explanations and causes; those come from explain_check. */
export function compactDiff(d: EvalDiff) {
  return {
    headline: d.headline,
    worsened: d.worsened.map(compactCheck),
    improved: d.improved.map(compactCheck),
    resolved: d.resolved.map(compactCheck),
    newChecks: d.newChecks.map(compactCheck),
    capexDeltaUsd: d.capexDeltaUsd,
    buildWeeksDelta: d.buildWeeksDelta,
    waterDeltaM3PerDay: d.waterDeltaM3PerDay,
  }
}

/** One line for the thread, e.g. "1 check worse, 2 better; PUE (annual) 1.21 to 1.25". */
export function describeDiff(d: EvalDiff): string {
  const parts: string[] = []
  if (d.worsened.length) parts.push(`${d.worsened.length} ${d.worsened.length === 1 ? 'check' : 'checks'} worse`)
  const better = d.improved.length + d.resolved.filter((c) => !d.improved.some((i) => i.id === c.id)).length
  if (better) parts.push(`${better} better`)
  const pue = d.headline.pueAnnual
  if (pue && typeof pue.from === 'number' && typeof pue.to === 'number') parts.push(`annual PUE ${round(pue.from)} to ${round(pue.to)}`)
  return parts.length ? parts.join(', ') : 'No check or PUE change'
}

const round = (n: number) => Number(n.toPrecision(3))
