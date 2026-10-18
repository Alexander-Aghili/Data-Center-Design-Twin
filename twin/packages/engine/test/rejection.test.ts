import { readdirSync, readFileSync } from 'node:fs'
import { createDefaultPlan } from '@twin/catalog'
import {
  CatalogEntrySchema,
  CLIMATE,
  EQUIPMENT,
  HEAT_REJECTION,
  RACK_COOLING,
  RulesSchema,
  type CatalogEntry,
  type ClimateEntry,
  type HeatRejectionEntry,
  type Plan,
  type RackResult,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { rejectHeat } from '../src/cooling/rejection'

const dataDir = new URL('../../catalog/data/', import.meta.url)
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, dataDir), 'utf8'))
const entries: CatalogEntry[] = ['heat-rejection', 'coolants', 'equipment', 'rack-cooling', 'climate'].flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, dataDir)).map((file) => CatalogEntrySchema.parse(readJson(`${dir}/${file}`))),
)
const rules = RulesSchema.parse(readJson('rules.json'))
const catalog = makeCatalogIndex(entries)
const dallas = catalog.get(CLIMATE.DALLAS, 'climate') as ClimateEntry
const chiller = catalog.get(HEAT_REJECTION.CHILLER_AIR, 'heatRejection') as HeatRejectionEntry

const HOURS = 8760
const MW = 1_000_000

function flatClimate(dryBulbC: number, wetBulbC = dryBulbC - 8): ClimateEntry {
  return { ...dallas, dryBulbC: Array(HOURS).fill(dryBulbC), wetBulbC: Array(HOURS).fill(wetBulbC) }
}

type CoolingPatch = Partial<Plan['cooling']>

function context(cooling: CoolingPatch, climate: ClimateEntry = dallas, extra: CatalogEntry[] = []): EvalContext {
  const base = createDefaultPlan()
  const plan: Plan = {
    ...base,
    rackGroups: [
      { id: 'liq', name: 'Liquid', rackTypeId: 'rack.gb300-nvl72', coolingMethodId: RACK_COOLING.DLC_1P },
      { id: 'air', name: 'Air', rackTypeId: 'rack.hgx-b300-air', coolingMethodId: RACK_COOLING.AIR_CONTAINED },
      { id: 'tank', name: 'Tank', rackTypeId: 'rack.gb300-nvl72', coolingMethodId: RACK_COOLING.IMMERSION_1P },
    ],
    cooling: { ...base.cooling, ...cooling },
  }
  return { plan, catalog: makeCatalogIndex([...entries, ...extra]), rules, climate }
}

/** A rack whose heat all goes to liquid on a CDU loop, so no hall pump or fan power is added without equipment. */
function rack(heatW: number, patch: Partial<RackResult> = {}): RackResult {
  return {
    placementId: 'R1-00',
    groupId: 'liq',
    rowId: 'R1',
    slot: 0,
    objectId: 'rack:R1-00',
    powerW: heatW,
    heatW,
    liquidW: heatW,
    facilityWaterW: 0,
    airW: 0,
    flowLps: null,
    supplyC: null,
    returnC: null,
    airInletC: null,
    airOutletC: null,
    weightKg: 1000,
    bayId: 'B1-1',
    flowShare: null,
    coolingOk: true,
    ...patch,
  }
}

function equipment(key: string, category: string, modelId: string | null, count: number, loadW: number): SizedEquipment {
  return { key, category, modelId, count, required: count, positionIds: [], autoSized: true, loadW, capacityW: null, objectIds: [`${key}-obj`] }
}

const chillerCop = (t: number) => Math.max(1.5, 4.3 - 0.12 * (t - 35))
const check = (result: ReturnType<typeof rejectHeat>, kind: string) => result.checks.find((c) => c.kind === kind)
const metric = (result: ReturnType<typeof rejectHeat>, id: string) => result.metrics.find((m) => m.id === id)?.value
const trimHours = (result: ReturnType<typeof rejectHeat>) => result.hourly.trimW.filter((w) => w > 0).length

