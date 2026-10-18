import { createDefaultPlan } from '@twin/catalog'
import {
  CHECK_KINDS,
  RULE_KEYS,
  qty,
  type CatalogEntry,
  type Check,
  type CheckKind,
  type ClimateEntry,
  type Plan,
  type Quantity,
  type Rules,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { attachCauses } from '../src/causes'
import { makeCatalogIndex, type EvalContext } from '../src/context'

const q = (value: number | null): Quantity => ({ value, unit: '-', basis: 'estimate', note: 'test value' })
const meta = { asOf: '2026-10-18', summary: 'test entry' }

const climate: ClimateEntry = {
  ...meta,
  id: 'climate.dallas',
  kind: 'climate',
  name: 'Dallas, Texas',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: q(38),
}

/** Only the fields `attachCauses` reads (id, kind, name) matter; the rest satisfy the schema. */
const named: CatalogEntry[] = [
  { ...meta, id: 'rack.gb300', kind: 'rack', name: 'GB300 NVL72', role: 'compute', gpuCount: 72, nominalPowerW: q(1), peakPowerW: q(1), weightKg: q(1), widthMm: q(600), depthMm: q(1), heightMm: q(1), slotsWide: 1, feet: 4, maxLiquidFraction: q(1), maxCoolantSupplyC: q(1), supportedCooling: [], supportedPower: [], scaleOutPorts: 0, portGbps: 0, fp8Pflops: q(1), trays: { compute: 0, switch: 0, power: 0 }, capexUsd: q(1), leadTimeWeeks: q(1) },
  { ...meta, id: 'rack.b300', kind: 'rack', name: 'HGX B300 (air)', role: 'compute', gpuCount: 8, nominalPowerW: q(1), peakPowerW: q(1), weightKg: q(1), widthMm: q(600), depthMm: q(1), heightMm: q(1), slotsWide: 1, feet: 4, maxLiquidFraction: q(1), maxCoolantSupplyC: q(1), supportedCooling: [], supportedPower: [], scaleOutPorts: 0, portGbps: 0, fp8Pflops: q(1), trays: { compute: 0, switch: 0, power: 0 }, capexUsd: q(1), leadTimeWeeks: q(1) },
  { ...meta, id: 'rackCooling.dlc', kind: 'rackCooling', name: 'Direct-to-chip, single-phase', category: 'dlc-1p', maxRackW: q(1), toTechnicalLoop: q(1), supplyRangeC: { min: q(1), max: q(1) }, deltaTK: q(1), pressureDropKpa: q(1), addedWeightKgPerRack: q(1), formFactor: 'rack', requiresCdu: true, pumpPowerFraction: q(0), capexUsdPerKw: q(1), installWeeks: q(1), leadTimeWeeks: q(1), risks: [], status: 'mainstream' },
  { ...meta, id: 'rackCooling.air', kind: 'rackCooling', name: 'Air with containment', category: 'air', maxRackW: q(1), toTechnicalLoop: q(0), supplyRangeC: { min: q(1), max: q(1) }, deltaTK: q(1), pressureDropKpa: q(1), addedWeightKgPerRack: q(0), formFactor: 'rack', requiresCdu: false, pumpPowerFraction: q(0), capexUsdPerKw: q(1), installWeeks: q(1), leadTimeWeeks: q(1), risks: [], status: 'mainstream' },
  { ...meta, id: 'heatRejection.chiller', kind: 'heatRejection', name: 'Air-cooled chiller', category: 'chiller', basis: 'dryBulb', approachK: q(1), copRef: q(1), copRefOutdoorC: q(1), copSlopePerK: q(1), economizer: true, fanPowerFraction: q(1), waterLPerKwh: q(0), unitCapacityW: q(1), capexUsdPerKw: q(1), leadTimeWeeks: q(1), installWeeks: q(1), footprintM2PerMw: q(1) },
  climate,
]
const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, qty(1, '-', 'estimate', { note: 'test value' })])) as Rules

function context(patch: (plan: Plan) => void = () => {}): EvalContext {
  const plan = createDefaultPlan()
  plan.rackGroups = [
    { id: 'g1', name: 'Inference block', rackTypeId: 'rack.b300', coolingMethodId: 'rackCooling.air' },
    { id: 'g2', name: 'Training block', rackTypeId: 'rack.gb300', coolingMethodId: 'rackCooling.dlc' },
  ]
  plan.placements = [
    { id: 'R1-00', groupId: 'g1', rowId: 'R1', slot: 0 },
    { id: 'R3-00', groupId: 'g2', rowId: 'R3', slot: 0 },
    { id: 'R3-01', groupId: 'g2', rowId: 'R3', slot: 1 },
  ]
  plan.cooling.heatRejectionId = 'heatRejection.chiller'
  patch(plan)
  return { plan, catalog: makeCatalogIndex(named), rules, climate }
}

function check(kind: CheckKind, subject: Check['subject'], causes: Check['causes'] = []): Check {
  return { id: `${kind}:${subject.id}`, kind, layer: 'layout', subject, title: kind, value: null, limit: null, unit: '-', utilization: null, status: 'fail', explanation: '', causes }
}

const paths = (c: Check) => c.causes.map((x) => x.path)

