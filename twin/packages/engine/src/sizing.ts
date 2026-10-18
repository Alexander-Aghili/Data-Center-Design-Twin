import type { Check, RackResult, SizedEquipment } from '@twin/schema'
import type { EvalContext } from './context'
import type { AirSideResult } from './cooling/air'
import type { LiquidSideResult } from './cooling/liquid'

export interface SizingResult {
  equipment: SizedEquipment[]
  checks: Check[]
}

/** Auto-sizes CDUs, CRAHs, plant, busways, UPS, transformers and leaves into hall positions (Task 8). */
export function sizeEquipment(ctx: EvalContext, racks: RackResult[], air: AirSideResult, liquid: LiquidSideResult): SizingResult {
  return { equipment: [], checks: [] }
}
