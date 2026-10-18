import { createDefaultPlan } from '@twin/catalog'
import {
  RULE_KEYS,
  qty,
  type Check,
  type CheckKind,
  type ClimateEntry,
  type EquipmentEntry,
  type Evaluation,
  type HeatRejectionEntry,
  type Quantity,
  type Rules,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { makeCatalogIndex, type EvalContext } from '../src/context'
import { emptyEvaluation } from '../src/empty'
import { applyFailureScenarios } from '../src/n1'

const q = (value: number | null, unit = '-'): Quantity => ({ value, unit, basis: 'estimate', note: 'test value' })
const meta = { asOf: '2026-10-18', summary: 'test entry' }

function equipmentEntry(id: string, category: EquipmentEntry['category'], params: Record<string, number>): EquipmentEntry {
  return { ...meta, id, kind: 'equipment', name: id, category, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, q(v)])) }
}

const cdu = equipmentEntry('cdu.test', 'cdu', { capacityW: 1_200_000, maxFlowLps: 24, approachK: 4, pumpPowerW: 10_000, weightKg: 1_600, capexUsd: 1, leadTimeWeeks: 1 })
const crah = equipmentEntry('crah.test', 'crah', { capacityW: 200_000, airflowM3s: 13.8, fanPowerW: 11_000, capexUsd: 1, leadTimeWeeks: 1 })
const ups = equipmentEntry('ups.test', 'ups', { moduleW: 500_000, efficiency: 0.967, capexUsdPerKw: 1, leadTimeWeeks: 1 })
const busway = equipmentEntry('busway.test', 'busway', { ratingA: 1250, voltageV: 415, powerFactor: 0.95, capexUsdPerM: 1, leadTimeWeeks: 1 })
const chiller: HeatRejectionEntry = {
  ...meta,
  id: 'heatRejection.test',
  kind: 'heatRejection',
  name: 'Air-cooled chiller',
  category: 'chiller',
  basis: 'dryBulb',
  approachK: q(5),
  copRef: q(5),
  copRefOutdoorC: q(35),
  copSlopePerK: q(0.1),
  economizer: true,
  fanPowerFraction: q(0.02),
  waterLPerKwh: q(0),
  unitCapacityW: q(1_300_000, 'W'),
  capexUsdPerKw: q(400),
  leadTimeWeeks: q(40),
  installWeeks: q(8),
  footprintM2PerMw: q(40),
}
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
  designDryBulbC: q(30),
}
const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, qty(k === 'warnThreshold' ? 0.8 : 1, '-', 'estimate', { note: 'test value' })])) as Rules
const ctx: EvalContext = { plan: createDefaultPlan(), catalog: makeCatalogIndex([cdu, crah, ups, busway, chiller, climate]), rules, climate }

function sized(key: string, category: string, modelId: string, count: number, loadW = 0): SizedEquipment {
  return { key, category, modelId, count, required: count, positionIds: [], autoSized: true, loadW, capacityW: null, objectIds: [] }
}

function check(kind: CheckKind, subjectId: string, value: number | null, unit = 'W'): Check {
  return {
    id: `${kind}:${subjectId}`,
    kind,
    layer: kind.startsWith('power') ? 'power' : 'cooling',
    subject: { kind: 'equipment', id: subjectId, objectIds: [] },
    title: kind,
    value,
    limit: null,
    unit,
    utilization: null,
    status: 'pass',
    explanation: '',
    causes: [],
  }
}

function base(equipment: SizedEquipment[], checks: Check[]): Evaluation {
  return { ...emptyEvaluation(), equipment, checks }
}

const byId = (e: Evaluation, id: string) => e.checks.find((c) => c.id === id)!