describe('chiller', () => {
  it('cooling power = Q / COP(T) with the COP falling linearly from the reference point', () => {
    const result = rejectHeat(context({ heatRejectionId: chiller.id }, flatClimate(30)), [rack(MW)], [])
    expect(result.hourly.coolingW[0]).toBeCloseTo(MW / chillerCop(30), 3)
    expect(result.hourly.coolingW).toHaveLength(HOURS)
    expect(result.hourly.trimW.every((w) => w === 0)).toBe(true)
  })

  it('floors the COP at 1.5 on extreme hours', () => {
    const result = rejectHeat(context({ heatRejectionId: chiller.id }, flatClimate(60)), [rack(MW)], [])
    expect(result.hourly.coolingW[0]).toBeCloseTo(MW / 1.5, 3)
  })

  it('economizer hours use fan power only when T_out + approach <= supply - loop delta T', () => {
    // 18 °C supply - 6 K loop - 4 K approach: free cooling up to 8 °C outdoor.
    const free = rejectHeat(context({ heatRejectionId: chiller.id, facilitySupplyC: 18 }, flatClimate(8)), [rack(MW)], [])
    expect(free.hourly.coolingW[0]).toBeCloseTo(0.025 * MW, 3)
    expect(metric(free, 'cooling.freeCoolingHours')).toBe(HOURS)
    const mech = rejectHeat(context({ heatRejectionId: chiller.id, facilitySupplyC: 18 }, flatClimate(9)), [rack(MW)], [])
    expect(mech.hourly.coolingW[0]).toBeCloseTo(MW / chillerCop(9), 3)
    expect(metric(mech, 'cooling.freeCoolingHours')).toBe(0)
  })

  it('without an economizer the compressor runs even on cold hours', () => {
    const noEco: HeatRejectionEntry = { ...chiller, id: 'heatRejection.no-eco', economizer: false, custom: true }
    const result = rejectHeat(context({ heatRejectionId: noEco.id }, flatClimate(0), [noEco]), [rack(MW)], [])
    expect(result.hourly.coolingW[0]).toBeCloseTo(MW / chillerCop(0), 3)
  })
})

describe('dry cooler', () => {
  const dry = HEAT_REJECTION.DRY_COOLER

  it('runs on fans alone while T_out + approach <= supply', () => {
    const result = rejectHeat(context({ heatRejectionId: dry, facilitySupplyC: 32 }, flatClimate(25)), [rack(MW)], [])
    expect(result.hourly.trimW[0]).toBe(0)
    expect(result.hourly.coolingW[0]).toBeCloseTo(0.02 * MW * (1 + 15 / 30), 3)
  })

  it('sends the shortfall to a trim chiller at chiller COP', () => {
    // 30 + 7 = 37 °C leaving air side vs 32 °C supply and 38 °C return: the dry cooler covers 1 K of the 6 K loop.
    const result = rejectHeat(context({ heatRejectionId: dry, facilitySupplyC: 32 }, flatClimate(30)), [rack(MW)], [])
    const trim = (MW * 5) / 6
    expect(result.hourly.trimW[0]).toBeCloseTo(trim, 3)
    expect(result.hourly.coolingW[0]).toBeCloseTo(0.02 * MW * (1 + 20 / 30) + trim / chillerCop(30), 3)
  })

  it('takes the whole load to trim once outdoor air is above the return temperature', () => {
    const result = rejectHeat(context({ heatRejectionId: dry, facilitySupplyC: 18 }, flatClimate(35)), [rack(MW)], [])
    expect(result.hourly.trimW[0]).toBeCloseTo(MW, 3)
  })

  it('clamps fan power at the base fraction on cold hours', () => {
    const result = rejectHeat(context({ heatRejectionId: dry, facilitySupplyC: 32 }, flatClimate(-5)), [rack(MW)], [])
    expect(result.hourly.coolingW[0]).toBeCloseTo(0.02 * MW, 3)
  })

  it('uses no water', () => {
    const result = rejectHeat(context({ heatRejectionId: dry, facilitySupplyC: 32 }, flatClimate(30)), [rack(MW)], [])
    expect(result.hourly.waterM3.every((w) => w === 0)).toBe(true)
  })
})

