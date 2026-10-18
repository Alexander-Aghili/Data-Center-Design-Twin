import { RACK_COOLING } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { airSide } from '../src/cooling/air'
import { airRack, gb300, makeCtx, makePlan, makeRacks, rules } from './coolingFixture'

const airGroup = { id: 'g1', rackTypeId: airRack.id, coolingMethodId: RACK_COOLING.AIR_CONTAINED, rows: ['R1', 'R2'], slots: 16 }

function run(plan = makePlan([airGroup])) {
  const ctx = makeCtx(plan)
  return airSide(ctx, makeRacks(ctx))
}

const metric = (r: ReturnType<typeof airSide>, id: string) => r.metrics.find((m) => m.id === id)?.value

describe('air side', () => {
  it('airflow = Q_air / (ρ·cp·ΔT), with ΔT from airDeltaTKContained when contained', () => {
    const qAir = 32 * 28_000
    const rho = rules.airDensity.value!
    const cp = rules.airCp.value!
    const contained = run()
    expect(metric(contained, 'cooling.airflowM3s')).toBeCloseTo(qAir / (rho * cp * rules.airDeltaTKContained.value!), 6)
    expect(metric(contained, 'cooling.airDeltaTK')).toBe(15)

    const open = run(makePlan([airGroup], { cooling: { ...makePlan([]).cooling, containment: 'none' } }))
    expect(metric(open, 'cooling.airflowM3s')).toBeCloseTo(qAir / (rho * cp * rules.airDeltaTK.value!), 6)
  })

  it('rackHeatLimit fails for 132 kW on air-contained (limit 40 kW) with utilization 3.3', () => {
    const result = run(makePlan([{ ...airGroup, id: 'g2', rackTypeId: gb300.id, rows: ['R3'] }]))
    const check = result.checks.find((c) => c.id === 'cooling.rackHeatLimit:g2')!
    expect(check.status).toBe('fail')
    expect(check.value).toBe(132_000)
    expect(check.limit).toBe(40_000)
    expect(check.utilization).toBeCloseTo(3.3, 6)
    expect(check.subject.objectIds).toHaveLength(16)
    expect(check.advice).toMatch(/132\u00a0kW/)
  })

  it('rackHeatLimit passes for 28 kW air racks and for GB300 on direct-to-chip', () => {
    const result = run(makePlan([airGroup, { ...airGroup, id: 'g2', rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.DLC_1P, rows: ['R3'] }]))
    expect(result.checks.find((c) => c.id === 'cooling.rackHeatLimit:g1')!.status).toBe('pass')
    const dlc = result.checks.find((c) => c.id === 'cooling.rackHeatLimit:g2')!
    expect(dlc.status).toBe('pass')
    expect(dlc.utilization).toBeCloseTo(132 / 250, 6)
  })

  it('reports air per row and splits each row over the CRAH positions serving it', () => {
    const result = run()
    expect(result.rows.find((r) => r.rowId === 'R1')!.airW).toBe(16 * 28_000)
    expect(result.rows.find((r) => r.rowId === 'R3')!.airW).toBe(0)
    // Default hall: crah-W1 serves R1 and R2.
    expect(result.crahLoads['crah-W1']).toBe(32 * 28_000)
    expect(result.crahLoads['crah-W2']).toBe(0)
  })

  it('DLC racks leave only their air share to the CRAHs', () => {
    const result = run(makePlan([{ ...airGroup, rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.DLC_1P, rows: ['R1'] }]))
    expect(result.rows.find((r) => r.rowId === 'R1')!.airW).toBeCloseTo(16 * 132_000 * 0.15, 6)
  })

  it('an empty hall has no checks and finite zero metrics', () => {
    const result = run(makePlan([]))
    expect(result.checks).toEqual([])
    for (const m of result.metrics) expect(m.value === null || Number.isFinite(m.value)).toBe(true)
  })

  describe('rack air temperatures (coordinator ruling a)', () => {
    const approach = rules.crahCoilApproachK.value!
    const rack = (r: ReturnType<typeof airSide>, groupId: string) => r.racks.find((x) => x.groupId === groupId)!

    it('inlet is facility supply + coil approach, never below 18 °C; outlet adds the contained ΔT', () => {
      const cold = rack(run(makePlan([airGroup], { cooling: { ...makePlan([]).cooling, facilitySupplyC: 10 } })), 'g1')
      expect(cold.airInletC).toBe(18)
      const warm = rack(run(makePlan([airGroup], { cooling: { ...makePlan([]).cooling, facilitySupplyC: 32 } })), 'g1')
      expect(warm.airInletC).toBe(32 + approach)
      expect(warm.airOutletC).toBe(32 + approach + rules.airDeltaTKContained.value!)
    })

    it('uses the open-room ΔT without containment and scales it by the air overload', () => {
      const plan = makePlan([{ ...airGroup, rackTypeId: gb300.id }], { cooling: { ...makePlan([]).cooling, containment: 'none' } })
      const r = rack(run(plan), 'g1')
      expect(r.airOutletC! - r.airInletC!).toBeCloseTo(rules.airDeltaTK.value! * (132_000 / 40_000), 9)
    })

    it('a DLC rack within its rating gets the plain ΔT on its residual air', () => {
      const r = rack(run(makePlan([{ ...airGroup, rackTypeId: gb300.id, coolingMethodId: RACK_COOLING.DLC_1P }])), 'g1')
      expect(r.airOutletC! - r.airInletC!).toBe(rules.airDeltaTKContained.value!)
    })

    it('a rack with no air heat has its outlet at its inlet', () => {
      const ctx = makeCtx(makePlan([airGroup]))
      const allLiquid = makeRacks(ctx).map((r) => ({ ...r, liquidW: r.heatW, airW: 0 }))
      const r = rack(airSide(ctx, allLiquid), 'g1')
      expect(r.airInletC).toBe(18 + approach)
      expect(r.airOutletC).toBe(r.airInletC)
    })
  })
})