describe('applyFailureScenarios', () => {
  it('with redundancy N, losing the only CDU in a zone fails', () => {
    const out = applyFailureScenarios(ctx, base([sized('cdu:R3', 'cdu', cdu.id, 1)], [check('cooling.cduCapacity', 'R3', 900_000)]))
    const c = byId(out, 'cooling.cduCapacity:R3')
    expect(c.status).toBe('pass')
    expect(c.worstFailure).toEqual({ scenario: 'One CDU serving row R3 offline', value: 900_000, utilization: null, status: 'fail' })
  })

  it('with N+1, the remaining CDU carries the load', () => {
    const out = applyFailureScenarios(ctx, base([sized('cdu:R3', 'cdu', cdu.id, 2)], [check('cooling.cduCapacity', 'cdu:R3', 900_000)]))
    expect(byId(out, 'cooling.cduCapacity:cdu:R3').worstFailure).toMatchObject({ status: 'pass', utilization: 0.75 })
  })

  it('warns above the warn threshold after the loss', () => {
    const out = applyFailureScenarios(ctx, base([sized('cdu:R3', 'cdu', cdu.id, 2)], [check('cooling.cduCapacity', 'R3', 1_000_000)]))
    expect(byId(out, 'cooling.cduCapacity:R3').worstFailure?.status).toBe('warn')
  })

  it('covers CRAH zones, plant units, busway feeds and UPS modules', () => {
    const out = applyFailureScenarios(
      ctx,
      base(
        [
          sized('crah:Z1', 'crah', crah.id, 3),
          sized('plant', 'heatRejection', chiller.id, 2),
          sized('busway:R3', 'busway', busway.id, 2),
          sized('ups', 'ups', ups.id, 4),
        ],
        [
          check('cooling.crahCapacity', 'Z1', 380_000),
          check('cooling.heatRejection', 'plant', 1_400_000),
          check('power.busway', 'R3', 1_000, 'A'),
          check('power.ups', 'site', 1_200_000),
        ],
      ),
    )
    expect(byId(out, 'cooling.crahCapacity:Z1').worstFailure).toMatchObject({ scenario: 'One CRAH in zone Z1 offline', status: 'warn', utilization: 0.95 })
    expect(byId(out, 'cooling.heatRejection:plant').worstFailure).toMatchObject({
      scenario: 'One heat rejection unit offline (Air-cooled chiller)',
      status: 'fail',
    })
    expect(byId(out, 'power.busway:R3').worstFailure).toMatchObject({ scenario: 'One busway feed to row R3 lost', status: 'pass', utilization: 0.8 })
    expect(byId(out, 'power.ups:site').worstFailure).toMatchObject({ scenario: 'One UPS module offline', status: 'pass', utilization: 0.8 })
  })

  it('a hall-wide check keeps the worst of its zones, using each zone load', () => {
    const out = applyFailureScenarios(
      ctx,
      base([sized('crah:Z1', 'crah', crah.id, 3, 300_000), sized('crah:Z2', 'crah', crah.id, 3, 390_000)], [check('cooling.crahCapacity', 'hall', 690_000)]),
    )
    expect(byId(out, 'cooling.crahCapacity:hall').worstFailure).toMatchObject({ scenario: 'One CRAH in zone Z2 offline', status: 'warn', value: 390_000 })
  })

  it('falls back to the equipment load when the check value is unknown', () => {
    const out = applyFailureScenarios(ctx, base([sized('cdu:R1', 'cdu', cdu.id, 2, 600_000)], [check('cooling.cduCapacity', 'R1', null)]))
    expect(byId(out, 'cooling.cduCapacity:R1').worstFailure).toMatchObject({ value: 600_000, utilization: 0.5, status: 'pass' })
  })

  it('leaves other checks alone and skips equipment with no units', () => {
    const floor = check('layout.floorBay', 'B3-2', 8)
    const out = applyFailureScenarios(ctx, base([sized('cdu:R3', 'cdu', cdu.id, 0)], [floor, check('cooling.cduCapacity', 'R3', 0)]))
    expect(byId(out, 'layout.floorBay:B3-2')).toEqual(floor)
    expect(byId(out, 'cooling.cduCapacity:R3').worstFailure).toBeUndefined()
  })
})