describe('adiabatic dry cooler', () => {
  const adiabatic = HEAT_REJECTION.ADIABATIC_DRY_COOLER

  it('above adiabaticAboveC it works to wet-bulb + approach and uses water in those hours', () => {
    const result = rejectHeat(context({ heatRejectionId: adiabatic, facilitySupplyC: 32 }, flatClimate(35, 22)), [rack(MW)], [])
    // 22 + 7 = 29 °C <= 32 °C: no trim although dry-bulb + approach would be 42 °C.
    expect(result.hourly.trimW[0]).toBe(0)
    expect(result.hourly.waterM3[0]).toBeCloseTo((1.0 * MW) / 1000 / 1000, 6)
  })

  it('stays dry below adiabaticAboveC', () => {
    const result = rejectHeat(context({ heatRejectionId: adiabatic, facilitySupplyC: 32 }, flatClimate(24, 18)), [rack(MW)], [])
    expect(result.hourly.waterM3[0]).toBe(0)
    expect(result.hourly.trimW[0]).toBe(0)
  })
})

describe('cooling tower', () => {
  const tower = HEAT_REJECTION.COOLING_TOWER
  const hourlyM3 = (q: number) => ((q / 1000) * 1.5 * (1 + 0.33)) / 1000

  it('water = Q[kWh] * waterLPerKwh * (1 + towerBlowdownFactor) every hour', () => {
    const result = rejectHeat(context({ heatRejectionId: tower, facilitySupplyC: 32 }, flatClimate(30, 20)), [rack(MW)], [])
    expect(result.hourly.waterM3[0]).toBeCloseTo(hourlyM3(MW), 6)
    expect(metric(result, 'cooling.waterAnnualM3')).toBeCloseTo(hourlyM3(MW) * HOURS, 3)
  })

  it('works to wet-bulb + approach', () => {
    const ok = rejectHeat(context({ heatRejectionId: tower, facilitySupplyC: 24 }, flatClimate(35, 20)), [rack(MW)], [])
    expect(ok.hourly.trimW[0]).toBe(0)
    const trim = rejectHeat(context({ heatRejectionId: tower, facilitySupplyC: 18 }, flatClimate(35, 20)), [rack(MW)], [])
    expect(trim.hourly.trimW[0]).toBeGreaterThan(0)
  })

  it('waterPeakDay compares the worst day to the site allowance', () => {
    // Default site allowance: 120 m³/day. 1 MW uses 47.9 m³/day, 3 MW uses 143.6 m³/day.
    const small = rejectHeat(context({ heatRejectionId: tower }, flatClimate(30, 20)), [rack(MW)], [])
    const smallCheck = check(small, 'cooling.waterPeakDay')
    expect(smallCheck?.status).toBe('pass')
    expect(smallCheck?.value).toBeCloseTo(hourlyM3(MW) * 24, 3)
    expect(smallCheck?.limit).toBe(120)
    const big = rejectHeat(context({ heatRejectionId: tower }, flatClimate(30, 20)), [rack(3 * MW)], [])
    expect(check(big, 'cooling.waterPeakDay')?.status).toBe('fail')
    expect(check(big, 'cooling.waterPeakDay')?.utilization).toBeCloseTo((hourlyM3(3 * MW) * 24) / 120, 3)
  })

  it('a site with no water allowance fails any evaporative use and passes a dry plant', () => {
    const plan = context({ heatRejectionId: tower }, flatClimate(30, 20))
    plan.plan.site = { ...plan.plan.site, waterAllowanceM3PerDay: 0 }
    const wet = check(rejectHeat(plan, [rack(MW)], []), 'cooling.waterPeakDay')
    expect(wet?.status).toBe('fail')
    expect(wet?.utilization).toBeNull()
    const dryPlan = context({ heatRejectionId: HEAT_REJECTION.DRY_COOLER }, flatClimate(30, 20))
    dryPlan.plan.site = { ...dryPlan.plan.site, waterAllowanceM3PerDay: 0 }
    expect(check(rejectHeat(dryPlan, [rack(MW)], []), 'cooling.waterPeakDay')?.status).toBe('pass')
  })
})

