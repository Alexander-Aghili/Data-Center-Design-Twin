import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  EQUIPMENT,
  RULE_KEYS,
  placementId,
  qty,
  type CatalogEntry,
  type ClimateEntry,
  type EquipmentPosition,
  type Plan,
  type RackEntry,
  type RackResult,
  type Rules,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { networkFabric } from '../src/network'

const note = { note: 'test value' }
const q = (v: number, unit: string) => qty(v, unit, 'estimate', note)

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
  designDryBulbC: q(38, '°C'),
}

function rules(overrides: Partial<Record<(typeof RULE_KEYS)[number], number>> = {}): Rules {
  const values = {
    warnThreshold: 0.8,
    dacReachM: 2,
    aecReachM: 7,
    routingSlackM: 3,
    fiberNsPerM: 4.9,
    copperNsPerM: 4.5,
    hopNs: 600,
    ...overrides,
  }
  return Object.fromEntries(RULE_KEYS.map((k) => [k, q(values[k as keyof typeof values] ?? 1, '-')])) as Rules
}

function rack(id: string, role: RackEntry['role'], scaleOutPorts: number): RackEntry {
  return {
    id,
    kind: 'rack',
    name: id,
    asOf: '2026-10-18',
    summary: 'Test rack',
    role,
    gpuCount: role === 'compute' ? 72 : 0,
    nominalPowerW: q(132_000, 'W'),
    peakPowerW: q(155_000, 'W'),
    weightKg: q(1580, 'kg'),
    widthMm: q(600, 'mm'),
    depthMm: q(1200, 'mm'),
    heightMm: q(2300, 'mm'),
    slotsWide: 1,
    feet: 4,
    maxLiquidFraction: q(0.85, 'fraction'),
    maxCoolantSupplyC: q(40, '°C'),
    supportedCooling: ['air', 'dlc-1p'],
    supportedPower: ['ac54'],
    scaleOutPorts,
    portGbps: 800,
    fp8Pflops: q(720, 'PFLOPS'),
    trays: { compute: 18, switch: 9, power: 8 },
    capexUsd: q(4_500_000, 'USD'),
    leadTimeWeeks: q(16, 'week'),
  }
}

function equipment(id: string, category: 'leaf' | 'optic' | 'cable', params: Record<string, number>): CatalogEntry {
  return {
    id,
    kind: 'equipment',
    name: id,
    asOf: '2026-10-18',
    summary: 'Test equipment',
    category,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, q(v, '-')])),
  }
}

const COMPUTE = rack('rack.compute', 'compute', 4)
const NETWORK = rack('rack.net', 'network', 64)
const LEAF = equipment(EQUIPMENT.LEAF_64X800G, 'leaf', { ports: 64, portGbps: 800, powerW: 940, capexUsd: 55_000 })
const OPTIC = equipment(EQUIPMENT.OPTIC_800G, 'optic', { powerW: 17.8, reachM: 500, capexUsd: 900 })
const DAC = equipment(EQUIPMENT.CABLE_DAC, 'cable', { reachM: 2, powerWPerEnd: 0.1, capexUsdPerM: 60 })
const AEC = equipment(EQUIPMENT.CABLE_AEC, 'cable', { reachM: 7, powerWPerEnd: 10, capexUsdPerM: 100 })
const FIBER = equipment(EQUIPMENT.CABLE_FIBER, 'cable', { reachM: 500, powerWPerEnd: 0, capexUsdPerM: 4 })
const ALL_ENTRIES: CatalogEntry[] = [climate, COMPUTE, NETWORK, LEAF, OPTIC, DAC, AEC, FIBER]

interface SetupOptions {
  slots: { rowId: string; slot: number; rackId?: string }[]
  leaves?: EquipmentPosition[]
  rules?: Rules
  fabric?: Plan['network']['fabric']
  oversubscription?: number
  entries?: CatalogEntry[]
}

