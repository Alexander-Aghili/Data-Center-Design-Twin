import type { Check, Metric, RackResult, RowLoad } from '@twin/schema'
import type { EvalContext } from '../context'

export interface LiquidSideResult {
  /** The input racks with flow, temperatures and flowShare filled in. */
  racks: RackResult[]
  rowFlows: Pick<RowLoad, 'rowId' | 'liquidW' | 'flowLps'>[]
  checks: Check[]
  metrics: Metric[]
}

/** Coolant flow, temperatures and row manifold balance (Task 8). */
export function liquidSide(ctx: EvalContext, racks: RackResult[]): LiquidSideResult {
  return { racks, rowFlows: [], checks: [], metrics: [] }
}
