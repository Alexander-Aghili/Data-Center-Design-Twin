import { createDefaultPlan } from '@twin/catalog'
import {
  RULE_KEYS,
  qty,
  type Check,
  type ClimateEntry,
  type Plan,
  type Quantity,
  type RackEntry,
  type RackResult,
  type RuleKey,
  type Rules,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { demandChecks } from '../src/demand'
import type { PowerResult } from '../src/power'

const q = (value: number | null, unit = '-'): Quantity => ({ value, unit, basis: 'estimate', note: 'test value' })

function rackEntry(id: string, fp8Pflops: number | null): RackEntry {
  return {
    asOf: '2026-10-18',
    summary: 'test entry',
    id,
    kind: 'rack',
    name: id,
    role: 'compute',
    gpuCount: 72,
    nominalPowerW: q(130_000, 'W'),
    peakPowerW: q(142_000, 'W'),
    weightKg: q(1_500, 'kg'),
    widthMm: q(600, 'mm'),
    depthMm: q(1_200, 'mm'),
    heightMm: q(2_300, 'mm'),
    slotsWide: 1,
    feet: 4,
    maxLiquidFraction: q(0.85),
    maxCoolantSupplyC: q(40, '°C'),
    supportedCooling: ['dlc-1p'],
    supportedPower: ['ac54'],
    scaleOutPorts: 72,
    portGbps: 800,
    fp8Pflops: q(fp8Pflops, 'PFLOPS'),
    trays: { compute: 18, switch: 9, power: 8 },
    capexUsd: q(3_000_000, 'USD'),
    leadTimeWeeks: q(30, 'week'),
  }
}

const climate: ClimateEntry = {
  asOf: '2026-10-18',
  summary: 'test entry',
  id: 'climate.test',
  kind: 'climate',
  name: 'Flat',
  city: 'Nowhere',
  lat: 0,
  lon: 0,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: q(30, '°C'),
}

const RULE_VALUES: Partial<Record<RuleKey, number>> = { peakToAverageTraining: 1.1, warnThreshold: 0.8 }
const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, qty(RULE_VALUES[k] ?? 1, '-', 'estimate', { note: 'test value' })])) as Rules

function context(patch: (plan: Plan) => void = () => {}): EvalContext {
  const plan = createDefaultPlan()
  plan.rackGroups = [{ id: 'g1', name: 'Training block', rackTypeId: 'rack.big', coolingMethodId: 'rackCooling.dlc' }]
  plan.placements = [
    { id: 'R1-00', groupId: 'g1', rowId: 'R1', slot: 0 },
    { id: 'R1-01', groupId: 'g1', rowId: 'R1', slot: 1 },
  ]
  plan.workload = { purpose: 'training', targetPflops: 500 }
  patch(plan)
  const catalog = makeCatalogIndex([rackEntry('rack.big', 360), rackEntry('rack.unknown', null), climate])
  return { plan, catalog, rules, climate }
}

function rack(placementId: string, groupId = 'g1'): RackResult {
  return {
    placementId,
    groupId,
    rowId: placementId.split('-')[0]!,
    slot: Number(placementId.split('-')[1]),
    objectId: `rack:${placementId}`,
    powerW: 130_000,
    heatW: 130_000,
    liquidW: 110_500,
    facilityWaterW: 110_500,
    airW: 19_500,
    flowLps: null,
    supplyC: null,
    returnC: null,
    airInletC: null,
    airOutletC: null,
    weightKg: 1_580,
    bayId: 'B1-1',
    flowShare: null,
    coolingOk: true,
  }
}
const racks = [rack('R1-00'), rack('R1-01')]

function buswayCheck(rowId: string, limitA: number | null): Check {
  return {
    id: `power.busway:${rowId}`,
    kind: 'power.busway',
    layer: 'power',
    subject: { kind: 'row', id: rowId, objectIds: [`eq:busway:${rowId}:0`] },
    title: `Busway ${rowId}`,
    value: null,
    limit: limitA,
    unit: 'A',
    utilization: null,
    status: 'pass',
    explanation: '',
    causes: [],
  }
}