function setup({ slots, leaves, rules: r = rules(), fabric = 'railOptimized', oversubscription = 1, entries = ALL_ENTRIES }: SetupOptions) {
  const base = createDefaultPlan()
  const rackIds = [...new Set(slots.map((s) => s.rackId ?? COMPUTE.id))]
  const plan: Plan = {
    ...base,
    hall: {
      ...base.hall,
      positions: leaves ? [...base.hall.positions.filter((p) => p.kind !== 'leaf'), ...leaves] : base.hall.positions,
    },
    network: { fabric, oversubscription },
    rackGroups: rackIds.map((rackTypeId, i) => ({ id: `g${i + 1}`, name: rackTypeId, rackTypeId, coolingMethodId: 'none' })),
    placements: slots.map(({ rowId, slot, rackId }) => ({
      id: placementId(rowId, slot),
      groupId: `g${rackIds.indexOf(rackId ?? COMPUTE.id) + 1}`,
      rowId,
      slot,
    })),
  }
  const ctx: EvalContext = { plan, catalog: makeCatalogIndex(entries), rules: r, climate }
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

/** A leaf at the west end of R1 (row center z 4.6), so short copper runs are possible. */
const leafAtR1: EquipmentPosition = { id: 'leaf-x', kind: 'leaf', x: 6.8, z: 4.6, servesRows: ['R1'], capacity: 1 }
const linkFor = (result: ReturnType<typeof networkFabric>, id: string) => result.network.links.find((l) => l.fromId === id)

describe('networkFabric', () => {
  it('each compute rack links to the nearest leaf position along the row and the row end, plus routing slack', () => {
    // Default leaves: leaf-1 at (6.8, 10.0) for R1–R4, leaf-2 at (6.8, 24.4) for R5–R8; rows start at x 8.
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 0 }, { rowId: 'R4', slot: 0 }, { rowId: 'R5', slot: 0 }] })
    const result = networkFabric(ctx, racks)
    // R1 slot 0: 0.3 m along the row to the west end, 1.2 m across to x 6.8, 5.4 m to z 10, plus 3 m slack.
    expect(linkFor(result, 'R1-00')).toEqual({ fromId: 'R1-00', toId: 'leaf-1', media: 'fiber', lengthM: expect.closeTo(9.9, 9) })
    expect(linkFor(result, 'R4-00')?.toId).toBe('leaf-1') // R4 at z 15.4: 5.4 m from leaf-1, 9 m from leaf-2
    expect(linkFor(result, 'R5-00')?.toId).toBe('leaf-2')
    expect(result.network.cableM).toBeCloseTo(3 * 4 * 9.9, 9) // four scale-out cables per rack
  })

  it('a rack near the east end routes out of the east end when the leaf is there', () => {
    const eastLeaf: EquipmentPosition = { id: 'leaf-e', kind: 'leaf', x: 23.6, z: 4.6, servesRows: ['R1'], capacity: 1 }
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 23 }], leaves: [eastLeaf] })
    // Slot 23 centers at x 22.1; the row ends at x 22.4.
    expect(linkFor(networkFabric(ctx, racks), 'R1-23')?.lengthM).toBeCloseTo(0.3 + 1.2 + 3, 9)
  })

  it('media is DAC up to dacReachM, AEC up to aecReachM, fiber otherwise', () => {
    const { ctx, racks } = setup({
      slots: [0, 1, 8, 9].map((slot) => ({ rowId: 'R1', slot })),
      leaves: [leafAtR1],
      rules: rules({ routingSlackM: 0.5 }),
    })
    const result = networkFabric(ctx, racks)
    expect(result.network.links.map((l) => [l.fromId, l.media, Number(l.lengthM.toFixed(6))])).toEqual([
      ['R1-00', 'dac', 2.0],
      ['R1-01', 'aec', 2.6],
      ['R1-08', 'aec', 6.8],
      ['R1-09', 'fiber', 7.4],
    ])
  })

  it('non-compute racks get no scale-out link', () => {
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 0 }, { rowId: 'R1', slot: 1, rackId: NETWORK.id }] })
    expect(networkFabric(ctx, racks).network.links.map((l) => l.fromId)).toEqual(['R1-00'])
  })

  it('optics power = 2·optic.powerW per fiber cable, plus the active ends of copper cables', () => {
    const { ctx, racks } = setup({
      slots: [0, 1, 9].map((slot) => ({ rowId: 'R1', slot })),
      leaves: [leafAtR1],
      rules: rules({ routingSlackM: 0.5 }),
    })
    const result = networkFabric(ctx, racks)
    expect(result.network.opticsW).toBeCloseTo(4 * 2 * (0.1 + 10 + 17.8), 9)
    expect(result.metrics.find((m) => m.id === 'network.opticsW')?.value).toBeCloseTo(result.network.opticsW, 9)
    expect(result.network.cableM).toBeCloseTo(4 * (2.0 + 2.6 + 7.4), 9)
  })

  it('copperReach is info with counts', () => {
    const { ctx, racks } = setup({
      slots: [0, 1, 9].map((slot) => ({ rowId: 'R1', slot })),
      leaves: [leafAtR1],
      rules: rules({ routingSlackM: 0.5 }),
    })
    const check = networkFabric(ctx, racks).checks.find((c) => c.kind === 'network.copperReach')!
    expect(check.id).toBe('network.copperReach:fabric')
    expect(check.status).toBe('pass')
    expect(check.value).toBe(2)
    expect(check.limit).toBeNull()
    expect(check.explanation).toContain('1 on DAC')
    expect(check.explanation).toContain('1 on AEC')
    expect(check.explanation).toContain('8 transceivers')
    expect(['dac', 'aec', 'fiber'].map((m) => networkFabric(ctx, racks).metrics.find((x) => x.id === `network.links.${m}`)?.value)).toEqual([
      1, 1, 1,
    ])
  })

  it('optics power is unknown when the optic has no power value', () => {
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 0 }], entries: ALL_ENTRIES.filter((e) => e.id !== OPTIC.id) })
    const result = networkFabric(ctx, racks)
    expect(result.network.opticsW).toBe(0)
    expect(result.metrics.find((m) => m.id === 'network.opticsW')?.value).toBeNull()
  })

  it('leaf ports needed = scale-out downlinks plus uplinks at the oversubscription ratio, against leaf ports × leaf count', () => {
    // 10 racks × 4 ports = 40 downlinks; 1:1 needs 40 uplinks. Two leaf positions hold one 64-port leaf each.
    const ten = Array.from({ length: 10 }, (_, slot) => ({ rowId: 'R1', slot }))
    const leaves = [leafAtR1, { ...leafAtR1, id: 'leaf-y', z: 18.4 }]
    const oneToOne = setup({ slots: ten, leaves })
    const check = networkFabric(oneToOne.ctx, oneToOne.racks).checks.find((c) => c.id === 'network.leafPorts:leaf')!
    expect(check.value).toBe(80)
    expect(check.limit).toBe(128)
    expect(check.utilization).toBeCloseTo(80 / 128, 9)
    expect(check.status).toBe('pass')

    // 3:1 needs ⌈40 / 3⌉ = 14 uplinks.
    const threeToOne = setup({ slots: ten, leaves, oversubscription: 3 })
    expect(networkFabric(threeToOne.ctx, threeToOne.racks).checks.find((c) => c.kind === 'network.leafPorts')?.value).toBe(54)

    const twenty = setup({ slots: Array.from({ length: 20 }, (_, slot) => ({ rowId: 'R1', slot })), leaves })
    const over = networkFabric(twenty.ctx, twenty.racks).checks.find((c) => c.kind === 'network.leafPorts')!
    expect(over.value).toBe(160)
    expect(over.status).toBe('fail')
    expect(over.advice).toBeDefined()
  })

  it('base latency = longest rack-to-rack path · ns/m + hops · hopNs (rail-optimized 2 hops, fat tree 3)', () => {
    const slots = [{ rowId: 'R1', slot: 0 }]
    const rail = setup({ slots })
    // One 9.9 m fiber run: the worst path goes up one run and down another.
    expect(networkFabric(rail.ctx, rail.racks).network.baseLatencyNs).toBeCloseTo(2 * 9.9 * 4.9 + 2 * 600, 9)
    const fat = setup({ slots, fabric: 'fatTree' })
    expect(networkFabric(fat.ctx, fat.racks).network.baseLatencyNs).toBeCloseTo(2 * 9.9 * 4.9 + 3 * 600, 9)
    const copper = setup({ slots, leaves: [leafAtR1], rules: rules({ routingSlackM: 0.5 }) })
    expect(networkFabric(copper.ctx, copper.racks).network.baseLatencyNs).toBeCloseTo(2 * 2.0 * 4.5 + 2 * 600, 9)
  })

  it('carries the plan oversubscription', () => {
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 0 }], oversubscription: 2 })
    expect(networkFabric(ctx, racks).network.oversubscription).toBe(2)
  })

  it('compute racks without any leaf position fail leafPorts and leave copperReach unknown', () => {
    const { ctx, racks } = setup({ slots: [{ rowId: 'R1', slot: 0 }], leaves: [] })
    const result = networkFabric(ctx, racks)
    expect(result.network.links).toEqual([])
    const leafPorts = result.checks.find((c) => c.kind === 'network.leafPorts')!
    expect(leafPorts.status).toBe('fail')
    expect(leafPorts.limit).toBe(0)
    expect(leafPorts.utilization).toBeNull()
    expect(result.checks.find((c) => c.kind === 'network.copperReach')?.status).toBe('unknown')
  })

  it('an empty hall evaluates to zeros and passing checks', () => {
    const { ctx, racks } = setup({ slots: [] })
    const result = networkFabric(ctx, racks)
    expect(result.network).toEqual({ links: [], opticsW: 0, cableM: 0, baseLatencyNs: 0, oversubscription: 1 })
    expect(result.checks.map((c) => c.status)).toEqual(['pass', 'pass'])
    expect(result.metrics.find((m) => m.id === 'network.baseLatencyNs')?.value).toBeNull()
  })
})
