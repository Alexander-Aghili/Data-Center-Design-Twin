import type { Check, Evaluation, HourlySeries, Metric, RackResult, RowLoad, SizedEquipment } from '@twin/schema'
import type { EvalContext } from './context'
import type { RejectionResult } from './cooling/rejection'
import type { NetworkSlice } from './network'

export interface PowerResult {
  hourly: Pick<HourlySeries, 'itW' | 'facilityW' | 'pue'>
  rows: Pick<RowLoad, 'rowId' | 'buswayLoadA'>[]
  checks: Check[]
  metrics: Metric[]
  headline: Partial<Evaluation['headline']>
}

/** Facility power each hour against the grid cap, busways, UPS and transformers (Task 7). */
export function powerBudget(
  ctx: EvalContext,
  racks: RackResult[],
  equipment: SizedEquipment[],
  rejection: RejectionResult,
  network: NetworkSlice,
): PowerResult {
  return { hourly: { itW: [], facilityW: [], pue: [] }, rows: [], checks: [], metrics: [], headline: {} }
}