function power(rows: { rowId: string; buswayLoadA: number }[], limits: Record<string, number | null>): PowerResult {
  return {
    hourly: { itW: [], facilityW: [], pue: [] },
    rows,
    checks: Object.entries(limits).map(([rowId, limit]) => buswayCheck(rowId, limit)),
    metrics: [],
    headline: {},
  }
}

const swing = (checks: Check[]) => checks.filter((c) => c.kind === 'power.trainingSwing')
const target = (checks: Check[]) => checks.find((c) => c.kind === 'workload.targetCompute')

describe('power.trainingSwing', () => {
  it('warns when the training design current (load × peakToAverageTraining) exceeds 90% of the busway rating', () => {
    // The power module's buswayLoadA already carries the purpose's peak-to-average factor (1050 A × 1.1 = 1155 A);
    // it must not be applied twice. 1155 A > 0.9 × 1250 A = 1125 A.
    const [check] = swing(demandChecks(context(), racks, power([{ rowId: 'R1', buswayLoadA: 1155 }], { R1: 1250 })).checks)
    expect(check).toMatchObject({ id: 'power.trainingSwing:R1', status: 'warn', unit: 'A', layer: 'power' })
    expect(check!.value).toBeCloseTo(1155, 6)
    expect(check!.limit).toBeCloseTo(1125, 6)
    expect(check!.utilization).toBeCloseTo(1155 / 1125, 6)
    expect(check!.subject.objectIds).toEqual(['eq:busway:R1:0', 'rack:R1-00', 'rack:R1-01'])
  })

  it('passes below 90% of the rating', () => {
    // 1100 A < 1125 A, although 1100 A × 1.1 would exceed it
    const [check] = swing(demandChecks(context(), racks, power([{ rowId: 'R1', buswayLoadA: 1100 }], { R1: 1250 })).checks)
    expect(check!.status).toBe('pass')
  })

  it('is unknown when the busway rating is unknown', () => {
    const [check] = swing(demandChecks(context(), racks, power([{ rowId: 'R1', buswayLoadA: 900 }], { R1: null })).checks)
    expect(check).toMatchObject({ status: 'unknown', utilization: null })
  })

  it('is not raised unless the purpose is training', () => {
    const ctx = context((p) => (p.workload.purpose = 'inference'))
    expect(swing(demandChecks(ctx, racks, power([{ rowId: 'R1', buswayLoadA: 1200 }], { R1: 1250 })).checks)).toEqual([])
  })
})

describe('workload.targetCompute', () => {
  it('warns when placed PFLOPS is below the target', () => {
    const check = target(demandChecks(context((p) => (p.workload.targetPflops = 1000)), racks, power([], {})).checks)
    expect(check).toMatchObject({ id: 'workload.targetCompute:site', status: 'warn', value: 720, limit: 1000, unit: 'PFLOPS' })
    expect(check!.utilization).toBeCloseTo(1000 / 720, 6)
  })

  it('passes when placed PFLOPS meets the target', () => {
    expect(target(demandChecks(context(), racks, power([], {})).checks)?.status).toBe('pass')
  })

  it('is unknown when a rack has no FP8 figure', () => {
    const ctx = context((p) => p.rackGroups.push({ id: 'g2', name: 'Mystery', rackTypeId: 'rack.unknown', coolingMethodId: 'x' }))
    expect(target(demandChecks(ctx, [...racks, rack('R2-00', 'g2')], power([], {})).checks)?.status).toBe('unknown')
  })

  it('is unknown, not a warning, in an empty hall', () => {
    const ctx = context((p) => (p.placements = []))
    const check = target(demandChecks(ctx, [], power([], {})).checks)
    expect(check).toMatchObject({ status: 'unknown', value: 0, utilization: null })
  })
})
