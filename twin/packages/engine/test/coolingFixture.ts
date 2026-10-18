import { readdirSync, readFileSync } from 'node:fs'
import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  CatalogEntrySchema,
  RulesSchema,
  qty,
  type CatalogEntry,
  type EquipmentOverride,
  type Plan,
  type RackEntry,
  type RackResult,
} from '@twin/schema'
import { makeCatalogIndex, type EvalContext } from '../src/context'

/** Built-in cooling data straight from the merged catalog files (rack cooling, coolants, equipment, heat rejection). */
function loadCatalogFolder(folder: string): CatalogEntry[] {
  const dir = new URL(`../../catalog/data/${folder}/`, import.meta.url)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => CatalogEntrySchema.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))))
}

export const rules = RulesSchema.parse(JSON.parse(readFileSync(new URL('../../catalog/data/rules.json', import.meta.url), 'utf8')))

const note = { note: 'test fixture' }

/** GB300 NVL72-like rack (Task 3 data lands later): 132 kW nominal, 85% liquid capable, 45 °C max coolant. */
export const gb300: RackEntry = {
  id: 'rack.test-gb300',
  kind: 'rack',
  name: 'GB300-like test rack',
  asOf: '2026-10-18',
  summary: 'Inline fixture with GB300 NVL72-like values',
  role: 'compute',
  gpuCount: 72,
  nominalPowerW: qty(132_000, 'W', 'estimate', note),
  peakPowerW: qty(140_000, 'W', 'estimate', note),
  weightKg: qty(1_360, 'kg', 'estimate', note),
  widthMm: qty(600, 'mm', 'estimate', note),
  depthMm: qty(1_200, 'mm', 'estimate', note),
  heightMm: qty(2_300, 'mm', 'estimate', note),
  slotsWide: 1,
  feet: 4,
  maxLiquidFraction: qty(0.85, 'fraction', 'estimate', note),
  maxCoolantSupplyC: qty(45, '°C', 'estimate', note),
  supportedCooling: ['dlc-1p', 'dlc-2p'],
  supportedPower: ['ac54', 'dc800'],
  scaleOutPorts: 72,
  portGbps: 800,
  fp8Pflops: qty(720, 'PFLOPS', 'estimate', note),
  trays: { compute: 18, switch: 9, power: 8 },
  capexUsd: qty(3_500_000, 'USD', 'estimate', note),
  leadTimeWeeks: qty(26, 'week', 'estimate', note),
}

/** Air-cooled 8-GPU rack at about 28 kW. */
export const airRack: RackEntry = {
  ...gb300,
  id: 'rack.test-air',
  name: 'Air-cooled test rack',
  gpuCount: 16,
  nominalPowerW: qty(28_000, 'W', 'estimate', note),
  peakPowerW: qty(30_000, 'W', 'estimate', note),
  maxLiquidFraction: qty(0, 'fraction', 'estimate', note),
  supportedCooling: ['air', 'rdhx'],
  scaleOutPorts: 16,
}

const climate: CatalogEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Flat test climate',
  asOf: '2026-10-18',
  summary: 'Flat test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: qty(38, '°C', 'estimate', note),
}

export const builtinEntries: CatalogEntry[] = [
  ...['rack-cooling', 'coolants', 'equipment', 'heat-rejection'].flatMap(loadCatalogFolder),
  gb300,
  airRack,
  climate,
]

export interface GroupSpec {
  id: string
  rackTypeId: string
  coolingMethodId: string
  rows: string[]
  slots: number
}

/** The default hall with its groups and placements replaced. */
export function makePlan(groups: GroupSpec[], patch: Partial<Pick<Plan, 'cooling' | 'power' | 'overrides'>> = {}): Plan {
  const base = createDefaultPlan()
  return {
    ...base,
    rackGroups: groups.map((g) => ({ id: g.id, name: g.id, rackTypeId: g.rackTypeId, coolingMethodId: g.coolingMethodId })),
    placements: groups.flatMap((g) =>
      g.rows.flatMap((rowId) =>
        Array.from({ length: g.slots }, (_, slot) => ({ id: `${rowId}-${String(slot).padStart(2, '0')}`, groupId: g.id, rowId, slot })),
      ),
    ),
    cooling: { ...base.cooling, ...patch.cooling },
    power: { ...base.power, ...patch.power },
    overrides: patch.overrides ?? [],
  }
}

export function makeCtx(plan: Plan, extra: CatalogEntry[] = []): EvalContext {
  return { plan, catalog: makeCatalogIndex([...builtinEntries, ...extra]), rules, climate: climate as EvalContext['climate'] }
}

/** Rack results as Task 7 would produce them: heat = nominal power, split by the method capped by the rack. */
export function makeRacks(ctx: EvalContext): RackResult[] {
  return ctx.plan.placements.map((p) => {
    const group = ctx.plan.rackGroups.find((g) => g.id === p.groupId)!
    const rack = ctx.catalog.get(group.rackTypeId, 'rack')!
    const method = ctx.catalog.get(group.coolingMethodId, 'rackCooling')!
    const heatW = rack.nominalPowerW.value!
    const liquidFraction = Math.min(method.toTechnicalLoop.value ?? 0, rack.maxLiquidFraction.value ?? 0)
    const liquidW = heatW * liquidFraction
    const facilityWaterW = (heatW - liquidW) * (method.toFacilityWaterAtRack?.value ?? 0)
    return {
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
      weightKg: rack.weightKg.value!,
      bayId: 'B1-1',
      flowShare: null,
      coolingOk: true,
    }
  })
}

export function override(o: EquipmentOverride): Pick<Plan, 'overrides'> {
  return { overrides: [o] }
}
