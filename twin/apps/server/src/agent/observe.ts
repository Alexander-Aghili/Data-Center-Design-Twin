import type { Check, EvalDiff, Evaluation, Headline, Severity } from '@twin/schema'
import type { StoreChange } from '../contracts'

/** Edits closer together than this make one observation turn. */
const OBSERVATION_DEBOUNCE_MS = 1500
/** Relative headline move that is worth a remark even when no check got worse. */
const HEADLINE_THRESHOLD = 0.02
/** `worstHour` is an hour index, not a magnitude, so moving it says nothing on its own. */
const IGNORED_HEADLINE_KEYS: ReadonlySet<keyof Headline> = new Set(['worstHour'])

type HeadlineDelta = EvalDiff['headline'][keyof Headline]

/** Checks that got worse, plus new checks that start out as a warning or failure. */
function badChecks(diff: EvalDiff): Check[] {
  return [...diff.worsened, ...diff.newChecks.filter((c) => c.status === 'warn' || c.status === 'fail')]
}

function headlineMoved(delta: HeadlineDelta): boolean {
  if (!delta) return false
  const { from, to } = delta
  if (typeof from === 'number' && typeof to === 'number') {
    return from === 0 ? to !== 0 : Math.abs(to - from) / Math.abs(from) >= HEADLINE_THRESHOLD
  }
  return from !== to
}

function movedHeadline(diff: EvalDiff): [keyof Headline, NonNullable<HeadlineDelta>][] {
  return (Object.entries(diff.headline) as [keyof Headline, HeadlineDelta][]).flatMap(([key, delta]) =>
    delta && !IGNORED_HEADLINE_KEYS.has(key) && headlineMoved(delta) ? [[key, delta]] : [],
  )
}

export function isWorthObserving(diff: EvalDiff): boolean {
  return badChecks(diff).length > 0 || movedHeadline(diff).length > 0
}

export function severityOf(diff: EvalDiff): Severity {
  const bad = badChecks(diff)
  if (bad.some((c) => c.status === 'fail')) return 'problem'
  if (bad.some((c) => c.status === 'warn')) return 'warning'
  return 'info'
}

const num = (v: number | boolean | null) => (typeof v === 'number' ? String(Number(v.toPrecision(6))) : String(v))

function describeCheck(c: Check): string {
  const reading = c.value === null ? 'no value' : `${num(c.value)}${c.limit === null ? '' : ` of ${num(c.limit)}`} ${c.unit}`.trim()
  return `- ${c.id} is now ${c.status} (${c.title}): ${reading}`
}

/** The user-turn text for an observation: the merged diff of a burst of edits, wrapped in `<app_event>`. */
export function formatAppEvent(diff: EvalDiff, summaries: string[]): string {
  const lines = [`The person changed the plan: ${summaries.join('; ')}.`]
  const bad = badChecks(diff)
  if (bad.length > 0) lines.push('Worsened checks:', ...bad.map(describeCheck))
  const moved = movedHeadline(diff)
  if (moved.length > 0) lines.push('Headline changes:', ...moved.map(([key, d]) => `- ${key}: ${num(d.from)} to ${num(d.to)}`))
  if (diff.resolved.length > 0) lines.push(`Resolved checks: ${diff.resolved.map((c) => c.id).join(', ')}`)
  if (diff.improved.length > 0) lines.push(`Improved checks: ${diff.improved.map((c) => c.id).join(', ')}`)
  const deltas = [
    diff.capexDeltaUsd !== 0 && `capex ${num(diff.capexDeltaUsd)} USD`,
    diff.buildWeeksDelta !== 0 && `build time ${num(diff.buildWeeksDelta)} weeks`,
    diff.waterDeltaM3PerDay !== 0 && `peak water ${num(diff.waterDeltaM3PerDay)} m³/day`,
  ].filter((d): d is string => typeof d === 'string')
  if (deltas.length > 0) lines.push(`Changes: ${deltas.join(', ')}`)
  return `<app_event>\n${lines.join('\n')}\n</app_event>`
}

export interface MergedChanges {
  prev: Evaluation
  next: Evaluation
  summaries: string[]
}

/**
 * Debounces a burst of user edits into one merged change: the evaluation before the first edit,
 * the evaluation after the last one, and every summary in order.
 */
export class ChangeCoalescer {
  #pending: MergedChanges | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly onFlush: (merged: MergedChanges) => void) {}

  add(change: StoreChange): void {
    this.#pending = this.#pending
      ? { prev: this.#pending.prev, next: change.next, summaries: [...this.#pending.summaries, change.summary] }
      : { prev: change.prev, next: change.next, summaries: [change.summary] }
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#flush(), OBSERVATION_DEBOUNCE_MS)
  }

  clear(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#pending = null
  }

  #flush(): void {
    const merged = this.#pending
    this.clear()
    if (merged) this.onFlush(merged)
  }
}
