import type { Evaluation } from '@twin/schema'
import type { EvalContext } from './context'

/** Re-runs capacity checks with one unit removed and records the worst failure (Task 11). */
export function applyFailureScenarios(ctx: EvalContext, base: Evaluation): Evaluation {
  return base
}