describe('heatRejection capacity check', () => {
  it('compares worst-hour load with the plant N capacity (units x unitCapacityW minus the N+1 spare)', () => {
    const ctx = context({ heatRejectionId: chiller.id }, flatClimate(30))
    // Two 1.3 MW units, N+1: 1.3 MW usable against 2 MW of heat.
    const short = check(rejectHeat(ctx, [rack(2 * MW)], [equipment('plant', 'plant', chiller.id, 2, 2 * MW)]), 'cooling.heatRejection')
    expect(short?.status).toBe('fail')
    expect(short?.value).toBeCloseTo(2 * MW)
    expect(short?.limit).toBeCloseTo(1.3 * MW)
    expect(short?.subject.objectIds).toEqual(['plant-obj'])
    const enough = check(rejectHeat(ctx, [rack(2 * MW)], [equipment('plant', 'plant', chiller.id, 3, 2 * MW)]), 'cooling.heatRejection')
    expect(enough?.status).toBe('pass')
    expect(enough?.utilization).toBeCloseTo(2 / 2.6, 3)
  })

  it('redundancy N uses every unit, 2N half of them', () => {
    const ctx = context({ heatRejectionId: chiller.id }, flatClimate(30))
    const plant = [equipment('plant', 'plant', chiller.id, 4, 2 * MW)]
    ctx.plan.power = { ...ctx.plan.power, redundancy: 'N' }
    expect(check(rejectHeat(ctx, [rack(2 * MW)], plant), 'cooling.heatRejection')?.limit).toBeCloseTo(5.2 * MW)
    ctx.plan.power = { ...ctx.plan.power, redundancy: '2N' }
    expect(check(rejectHeat(ctx, [rack(2 * MW)], plant), 'cooling.heatRejection')?.limit).toBeCloseTo(2.6 * MW)
  })

  it('without a sized plant it counts the units the load needs plus the spare', () => {
    const result = rejectHeat(context({ heatRejectionId: chiller.id }, flatClimate(30)), [rack(2 * MW)], [])
    const plantCheck = check(result, 'cooling.heatRejection')
    expect(plantCheck?.status).toBe('pass')
    expect(plantCheck?.limit).toBeCloseTo(2.6 * MW)
    expect(plantCheck?.explanation).toContain('3 units')
  })

  it('warns when a dry cooler needs trim cooling and names the hours', () => {
    const result = rejectHeat(context({ heatRejectionId: HEAT_REJECTION.DRY_COOLER, facilitySupplyC: 32 }), [rack(MW)], [])
    const plantCheck = check(result, 'cooling.heatRejection')
    expect(plantCheck?.status).toBe('warn')
    expect(plantCheck?.explanation).toContain(`${trimHours(result).toLocaleString('en-US')} hours`)
  })

  it('is unknown when the heat rejection entry lacks an input', () => {
    const blank: HeatRejectionEntry = {
      ...chiller,
      id: 'heatRejection.blank',
      custom: true,
      approachK: { value: null, unit: 'K', basis: 'user' },
    }
    const result = rejectHeat(context({ heatRejectionId: blank.id }, flatClimate(30), [blank]), [rack(MW)], [])
    expect(check(result, 'cooling.heatRejection')?.status).toBe('unknown')
    expect(check(result, 'cooling.heatRejection')?.explanation).toContain('approach')
  })

  it('is unknown when the heat rejection id is not in the catalog', () => {
    const result = rejectHeat(context({ heatRejectionId: 'heatRejection.missing' }, flatClimate(30)), [rack(MW)], [])
    expect(check(result, 'cooling.heatRejection')?.status).toBe('unknown')
    expect(result.hourly.coolingW).toHaveLength(HOURS)
  })
})

