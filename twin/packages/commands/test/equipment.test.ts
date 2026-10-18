import { EQUIPMENT, HEAT_REJECTION } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('overrideEquipment', () => {
  it('fixes model, count and positions, merging into an existing override', () => {
    const first = run(plan(), 'overrideEquipment', { key: 'cdu:R3', modelId: EQUIPMENT.CDU_1200KW, count: 2 })
    expect(first.plan.overrides).toEqual([{ key: 'cdu:R3', modelId: EQUIPMENT.CDU_1200KW, count: 2 }])
    expect(first.summary).toBe('cdu:R3 fixed to model CDU 1.2 MW, count 2')
    const second = run(first.plan, 'overrideEquipment', { key: 'cdu:R3', positionIds: ['cdu-E3'] })
    expect(second.plan.overrides).toEqual([{ key: 'cdu:R3', modelId: EQUIPMENT.CDU_1200KW, count: 2, positionIds: ['cdu-E3'] }])
    expect(second.summary).toBe('cdu:R3 fixed to position cdu-E3')
  })

  it('accepts a heat rejection model for the plant', () => {
    const result = run(plan(), 'overrideEquipment', { key: 'plant', modelId: HEAT_REJECTION.DRY_COOLER, count: 4 })
    expect(result.plan.overrides[0]).toEqual({ key: 'plant', modelId: HEAT_REJECTION.DRY_COOLER, count: 4 })
  })

  it('rejects bad keys, mismatched models, unknown positions and empty overrides', () => {
    expectRejected(plan(), 'overrideEquipment', { key: 'pump:R3', count: 1 }, /^Unknown equipment key "pump:R3"\. Keys look like/)
    expectRejected(plan(), 'overrideEquipment', { key: 'cdu:R3', modelId: HEAT_REJECTION.DRY_COOLER }, /^Unknown cdu model "heatRejection\.dry-cooler"\. Known cdu models: cdu\.1200kw$/)
    expectRejected(plan(), 'overrideEquipment', { key: 'cdu:R3', positionIds: ['crah-W1'] }, 'Position crah-W1 holds crah equipment, not cdu')
    expectRejected(plan(), 'overrideEquipment', { key: 'cdu:R3', positionIds: ['cdu-E99'] }, /^Unknown equipment position "cdu-E99"/)
    expectRejected(plan(), 'overrideEquipment', { key: 'ups' }, 'overrideEquipment needs modelId, count or positionIds')
  })
})

describe('clearOverride', () => {
  it('returns the item to auto-sizing', () => {
    const p = run(plan(), 'overrideEquipment', { key: 'ups', count: 6 }).plan
    const result = run(p, 'clearOverride', { key: 'ups' })
    expect(result.plan.overrides).toEqual([])
    expect(result.summary).toBe('ups is auto-sized again')
    expectRejected(plan(), 'clearOverride', { key: 'ups' }, 'No override for "ups". Overridden: none')
  })
})
