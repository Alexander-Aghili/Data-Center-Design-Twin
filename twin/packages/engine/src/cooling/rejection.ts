import type { Check, HourlySeries, Metric, RackResult, SizedEquipment } from '@twin/schema'
import type { EvalContext } from '../context'

export interface RejectionResult {
  hourly: Pick<HourlySeries, 'outdoorC' | 'wetBulbC' | 'coolingW' | 'trimW' | 'waterM3'>
  checks: Check[]
  metrics: Metric[]
}

/** Hour-by-hour heat rejection power and water (Task 9). */
export function rejectHeat(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): RejectionResult {
  return { hourly: { outdoorC: [], wetBulbC: [], coolingW: [], trimW: [], waterM3: [] }, checks: [], metrics: [] }
}
