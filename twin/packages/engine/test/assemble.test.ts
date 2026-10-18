import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  EquipmentEntrySchema,
  EvaluationSchema,
  RACK,
  RACK_COOLING,
  RackCoolingEntrySchema,
  RulesSchema,
  qty,
  type Builtins,
  type CatalogEntry,
  type Check,
  type ClimateEntry,
  type Plan,
  type RackEntry,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import busway1250Json from '../../catalog/data/equipment/busway.1250a.json'
import transformerJson from '../../catalog/data/equipment/transformer.3mva.json'
import upsJson from '../../catalog/data/equipment/ups.500kw.json'
import airContainedJson from '../../catalog/data/rack-cooling/rackCooling.air-contained.json'
import rulesJson from '../../catalog/data/rules.json'
import { evaluate } from '../src'
import { assemble, type EvalSlices } from '../src/assemble'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { emptyCost, emptyNetwork } from '../src/empty'
import { powerBudget } from '../src/power'
import { computeRacks } from '../src/racks'

/** Fails with the path of the first NaN or ±Infinity found anywhere in `value`. */
function assertFinite(value: unknown, path = 'evaluation'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(v, `${path}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`)
  }
}

const est = (value: number, unit: string) => qty(value, unit, 'estimate', { note: 'test fixture' })
const hgx: RackEntry = {
  id: RACK.HGX_B300_AIR,
  kind: 'rack',
  name: 'HGX B300 air',
  asOf: '2026-10-18',
  summary: 'test rack',
  role: 'compute',
  gpuCount: 16,
  nominalPowerW: est(28_000, 'W'),
  peakPowerW: est(30_000, 'W'),
  weightKg: est(440, 'kg'),
  widthMm: est(600, 'mm'),
  depthMm: est(1200, 'mm'),
  heightMm: est(2300, 'mm'),
  slotsWide: 1,
  feet: 4,
  maxLiquidFraction: est(0, 'fraction'),
  maxCoolantSupplyC: est(45, '°C'),
  supportedCooling: ['air', 'rdhx'],
  supportedPower: ['ac54'],
  scaleOutPorts: 16,
  portGbps: 800,
  fp8Pflops: est(72, 'PFLOPS'),
  trays: { compute: 2, switch: 0, power: 2 },
  capexUsd: est(500_000, 'USD'),
  leadTimeWeeks: est(16, 'week'),
}
const climate: ClimateEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Test',
  asOf: '2026-10-18',
  summary: 'test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, (_, h) => 20 + 15 * Math.sin((2 * Math.PI * h) / 8760)),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: est(38, '°C'),
}
const rules = RulesSchema.parse(rulesJson)
const entries: CatalogEntry[] = [
  hgx,
  climate,
  RackCoolingEntrySchema.parse(airContainedJson),
  EquipmentEntrySchema.parse(busway1250Json),
  EquipmentEntrySchema.parse(upsJson),
  EquipmentEntrySchema.parse(transformerJson),
]
const builtins: Builtins = { entries, rules }

function hgxPlan(): Plan {
  return {
    ...createDefaultPlan(),
    rackGroups: [{ id: 'g1', name: 'Inference block', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED }],
    placements: Array.from({ length: 4 }, (_, slot) => ({ id: `R1-0${slot}`, groupId: 'g1', rowId: 'R1', slot })),
  }
}

