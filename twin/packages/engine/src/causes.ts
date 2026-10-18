import type { Check } from '@twin/schema'
import type { EvalContext } from './context'

/** Links each check to the decisions that drive it (Task 11). */
export function attachCauses(ctx: EvalContext, checks: Check[]): Check[] {
  return checks
}
