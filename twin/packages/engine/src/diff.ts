import type { Check, EvalDiff, Evaluation, Headline, HourlySeries, HourlySeriesKey, Status } from '@twin/schema'

export const STATUS_ORDER: Record<Status, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 }
/** Utilization change inside warn/fail that counts as worse or better. */
const UTILIZATION_STEP = 0.05
/** Absorbs float noise so a 0.85 → 0.90 move counts as a full step. */
const EPS = 1e-9

const isProblem = (status: Status) => status === 'warn' || status === 'fail'

/** +1 worse, -1 better, 0 unchanged, for a check present in both evaluations. */
function direction(prev: Check, next: Check): -1 | 0 | 1 {
  const order = STATUS_ORDER[next.status] - STATUS_ORDER[prev.status]
  if (order !== 0) return order > 0 ? 1 : -1
  if (!isProblem(next.status) || prev.utilization === null || next.utilization === null) return 0
  const delta = next.utilization - prev.utilization
  if (delta >= UTILIZATION_STEP - EPS) return 1
  if (delta <= -UTILIZATION_STEP + EPS) return -1
  return 0
}

function headlineDelta(prev: Headline, next: Headline): EvalDiff['headline'] {
  const out: EvalDiff['headline'] = {}
  for (const key of Object.keys(next) as (keyof Headline)[]) {
    if (prev[key] !== next[key]) out[key] = { from: prev[key], to: next[key] }
  }
  return out
}

/**
 * What changed between two evaluations. Checks are matched by id. A new check that already warns or
 * fails also counts as worsened (its status rose from nothing), so observers that watch `worsened`
 * see it; a warn/fail check that disappears counts as resolved.
 */
export function diffEvaluations(prev: Evaluation, next: Evaluation): EvalDiff {
  const before = new Map(prev.checks.map((c) => [c.id, c]))
  const after = new Set(next.checks.map((c) => c.id))
  const worsened: Check[] = []
  const improved: Check[] = []
  const resolved: Check[] = []
  const newChecks: Check[] = []

  for (const check of next.checks) {
    const old = before.get(check.id)
    if (!old) {
      newChecks.push(check)
      if (isProblem(check.status)) worsened.push(check)
      continue
    }
    if (isProblem(old.status) && check.status === 'pass') {
      resolved.push(check)
      continue
    }
    const dir = direction(old, check)
    if (dir > 0) worsened.push(check)
    else if (dir < 0) improved.push(check)
  }
  for (const old of prev.checks) {
    if (!after.has(old.id) && isProblem(old.status)) resolved.push(old)
  }

  return {
    headline: headlineDelta(prev.headline, next.headline),
    worsened,
    improved,
    resolved,
    newChecks,
    capexDeltaUsd: next.cost.capexUsd - prev.cost.capexUsd,
    buildWeeksDelta: next.cost.buildWeeks - prev.cost.buildWeeks,
    waterDeltaM3PerDay: next.headline.waterM3PerDayPeak - prev.headline.waterM3PerDayPeak,
  }
}

/** True when two hourly series hold the same values; lets the server and the local backend skip resending 8760-hour arrays. */
export function sameHourly(a: HourlySeries, b: HourlySeries): boolean {
  return (Object.keys(a) as HourlySeriesKey[]).every((key) => {
    const x = a[key]
    const y = b[key]
    return x.length === y.length && x.every((v, i) => v === y[i])
  })
}