describe('empty plan evaluates cleanly', () => {
  it('no NaN or Infinity anywhere, PUE null, checks pass or unknown', () => {
    const evaluation = evaluate({ ...hgxPlan(), placements: [] }, builtins)
    assertFinite(evaluation)
    expect(EvaluationSchema.safeParse(evaluation).success).toBe(true)
    expect(evaluation.headline.pueAnnual).toBeNull()
    expect(evaluation.headline.pueWorst).toBeNull()
    expect(evaluation.headline.usablePflops).toBe(0)
    expect(evaluation.headline.buildable).toBe(false)
    expect(evaluation.hourly.facilityW).toHaveLength(8760)
    expect(evaluation.hourly.pue.every((v) => v === null)).toBe(true)
    expect(evaluation.checks.every((c) => c.status === 'pass' || c.status === 'unknown')).toBe(true)
    expect(evaluation.rows.map((r) => r.rowId)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
  })

  it('a plan with racks also evaluates without NaN or Infinity', () => {
    const evaluation = evaluate(hgxPlan(), builtins)
    assertFinite(evaluation)
    expect(EvaluationSchema.safeParse(evaluation).success).toBe(true)
    expect(evaluation.headline.placedPflops).toBe(4 * 72)
    expect(evaluation.racks).toHaveLength(4)
  })
})

describe('assemble', () => {
  const plan = hgxPlan()
  const ctx: EvalContext = { plan, catalog: makeCatalogIndex(entries), rules, climate }
  const racks = computeRacks(ctx)
  const hours = 8760
  // 0.1 m³ every hour, except day 200 at 0.5 m³ per hour: the peak day uses 12 m³.
  const waterM3 = Array.from({ length: hours }, (_, h) => (Math.floor(h / 24) === 200 ? 0.5 : 0.1))
  const coolingW = Array.from({ length: hours }, () => 20_000)
  const check = (id: string, status: Check['status']): Check => ({
    id,
    kind: 'cooling.leakExposure',
    layer: 'cooling',
    subject: { kind: 'site', id: 'site', objectIds: [] },
    title: id,
    value: null,
    limit: null,
    unit: '',
    utilization: null,
    status,
    explanation: 'test',
    causes: [],
  })
  const cdu: SizedEquipment = {
    key: 'cdu:R1',
    category: 'cdu',
    modelId: null,
    count: 1,
    required: 1,
    positionIds: ['cdu-E1'],
    autoSized: true,
    loadW: 0,
    capacityW: null,
    objectIds: [],
  }

  function slices(extraChecks: Check[] = []): EvalSlices {
    const rejection = { hourly: { outdoorC: [], wetBulbC: [], coolingW, trimW: [], waterM3 }, checks: [check('rejection', 'pass')], metrics: [] }
    const network = { network: emptyNetwork(1), checks: [], metrics: [] }
    return {
      racks,
      air: { rows: [{ rowId: 'R1', airW: 112_000 }], checks: [check('air', 'pass')], metrics: [], crahLoads: {} },
      liquid: { racks, rowFlows: [{ rowId: 'R1', liquidW: 5, flowLps: 1.5 }], checks: [], metrics: [] },
      sizing: { equipment: [cdu], checks: [check('sizing', 'warn')] },
      rejection,
      buffer: { checks: [], metrics: [] },
      network,
      power: powerBudget(ctx, racks, [cdu], rejection, network),
      floor: { bays: [], checks: extraChecks, metrics: [] },
      cost: { cost: emptyCost(), checks: [], metrics: [] },
      demand: { checks: [] },
    }
  }

  it('merges per-row loads from the air, liquid, power and sizing slices', () => {
    const e = assemble(ctx, slices())
    const r1 = e.rows.find((r) => r.rowId === 'R1')!
    expect(r1.airW).toBe(112_000)
    expect(r1.liquidW).toBe(5)
    expect(r1.flowLps).toBe(1.5)
    expect(r1.cduKey).toBe('cdu:R1')
    expect(r1.buswayLoadA).toBeGreaterThan(0)
    expect(e.rows.find((r) => r.rowId === 'R2')).toEqual({ rowId: 'R2', airW: 0, liquidW: 0, flowLps: 0, buswayLoadA: 0, cduKey: null })
  })

  it('builds 8,760-hour series from the climate, rejection and power slices', () => {
    const e = assemble(ctx, slices())
    for (const series of Object.values(e.hourly)) expect(series).toHaveLength(hours)
    expect(e.hourly.outdoorC[100]).toBe(climate.dryBulbC[100])
    expect(e.hourly.coolingW[0]).toBe(20_000)
    expect(e.hourly.trimW[0]).toBe(0)
    expect(e.hourly.itW[0]).toBe(4 * 28_000)
  })

  it('headline carries power results, the peak-day water and buildability', () => {
    const e = assemble(ctx, slices())
    expect(e.headline.placedPflops).toBe(288)
    expect(e.headline.gpuCount).toBe(64)
    expect(e.headline.waterM3PerDayPeak).toBeCloseTo(12, 9)
    expect(e.headline.pueAnnual).not.toBeNull()
    expect(e.headline.buildable).toBe(true)
    expect(assemble(ctx, slices([check('floor', 'fail')])).headline.buildable).toBe(false)
  })

  it('collects every slice checks and metrics', () => {
    const e = assemble(ctx, slices())
    const ids = e.checks.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['air', 'sizing', 'rejection', 'power.gridWorstHour:site']))
    expect(e.metrics.some((m) => m.id === 'power.itW')).toBe(true)
    expect(e.equipment).toEqual([cdu])
    expect(EvaluationSchema.safeParse(e).success).toBe(true)
  })
})
