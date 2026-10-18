import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  EQUIPMENT,
  EquipmentEntrySchema,
  RACK,
  RACK_COOLING,
  RackCoolingEntrySchema,
  RulesSchema,
  qty,
  type CatalogEntry,
  type Check,
  type ClimateEntry,
  type Plan,
  type RackEntry,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import busway2500Json from '../../catalog/data/equipment/busway.2500a.json'
import transformerJson from '../../catalog/data/equipment/transformer.3mva.json'
import upsJson from '../../catalog/data/equipment/ups.500kw.json'
import dlcJson from '../../catalog/data/rack-cooling/rackCooling.dlc-1p.json'
import rulesJson from '../../catalog/data/rules.json'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import type { RejectionResult } from '../src/cooling/rejection'
import type { NetworkSlice } from '../src/network'
import { demandChecks } from '../src/demand'
import { placedCompute, powerBudget } from '../src/power'
import { computeRacks } from '../src/racks'

const rules = RulesSchema.parse(rulesJson)
const R = (k: keyof typeof rules) => rules[k].value!
const CHAIN = R('upsEfficiency') * R('transformerEfficiency') * R('distributionEfficiency')
const MISC = R('miscFacilityFraction')

const est = (value: number, unit: string) => qty(value, unit, 'estimate', { note: 'test fixture' })
const gb300: RackEntry = {
  id: RACK.GB300_NVL72,
  kind: 'rack',
  name: 'GB300 NVL72',
  asOf: '2026-10-18',
  summary: 'test rack',
  role: 'compute',
  gpuId: 'gpu.gb300',
  gpuCount: 72,
  nominalPowerW: est(132_000, 'W'),
  peakPowerW: est(155_000, 'W'),
  weightKg: est(1580, 'kg'),
  widthMm: est(600, 'mm'),
  depthMm: est(1200, 'mm'),
  heightMm: est(2300, 'mm'),
  slotsWide: 1,
  feet: 4,
  maxLiquidFraction: est(0.85, 'fraction'),
  maxCoolantSupplyC: est(45, '°C'),
  supportedCooling: ['dlc-1p'],
  supportedPower: ['ac54'],
  scaleOutPorts: 72,
  portGbps: 800,
  fp8Pflops: est(360, 'PFLOPS'),
  trays: { compute: 18, switch: 9, power: 8 },
  capexUsd: est(3_900_000, 'USD'),
  leadTimeWeeks: est(26, 'week'),
}

// Flat 20 °C year with one hot afternoon: 15 Aug 15:00 (day index 226) at 41.2 °C.
const HOT_HOUR = 226 * 24 + 15
const climate: ClimateEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Test',
  asOf: '2026-10-18',
  summary: 'flat test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, (_, h) => (h === HOT_HOUR ? 41.2 : 20)),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: est(38, '°C'),
}

const entries: CatalogEntry[] = [
  gb300,
  climate,
  RackCoolingEntrySchema.parse(dlcJson),
  EquipmentEntrySchema.parse(busway2500Json),
  EquipmentEntrySchema.parse(upsJson),
  EquipmentEntrySchema.parse(transformerJson),
]

/** Ten GB300 racks with DLC in row R3. */
function basePlan(patch: Partial<Plan> = {}): Plan {
  return {
    ...createDefaultPlan(),
    rackGroups: [{ id: 'g2', name: 'Training', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P }],
    placements: Array.from({ length: 10 }, (_, slot) => ({ id: `R3-0${slot}`, groupId: 'g2', rowId: 'R3', slot })),
    ...patch,
  }
}

const ctxFor = (plan: Plan): EvalContext => ({ plan, catalog: makeCatalogIndex(entries), rules, climate })

const COOLING_W = 1_000_000
const HOT_COOLING_W = 2_000_000
function rejection(): RejectionResult {
  const coolingW = Array.from({ length: 8760 }, (_, h) => (h === HOT_HOUR ? HOT_COOLING_W : COOLING_W))
  return { hourly: { outdoorC: climate.dryBulbC, wetBulbC: climate.wetBulbC, coolingW, trimW: [], waterM3: [] }, checks: [], metrics: [] }
}

const OPTICS_W = 20_000
const network: NetworkSlice = {
  network: { links: [], opticsW: OPTICS_W, cableM: 0, baseLatencyNs: 0, oversubscription: 1 },
  checks: [],
  metrics: [],
}

