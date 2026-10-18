import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  RULE_KEYS,
  placementId,
  qty,
  type CatalogEntry,
  type ClimateEntry,
  type Plan,
  type RackCoolingEntry,
  type RackEntry,
  type RackResult,
  type Rules,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { floorLoads } from '../src/floor'

const G = 9.80665
const BAY_AREA = 3.6 * 3.6
const note = { note: 'test value' }

const climate: ClimateEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Dallas',
  asOf: '2026-10-18',
  summary: 'Flat test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: qty(38, '°C', 'estimate', note),
}

const rules = {
  ...Object.fromEntries(RULE_KEYS.map((k) => [k, qty(1, '-', 'estimate', note)])),
  warnThreshold: qty(0.8, 'fraction', 'estimate', note),
} as Rules

function rack(id: string, weightKg: number | null, extra: Partial<RackEntry> = {}): RackEntry {
  return {
    id,
    kind: 'rack',
    name: id,
    asOf: '2026-10-18',
    summary: 'Test rack',
    role: 'compute',
    gpuCount: 72,
    nominalPowerW: qty(132_000, 'W', 'estimate', note),
    peakPowerW: qty(155_000, 'W', 'estimate', note),
    weightKg: { value: weightKg, unit: 'kg', basis: 'estimate', note: 'test value' },
    widthMm: qty(600, 'mm', 'estimate', note),
    depthMm: qty(1200, 'mm', 'estimate', note),
    heightMm: qty(2300, 'mm', 'estimate', note),
    slotsWide: 1,
    feet: 4,
    maxLiquidFraction: qty(0.85, 'fraction', 'estimate', note),
    maxCoolantSupplyC: qty(40, '°C', 'estimate', note),
    supportedCooling: ['air', 'dlc-1p'],
    supportedPower: ['ac54'],
    scaleOutPorts: 72,
    portGbps: 800,
    fp8Pflops: qty(720, 'PFLOPS', 'estimate', note),
    trays: { compute: 18, switch: 9, power: 8 },
    capexUsd: qty(4_500_000, 'USD', 'estimate', note),
    leadTimeWeeks: qty(16, 'week', 'estimate', note),
    ...extra,
  }
}

function method(id: string, addedWeightKg: number): RackCoolingEntry {
  const q = (v: number, unit: string) => qty(v, unit, 'estimate', note)
  return {
    id,
    kind: 'rackCooling',
    name: id,
    asOf: '2026-10-18',
    summary: 'Test cooling method',
    category: addedWeightKg > 0 ? 'dlc-1p' : 'air',
    maxRackW: q(200_000, 'W'),
    toTechnicalLoop: q(0.85, 'fraction'),
    supplyRangeC: { min: q(17, '°C'), max: q(45, '°C') },
    deltaTK: q(10, 'K'),
    pressureDropKpa: q(50, 'kPa'),
    addedWeightKgPerRack: q(addedWeightKg, 'kg'),
    formFactor: 'rack',
    requiresCdu: addedWeightKg > 0,
    pumpPowerFraction: q(0, 'fraction'),
    capexUsdPerKw: q(300, 'USD/kW'),
    installWeeks: q(4, 'week'),
    leadTimeWeeks: q(12, 'week'),
    risks: [],
    status: 'mainstream',
  }
}

const cdu: CatalogEntry = {
  id: 'cdu.test',
  kind: 'equipment',
  name: 'Test CDU',
  asOf: '2026-10-18',
  summary: 'Test CDU',
  category: 'cdu',
  params: {
    capacityW: qty(1_200_000, 'W', 'estimate', note),
    maxFlowLps: qty(24, 'L/s', 'estimate', note),
    approachK: qty(4, 'K', 'estimate', note),
    pumpPowerW: qty(10_000, 'W', 'estimate', note),
    weightKg: qty(1600, 'kg', 'estimate', note),
    capexUsd: qty(220_000, 'USD', 'estimate', note),
    leadTimeWeeks: qty(20, 'week', 'estimate', note),
  },
}

const PLAIN = rack('rack.plain', 1000)
const GB300 = rack('rack.gb300-like', 1580)
const UNKNOWN = rack('rack.unknown', null)
const BARE = method('method.bare', 0)
const DLC = method('method.dlc', 50)

