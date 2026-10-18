import { RACK_COOLING, qty, type Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { liquidSide } from '../src/cooling/liquid'
import { builtinEntries, gb300, makeCtx, makePlan, makeRacks } from './coolingFixture'

const dlc = { id: 'g2', rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.DLC_1P, rows: ['R3'], slots: 16 }
const baseCooling = makePlan([]).cooling
const coolant = (id: string) => builtinEntries.find((e) => e.id === id && e.kind === 'coolant') as Extract<(typeof builtinEntries)[number], { kind: 'coolant' }>
const pg25 = coolant('coolant.pg25')
const water = coolant('coolant.water')

function run(plan: Plan, edit?: (ctx: ReturnType<typeof makeCtx>) => void) {
  const ctx = makeCtx(plan)
  edit?.(ctx)
  return liquidSide(ctx, makeRacks(ctx))
}

const metric = (r: ReturnType<typeof liquidSide>, id: string) => r.metrics.find((m) => m.id === id)?.value

describe('liquid side', () => {
  it('liquid flow 130 kW, PG25, 10 K ≈ 3.33 kg/s, computed from the catalog cp and density', () => {
    const ctx = makeCtx(makePlan([{ ...dlc, slots: 1 }]))
    const [rack] = makeRacks(ctx)
    const result = liquidSide(ctx, [{ ...rack!, liquidW: 130_000 }])
    const out = result.racks[0]!
    const massKgS = (out.flowLps! / 1000) * pg25.densityKgM3.value!
    expect(Math.abs(massKgS - 3.33) / 3.33).toBeLessThan(0.02)
    expect(massKgS).toBeCloseTo(130_000 / (pg25.cpJPerKgK.value! * 10), 9)
  })

  it('return temperature = supply + Q/(ṁ·cp), with supply = facility supply + CDU approach', () => {
    const result = run(makePlan([{ ...dlc, slots: 1 }]))
    const out = result.racks[0]!
    expect(out.supplyC).toBe(18 + 4)
    const massKgS = ((out.flowLps! * out.flowShare!) / 1000) * pg25.densityKgM3.value!
    expect(out.returnC! - out.supplyC!).toBeCloseTo(out.liquidW / (massKgS * pg25.cpJPerKgK.value!), 9)
    expect(out.returnC).toBeCloseTo(32, 9)
  })

  it('unbalanced manifold: s_k = 1 − h·k/(n−1), normalized to mean 1, lowest at the end far from the CDU', () => {
    const result = run(makePlan([dlc]))
    const shares = result.racks.map((r) => r.flowShare!)
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length
    expect(mean).toBeCloseTo(1, 9)
    // The default hall feeds rows from the east end (CDU at the east), so slot 15 is k = 0.
    expect(result.racks.find((r) => r.slot === 15)!.flowShare).toBeCloseTo(1 / 0.9, 9)
    expect(result.racks.find((r) => r.slot === 0)!.flowShare).toBeCloseTo(0.8 / 0.9, 9)
    const starved = result.racks.find((r) => r.slot === 0)!
    expect(starved.returnC! - starved.supplyC!).toBeCloseTo(10 / (0.8 / 0.9), 9)
    const check = result.checks.find((c) => c.id === 'cooling.manifoldBalance:R3')!
    expect(check.status).toBe('warn')
    expect(check.value).toBeCloseTo(0.8 / 0.9, 9)
  })

  it('manifoldBalance fails when the minimum share falls below 0.8', () => {
    const result = run(makePlan([dlc]), (ctx) => {
      ctx.rules = { ...ctx.rules, manifoldHeaderLossFraction: qty(0.4, 'fraction', 'user') }
    })
    const check = result.checks.find((c) => c.id === 'cooling.manifoldBalance:R3')!
    expect(check.value).toBeCloseTo(0.6 / 0.8, 9)
    expect(check.status).toBe('fail')
    expect(result.racks.find((r) => r.slot === 0)!.coolingOk).toBe(false)
  })

  it('balancing valves make every share 1 and raise pump power by balancingValvePumpPenalty', () => {
    const unbalanced = run(makePlan([dlc]))
    const balanced = run(makePlan([dlc], { cooling: { ...baseCooling, flowBalancing: true } }))
    expect(balanced.racks.every((r) => r.flowShare === 1)).toBe(true)
    expect(balanced.checks.find((c) => c.id === 'cooling.manifoldBalance:R3')!.status).toBe('pass')
    // R-pump: CDU pumps = pumpPowerW × count × load fraction = 24 kW × 1.7952 MW / 2 MW (cdu.2000kw chosen for N+1).
    const loadW = 16 * 132_000 * 0.85
    expect(metric(unbalanced, 'cooling.cduPumpW')).toBeCloseTo((24_000 * loadW) / 2_000_000, 6)
    expect(metric(balanced, 'cooling.cduPumpW')).toBeCloseTo(((24_000 * loadW) / 2_000_000) * 1.15, 6)
  })

  it('reports row liquid heat and flow', () => {
    const result = run(makePlan([dlc]))
    const row = result.rowFlows.find((r) => r.rowId === 'R3')!
    expect(row.liquidW).toBeCloseTo(16 * 132_000 * 0.85, 6)
    expect(row.flowLps).toBeCloseTo(result.racks.reduce((s, r) => s + r.flowLps!, 0), 9)
  })

  it('coolantTemp fails when facilitySupplyC + CDU approach > rack maxCoolantSupplyC', () => {
    const hot = run(makePlan([dlc], { cooling: { ...baseCooling, facilitySupplyC: 42 } }))
    const check = hot.checks.find((c) => c.id === 'cooling.coolantTemp:g2')!
    expect(check.status).toBe('fail')
    expect(check.value).toBe(46)
    expect(check.limit).toBe(45)
    expect(hot.racks.every((r) => !r.coolingOk)).toBe(true)

    const warm = run(makePlan([dlc], { cooling: { ...baseCooling, facilitySupplyC: 32 } }))
    expect(warm.checks.find((c) => c.id === 'cooling.coolantTemp:g2')!.status).toBe('pass')
  })

  it('two-phase: facility flow from the method ΔT with water properties, no single-phase rack-loop math (R-2p)', () => {
    const result = run(makePlan([{ ...dlc, coolingMethodId: RACK_COOLING.DLC_2P, slots: 1 }]))
    const out = result.racks[0]!
    const expected = (out.liquidW / (water.cpJPerKgK.value! * 10) / water.densityKgM3.value!) * 1000
    expect(out.flowLps).toBeCloseTo(expected, 9)
    expect(out.supplyC).toBe(18)
    expect(out.returnC).toBe(28)
    expect(out.flowShare).toBeNull()
  })

  it('immersion: no CDU approach, method pump fraction counted, tank footprint used for floor area', () => {
    const tank = { ...dlc, rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.IMMERSION_1P, slots: 4 }
    const result = run(makePlan([tank]))
    expect(result.racks[0]!.supplyC).toBe(18)
    const loopW = 4 * 132_000 * 0.85
    expect(metric(result, 'cooling.rackPumpW')).toBeCloseTo(0.016 * loopW, 6)
    expect(metric(result, 'cooling.cduPumpW')).toBe(0)
    expect(metric(result, 'cooling.floorAreaM2:g2')).toBeCloseTo(4 * 2.22, 9)

    const racks = run(makePlan([{ ...dlc, slots: 4 }]))
    expect(metric(racks, 'cooling.floorAreaM2:g2')).toBeCloseTo(4 * 0.6 * 1.2, 9)
  })

  it('air-only racks keep null flow and temperatures', () => {
    const result = run(makePlan([{ ...dlc, coolingMethodId: RACK_COOLING.AIR_CONTAINED }]))
    expect(result.racks.every((r) => r.flowLps === null && r.supplyC === null && r.flowShare === null)).toBe(true)
    expect(result.checks.filter((c) => c.kind === 'cooling.manifoldBalance')).toEqual([])
  })

  it('an empty hall evaluates with finite metrics and no checks', () => {
    const result = run(makePlan([]))
    expect(result.racks).toEqual([])
    expect(result.checks).toEqual([])
    for (const m of result.metrics) expect(m.value === null || Number.isFinite(m.value)).toBe(true)
  })
})
