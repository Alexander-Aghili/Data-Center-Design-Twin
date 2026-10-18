import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('network decisions', () => {
  it('sets fabric and oversubscription', () => {
    const f = run(plan(), 'setFabric', { fabric: 'fatTree' })
    expect(f.plan.network.fabric).toBe('fatTree')
    expect(f.summary).toBe('Network fabric set to fat tree')
    const o = run(plan(), 'setNetworkOversubscription', { ratio: 2 })
    expect(o.plan.network.oversubscription).toBe(2)
    expect(o.summary).toBe('Network oversubscription set to 2:1 (was 1:1)')
  })

  it('rejects a ratio below 1:1', () => {
    expectRejected(plan(), 'setNetworkOversubscription', { ratio: 0.5 }, /payload\.ratio: Network oversubscription must be at least 1 \(1 means 1:1, non-blocking\)/)
  })

  it('rejects a ratio above 8:1', () => {
    expectRejected(plan(), 'setNetworkOversubscription', { ratio: 16 }, /payload\.ratio: Network oversubscription must be at most 8 \(8:1\)/)
  })
})
