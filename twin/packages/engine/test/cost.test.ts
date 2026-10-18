import { createDefaultPlan } from '@twin/catalog'
import {
  RULE_KEYS,
  qty,
  type CatalogEntry,
  type ClimateEntry,
  type EquipmentEntry,
  type HeatRejectionEntry,
  type Plan,
  type Quantity,
  type RackCoolingEntry,
  type RackEntry,
  type RackResult,
  type RuleKey,
  type Rules,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { costAndSchedule } from '../src/cost'

const q = (value: number | null, unit = '-'): Quantity => ({ value, unit, basis: 'estimate', note: 'test value' })
const meta = { asOf: '2026-10-18', summary: 'test entry' }

const gb300: RackEntry = {
  ...meta,
  id: 'rack.test-gb300',
  kind: 'rack',
  name: 'GB300 NVL72',
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
  fp8Pflops: q(360, 'PFLOPS'),
  trays: { compute: 18, switch: 9, power: 8 },
  capexUsd: q(3_000_000, 'USD'),
  leadTimeWeeks: q(30, 'week'),
}

const dlc: RackCoolingEntry = {
  ...meta,
  id: 'rackCooling.test-dlc',
  kind: 'rackCooling',
  name: 'Direct-to-chip, single-phase',
  category: 'dlc-1p',
  maxRackW: q(200_000, 'W'),
  toTechnicalLoop: q(0.85),
  supplyRangeC: { min: q(17, '°C'), max: q(45, '°C') },
  deltaTK: q(10, 'K'),
  pressureDropKpa: q(50, 'kPa'),
  addedWeightKgPerRack: q(80, 'kg'),
  formFactor: 'rack',
  requiresCdu: true,
  pumpPowerFraction: q(0),
  capexUsdPerKw: q(100, 'USD/kW'),
  installWeeks: q(8, 'week'),
  leadTimeWeeks: q(20, 'week'),
  risks: [],
  status: 'mainstream',
}

const chiller: HeatRejectionEntry = {
  ...meta,
  id: 'heatRejection.test-chiller',
  kind: 'heatRejection',
  name: 'Air-cooled chiller',
  category: 'chiller',
  basis: 'dryBulb',
  approachK: q(5, 'K'),
  copRef: q(5),
  copRefOutdoorC: q(35, '°C'),
  copSlopePerK: q(0.1),
  economizer: true,
  fanPowerFraction: q(0.02),
  waterLPerKwh: q(0, 'L/kWh'),
  unitCapacityW: q(1_300_000, 'W'),
  capexUsdPerKw: q(400, 'USD/kW'),
  leadTimeWeeks: q(40, 'week'),
  installWeeks: q(8, 'week'),
  footprintM2PerMw: q(40, 'm²/MW'),
}

function equipmentEntry(id: string, name: string, category: EquipmentEntry['category'], params: Record<string, number | null>): EquipmentEntry {
  return { ...meta, id, kind: 'equipment', name, category, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, q(v)])) }
}

const cdu = equipmentEntry('cdu.test', '1.2 MW row CDU', 'cdu', {
  capacityW: 1_200_000, maxFlowLps: 24, approachK: 4, pumpPowerW: 10_000, weightKg: 1_600, capexUsd: 220_000, leadTimeWeeks: 20,
})
const ups = equipmentEntry('ups.test', '500 kW modular UPS', 'ups', { moduleW: 500_000, efficiency: 0.967, capexUsdPerKw: 250, leadTimeWeeks: 26 })
const busway = equipmentEntry('busway.test', '1250 A busway', 'busway', { ratingA: 1250, voltageV: 415, powerFactor: 0.95, capexUsdPerM: 600, leadTimeWeeks: 16 })
const transformer = equipmentEntry('transformer.test', '3 MVA pad-mount transformer', 'transformer', {
  ratingVa: 3_000_000, efficiency: 0.995, capexUsd: 180_000, leadTimeWeeks: 52,
})
const buffer = equipmentEntry('bufferTank.test', 'Buffer tank', 'bufferTank', { capexUsdPerM3: 1_500, leadTimeWeeks: 12 })
const leaf = equipmentEntry('leaf.test', 'Leaf switch', 'leaf', { ports: 64, portGbps: 800, powerW: 940, capexUsd: 55_000 })

const climate: ClimateEntry = {
  ...meta,
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

const RULE_VALUES: Partial<Record<RuleKey, number>> = {
  pipingUsdPerMRaised: 600,
  pipingUsdPerMOverhead: 800,
  // The spec says overhead piping installs faster than raised floor; these test values follow it.
  raisedFloorInstallWeeks: 10,
  overheadInstallWeeks: 6,
  routingSlackM: 3,
  warnThreshold: 0.8,
}
const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, qty(RULE_VALUES[k] ?? 1, '-', 'estimate', { note: 'test value' })])) as Rules

