import { HEAT_REJECTION, RACK_COOLING, type Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { airSide } from '../src/cooling/air'
import { liquidSide } from '../src/cooling/liquid'
import { evaluate } from '../src/evaluate'
import { networkFabric } from '../src/network'
import { sizeEquipment } from '../src/sizing'
import { airRack, builtinEntries, gb300, makeCtx, makePlan, makeRacks, rules } from './coolingFixture'
import { builtins, demoPlan } from './integrationFixture'

const dlc = { id: 'g2', rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.DLC_1P, rows: ['R3'], slots: 16 }
const airHall = { id: 'g1', rackTypeId: airRack.id, coolingMethodId: RACK_COOLING.AIR_CONTAINED, rows: ['R1', 'R2', 'R3', 'R4', 'R5'], slots: 16 }
const dlcLoadW = 16 * 132_000 * 0.85

function run(plan: Plan) {
  const ctx = makeCtx(plan)
  const racks = makeRacks(ctx)
  const air = airSide(ctx, racks)
  const liquid = liquidSide(ctx, racks)
  return { ...sizeEquipment(ctx, liquid.racks, air, liquid), air }
}

const item = (r: ReturnType<typeof run>, key: string) => r.equipment.find((e) => e.key === key)
const check = (r: ReturnType<typeof run>, id: string) => r.checks.find((c) => c.id === id)

describe('CDU sizing', () => {
  it('N+1: ceil(liquidW_row / capacity) + 1, smallest model that fits the row positions', () => {
    // cdu.1200kw needs 2 + 1 = 3 units but cdu-E3 holds 2, so cdu.2000kw (1 + 1 = 2) is the smallest that fits.
    const result = run(makePlan([dlc]))
    expect(item(result, 'cdu:R3')).toEqual({
      key: 'cdu:R3',
      category: 'cdu',
      modelId: 'cdu.2000kw',
      count: 2,
      required: 2,
      positionIds: ['cdu-E3'],
      autoSized: true,
      loadW: dlcLoadW,
      capacityW: 2_000_000,
      objectIds: ['eq:cdu:R3:0', 'eq:cdu:R3:1'],
    })
    expect(check(result, 'cooling.cduPositions:R3')!.status).toBe('pass')
    const capacity = check(result, 'cooling.cduCapacity:cdu:R3')!
    expect(capacity.value).toBeCloseTo(dlcLoadW, 6)
    expect(capacity.limit).toBe(2_000_000)
    expect(capacity.utilization).toBeCloseTo(dlcLoadW / 2_000_000, 9)
  })

  it('N adds nothing and 2N doubles', () => {
    const n = item(run(makePlan([dlc], { power: { ...makePlan([]).power, redundancy: 'N' } })), 'cdu:R3')!
    expect([n.modelId, n.count]).toEqual(['cdu.1200kw', 2])
    const twoN = item(run(makePlan([dlc], { power: { ...makePlan([]).power, redundancy: '2N' } })), 'cdu:R3')!
    expect([twoN.modelId, twoN.count, twoN.required]).toEqual(['cdu.2000kw', 2, 2])
  })

  it('cduPositions fails with advice naming the row and the free positions when positions run out', () => {
    const result = run(makePlan([{ ...dlc, slots: 24 }]))
    const cdu = item(result, 'cdu:R3')!
    expect([cdu.modelId, cdu.required, cdu.count]).toEqual(['cdu.2000kw', 3, 2])
    const positions = check(result, 'cooling.cduPositions:R3')!
    expect(positions.status).toBe('fail')
    expect(positions.value).toBe(3)
    expect(positions.limit).toBe(2)
    expect(positions.advice).toMatch(/R3/)
    expect(positions.advice).toMatch(/cdu-E3/)
    expect(positions.advice).toMatch(/2 free/)
    // With one unit missing the row runs without its N+1 spare: usable capacity is 1 × 2 MW for 2.69 MW.
    expect(check(result, 'cooling.cduCapacity:cdu:R3')!.status).toBe('fail')
  })

  it('a CDU flow above the rated flow raises the capacity check to at least a warning', () => {
    const result = run(makePlan([dlc]))
    const capacity = check(result, 'cooling.cduCapacity:cdu:R3')!
    // 1.7952 MW of PG25 at 10 K is 44.6 L/s against 40 L/s for one cdu.2000kw.
    expect(capacity.status).toBe('warn')
    expect(capacity.explanation).toMatch(/L\/s/)
  })

  it('overrideEquipment fixes model and count; the check then compares load to the override capacity', () => {
    const plan = makePlan([dlc], { overrides: [{ key: 'cdu:R3', modelId: 'cdu.1200kw', count: 2 }] })
    const result = run(plan)
    const cdu = item(result, 'cdu:R3')!
    expect([cdu.modelId, cdu.count, cdu.autoSized]).toEqual(['cdu.1200kw', 2, false])
    expect(cdu.required).toBe(3)
    const capacity = check(result, 'cooling.cduCapacity:cdu:R3')!
    expect(capacity.limit).toBe(1_200_000)
    expect(capacity.utilization).toBeCloseTo(dlcLoadW / 1_200_000, 9)
    expect(capacity.status).toBe('fail')
  })

  it('an override can move units to named positions', () => {
    const plan = makePlan([dlc], { overrides: [{ key: 'cdu:R3', positionIds: ['cdu-E4'] }] })
    expect(item(run(plan), 'cdu:R3')!.positionIds).toEqual(['cdu-E4'])
  })
})

describe('CRAH sizing', () => {
  it('zones come from positions.servesRows; count = ceil(airW_zone / capacity) + redundancy', () => {
    const result = run(makePlan([airHall]))
    // Z1 = crah-W1 (R1, R2): 896 kW. crah.200kw needs 5 + 1 = 6 > 4 places, crah.400kw needs 3 + 1 = 4.
    const z1 = item(result, 'crah:Z1')!
    expect([z1.modelId, z1.count, z1.positionIds, z1.loadW]).toEqual(['crah.400kw', 4, ['crah-W1'], 896_000])
    // Z3 = crah-W3 (R5, R6): 448 kW fits 3 + 1 crah.200kw.
    expect([item(result, 'crah:Z3')!.modelId, item(result, 'crah:Z3')!.count]).toEqual(['crah.200kw', 4])
    expect(item(result, 'crah:Z4')).toBeUndefined()
    expect(result.checks.filter((c) => c.kind === 'cooling.crahCapacity').every((c) => c.status === 'pass')).toBe(true)
  })

  it('crahCapacity fails for GB300 on air, with advice', () => {
    const result = run(makePlan([airHall, { ...dlc, coolingMethodId: RACK_COOLING.AIR_CONTAINED, rows: ['R3', 'R4'] }]))
    const z2 = check(result, 'cooling.crahCapacity:crah:Z2')!
    expect(z2.status).toBe('fail')
    expect(z2.advice).toBeTruthy()
  })

  it('CRAH fan power follows the sized model (fanPowerW × load / capacity)', () => {
    const result = run(makePlan([airHall]))
    const fan = result.air.metrics.find((m) => m.id === 'cooling.crahFanW')!.value!
    const expected = (22_000 * 896_000) / 400_000 * 2 + (11_000 * 448_000) / 200_000
    expect(fan).toBeCloseTo(expected, 6)
  })

  it('air in a row no CRAH position serves fails crahCapacity for that row', () => {
    const plan = makePlan([{ ...airHall, rows: ['R7'] }])
    plan.hall.positions = plan.hall.positions.filter((p) => p.id !== 'crah-W4')
    const result = run(plan)
    expect(check(result, 'cooling.crahCapacity:R7')!.status).toBe('fail')
  })
})

describe('plant, electrical and network sizing', () => {
  it('plant units = ceil((rack heat + hall pumps and fans) / (unitCapacityW · warnThreshold)) + redundancy when positions allow headroom', () => {
    const result = run(makePlan([airHall]))
    // 2.24 MW of racks plus 123.2 kW of CRAH fans (see the fan test) over 1.3 MW chillers kept at 80%: 3 + 1.
    expect(item(result, 'plant')).toMatchObject({ modelId: HEAT_REJECTION.CHILLER_AIR, count: 4, required: 4, positionIds: ['plant-1'] })
    expect(item(result, 'plant')!.loadW).toBeCloseTo(2_240_000 + 123_200, 6)
  })

  it('UPS modules and busways use the power checks loads: UPS = IT peak / distribution efficiency', () => {
    const result = run(makePlan([airHall]))
    // Peak 80 × 30 kW = 2.4 MW plus optics, / 0.98 ≈ 2.5 MW over 500 kW modules kept at 80%: 7 + 1.
    expect(item(result, 'ups')).toMatchObject({ modelId: 'ups.500kw', count: 8, positionIds: ['elec-1'] })
    const ctx = makeCtx(makePlan([airHall]))
    const opticsW = networkFabric(ctx, makeRacks(ctx)).network.opticsW
    expect(item(result, 'ups')!.loadW).toBeCloseTo((2_400_000 + opticsW) / 0.98, 6)
    // Row R1: 480 kW peak at 415 V and pf 0.95 is 703 A: one 1250 A busway (56%) plus a spare.
    expect(item(result, 'busway:R1')).toMatchObject({ modelId: 'busway.1250a', count: 2, loadW: 480_000 })
    expect(item(result, 'transformer')).toMatchObject({ modelId: 'transformer.3mva', positionIds: ['elec-1'] })
  })

  it('busway design current is the row peak current with no peak-to-average factor, as the power check uses', () => {
    // 20 racks × 30 kW peak = 600 kW is 879 A: one 1250 A feed within 80%, plus a spare. A × 1.3 factor would give
    // 1,142 A and two working feeds.
    const result = run(makePlan([{ ...airHall, rows: ['R1'], slots: 20 }]))
    expect(item(result, 'busway:R1')).toMatchObject({ modelId: 'busway.1250a', count: 2, required: 2 })
  })

  it('gives up UPS headroom before it starves the transformers of electrical positions', () => {
    // GB300 demo hall: UPS 8.71 MW needs 18 + 1 modules at full load or 22 + 1 at 80%; transformers 12.4 MVA need
    // 5 + 1 at full or 6 + 1 at 80%. In 26 units, 23 headroom UPS modules would leave room for only 3 transformers.
    const base = demoPlan()
    const plan: Plan = {
      ...base,
      hall: { ...base.hall, positions: base.hall.positions.map((p) => (p.kind === 'electrical' ? { ...p, capacity: 26 } : p)) },
    }
    const ev = evaluate(plan, builtins)
    const units = (key: string) => ev.equipment.find((e) => e.key === key)!
    expect(units('ups')).toMatchObject({ count: 19, required: 19 })
    expect(units('transformer')).toMatchObject({ count: 7, required: 7 })
    expect(ev.checks.find((c) => c.id === 'power.transformer:transformer')!.status).not.toBe('fail')
    expect(ev.checks.find((c) => c.id === 'power.ups:ups')!.status).not.toBe('fail')
  })

  it('leaves per leaf position: downlinks plus downlinks / oversubscription, capped by the position capacity', () => {
    const result = run(makePlan([airHall]))
    // leaf-1 serves R1–R4: 64 racks × 16 ports = 1024 downlinks + 1024 uplinks at 1:1 = 32 leaves of 64 ports,
    // 40 kept at the 80% warning threshold; the position holds 64.
    expect(item(result, 'leaf:leaf-1')).toMatchObject({ modelId: 'leaf.64x800g', required: 40, count: 40, positionIds: ['leaf-1'] })
    // GB300 racks on R1–R4: 64 × 72 ports = 4608 downlinks + 4608 uplinks = 144 leaves, capped at the 64 the position holds.
    const dense = run(makePlan([{ ...dlc, rows: ['R1', 'R2', 'R3', 'R4'] }]))
    expect(item(dense, 'leaf:leaf-1')).toMatchObject({ required: 144, count: 64 })
  })

  it('keys and categories match what the rejection, power and cost modules read', () => {
    const result = run(makePlan([airHall, { ...dlc, rows: ['R6'] }], { cooling: { ...makePlan([]).cooling, bufferTankM3: 10 } }))
    const pairs = result.equipment.map((e) => `${e.key} ${e.category}`)
    expect(pairs).toEqual(
      expect.arrayContaining(['cdu:R6 cdu', 'crah:Z1 crah', 'plant plant', 'ups ups', 'transformer transformer', 'busway:R1 busway', 'leaf:leaf-1 leaf', 'bufferTank bufferTank']),
    )
    expect(item(result, 'cdu:R6')!.modelId).toBe('cdu.2000kw')
    expect(item(result, 'crah:Z1')!.modelId).toBe('crah.400kw')
  })

  it('an empty hall sizes nothing and raises no checks', () => {
    const result = run(makePlan([]))
    expect(result.equipment).toEqual([])
    expect(result.checks).toEqual([])
  })
})

describe('auto-sized equipment in the full pipeline', () => {
  it('passes the power, plant and cooling capacity checks for an ordinary air hall', () => {
    const plan = makePlan([airHall])
    const evaluation = evaluate(plan, { entries: builtinEntries, rules })
    const byKind = (prefix: string) => evaluation.checks.filter((c) => c.kind.startsWith(prefix))
    for (const c of [...byKind('power.busway'), ...byKind('power.ups'), ...byKind('power.transformer'), ...byKind('cooling.crahCapacity'), ...byKind('cooling.heatRejection')]) {
      expect([c.id, c.status]).not.toEqual([c.id, 'fail'])
    }
    expect(byKind('power.ups')).toHaveLength(1)
  })
})