/** Default hall geometry with one group of the given rack and method placed at the given slots. */
function setup(rackId: string, methodId: string, slots: { rowId: string; slot: number }[]) {
  const base = createDefaultPlan()
  const plan: Plan = {
    ...base,
    rackGroups: [{ id: 'g1', name: 'Test block', rackTypeId: rackId, coolingMethodId: methodId }],
    placements: slots.map(({ rowId, slot }) => ({ id: placementId(rowId, slot), groupId: 'g1', rowId, slot })),
  }
  const ctx: EvalContext = {
    plan,
    catalog: makeCatalogIndex([climate, PLAIN, GB300, UNKNOWN, BARE, DLC, cdu]),
    rules,
    climate,
  }
  const racks: RackResult[] = plan.placements.map((p) => ({
    placementId: p.id,
    groupId: p.groupId,
    rowId: p.rowId,
    slot: p.slot,
    objectId: `rack:${p.id}`,
    powerW: 0,
    heatW: 0,
    liquidW: 0,
    facilityWaterW: 0,
    airW: 0,
    flowLps: null,
    supplyC: null,
    returnC: null,
    airInletC: null,
    airOutletC: null,
    weightKg: 0,
    bayId: '',
    flowShare: null,
    coolingOk: true,
  }))
  return { ctx, racks }
}

function cduAt(positionId: string, count: number): SizedEquipment {
  return {
    key: 'cdu:R1',
    category: 'cdu',
    modelId: 'cdu.test',
    count,
    required: count,
    positionIds: [positionId],
    autoSized: true,
    loadW: 0,
    capacityW: 1_200_000,
    objectIds: Array.from({ length: count }, (_, i) => `eq:cdu:R1:${i}`),
  }
}

const slotsInRow = (rowId: string, n: number) => Array.from({ length: n }, (_, slot) => ({ rowId, slot }))