function context(patch: (plan: Plan) => void = () => {}, extra: CatalogEntry[] = []): EvalContext {
  const plan = createDefaultPlan()
  plan.rackGroups = [{ id: 'g3', name: 'Training block', rackTypeId: gb300.id, coolingMethodId: dlc.id }]
  plan.placements = [
    { id: 'R3-00', groupId: 'g3', rowId: 'R3', slot: 0 },
    { id: 'R3-02', groupId: 'g3', rowId: 'R3', slot: 2 },
  ]
  plan.cooling.heatRejectionId = chiller.id
  plan.cooling.bufferTankM3 = 10
  plan.site.climateId = climate.id
  patch(plan)
  const catalog = makeCatalogIndex([gb300, dlc, chiller, cdu, ups, busway, transformer, buffer, leaf, climate, ...extra])
  return { plan, catalog, rules, climate }
}

function rack(placementId: string, rowId: string, slot: number): RackResult {
  return {
    placementId,
    groupId: 'g3',
    rowId,
    slot,
    objectId: `rack:${placementId}`,
    powerW: 130_000,
    heatW: 130_000,
    liquidW: 110_500,
    facilityWaterW: 110_500,
    airW: 19_500,
    flowLps: 2.6,
    supplyC: 22,
    returnC: 32,
    airInletC: 24,
    airOutletC: 39,
    weightKg: 1_580,
    bayId: 'B1-1',
    flowShare: 1,
    coolingOk: true,
  }
}
const racks = [rack('R3-00', 'R3', 0), rack('R3-02', 'R3', 2)]

function sized(key: string, category: string, modelId: string | null, count: number, positionIds: string[] = []): SizedEquipment {
  return { key, category, modelId, count, required: count, positionIds, autoSized: true, loadW: 0, capacityW: null, objectIds: [`eq:${key}:0`] }
}

const equipment: SizedEquipment[] = [
  sized('cdu:R3', 'cdu', cdu.id, 2, ['cdu-E3']),
  sized('ups', 'ups', ups.id, 2, ['elec-1']),
  sized('busway:R3', 'busway', busway.id, 1),
  sized('transformer', 'transformer', transformer.id, 1, ['elec-1']),
  sized('plant', 'heatRejection', chiller.id, 1, ['plant-1']),
  sized('bufferTank', 'bufferTank', buffer.id, 1),
  sized('leaf:L1', 'leaf', leaf.id, 1, ['leaf-1']),
]

// Default hall geometry: rows start at x 8 m with 0.6 m slots; R3 sits at z 11.2 m, so rack centers are at z 11.8 m.
// cdu-E3 is at (23.6, 11.8) and plant-1 at (20, -6). Routed length = Manhattan distance + 3 m slack per run.
const BRANCH_SLOT0 = 23.6 - 8.3 + 3
const BRANCH_SLOT2 = 23.6 - 9.5 + 3
const MAIN_CDU = 23.6 - 20 + (11.8 - -6) + 3
const PIPE_M = BRANCH_SLOT0 + BRANCH_SLOT2 + MAIN_CDU