describe('hall pumps and fans (R-pump: counted once)', () => {
  const plant = (ctx: EvalContext, racks: RackResult[], equip: SizedEquipment[]) => rejectHeat(ctx, racks, equip).hourly.coolingW[0]
  const ctx = () => context({ heatRejectionId: chiller.id, facilitySupplyC: 18 }, flatClimate(0))
  // At 0 °C the chiller free-cools, so plant power is 0.025 Q and the rest is pumps and fans.
  const freeCooling = (q: number) => 0.025 * q

  it('CDU pumps = pumpPowerW x count x load fraction, and the method pump fraction is not added', () => {
    const cdus = [equipment('cdu:R1', 'cdu', EQUIPMENT.CDU_1200KW, 2, 1.2 * MW)]
    const pumps = 10_000 * 2 * 0.5
    expect(plant(ctx(), [rack(1.2 * MW)], cdus)).toBeCloseTo(freeCooling(1.2 * MW + pumps) + pumps, 3)
  })

  it('balancing valves add the pump penalty', () => {
    const balanced = ctx()
    balanced.plan.cooling = { ...balanced.plan.cooling, flowBalancing: true }
    const cdus = [equipment('cdu:R1', 'cdu', EQUIPMENT.CDU_1200KW, 2, 1.2 * MW)]
    const pumps = 10_000 * 2 * 0.5 * 1.15
    expect(plant(balanced, [rack(1.2 * MW)], cdus)).toBeCloseTo(freeCooling(1.2 * MW + pumps) + pumps, 3)
  })

  it('methods without a CDU use their own pump fraction', () => {
    const tank = rack(100_000, { groupId: 'tank' })
    const pumps = 0.016 * 100_000
    expect(plant(ctx(), [tank], [])).toBeCloseTo(freeCooling(100_000 + pumps) + pumps, 3)
  })

  it('CRAH fans = fanPowerW x count x load fraction', () => {
    const air = rack(300_000, { groupId: 'air', liquidW: 0, airW: 300_000 })
    const crahs = [equipment('crah:Z1', 'crah', EQUIPMENT.CRAH_200KW, 3, 300_000)]
    const fans = 11_000 * 3 * 0.5
    expect(plant(ctx(), [air], crahs)).toBeCloseTo(freeCooling(300_000 + fans) + fans, 3)
  })

  it('air heat without sized CRAHs uses the fallback fan fraction', () => {
    const air = rack(100_000, { groupId: 'air', liquidW: 0, airW: 100_000 })
    const fans = 0.04 * 100_000
    expect(plant(ctx(), [air], [])).toBeCloseTo(freeCooling(100_000 + fans) + fans, 3)
  })
})

describe('series and empty hall', () => {
  it('carries the climate through and emits finite numbers', () => {
    const result = rejectHeat(context({ heatRejectionId: chiller.id }), [rack(MW)], [])
    expect(result.hourly.outdoorC).toEqual(dallas.dryBulbC)
    expect(result.hourly.wetBulbC).toEqual(dallas.wetBulbC)
    for (const series of Object.values(result.hourly)) expect(series.every(Number.isFinite)).toBe(true)
  })

  it('an empty hall evaluates to zero power and water with no failing checks', () => {
    const result = rejectHeat(context({ heatRejectionId: HEAT_REJECTION.COOLING_TOWER }), [], [])
    expect(result.hourly.coolingW).toEqual(Array(HOURS).fill(0))
    expect(result.hourly.waterM3).toEqual(Array(HOURS).fill(0))
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true)
    for (const m of result.metrics) expect(m.value === null || Number.isFinite(m.value)).toBe(true)
  })
})

describe('demo anchor: Dallas dry cooler', () => {
  const run = (supply: number) =>
    rejectHeat(context({ heatRejectionId: HEAT_REJECTION.DRY_COOLER, facilitySupplyC: supply }), [rack(5 * MW)], [])
  // TMYx hours 3624-5831 are June through August (non-leap year).
  const summer = (series: number[]) => series.slice(3624, 5832)

  it('at 18 °C supply needs trim in most summer hours; at 32 °C far fewer hours, and only hot ones', () => {
    const at18 = run(18)
    const at32 = run(32)
    const summer18 = summer(at18.hourly.trimW).filter((w) => w > 0).length
    expect(summer18 / summer(at18.hourly.trimW).length).toBeGreaterThan(0.95)
    expect(trimHours(at32)).toBeLessThan(trimHours(at18) / 2)
    const trimmedTemps = at32.hourly.outdoorC.filter((_, h) => at32.hourly.trimW[h] > 0)
    expect(Math.min(...trimmedTemps)).toBeGreaterThan(25)
    expect(metric(at32, 'cooling.trimHours')).toBe(trimHours(at32))
  })

  it('trim hours fall as the supply temperature rises', () => {
    const hours = [18, 32, 38, 45].map((s) => trimHours(run(s)))
    expect(hours[0]).toBeGreaterThan(hours[1])
    expect(hours[1]).toBeGreaterThan(hours[2])
    expect(hours[2]).toBeGreaterThan(hours[3])
    expect(hours[3]).toBeLessThan(50)
  })
})
