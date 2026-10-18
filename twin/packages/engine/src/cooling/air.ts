import type { Check, Metric, RackResult, RowLoad } from '@twin/schema'
import type { EvalContext } from '../context'

export interface AirSideResult {
  rows: Pick<RowLoad, 'rowId' | 'airW'>[]
  checks: Check[]
  metrics: Metric[]
  /** Air heat per CRAH position id, in W. */
  crahLoads: Record<string, number>
}

/** Airflow, CRAH zone loads and rack air limits (Task 8). */
export function airSide(ctx: EvalContext, racks: RackResult[]): AirSideResult {
  return { rows: [], checks: [], metrics: [], crahLoads: {} }
}
