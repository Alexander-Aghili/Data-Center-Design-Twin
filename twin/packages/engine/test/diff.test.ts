import type { Check, Evaluation, Status } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { diffEvaluations } from '../src/diff'
import { emptyEvaluation } from '../src/empty'

function check(id: string, status: Status, utilization: number | null = null): Check {
  return {
    id,
    kind: 'cooling.cduCapacity',
    layer: 'cooling',
    subject: { kind: 'equipment', id, objectIds: [] },
    title: id,
    value: null,
    limit: null,
    unit: 'W',
    utilization,
    status,
    explanation: '',
    causes: [],
  }
}

function evaluation(checks: Check[], patch: Partial<Evaluation> = {}): Evaluation {
  return { ...emptyEvaluation(), checks, ...patch }
}

const ids = (checks: Check[]) => checks.map((c) => c.id)

describe('diffEvaluations', () => {
  it('worsened when the status order rises (pass < unknown < warn < fail)', () => {
    const prev = evaluation([check('a', 'pass'), check('b', 'unknown'), check('c', 'warn'), check('d', 'fail')])
    const next = evaluation([check('a', 'unknown'), check('b', 'warn'), check('c', 'fail'), check('d', 'fail')])
    expect(ids(diffEvaluations(prev, next).worsened)).toEqual(['a', 'b', 'c'])
  })

  it('worsened when utilization rises by at least 0.05 within warn or fail', () => {
    const prev = evaluation([check('a', 'warn', 0.85), check('b', 'fail', 1.2), check('c', 'warn', 0.85), check('d', 'pass', 0.3)])
    const next = evaluation([check('a', 'warn', 0.9), check('b', 'fail', 1.3), check('c', 'warn', 0.88), check('d', 'pass', 0.7)])
    expect(ids(diffEvaluations(prev, next).worsened)).toEqual(['a', 'b'])
  })

  it('reports the current state of a worsened check', () => {
    const diff = diffEvaluations(evaluation([check('a', 'pass', 0.5)]), evaluation([check('a', 'fail', 1.4)]))
    expect(diff.worsened[0]).toMatchObject({ status: 'fail', utilization: 1.4 })
  })

  it('resolved when a warn or fail check passes or disappears', () => {
    const prev = evaluation([check('a', 'fail'), check('b', 'warn'), check('c', 'unknown'), check('d', 'fail')])
    const next = evaluation([check('a', 'pass'), check('d', 'warn')])
    const diff = diffEvaluations(prev, next)
    expect(ids(diff.resolved)).toEqual(['a', 'b'])
    expect(diff.resolved[0]!.status).toBe('pass')
    expect(ids(diff.improved)).toEqual(['d'])
  })

  it('improved when utilization falls by at least 0.05 within warn or fail', () => {
    const diff = diffEvaluations(evaluation([check('a', 'fail', 1.5)]), evaluation([check('a', 'fail', 1.1)]))
    expect(ids(diff.improved)).toEqual(['a'])
    expect(diff.worsened).toEqual([])
  })

  it('new checks are listed, and new warn or fail checks also count as worsened', () => {
    const diff = diffEvaluations(evaluation([]), evaluation([check('a', 'pass'), check('b', 'fail')]))
    expect(ids(diff.newChecks)).toEqual(['a', 'b'])
    expect(ids(diff.worsened)).toEqual(['b'])
  })

  it('headline lists only the fields that changed', () => {
    const prev = evaluation([])
    const next = evaluation([], {
      headline: { ...prev.headline, usablePflops: 120, buildable: true, pueAnnual: 1.3 },
    })
    expect(diffEvaluations(prev, next).headline).toEqual({
      usablePflops: { from: 0, to: 120 },
      buildable: { from: false, to: true },
      pueAnnual: { from: null, to: 1.3 },
    })
  })

  it('capex, build weeks and peak water deltas are next minus prev', () => {
    const prev = evaluation([], {
      cost: { capexUsd: 1_000_000, byCategory: {}, buildWeeks: 40, criticalPath: [], delayCostUsd: 0 },
      headline: { ...emptyEvaluation().headline, waterM3PerDayPeak: 50 },
    })
    const next = evaluation([], {
      cost: { capexUsd: 1_250_000, byCategory: {}, buildWeeks: 52, criticalPath: [], delayCostUsd: 0 },
      headline: { ...emptyEvaluation().headline, waterM3PerDayPeak: 20 },
    })
    const diff = diffEvaluations(prev, next)
    expect(diff.capexDeltaUsd).toBe(250_000)
    expect(diff.buildWeeksDelta).toBe(12)
    expect(diff.waterDeltaM3PerDay).toBe(-30)
  })

  it('identical evaluations give an empty diff', () => {
    const e = evaluation([check('a', 'fail', 1.2)])
    expect(diffEvaluations(e, e)).toEqual({
      headline: {},
      worsened: [],
      improved: [],
      resolved: [],
      newChecks: [],
      capexDeltaUsd: 0,
      buildWeeksDelta: 0,
      waterDeltaM3PerDay: 0,
    })
  })
})
