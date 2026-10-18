import type { Check, Evaluation, Metric, RackResult, SizedEquipment } from '@twin/schema'
import type { EvalContext } from './context'
import { emptyCost } from './empty'

export interface CostSlice {
  cost: Evaluation['cost']
  checks: Check[]
  metrics: Metric[]
}

/** Capex, build-out weeks and cost of delay (Task 11). */
export function costAndSchedule(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): CostSlice {
  return { cost: emptyCost(), checks: [], metrics: [] }
}
