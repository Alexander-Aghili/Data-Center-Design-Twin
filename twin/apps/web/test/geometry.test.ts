import { createDefaultPlan } from '@twin/catalog'
import { describe, expect, it } from 'vitest'
import { hallBounds, objectIdForEquipment, objectIdForPlacement, slotWorld } from '../src/scene/geometry'

describe('scene geometry', () => {
  const plan = createDefaultPlan()

  it('slotWorld places R1 slot 0 at x=8.3', () => {
    const p = slotWorld(plan, 'R1', 0)
    expect(p.x).toBeCloseTo(8.3)
    expect(p.z).toBeCloseTo(4.6)
  })

  it('double-wide rack centers across two slots', () => {
    expect(slotWorld(plan, 'R1', 4, 2).x).toBeCloseTo(8 + 5 * 0.6)
  })

  it('hallBounds matches hall size', () => {
    expect(hallBounds(plan)).toEqual({ min: [0, 0, 0], max: [40, 4.5, 36] })
  })

  it('object ids follow the scene naming', () => {
    expect(objectIdForPlacement('R3-07')).toBe('rack:R3-07')
    expect(objectIdForEquipment('cdu:R3', 0)).toBe('eq:cdu:R3:0')
  })
})
