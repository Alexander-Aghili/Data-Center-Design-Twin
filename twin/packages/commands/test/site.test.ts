import { CLIMATE } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('setSiteInput', () => {
  it('sets numeric inputs and summarizes them in display units', () => {
    const grid = run(plan(), 'setSiteInput', { field: 'gridCapacityW', value: 12_500_000 })
    expect(grid.plan.site.gridCapacityW).toBe(12_500_000)
    expect(grid.summary).toBe('Grid capacity set to 12.5 MW (was 10 MW)')
    const water = run(plan(), 'setSiteInput', { field: 'waterAllowanceM3PerDay', value: 0 })
    expect(water.plan.site.waterAllowanceM3PerDay).toBe(0)
    expect(water.summary).toBe('Water allowance set to 0 m³/day (was 120 m³/day)')
    const value = run(plan(), 'setSiteInput', { field: 'valueOfComputeUsdPerGpuHour', value: 3 })
    expect(value.summary).toBe('Value of compute set to 3 USD per GPU-hour (was 2.5 USD per GPU-hour)')
  })

  it('sets the climate from the catalog', () => {
    const result = run(plan(), 'setSiteInput', { field: 'climateId', value: CLIMATE.STOCKHOLM })
    expect(result.plan.site.climateId).toBe(CLIMATE.STOCKHOLM)
    expect(result.summary).toBe('Climate set to climate.stockholm')
  })

  it('rejects wrong value types, unknown climates and out-of-range numbers', () => {
    expectRejected(plan(), 'setSiteInput', { field: 'gridCapacityW', value: '12 MW' }, 'gridCapacityW needs a number in W, not the text "12 MW"')
    expectRejected(plan(), 'setSiteInput', { field: 'climateId', value: 4 }, 'climateId needs a climate id such as "climate.dallas", not a number')
    expectRejected(plan(), 'setSiteInput', { field: 'climateId', value: 'climate.oslo' }, /^Unknown climate "climate\.oslo"\. Known climates: climate\.dallas, climate\.stockholm$/)
    expectRejected(plan(), 'setSiteInput', { field: 'gridCapacityW', value: 0 }, 'gridCapacityW must be greater than 0')
    expectRejected(plan(), 'setSiteInput', { field: 'waterAllowanceM3PerDay', value: -1 }, 'waterAllowanceM3PerDay cannot be negative')
  })
})

describe('setFloor and setBayRating', () => {
  it('sets the floor type and optionally rates every bay', () => {
    const slab = run(plan(), 'setFloor', { type: 'slab', ratingKnM2: 24 })
    expect(slab.plan.hall.floor.type).toBe('slab')
    expect(slab.plan.hall.bays.every((b) => b.ratingKnM2 === 24)).toBe(true)
    expect(slab.summary).toBe('Floor set to slab, all bays rated 24 kN/m²')
    const raised = run(plan(), 'setFloor', { type: 'raised' })
    expect(raised.plan.hall.bays[0]?.ratingKnM2).toBe(7.2)
    expect(raised.summary).toBe('Floor set to raised floor')
  })

  it('rates one bay', () => {
    const result = run(plan(), 'setBayRating', { bayId: 'B3-2', ratingKnM2: 12 })
    expect(result.plan.hall.bays.find((b) => b.id === 'B3-2')?.ratingKnM2).toBe(12)
    expect(result.plan.hall.bays.find((b) => b.id === 'B3-3')?.ratingKnM2).toBe(7.2)
    expect(result.summary).toBe('Bay B3-2 rated 12 kN/m² (was 7.2 kN/m²)')
    expectRejected(plan(), 'setBayRating', { bayId: 'B40-1', ratingKnM2: 12 }, 'Unknown bay "B40-1". Bays run from B1-1 to B12-10 (column-row).')
  })
})
