import type { Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../src'
import { builtins, defaultPlan, demoPlan } from './integrationFixture'

/** Median wall time of `runs` evaluations, after two warm-up runs. */
function medianMs(plan: Plan, runs = 20): number {
  evaluate(plan, builtins)
  evaluate(plan, builtins)
  const times = Array.from({ length: runs }, () => {
    const t0 = performance.now()
    evaluate(plan, builtins)
    return performance.now() - t0
  }).sort((a, b) => a - b)
  return (times[runs / 2 - 1]! + times[runs / 2]!) / 2
}

describe('perf', () => {
  it('evaluates the default plan in under 100 ms (median of 20)', () => {
    expect(medianMs(defaultPlan())).toBeLessThan(100)
  })

  it('evaluates the demo state in under 150 ms (median of 20)', () => {
    expect(medianMs(demoPlan())).toBeLessThan(150)
  })
})
