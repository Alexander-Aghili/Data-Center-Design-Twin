import type { Evaluation, RackResult } from '@twin/schema'
import type { EvalContext } from './context'
import type { AirSideResult } from './cooling/air'
import type { BufferResult } from './cooling/buffer'
import type { LiquidSideResult } from './cooling/liquid'
import type { RejectionResult } from './cooling/rejection'
import type { CostSlice } from './cost'
import type { DemandResult } from './demand'
import { emptyEvaluation } from './empty'
import type { FloorResult } from './floor'
import type { NetworkSlice } from './network'
import type { PowerResult } from './power'
import type { SizingResult } from './sizing'

/** Every module's output, in pipeline order. */
export interface EvalSlices {
  racks: RackResult[]
  air: AirSideResult
  liquid: LiquidSideResult
  sizing: SizingResult
  rejection: RejectionResult
  buffer: BufferResult
  network: NetworkSlice
  power: PowerResult
  floor: FloorResult
  cost: CostSlice
  demand: DemandResult
}

/** Merges the slices into one Evaluation: hourly series, rows, headline (Task 7). */
export function assemble(ctx: EvalContext, slices: EvalSlices): Evaluation {
  return emptyEvaluation(ctx.plan.network.oversubscription)
}