describe('attachCauses', () => {
  it('floor bay ← rack type, cooling method and floor, with readable labels', () => {
    // Default hall: R3 sits at z 11.2–12.4 m, slots 0–1 at x 8.0–9.2 m, which is bay B3-4 (x 7.2–10.8, z 10.8–14.4).
    const [c] = attachCauses(context(), [check('layout.floorBay', { kind: 'bay', id: 'B3-4', objectIds: ['rack:R3-00', 'rack:R3-01'] })])
    expect(c!.causes).toEqual([
      { layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type (Training block): GB300 NVL72', value: 'GB300 NVL72' },
      { layer: 'cooling', path: 'rackGroups.g2.coolingMethodId', label: 'Cooling method (Training block): Direct-to-chip, single-phase', value: 'Direct-to-chip, single-phase' },
      { layer: 'site', path: 'hall.floor.type', label: 'Floor type: Raised floor', value: 'Raised floor' },
      { layer: 'site', path: 'hall.bays.B3-4.ratingKnM2', label: 'Bay B3-4 rating: 7.3 kN/m²', value: '7.3 kN/m²' },
    ])
  })

  it('a bay without object ids finds its racks by position', () => {
    const [c] = attachCauses(context(), [check('layout.floorBay', { kind: 'bay', id: 'B3-4', objectIds: [] })])
    expect(paths(c!)).toContain('rackGroups.g2.rackTypeId')
    expect(paths(c!)).not.toContain('rackGroups.g1.rackTypeId')
  })

  it('a single rack group drops the group name from the label', () => {
    const ctx = context((p) => {
      p.rackGroups = p.rackGroups.filter((g) => g.id === 'g2')
      p.placements = p.placements.filter((pl) => pl.groupId === 'g2')
    })
    const [c] = attachCauses(ctx, [check('cooling.rackHeatLimit', { kind: 'group', id: 'g2', objectIds: [] })])
    expect(c!.causes[0]).toMatchObject({ label: 'Rack type: GB300 NVL72' })
  })

  it('scopes group decisions to the rows, groups and equipment the subject covers', () => {
    const ctx = context()
    const [row, group, cdu, site] = attachCauses(ctx, [
      check('power.busway', { kind: 'row', id: 'R1', objectIds: [] }),
      check('cooling.rackHeatLimit', { kind: 'group', id: 'g2', objectIds: [] }),
      check('cooling.cduCapacity', { kind: 'equipment', id: 'cdu:R3', objectIds: [] }),
      check('power.gridWorstHour', { kind: 'site', id: 'site', objectIds: [] }),
    ])
    expect(paths(row!)).toContain('rackGroups.g1.rackTypeId')
    // Busway feeds are counted under redundancy; the design current no longer depends on the purpose.
    expect(paths(row!)).toContain('power.redundancy')
    expect(paths(row!)).not.toContain('workload.purpose')
    expect(paths(row!)).not.toContain('rackGroups.g2.rackTypeId')
    expect(paths(group!)).not.toContain('rackGroups.g1.rackTypeId')
    expect(paths(cdu!)).toEqual(expect.arrayContaining(['rackGroups.g2.coolingMethodId', 'power.redundancy']))
    expect(paths(cdu!)).not.toContain('rackGroups.g1.coolingMethodId')
    expect(paths(site!)).toEqual(expect.arrayContaining(['rackGroups.g1.rackTypeId', 'rackGroups.g2.rackTypeId', 'site.gridCapacityW']))
  })

  it('formats plan values as people read them', () => {
    const [heat, grid] = attachCauses(context(), [
      check('cooling.heatRejection', { kind: 'plant', id: 'plant', objectIds: [] }),
      check('power.gridWorstHour', { kind: 'site', id: 'site', objectIds: [] }),
    ])
    const byPath = (c: Check, path: string) => c.causes.find((x) => x.path === path)
    expect(byPath(heat!, 'cooling.heatRejectionId')).toMatchObject({ value: 'Air-cooled chiller', label: 'Heat rejection: Air-cooled chiller' })
    expect(byPath(heat!, 'site.climateId')?.value).toBe('Dallas, Texas')
    expect(byPath(heat!, 'power.redundancy')?.value).toBe('N+1')
    expect(byPath(grid!, 'site.gridCapacityW')?.value).toBe('10.6 MW')
  })

  it('falls back to the catalog id when an entry is missing', () => {
    const ctx = context((p) => (p.rackGroups[1]!.rackTypeId = 'rack.gone'))
    const [c] = attachCauses(ctx, [check('cooling.rackHeatLimit', { kind: 'group', id: 'g2', objectIds: [] })])
    expect(c!.causes[0]!.value).toBe('rack.gone')
  })

  it('keeps causes a module already set and does not repeat their paths', () => {
    const own = { layer: 'cooling' as const, path: 'cooling.containment', label: 'Containment: none', value: 'none' }
    const [c] = attachCauses(context(), [check('cooling.rackHeatLimit', { kind: 'group', id: 'g2', objectIds: [] }, [own])])
    expect(c!.causes[0]).toEqual(own)
    expect(paths(c!).filter((p) => p === 'cooling.containment')).toHaveLength(1)
  })

  it('every check kind links to at least one decision', () => {
    const checks = CHECK_KINDS.map((kind) => check(kind, { kind: 'site', id: 'site', objectIds: [] }))
    for (const c of attachCauses(context(), checks)) expect(c.causes.length, c.kind).toBeGreaterThan(0)
  })
})
