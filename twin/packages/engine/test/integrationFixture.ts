import { createDefaultPlan, loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { applyCommands } from '@twin/commands'
import { HEAT_REJECTION, RACK, RACK_COOLING, type Command, type Plan } from '@twin/schema'
import { makeCatalogIndex } from '../src'

/** The shipped built-in catalog and rules, as the server passes them to `evaluate`. */
export const builtins = loadBuiltins()
const catalog = makeCatalogIndex(builtins.entries)

/** The default plan as the server first stores it: catalog entries snapshotted into the plan. */
export function defaultPlan(): Plan {
  return snapshotCatalog(createDefaultPlan(), builtins.entries)
}

export function apply(plan: Plan, commands: Command[]): Plan {
  return applyCommands(plan, commands, catalog).plan
}

/** Facility supply for the dry-cooler step: the ASHRAE W32 liquid-cooling class, well inside GB300's 45 °C limit. */
export const DEMO_SUPPLY_C = 32

/** The spec's demo script (steps 2, 4 and 6) as commands. */
export const DEMO_STEPS = {
  /** Step 2: rows R3–R5 (group g2) become GB300 NVL72, still on air. */
  toGb300: [{ type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } }],
  /** Step 4: direct-to-chip liquid, warm facility water and dry coolers (water is scarce, so no towers). */
  toLiquid: [
    { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P } },
    { type: 'setFacilitySupplyTemp', payload: { celsius: DEMO_SUPPLY_C } },
    { type: 'setHeatRejection', payload: { heatRejectionId: HEAT_REJECTION.DRY_COOLER } },
  ],
  /**
   * Step 6: spread the load. Each GB300 row holds 6 racks in bay column B4 (slots 5–10); two of them move
   * to the empty column B6 (slots 17 and 18), leaving 4 in B4.
   */
  spreadFloor: ['R3', 'R4', 'R5'].flatMap((rowId): Command[] => [
    { type: 'moveRack', payload: { placementId: `${rowId}-09`, rowId, slot: 17 } },
    { type: 'moveRack', payload: { placementId: `${rowId}-10`, rowId, slot: 18 } },
  ]),
} satisfies Record<string, Command[]>

/** The plan after the liquid-cooling step: the heaviest state of the demo. */
export function demoPlan(): Plan {
  return apply(apply(defaultPlan(), DEMO_STEPS.toGb300), DEMO_STEPS.toLiquid)
}

/** Throws on the first NaN or ±Infinity anywhere in `value`, naming its path. */
export function assertFinite(value: unknown, path = 'evaluation'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(v, `${path}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`)
  }
}
