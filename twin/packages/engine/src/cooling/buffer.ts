import type { Check, Metric, RackResult } from '@twin/schema'
import type { EvalContext } from '../context'

export interface BufferResult {
  checks: Check[]
  metrics: Metric[]
}

/** Buffer tank ride-through against chiller restart (Task 9). */
export function rideThrough(ctx: EvalContext, racks: RackResult[]): BufferResult {
  return { checks: [], metrics: [] }
}
