import type { EvalDiff, Evaluation } from '@twin/schema'

/** What changed between two evaluations (Task 11). */
export function diffEvaluations(prev: Evaluation, next: Evaluation): EvalDiff {
  return { headline: {}, worsened: [], improved: [], resolved: [], newChecks: [], capexDeltaUsd: 0, buildWeeksDelta: 0, waterDeltaM3PerDay: 0 }
}
