import type { Builtins, Evaluation, Plan } from '@twin/schema'
import { assemble } from './assemble'
import { attachCauses } from './causes'
import { makeCatalogIndex, withinRanges, type EvalContext } from './context'
import { airSide } from './cooling/air'
import { rideThrough } from './cooling/buffer'
import { liquidSide } from './cooling/liquid'
import { rejectHeat } from './cooling/rejection'
import { costAndSchedule } from './cost'
import { demandChecks } from './demand'
import { emptyEvaluation } from './empty'
import { floorLoads } from './floor'
import { applyFailureScenarios } from './n1'
import { networkFabric } from './network'
import { powerBudget } from './power'
import { computeRacks } from './racks'
import { sizeEquipment } from './sizing'

/**
 * Pure, deterministic evaluation of a plan. The catalog is `plan.catalog` merged over the built-ins
 * (plan entries win). A plan whose climate preset is missing evaluates to an empty result.
 */
export function evaluate(input: Plan, builtins: Builtins): Evaluation {
  const plan = withinRanges(input)
  const catalog = makeCatalogIndex([...builtins.entries, ...Object.values(plan.catalog)])
  const climate = catalog.get(plan.site.climateId, 'climate')
  if (!climate) return emptyEvaluation(plan.network.oversubscription)
  const ctx: EvalContext = { plan, catalog, rules: builtins.rules, climate }

  const placed = computeRacks(ctx)
  const air = airSide(ctx, placed)
  const liquid = liquidSide(ctx, air.racks)
  const racks = liquid.racks
  const sizing = sizeEquipment(ctx, racks, air, liquid)
  const rejection = rejectHeat(ctx, racks, sizing.equipment)
  const buffer = rideThrough(ctx, racks)
  const network = networkFabric(ctx, racks)
  const power = powerBudget(ctx, racks, sizing.equipment, rejection, network)
  const floor = floorLoads(ctx, racks, sizing.equipment)
  const cost = costAndSchedule(ctx, racks, sizing.equipment)
  const demand = demandChecks(ctx, racks, power)

  const base = assemble(ctx, { racks, air, liquid, sizing, rejection, buffer, network, power, floor, cost, demand })
  const withFailures = applyFailureScenarios(ctx, base)
  return { ...withFailures, checks: attachCauses(ctx, withFailures.checks) }
}
