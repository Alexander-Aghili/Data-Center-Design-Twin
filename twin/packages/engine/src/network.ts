import type { Check, Evaluation, Metric, RackResult } from '@twin/schema'
import type { EvalContext } from './context'
import { emptyNetwork } from './empty'

export interface NetworkSlice {
  network: Evaluation['network']
  checks: Check[]
  metrics: Metric[]
}

/** Rack-to-leaf links, media, optics power and latency (Task 10). */
export function networkFabric(ctx: EvalContext, racks: RackResult[]): NetworkSlice {
  return { network: emptyNetwork(ctx.plan.network.oversubscription), checks: [], metrics: [] }
}
