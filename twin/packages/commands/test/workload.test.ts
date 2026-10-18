import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('setWorkload', () => {
  it('sets purpose and target together or alone', () => {
    const both = run(plan(), 'setWorkload', { purpose: 'training', targetPflops: 5000 })
    expect(both.plan.workload).toEqual({ purpose: 'training', targetPflops: 5000 })
    expect(both.summary).toBe('Workload set to training, target 5,000 PFLOPS')
    const target = run(plan(), 'setWorkload', { targetPflops: 1200.5 })
    expect(target.plan.workload).toEqual({ purpose: 'mixed', targetPflops: 1200.5 })
    expect(target.summary).toBe('Workload target set to 1,200.5 PFLOPS')
    expect(run(plan(), 'setWorkload', { purpose: 'inference' }).summary).toBe('Workload set to inference')
  })

  it('rejects an empty change', () => {
    expectRejected(plan(), 'setWorkload', {}, 'setWorkload needs purpose, targetPflops or both')
  })
})
