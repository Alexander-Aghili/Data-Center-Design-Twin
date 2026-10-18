import { readdirSync, readFileSync } from 'node:fs'
import { createDefaultPlan } from '@twin/catalog'
import { CatalogEntrySchema, CLIMATE, COOLANT, RulesSchema, type CatalogEntry, type ClimateEntry, type Plan, type RackResult } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { rideThrough } from '../src/cooling/buffer'

const dataDir = new URL('../../catalog/data/', import.meta.url)
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, dataDir), 'utf8'))
const entries: CatalogEntry[] = ['coolants', 'rack-cooling', 'climate'].flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, dataDir)).map((file) => CatalogEntrySchema.parse(readJson(`${dir}/${file}`))),
)
const rules = RulesSchema.parse(readJson('rules.json'))

function context(cooling: Partial<Plan['cooling']>, catalogEntries: CatalogEntry[] = entries): EvalContext {
  const base = createDefaultPlan()
  const catalog = makeCatalogIndex(catalogEntries)
  return {
    plan: { ...base, cooling: { ...base.cooling, ...cooling } },
    catalog,
    rules,
    climate: makeCatalogIndex(entries).get(CLIMATE.DALLAS, 'climate') as ClimateEntry,
  }
}

function rack(liquidW: number, facilityWaterW = 0): RackResult {
  return {
    placementId: 'R1-00',
    groupId: 'g1',
    rowId: 'R1',
    slot: 0,
    objectId: 'rack:R1-00',
    powerW: liquidW + facilityWaterW,
    heatW: liquidW + facilityWaterW,
    liquidW,
    facilityWaterW,
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
  }
}

const MW = 1_000_000
// Treated water from the catalog (997 kg/m³, 4181 J/kg·K) and the 5 K allowed rise from rules.
const seconds = (m3: number, liquidW: number) => (m3 * 997 * 4181 * 5) / liquidW
const rideCheck = (ctx: EvalContext, racks: RackResult[]) => rideThrough(ctx, racks).checks.find((c) => c.kind === 'cooling.rideThrough')
const leakCheck = (ctx: EvalContext, racks: RackResult[]) => rideThrough(ctx, racks).checks.find((c) => c.kind === 'cooling.leakExposure')

describe('ride-through', () => {
  it('t = V * rho * cp * allowed rise / liquid heat, against the chiller restart time', () => {
    const check = rideCheck(context({ bufferTankM3: 20 }), [rack(MW)])
    expect(check?.value).toBeCloseTo(seconds(20, MW), 3)
    expect(check?.limit).toBe(180)
    expect(check?.unit).toBe('s')
    expect(check?.utilization).toBeCloseTo(180 / seconds(20, MW), 3)
    expect(check?.status).toBe('pass')
    const metric = rideThrough(context({ bufferTankM3: 20 }), [rack(MW)]).metrics.find((m) => m.id === 'cooling.rideThroughS')
    expect(metric?.value).toBeCloseTo(seconds(20, MW), 3)
  })

  it('counts heat carried by facility water at the rack (rear doors) as liquid load', () => {
    const check = rideCheck(context({ bufferTankM3: 20 }), [rack(MW / 2, MW / 2)])
    expect(check?.value).toBeCloseTo(seconds(20, MW), 3)
  })

  it('fails when the tank empties its margin before the chiller restarts', () => {
    // 5 m³ at 1 MW rides through about 104 s, less than the 180 s restart.
    const check = rideCheck(context({ bufferTankM3: 5 }), [rack(MW)])
    expect(check?.status).toBe('fail')
    expect(check?.explanation).toMatch(/1\.7 min/)
  })

  it('warns inside the warning band', () => {
    // 10 m³ gives about 208 s; 180 / 208 = 0.86 is above the 0.8 warning threshold.
    expect(rideCheck(context({ bufferTankM3: 10 }), [rack(MW)])?.status).toBe('warn')
  })

  it('with 0 m³ the check fails and says there is no buffer tank', () => {
    const check = rideCheck(context({ bufferTankM3: 0 }), [rack(MW)])
    expect(check?.status).toBe('fail')
    expect(check?.value).toBe(0)
    expect(check?.explanation).toContain('No buffer tank')
  })

  it('passes with no liquid-cooled load and reports no ride-through time', () => {
    const result = rideThrough(context({ bufferTankM3: 0 }), [rack(0)])
    const check = result.checks.find((c) => c.kind === 'cooling.rideThrough')
    expect(check?.status).toBe('pass')
    expect(check?.value).toBeNull()
    expect(check?.utilization).toBeNull()
    expect(result.metrics.find((m) => m.id === 'cooling.rideThroughS')?.value).toBeNull()
  })

  it('is unknown without the water properties', () => {
    const noWater = entries.filter((e) => e.id !== COOLANT.WATER)
    expect(rideCheck(context({ bufferTankM3: 20 }, noWater), [rack(MW)])?.status).toBe('unknown')
  })
})

describe('leak exposure', () => {
  it('overhead piping warns that there is no under-floor leak containment', () => {
    const check = leakCheck(context({ pipingRoute: 'overhead' }), [rack(MW)])
    expect(check?.status).toBe('warn')
    expect(check?.explanation).toContain('no under-floor leak containment')
    expect(check?.value).toBeNull()
  })

  it('raised-floor piping passes and explains why', () => {
    const check = leakCheck(context({ pipingRoute: 'raisedFloor' }), [rack(MW)])
    expect(check?.status).toBe('pass')
    expect(check?.explanation).toMatch(/under the raised floor/)
  })

  it('a hall without liquid at the racks passes either way', () => {
    const check = leakCheck(context({ pipingRoute: 'overhead' }), [rack(0)])
    expect(check?.status).toBe('pass')
  })
})
