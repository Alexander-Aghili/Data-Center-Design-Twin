import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  RACK,
  RACK_COOLING,
  RackCoolingEntrySchema,
  RulesSchema,
  qty,
  type CatalogEntry,
  type ClimateEntry,
  type Plan,
  type RackEntry,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import airContainedJson from '../../catalog/data/rack-cooling/rackCooling.air-contained.json'
import dlcJson from '../../catalog/data/rack-cooling/rackCooling.dlc-1p.json'
import rdhxJson from '../../catalog/data/rack-cooling/rackCooling.rdhx-active.json'
import rulesJson from '../../catalog/data/rules.json'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { computeRacks } from '../src/racks'

const est = (value: number, unit: string) => qty(value, unit, 'estimate', { note: 'test fixture' })

function rack(id: string, p: { nominal: number; peak: number; maxLiquid: number; weight: number; pflops: number; gpus: number }): RackEntry {
  return {
    id,
    kind: 'rack',
    name: id,
    asOf: '2026-10-18',
    summary: 'test rack',
    role: 'compute',
    gpuCount: p.gpus,
    nominalPowerW: est(p.nominal, 'W'),
    peakPowerW: est(p.peak, 'W'),
    weightKg: est(p.weight, 'kg'),
    widthMm: est(600, 'mm'),
    depthMm: est(1200, 'mm'),
    heightMm: est(2300, 'mm'),
    slotsWide: 1,
    feet: 4,
    maxLiquidFraction: est(p.maxLiquid, 'fraction'),
    maxCoolantSupplyC: est(45, '°C'),
    supportedCooling: ['air', 'rdhx', 'dlc-1p'],
    supportedPower: ['ac54'],
    scaleOutPorts: 8,
    portGbps: 800,
    fp8Pflops: est(p.pflops, 'PFLOPS'),
    trays: { compute: 18, switch: 9, power: 8 },
    capexUsd: est(3_000_000, 'USD'),
    leadTimeWeeks: est(20, 'week'),
  }
}

const gb300 = rack(RACK.GB300_NVL72, { nominal: 132_000, peak: 155_000, maxLiquid: 0.85, weight: 1580, pflops: 360, gpus: 72 })
const hgx = rack(RACK.HGX_B300_AIR, { nominal: 28_000, peak: 30_000, maxLiquid: 0, weight: 440, pflops: 72, gpus: 16 })
const climate: ClimateEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Flat',
  asOf: '2026-10-18',
  summary: 'flat test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: est(38, '°C'),
}

function ctxFor(plan: Plan): EvalContext {
  const entries: CatalogEntry[] = [
    gb300,
    hgx,
    climate,
    RackCoolingEntrySchema.parse(dlcJson),
    RackCoolingEntrySchema.parse(airContainedJson),
    RackCoolingEntrySchema.parse(rdhxJson),
  ]
  return { plan, catalog: makeCatalogIndex(entries), rules: RulesSchema.parse(rulesJson), climate }
}

function planWith(groups: Plan['rackGroups'], placements: Plan['placements']): Plan {
  return { ...createDefaultPlan(), rackGroups: groups, placements }
}

describe('computeRacks', () => {
  it('rack heat equals nominal power', () => {
    const plan = planWith(
      [{ id: 'g2', name: 'Training', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P }],
      [{ id: 'R3-00', groupId: 'g2', rowId: 'R3', slot: 0 }],
    )
    const [r] = computeRacks(ctxFor(plan))
    expect(r!.powerW).toBe(132_000)
    expect(r!.heatW).toBe(132_000)
  })

  it('heat split follows cooling method capped by rack maxLiquidFraction', () => {
    const plan = planWith(
      [
        { id: 'g1', name: 'Air', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED },
        { id: 'g2', name: 'DLC', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P },
        { id: 'g3', name: 'DLC on an air rack', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.DLC_1P },
      ],
      [
        { id: 'R1-00', groupId: 'g1', rowId: 'R1', slot: 0 },
        { id: 'R3-00', groupId: 'g2', rowId: 'R3', slot: 0 },
        { id: 'R4-00', groupId: 'g3', rowId: 'R4', slot: 0 },
      ],
    )
    const [air, dlc, capped] = computeRacks(ctxFor(plan))
    expect(dlc!.liquidW / dlc!.heatW).toBeCloseTo(0.85, 6)
    expect(dlc!.airW / dlc!.heatW).toBeCloseTo(0.15, 6)
    expect(dlc!.facilityWaterW).toBe(0)
    expect(air!.liquidW).toBe(0)
    expect(air!.airW).toBe(28_000)
    // The rack itself has no cold plates (maxLiquidFraction 0), so DLC cannot take any heat.
    expect(capped!.liquidW).toBe(0)
    expect(capped!.airW).toBe(28_000)
  })

  it('a rear-door heat exchanger moves rack heat into facility water at the rack', () => {
    const plan = planWith(
      [{ id: 'g1', name: 'Doors', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.RDHX_ACTIVE }],
      [{ id: 'R1-00', groupId: 'g1', rowId: 'R1', slot: 0 }],
    )
    const [r] = computeRacks(ctxFor(plan))
    expect(r!.facilityWaterW).toBe(28_000)
    expect(r!.liquidW).toBe(0)
    expect(r!.airW).toBe(0)
  })

  it('weight adds the cooling method per-rack weight, and the rack sits in the bay under its center', () => {
    const plan = planWith(
      [{ id: 'g2', name: 'DLC', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P }],
      // R3 starts at x 8, z 11.2: slot 6 center is x 8 + 6.5 * 0.6 = 11.9, z 11.8 → column 4, row 4.
      [{ id: 'R3-06', groupId: 'g2', rowId: 'R3', slot: 6 }],
    )
    const [r] = computeRacks(ctxFor(plan))
    expect(r!.weightKg).toBe(1580 + 50)
    expect(r!.bayId).toBe('B4-4')
    expect(r!.objectId).toBe('rack:R3-06')
    expect(r).toMatchObject({ placementId: 'R3-06', groupId: 'g2', rowId: 'R3', slot: 6, flowLps: null, flowShare: null })
  })

  it('coolingOk is false when the rack heat exceeds the method limit', () => {
    const plan = planWith(
      [{ id: 'g2', name: 'Air', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.AIR_CONTAINED }],
      [{ id: 'R3-00', groupId: 'g2', rowId: 'R3', slot: 0 }],
    )
    expect(computeRacks(ctxFor(plan))[0]!.coolingOk).toBe(false)
  })

  it('skips placements whose group or rack type cannot be resolved', () => {
    const plan = planWith(
      [{ id: 'g1', name: 'Missing', rackTypeId: 'rack.unknown', coolingMethodId: RACK_COOLING.AIR_CONTAINED }],
      [
        { id: 'R1-00', groupId: 'g1', rowId: 'R1', slot: 0 },
        { id: 'R1-01', groupId: 'nope', rowId: 'R1', slot: 1 },
      ],
    )
    expect(computeRacks(ctxFor(plan))).toEqual([])
  })
})
