import { PlanSchema } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { createDefaultPlan } from '../src'

describe('createDefaultPlan', () => {
  it('default plan has 80 placed racks, 2 groups, no overlapping slots', () => {
    const plan = PlanSchema.parse(createDefaultPlan())
    expect(plan.placements).toHaveLength(80)
    expect(plan.rackGroups.map((g) => g.id)).toEqual(['g1', 'g2'])
    const taken = new Set<string>()
    for (const p of plan.placements) {
      const key = `${p.rowId}:${p.slot}`
      expect(taken.has(key)).toBe(false)
      taken.add(key)
      expect(p.id).toBe(`${p.rowId}-${String(p.slot).padStart(2, '0')}`)
    }
    expect(plan.catalog).toEqual({})
  })
})
