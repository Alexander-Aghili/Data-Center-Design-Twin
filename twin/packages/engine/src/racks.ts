import { num, type Bay, type Plan, type RackCoolingEntry, type RackEntry, type RackResult } from '@twin/schema'
import type { EvalContext } from './context'

export interface ResolvedGroup {
  rack: RackEntry
  method: RackCoolingEntry | undefined
}

/** The rack type and cooling method a rack group points at; undefined when the group or its rack type is missing. */
export function resolveGroup(ctx: EvalContext, groupId: string): ResolvedGroup | undefined {
  const group = ctx.plan.rackGroups.find((g) => g.id === groupId)
  const rack = group && ctx.catalog.get(group.rackTypeId, 'rack')
  if (!group || !rack) return undefined
  return { rack, method: ctx.catalog.get(group.coolingMethodId, 'rackCooling') }
}

/** Electrical peak of one rack type, for capacity checks. Falls back to nominal power when the peak is unknown. */
export function rackPeakW(rack: RackEntry): number {
  return num(rack.peakPowerW) ?? num(rack.nominalPowerW) ?? 0
}

function bayUnder(plan: Plan, x: number, z: number): Bay | undefined {
  return plan.hall.bays.find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d)
}

/**
 * Per-placement power, heat split and weight (Task 7).
 *
 * Heat split: `liquidW` is heat taken into the method's own coolant loop (cold plates or tank fluid), the
 * method's `toTechnicalLoop` capped by the rack's `maxLiquidFraction`. `facilityWaterW` is heat a rear door
 * puts straight into facility water at the rack. The rest leaves as air. Flow and temperatures stay null
 * for the liquid side to fill.
 */
export function computeRacks(ctx: EvalContext): RackResult[] {
  const out: RackResult[] = []
  for (const p of ctx.plan.placements) {
    const resolved = resolveGroup(ctx, p.groupId)
    const row = ctx.plan.hall.rows.find((r) => r.id === p.rowId)
    if (!resolved || !row) continue
    const { rack, method } = resolved

    const heatW = num(rack.nominalPowerW) ?? 0
    const liquidFraction = method ? Math.min(num(method.toTechnicalLoop) ?? 0, num(rack.maxLiquidFraction) ?? 0) : 0
    const doorFraction = method?.toFacilityWaterAtRack ? Math.min(num(method.toFacilityWaterAtRack) ?? 0, 1 - liquidFraction) : 0
    const liquidW = heatW * liquidFraction
    const facilityWaterW = heatW * doorFraction
    const maxRackW = method ? num(method.maxRackW) : null

    const centerX = row.x + (p.slot + rack.slotsWide / 2) * row.slotPitchM
    const centerZ = row.z + row.rackDepthM / 2

    out.push({
      placementId: p.id,
      groupId: p.groupId,
      rowId: p.rowId,
      slot: p.slot,
      objectId: `rack:${p.id}`,
      powerW: heatW,
      heatW,
      liquidW,
      facilityWaterW,
      airW: heatW - liquidW - facilityWaterW,
      flowLps: null,
      supplyC: null,
      returnC: null,
      airInletC: null,
      airOutletC: null,
      weightKg: (num(rack.weightKg) ?? 0) + (method ? (num(method.addedWeightKgPerRack) ?? 0) : 0),
      bayId: bayUnder(ctx.plan, centerX, centerZ)?.id ?? '',
      flowShare: null,
      coolingOk:
        method !== undefined &&
        maxRackW !== null &&
        heatW <= maxRackW &&
        (method.category === 'custom' || rack.supportedCooling.includes(method.category)),
    })
  }
  return out
}
