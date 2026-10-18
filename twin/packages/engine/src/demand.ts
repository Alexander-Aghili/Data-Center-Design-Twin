import type { Check, RackResult } from '@twin/schema'
import type { EvalContext } from './context'
import type { PowerResult } from './power'

export interface DemandResult {
  checks: Check[]
}

/** Demand problems: training swings, lead times, target compute (Task 11). */
export function demandChecks(ctx: EvalContext, racks: RackResult[], power: PowerResult): DemandResult {
  return { checks: [] }
}