function eq(key: string, category: string, modelId: string, count: number): SizedEquipment {
  return { key, category, modelId, count, required: count, positionIds: [], autoSized: true, loadW: 0, capacityW: null, objectIds: [`eq:${key}:0`] }
}
const defaultEquipment = [
  eq('busway:R3', 'busway', EQUIPMENT.BUSWAY_2500A, 2),
  eq('ups', 'ups', EQUIPMENT.UPS_500KW, 5),
  eq('transformer', 'transformer', EQUIPMENT.TRANSFORMER_3MVA, 3),
]

function run(plan = basePlan(), equipment = defaultEquipment) {
  const ctx = ctxFor(plan)
  return powerBudget(ctx, computeRacks(ctx), equipment, rejection(), network)
}
const find = (checks: Check[], id: string) => {
  const c = checks.find((x) => x.id === id)
  if (!c) throw new Error(`no check ${id}; have ${checks.map((x) => x.id).join(', ')}`)
  return c
}

const IT_W = 10 * 132_000 + OPTICS_W
const IT_PEAK_W = 10 * 155_000 + OPTICS_W
const facilityAt = (it: number, cooling: number) => (it + cooling + MISC * it) / CHAIN

describe('powerBudget', () => {
  it('facility power each hour = (IT + cooling + misc) / (upsEff·transformerEff·distributionEff)', () => {
    const p = run()
    expect(p.hourly.itW).toHaveLength(8760)
    expect(p.hourly.itW[0]).toBe(IT_W)
    expect(p.hourly.facilityW[0]).toBeCloseTo(facilityAt(IT_W, COOLING_W), 3)
    expect(p.hourly.facilityW[HOT_HOUR]).toBeCloseTo(facilityAt(IT_W, HOT_COOLING_W), 3)
    expect(p.hourly.pue[0]).toBeCloseTo(facilityAt(IT_W, COOLING_W) / IT_W, 9)
    expect(p.headline.worstHour).toBe(HOT_HOUR)
    expect(p.headline.pueWorst).toBeCloseTo(facilityAt(IT_W, HOT_COOLING_W) / IT_W, 9)
  })

  it('sized leaf switches count as IT load, at nominal and at peak', () => {
    const leaves = { ...eq('leaf:leaf-1', 'leaf', EQUIPMENT.LEAF_64X800G, 10), loadW: 9_400 }
    const p = run(basePlan(), [...defaultEquipment, leaves])
    expect(p.hourly.itW[0]).toBe(IT_W + 9_400)
    expect(p.hourly.facilityW[0]).toBeCloseTo(facilityAt(IT_W + 9_400, COOLING_W), 3)
    expect(p.metrics.find((m) => m.id === 'power.itPeakW')!.value).toBeCloseTo(run().metrics.find((m) => m.id === 'power.itPeakW')!.value! + 9_400, 6)
  })

  it('hoursOverCap counts hours where facilityW > gridCapacityW', () => {
    const cap = (facilityAt(IT_W, COOLING_W) + facilityAt(IT_W, HOT_COOLING_W)) / 2
    const plan = basePlan()
    const p = run({ ...plan, site: { ...plan.site, gridCapacityW: cap } })
    expect(p.headline.hoursOverCap).toBe(1)
    expect(run().headline.hoursOverCap).toBe(0)
  })

  it('usablePflops = placedPflops · min(1, (cap·eff − cooling_worst − misc) / IT_worst)', () => {
    const plan = basePlan()
    const cap = 3_000_000
    const p = run({ ...plan, site: { ...plan.site, gridCapacityW: cap } })
    const fraction = (cap * CHAIN - HOT_COOLING_W - MISC * IT_W) / IT_W
    expect(fraction).toBeLessThan(1)
    expect(p.headline.placedPflops).toBe(3600)
    expect(p.headline.gpuCount).toBe(720)
    expect(p.headline.usablePflops).toBeCloseTo(3600 * fraction, 6)
    expect(run().headline.usablePflops).toBe(3600)
  })

  it('usablePflops is 0, not negative, when cooling alone exceeds the cap', () => {
    const plan = basePlan()
    expect(run({ ...plan, site: { ...plan.site, gridCapacityW: 1_000_000 } }).headline.usablePflops).toBe(0)
  })

  it('pue null when IT is 0', () => {
    const plan = basePlan({ placements: [] })
    const ctx = ctxFor(plan)
    const empty: NetworkSlice = { ...network, network: { ...network.network, opticsW: 0 } }
    const p = powerBudget(ctx, [], [], rejection(), empty)
    expect(p.hourly.pue.every((v) => v === null)).toBe(true)
    expect(p.headline.pueAnnual).toBeNull()
    expect(p.headline.pueWorst).toBeNull()
    expect(p.headline.usablePflops).toBe(0)
  })

  it('busway check per row uses I = P_peak / (√3 · V · pf) / oversubscription allowance', () => {
    const plan = basePlan()
    const allowance = 1.25
    const p = run({ ...plan, power: { ...plan.power, oversubscription: allowance } })
    // Rack peak (155 kW, not nominal 132 kW) already is the peak, so no peak-to-average factor on top.
    const expected = (10 * 155_000) / (Math.sqrt(3) * 415 * 0.95) / allowance
    const check = find(p.checks, 'power.busway:R3')
    expect(check.value).toBeCloseTo(expected, 6)
    expect(p.rows.find((r) => r.rowId === 'R3')!.buswayLoadA).toBeCloseTo(expected, 6)
    expect(p.rows.find((r) => r.rowId === 'R1')!.buswayLoadA).toBe(0)
    // N+1 with two 2,500 A feeds: one carries the load.
    expect(check.limit).toBe(2500)
    expect(check.utilization).toBeCloseTo(expected / 2500, 9)
    // 1,816 A on 2,500 A is 73%, under the 80% warn threshold.
    expect(check.status).toBe('pass')
    expect(check.subject).toEqual({ kind: 'row', id: 'R3', objectIds: ['eq:busway:R3:0'] })
    expect(check.explanation).toMatch(/row R3/i)
    expect(check.explanation).toMatch(/1\.25/)
    expect(check.explanation).not.toMatch(/peak-to-average/)
    expect(p.checks.some((c) => c.id === 'power.busway:R1')).toBe(false)
  })

  it('busway design current does not depend on the workload purpose', () => {
    const plan = basePlan()
    const training = run({ ...plan, workload: { ...plan.workload, purpose: 'training' } })
    const inference = run({ ...plan, workload: { ...plan.workload, purpose: 'inference' } })
    const expected = (10 * 155_000) / (Math.sqrt(3) * 415 * 0.95)
    expect(find(training.checks, 'power.busway:R3').value).toBeCloseTo(expected, 6)
    expect(find(inference.checks, 'power.busway:R3').value).toBeCloseTo(expected, 6)
  })

  it('exposes each loaded row nominal power, amps per watt and serving busway capacity for the swing check', () => {
    const p = run()
    expect(p.busways).toEqual([
      { rowId: 'R3', nominalW: 10 * 132_000, ampsPerW: expect.any(Number), capacityA: 2500, objectIds: ['eq:busway:R3:0'] },
    ])
    expect(p.busways[0]!.ampsPerW).toBeCloseTo(1 / (Math.sqrt(3) * 415 * 0.95), 12)
  })

  it('placed PFLOPS falls back to GPU FP8 × GPU count, and the target check agrees with the headline', () => {
    const gpu: CatalogEntry = {
      id: 'gpu.test', kind: 'gpu', name: 'Test GPU', asOf: '2026-10-18', summary: 'test gpu',
      tdpW: est(1400, 'W'), fp8Pflops: est(5, 'PFLOPS'), fp4Pflops: est(10, 'PFLOPS'), hbmGb: est(288, 'GB'), cooling: 'liquid',
    }
    const noFp8: RackEntry = { ...gb300, id: 'rack.no-fp8', gpuId: 'gpu.test', fp8Pflops: { value: null, unit: 'PFLOPS', basis: 'estimate', note: 'unknown' } }
    const plan = basePlan({ rackGroups: [{ id: 'g2', name: 'Training', rackTypeId: 'rack.no-fp8', coolingMethodId: RACK_COOLING.DLC_1P }] })
    const ctx: EvalContext = { plan, catalog: makeCatalogIndex([...entries, gpu, noFp8]), rules, climate }
    const racks = computeRacks(ctx)
    const p = powerBudget(ctx, racks, defaultEquipment, rejection(), network)
    expect(p.headline.placedPflops).toBe(10 * 72 * 5)
    const target = demandChecks(ctx, racks, p).checks.find((c) => c.kind === 'workload.targetCompute')!
    expect(target.value).toBe(p.headline.placedPflops)
    expect(placedCompute(ctx, racks)).toEqual({ pflops: 3600, gpuCount: 720, unknownRacks: 0 })
  })

  it('busway check is unknown when no busway is sized for the row', () => {
    const p = run(basePlan(), defaultEquipment.filter((e) => e.category !== 'busway'))
    const check = find(p.checks, 'power.busway:R3')
    expect(check.status).toBe('unknown')
    expect(check.limit).toBeNull()
  })

  it('inputCompat fails for dc800 with an ac54-only rack', () => {
    const plan = basePlan()
    const fail = find(run({ ...plan, power: { ...plan.power, distribution: 'dc800' } }).checks, 'power.inputCompat:g2')
    expect(fail.status).toBe('fail')
    expect(fail.subject.kind).toBe('group')
    expect(fail.subject.objectIds).toHaveLength(10)
    expect(fail.explanation).toMatch(/800 V DC/)
    expect(fail.explanation).toMatch(/54 V AC/)
    expect(find(run().checks, 'power.inputCompat:g2').status).toBe('pass')
  })

  it('power.gridWorstHour compares the worst-hour facility power to the grid capacity and names the hour', () => {
    const plan = basePlan()
    const cap = 4_000_000
    const p = run({ ...plan, site: { ...plan.site, gridCapacityW: cap } })
    const check = find(p.checks, 'power.gridWorstHour:site')
    const worst = facilityAt(IT_W, HOT_COOLING_W)
    expect(check.value).toBeCloseTo(worst, 3)
    expect(check.limit).toBe(cap)
    expect(check.unit).toBe('W')
    expect(check.utilization).toBeCloseTo(worst / cap, 9)
    expect(check.status).toBe(worst > cap ? 'fail' : 'warn')
    expect(check.explanation).toContain('15 Aug')
    expect(check.explanation).toContain('15:00')
    expect(check.explanation).toMatch(/41\.2\s°C/)
    expect(check.explanation).toMatch(/4(\.0+)?\sMW/)
  })

  it('power.ups counts modules with redundancy and checks the load against N capacity', () => {
    const upsLoad = IT_PEAK_W / R('distributionEfficiency')
    const nPlus1 = find(run().checks, 'power.ups:ups')
    // Five modules for N+1: four carry the load.
    expect(nPlus1.value).toBeCloseTo(upsLoad, 3)
    expect(nPlus1.limit).toBe(4 * 500_000)
    expect(nPlus1.utilization).toBeCloseTo(upsLoad / 2_000_000, 9)
    expect(nPlus1.explanation).toMatch(/5 modules/)
    expect(nPlus1.explanation).toMatch(/N\+1/)

    const plan = basePlan()
    const twoN = run({ ...plan, power: { ...plan.power, redundancy: '2N' } }, [eq('ups', 'ups', EQUIPMENT.UPS_500KW, 6)])
    const ups2n = find(twoN.checks, 'power.ups:ups')
    expect(ups2n.limit).toBe(3 * 500_000)
    expect(ups2n.status).toBe('fail')
    expect(ups2n.advice).toBeDefined()

    const n = run({ ...plan, power: { ...plan.power, redundancy: 'N' } }, [eq('ups', 'ups', EQUIPMENT.UPS_500KW, 4)])
    expect(find(n.checks, 'power.ups:ups').limit).toBe(4 * 500_000)
  })

  it('power.transformer counts units with redundancy and checks apparent power against N capacity', () => {
    const check = find(run().checks, 'power.transformer:transformer')
    const loadVa = (facilityAt(IT_PEAK_W, HOT_COOLING_W) * R('transformerEfficiency')) / 0.95
    expect(check.unit).toBe('VA')
    expect(check.value).toBeCloseTo(loadVa, 3)
    expect(check.limit).toBe(2 * 3_000_000)
    expect(check.utilization).toBeCloseTo(loadVa / 6_000_000, 9)
    expect(check.explanation).toMatch(/3 units/)
  })

  it('UPS and transformer checks are unknown when nothing is sized for a real load', () => {
    const p = run(basePlan(), [])
    expect(find(p.checks, 'power.ups:ups').status).toBe('unknown')
    expect(find(p.checks, 'power.transformer:transformer').status).toBe('unknown')
  })

  it('reports power metrics with finite values', () => {
    const p = run()
    const it = p.metrics.find((m) => m.id === 'power.itW')
    expect(it).toMatchObject({ layer: 'power', unit: 'W', value: IT_W, basis: 'calculated' })
    expect(p.metrics.every((m) => m.value === null || Number.isFinite(m.value))).toBe(true)
  })
})
