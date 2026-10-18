import type { BayLoad, Check, Metric, RackResult, SizedEquipment } from '@twin/schema'
import type { EvalContext } from './context'

export interface FloorResult {
  bays: BayLoad[]
  checks: Check[]
  metrics: Metric[]
}

/** Floor bay and point loads (Task 10). */
export function floorLoads(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): FloorResult {
  return { bays: [], checks: [], metrics: [] }
}