describe('floorLoads', () => {
  it('bay load = Σ(weight·g) of racks whose footprint center lies in the bay, plus equipment in the bay, ÷ bay area', () => {
    // R1 starts at x 8: slot 4 centers at 10.7 m (bay column 3, 7.2–10.8), slot 5 at 11.3 m (column 4).
    const { ctx, racks } = setup(PLAIN.id, BARE.id, [
      { rowId: 'R1', slot: 0 },
      { rowId: 'R1', slot: 4 },
      { rowId: 'R1', slot: 5 },
    ])
    // cdu-E1 sits at x 23.6, z 4.6: bay B7-2.
    const result = floorLoads(ctx, racks, [cduAt('cdu-E1', 2)])
    const bay = (id: string) => result.bays.find((b) => b.bayId === id)

    expect(result.bays).toHaveLength(ctx.plan.hall.bays.length)
    expect(bay('B3-2')?.loadKnM2).toBeCloseTo((2 * 1000 * G) / BAY_AREA / 1000, 6)
    expect(bay('B4-2')?.loadKnM2).toBeCloseTo((1000 * G) / BAY_AREA / 1000, 6)
    expect(bay('B7-2')?.loadKnM2).toBeCloseTo((2 * 1600 * G) / BAY_AREA / 1000, 6)
    expect(bay('B1-1')?.loadKnM2).toBe(0)
    expect(bay('B3-2')?.ratingKnM2).toBe(7.2)
    expect(bay('B3-2')?.utilization).toBeCloseTo(bay('B3-2')!.loadKnM2 / 7.2, 9)

    const check = result.checks.find((c) => c.id === 'layout.floorBay:B3-2')
    expect(check?.subject).toEqual({ kind: 'bay', id: 'B3-2', objectIds: ['rack:R1-00', 'rack:R1-04'] })
    expect(check?.status).toBe('pass')
    expect(result.checks.find((c) => c.id === 'layout.floorBay:B7-2')?.subject.objectIds).toEqual([
      'eq:cdu:R1:0',
      'eq:cdu:R1:1',
    ])
    // Only bays that carry something get a check.
    expect(result.checks.filter((c) => c.kind === 'layout.floorBay')).toHaveLength(3)
  })

  it('point load = weight·g / feet vs pointLimitKn', () => {
    const { ctx, racks } = setup(GB300.id, BARE.id, [{ rowId: 'R1', slot: 0 }])
    const check = floorLoads(ctx, racks, []).checks.find((c) => c.id === 'layout.pointLoad:g1')
    const expected = (1580 * G) / 4 / 1000
    expect(check?.value).toBeCloseTo(expected, 6)
    expect(check?.limit).toBe(4.5)
    expect(check?.unit).toBe('kN')
    expect(check?.utilization).toBeCloseTo(expected / 4.5, 6)
    expect(check?.status).toBe('warn') // 0.86 of the limit, above the 0.8 warning threshold
    expect(check?.subject).toEqual({ kind: 'group', id: 'g1', objectIds: ['rack:R1-00'] })
  })

  it('DLC adds addedWeightKgPerRack', () => {
    const slots = slotsInRow('R1', 2)
    const bare = setup(GB300.id, BARE.id, slots)
    const dlc = setup(GB300.id, DLC.id, slots)
    const bareResult = floorLoads(bare.ctx, bare.racks, [])
    const dlcResult = floorLoads(dlc.ctx, dlc.racks, [])
    const load = (r: typeof bareResult) => r.bays.find((b) => b.bayId === 'B3-2')!.loadKnM2
    const point = (r: typeof bareResult) => r.checks.find((c) => c.kind === 'layout.pointLoad')!.value!

    expect(load(dlcResult) - load(bareResult)).toBeCloseTo((2 * 50 * G) / BAY_AREA / 1000, 6)
    expect(point(dlcResult)).toBeCloseTo((1630 * G) / 4 / 1000, 6)
  })

  it('floorBay fails for GB300+DLC in default bays (7.2 kN/m²)', () => {
    // The default plan's placements: 16 slots in R1–R5. Bay column 4 holds six 600 mm racks of each row.
    const { ctx, racks } = setup(GB300.id, DLC.id, ['R1', 'R2', 'R3', 'R4', 'R5'].flatMap((r) => slotsInRow(r, 16)))
    const result = floorLoads(ctx, racks, [])
    const b42 = result.bays.find((b) => b.bayId === 'B4-2')!

    expect(b42.loadKnM2).toBeCloseTo((6 * 1630 * G) / BAY_AREA / 1000, 6) // ≈ 7.40 kN/m²
    expect(b42.utilization).toBeGreaterThan(1)
    const check = result.checks.find((c) => c.id === 'layout.floorBay:B4-2')!
    expect(check.status).toBe('fail')
    expect(check.limit).toBe(7.2)
    expect(check.explanation).toContain('6 racks')
    expect(check.advice).toBeDefined()
    expect(result.checks.filter((c) => c.kind === 'layout.floorBay' && c.status === 'fail').length).toBeGreaterThanOrEqual(5)
    expect(result.metrics.find((m) => m.id === 'layout.maxBayLoad')?.value).toBeCloseTo(b42.loadKnM2, 6)
  })

  it('a rack with unknown weight makes its bay and group checks unknown', () => {
    const { ctx, racks } = setup(UNKNOWN.id, BARE.id, [{ rowId: 'R1', slot: 0 }])
    const result = floorLoads(ctx, racks, [])
    const bayCheck = result.checks.find((c) => c.id === 'layout.floorBay:B3-2')!
    expect(bayCheck.status).toBe('unknown')
    expect(bayCheck.value).toBeNull()
    expect(bayCheck.utilization).toBeNull()
    const pointCheck = result.checks.find((c) => c.id === 'layout.pointLoad:g1')!
    expect(pointCheck.status).toBe('unknown')
    expect(pointCheck.value).toBeNull()
  })

  it('an empty hall gives zero loads, no checks and finite numbers', () => {
    const { ctx, racks } = setup(PLAIN.id, BARE.id, [])
    const result = floorLoads(ctx, racks, [])
    expect(result.checks).toEqual([])
    expect(result.bays.every((b) => b.loadKnM2 === 0 && b.utilization === 0)).toBe(true)
    expect(result.metrics.find((m) => m.id === 'layout.maxBayLoad')?.value).toBeNull()
    expect(result.metrics.find((m) => m.id === 'layout.maxPointLoad')?.value).toBeNull()
  })
})
