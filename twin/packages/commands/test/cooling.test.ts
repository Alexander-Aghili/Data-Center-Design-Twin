import { HEAT_REJECTION, RACK, RACK_COOLING } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('setCoolingMethod', () => {
  it('sets a supported method', () => {
    const p = run(plan(), 'setRackType', { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 }).plan
    const result = run(p, 'setCoolingMethod', { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P })
    expect(result.plan.rackGroups.find((g) => g.id === 'g2')?.coolingMethodId).toBe(RACK_COOLING.DLC_1P)
    expect(result.summary).toBe('Training block (rows R3–R5) cooled by rackCooling.dlc-1p')
  })

  it('setCoolingMethod rejects a method the rack does not support', () => {
    expectRejected(plan(), 'setCoolingMethod', { groupId: 'g1', coolingMethodId: RACK_COOLING.DLC_1P }, 'HGX B300 air does not support dlc-1p cooling (Single-phase direct-to-chip). It supports: air, rdhx.')
  })

  it('rejects unknown methods and groups', () => {
    expectRejected(plan(), 'setCoolingMethod', { groupId: 'g1', coolingMethodId: 'rackCooling.magic' }, /^Unknown rack cooling method "rackCooling\.magic"\. Known rack cooling methods: rackCooling\.air-contained, rackCooling\.dlc-1p$/)
    expectRejected(plan(), 'setCoolingMethod', { groupId: 'gx', coolingMethodId: RACK_COOLING.DLC_1P }, /^Unknown rack group "gx"/)
  })
})

describe('facility cooling decisions', () => {
  it('sets heat rejection from the catalog', () => {
    const result = run(plan(), 'setHeatRejection', { heatRejectionId: HEAT_REJECTION.DRY_COOLER })
    expect(result.plan.cooling.heatRejectionId).toBe(HEAT_REJECTION.DRY_COOLER)
    expect(result.summary).toBe('Heat rejection set to heatRejection.dry-cooler')
    expectRejected(plan(), 'setHeatRejection', { heatRejectionId: HEAT_REJECTION.COOLING_TOWER }, /^Unknown heat rejection method "heatRejection\.cooling-tower"/)
  })

  it('sets the facility supply temperature within the liquid-water range', () => {
    const result = run(plan(), 'setFacilitySupplyTemp', { celsius: 32 })
    expect(result.plan.cooling.facilitySupplyC).toBe(32)
    expect(result.summary).toBe('Facility supply temperature set to 32 °C (was 18 °C)')
    expectRejected(plan(), 'setFacilitySupplyTemp', { celsius: 0 }, /between 0 and 100/)
    expectRejected(plan(), 'setFacilitySupplyTemp', { celsius: 120 }, /between 0 and 100/)
  })

  it('sets piping route, flow balancing and buffer tank', () => {
    const p1 = run(plan(), 'setPipingRoute', { route: 'overhead' })
    expect(p1.plan.cooling.pipingRoute).toBe('overhead')
    expect(p1.summary).toBe('Piping routed overhead')
    const p2 = run(plan(), 'setFlowBalancing', { enabled: true })
    expect(p2.plan.cooling.flowBalancing).toBe(true)
    expect(p2.summary).toBe('Flow balancing valves turned on')
    const p3 = run(plan(), 'setBufferTank', { m3: 12.5 })
    expect(p3.plan.cooling.bufferTankM3).toBe(12.5)
    expect(p3.summary).toBe('Buffer tank set to 12.5 m³')
    expect(run(p3.plan, 'setBufferTank', { m3: 0 }).summary).toBe('Buffer tank removed')
  })
})