/** Paths of numbers that are NaN or infinite. */
function nonFinite(value: unknown, path = '$'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`))
  return []
}

describe('costAndSchedule capex', () => {
  it('sums racks, rack cooling, equipment, plant, piping and buffer by category', () => {
    const { cost } = costAndSchedule(context(), racks, equipment)
    const expected = {
      racks: 2 * 3_000_000,
      rackCooling: 100 * 260, // capexUsdPerKw × IT kW
      cdu: 2 * 220_000,
      ups: 2 * 500 * 250, // modules × kW per module × USD/kW
      busway: 600 * 24 * 0.6, // USD/m × row length
      transformer: 180_000,
      leaf: 55_000,
      plant: 400 * 260, // capexUsdPerKw × rejected kW
      piping: 600 * PIPE_M, // raised-floor rate × routed length
      bufferTank: 1_500 * 10,
    }
    expect(Object.keys(cost.byCategory).sort()).toEqual(Object.keys(expected).sort())
    for (const [category, usd] of Object.entries(expected)) expect(cost.byCategory[category]).toBeCloseTo(usd, 6)
    expect(cost.capexUsd).toBeCloseTo(Object.values(expected).reduce((a, b) => a + b, 0), 6)
  })

  it('overhead piping uses the overhead rate', () => {
    const { cost } = costAndSchedule(context((p) => (p.cooling.pipingRoute = 'overhead')), racks, equipment)
    expect(cost.byCategory.piping).toBeCloseTo(800 * PIPE_M, 6)
  })

  it('leaves out items without a price and counts them in a metric', () => {
    const custom = equipmentEntry('crah.custom', 'Custom CRAH', 'crah', { capacityW: 300_000, airflowM3s: 20, fanPowerW: 15_000, capexUsd: null, leadTimeWeeks: 10 })
    const { cost, metrics } = costAndSchedule(context(() => {}, [custom]), racks, [sized('crah:Z1', 'crah', custom.id, 2)])
    expect(cost.byCategory.crah).toBeUndefined()
    expect(metrics.find((m) => m.id === 'cost.unpriced')?.value).toBe(1)
  })
})

describe('costAndSchedule build-out', () => {
  it('buildWeeks is the longest lead time plus install time, with the critical path named', () => {
    const { cost } = costAndSchedule(context(), racks, equipment)
    expect(cost.buildWeeks).toBe(52)
    expect(cost.criticalPath).toEqual(['3 MVA pad-mount transformer'])
  })

  it('plant counts its install weeks on top of its lead time', () => {
    const noTransformer = equipment.filter((e) => e.key !== 'transformer')
    const { cost } = costAndSchedule(context(), racks, noTransformer)
    expect(cost.buildWeeks).toBe(40 + 8)
    expect(cost.criticalPath).toEqual(['Air-cooled chiller'])
  })

  it('overhead piping is faster than raised floor for water-side items', () => {
    const slowCdu = equipmentEntry('cdu.slow', 'Slow CDU', 'cdu', { ...Object.fromEntries(Object.entries(cdu.params).map(([k, v]) => [k, v.value])), leadTimeWeeks: 50 })
    const onlyCdu = [sized('cdu:R3', 'cdu', slowCdu.id, 2, ['cdu-E3'])]
    const raised = costAndSchedule(context(() => {}, [slowCdu]), racks, onlyCdu).cost
    const overhead = costAndSchedule(context((p) => (p.cooling.pipingRoute = 'overhead'), [slowCdu]), racks, onlyCdu).cost
    expect(raised.buildWeeks).toBe(50 + 10)
    expect(overhead.buildWeeks).toBe(50 + 6)
    expect(overhead.criticalPath).toEqual(['Slow CDU'])
  })

  it('delayCostUsd = buildWeeks · 168 · gpuCount · value of compute', () => {
    const { cost } = costAndSchedule(context(), racks, equipment)
    expect(cost.delayCostUsd).toBeCloseTo(52 * 168 * 144 * 2.5, 6)
  })
})

describe('demand.leadTime check', () => {
  it('passes as info and names the critical-path item', () => {
    const { checks } = costAndSchedule(context(), racks, equipment)
    const lead = checks.find((c) => c.kind === 'demand.leadTime')!
    expect(lead).toMatchObject({ id: 'demand.leadTime:site', status: 'pass', value: 52, unit: 'week' })
    expect(lead.explanation).toContain('3 MVA pad-mount transformer')
    expect(lead.subject.objectIds).toEqual(['eq:transformer:0'])
  })

  it('uses singular and plural correctly, with a non-breaking space before the unit', () => {
    const quick = equipmentEntry('busway.quick', 'Quick busway', 'busway', { ratingA: 1250, voltageV: 415, powerFactor: 0.95, capexUsdPerM: 600, leadTimeWeeks: 1 })
    const twin = equipmentEntry('ups.quick', 'Quick UPS', 'ups', { moduleW: 500_000, efficiency: 0.967, capexUsdPerKw: 250, leadTimeWeeks: 1 })
    const one = costAndSchedule(context((p) => (p.cooling.bufferTankM3 = 0), [quick, twin]), [], [sized('busway:R3', 'busway', quick.id, 1), sized('ups', 'ups', twin.id, 1)])
    const lead = one.checks.find((c) => c.kind === 'demand.leadTime')!
    expect(lead.explanation).toBe('Build-out takes 1\u00a0week. Quick busway and Quick UPS set the critical path: 1\u00a0week lead time.')
    const single = costAndSchedule(context(), racks, equipment).checks.find((c) => c.kind === 'demand.leadTime')!
    expect(single.explanation).toContain('3 MVA pad-mount transformer sets the critical path: 52\u00a0weeks lead time.')
  })

  it('is unknown when an item on order has no lead time', () => {
    const unknownLead = equipmentEntry('transformer.custom', 'Custom transformer', 'transformer', {
      ratingVa: 3_000_000, efficiency: 0.99, capexUsd: 150_000, leadTimeWeeks: null,
    })
    const { checks } = costAndSchedule(context(() => {}, [unknownLead]), racks, [sized('transformer', 'transformer', unknownLead.id, 1)])
    const lead = checks.find((c) => c.kind === 'demand.leadTime')!
    expect(lead.status).toBe('unknown')
    expect(lead.explanation).toContain('Custom transformer')
  })
})

describe('costAndSchedule empty hall', () => {
  it('evaluates to zeros with no NaN', () => {
    const ctx = context((p) => {
      p.placements = []
      p.cooling.bufferTankM3 = 0
    })
    const slice = costAndSchedule(ctx, [], [])
    expect(slice.cost).toEqual({ capexUsd: 0, byCategory: {}, buildWeeks: 0, criticalPath: [], delayCostUsd: 0 })
    expect(slice.checks.every((c) => c.status === 'pass' || c.status === 'unknown')).toBe(true)
    expect(nonFinite(slice)).toEqual([])
  })
})
