import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('power decisions', () => {
  it('sets redundancy, distribution and oversubscription', () => {
    const r = run(plan(), 'setRedundancy', { redundancy: '2N' })
    expect(r.plan.power.redundancy).toBe('2N')
    expect(r.summary).toBe('Power redundancy set to 2N (was N+1)')
    const d = run(plan(), 'setDistribution', { distribution: 'dc800' })
    expect(d.plan.power.distribution).toBe('dc800')
    expect(d.summary).toBe('Power distribution set to 800 V DC')
    const o = run(plan(), 'setOversubscription', { factor: 1.25 })
    expect(o.plan.power.oversubscription).toBe(1.25)
    expect(o.summary).toBe('Power oversubscription set to 1.25 (was 1)')
  })

  it('rejects oversubscription below 1', () => {
    expectRejected(plan(), 'setOversubscription', { factor: 0.8 }, /payload\.factor: Power oversubscription must be at least 1 \(1 means no oversubscription\)/)
    expectRejected(plan(), 'setOversubscription', { factor: 1e-9 }, /must be at least 1/)
  })

  it('rejects oversubscription above 2', () => {
    expectRejected(plan(), 'setOversubscription', { factor: 2.5 }, /payload\.factor: Power oversubscription must be at most 2/)
  })
})
