import type { Check, Evaluation, Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { diffEvaluations, evaluate } from '../src'
import { DEMO_STEPS, DEMO_SUPPLY_C, apply, builtins, defaultPlan } from './integrationFixture'

const check = (ev: Evaluation, id: string): Check => {
  const found = ev.checks.find((c) => c.id === id)
  if (!found) throw new Error(`no check ${id}; have ${ev.checks.map((c) => c.id).join(', ')}`)
  return found
}
const ofKind = (ev: Evaluation, kind: Check['kind']) => ev.checks.filter((c) => c.kind === kind)
const GB300_ROWS = ['R3', 'R4', 'R5']
/** Floor bays that carry racks of rows R3–R5. */
const gb300Bays = (ev: Evaluation) =>
  ofKind(ev, 'layout.floorBay').filter((c) => c.subject.objectIds.some((o) => GB300_ROWS.some((row) => o.startsWith(`rack:${row}-`))))

describe('demo: the spec cascade, replayed as commands', () => {
  const start = defaultPlan()
  const before = evaluate(start, builtins)
  const gb300: Plan = apply(start, DEMO_STEPS.toGb300)
  const onAir = evaluate(gb300, builtins)
  const liquid: Plan = apply(gb300, DEMO_STEPS.toLiquid)
  const cascade = evaluate(liquid, builtins)
  const spread: Plan = apply(liquid, DEMO_STEPS.spreadFloor)
  const fixed = evaluate(spread, builtins)

  it('step 1: the default plan is quiet', () => {
    expect(before.checks.filter((c) => c.status !== 'pass')).toEqual([])
  })

  describe('step 2: rows R3–R5 switch to GB300 NVL72 on air', () => {
    it('rack power goes from about 28 kW to 132 kW', () => {
      expect(before.racks.find((r) => r.rowId === 'R3')!.powerW).toBeCloseTo(28_000, -3)
      expect(onAir.racks.find((r) => r.rowId === 'R3')!.powerW).toBe(132_000)
    })

    it('air cannot carry 132 kW per rack: rack heat limit and CRAH capacity fail', () => {
      expect(check(onAir, 'cooling.rackHeatLimit:g2').status).toBe('fail')
      expect(ofKind(onAir, 'cooling.crahCapacity').some((c) => c.status === 'fail')).toBe(true)
    })

    it('the overloaded air racks run visibly hot', () => {
      const r = onAir.racks.find((x) => x.groupId === 'g2')!
      expect(r.airOutletC! - r.airInletC!).toBeGreaterThan(40)
    })

    it('floor and grid still hold before the liquid step, so they ripple out later', () => {
      for (const c of gb300Bays(onAir)) expect(c.status).not.toBe('fail')
      expect(onAir.headline.hoursOverCap).toBe(0)
    })
  })

  describe('step 4: direct-to-chip, warm water and dry coolers', () => {
    it('rack heat passes and CDUs fit their positions', () => {
      expect(check(cascade, 'cooling.rackHeatLimit:g2').status).toBe('pass')
      const positions = ofKind(cascade, 'cooling.cduPositions')
      expect(positions.map((c) => c.subject.id).sort()).toEqual(GB300_ROWS)
      for (const c of positions) expect(c.status).toBe('pass')
      for (const c of ofKind(cascade, 'cooling.crahCapacity')) expect(c.status).not.toBe('fail')
    })

    it(`coolant at ${DEMO_SUPPLY_C} °C facility supply stays within each rack's maximum`, () => {
      expect(check(cascade, 'cooling.coolantTemp:g2').status).toBe('pass')
      for (const r of cascade.racks.filter((x) => x.groupId === 'g2')) expect(r.supplyC!).toBeLessThanOrEqual(45)
    })

    it('a raised-floor bay under rows R3–R5 goes over its rating (heavier racks plus coolant)', () => {
      expect(gb300Bays(cascade).some((c) => c.status === 'fail')).toBe(true)
    })

    it('dry coolers use no water, so the scarce-water note holds', () => {
      expect(cascade.headline.waterM3PerDayPeak).toBe(0)
      expect(check(cascade, 'cooling.waterPeakDay:site').status).toBe('pass')
    })

    it('hot hours need trim cooling, the grid cap is exceeded for some hours, and usable compute drops', () => {
      const trimHours = cascade.metrics.find((m) => m.id === 'cooling.trimHours')!.value!
      expect(trimHours).toBeGreaterThan(0)
      expect(cascade.headline.hoursOverCap).toBeGreaterThanOrEqual(1)
      expect(cascade.headline.hoursOverCap).toBeLessThanOrEqual(1500)
      expect(cascade.headline.hoursOverCap).toBeLessThan(trimHours)
      expect(cascade.headline.usablePflops).toBeLessThan(cascade.headline.placedPflops)
      expect(check(cascade, 'power.gridWorstHour:site').status).toBe('fail')
    })

    it('the UPS and transformers fit the electrical room (ruling c)', () => {
      expect(check(cascade, 'power.ups:ups').status).not.toBe('fail')
      expect(check(cascade, 'power.transformer:transformer').status).not.toBe('fail')
    })

    it('the new effects show up as worsened checks for the agent to speak about', () => {
      const worsened = diffEvaluations(onAir, cascade).worsened.map((c) => c.id)
      expect(worsened).toContain('power.gridWorstHour:site')
      expect(worsened.some((id) => id.startsWith('layout.floorBay:'))).toBe(true)
    })
  })

  describe('step 6: moving racks spreads the floor load', () => {
    it('no bay is over its rating and the bays that failed now pass', () => {
      const failed = gb300Bays(cascade).filter((c) => c.status === 'fail').map((c) => c.id)
      for (const c of ofKind(fixed, 'layout.floorBay')) expect(c.status).not.toBe('fail')
      for (const id of failed) expect(check(fixed, id).status).toBe('pass')
    })

    it('keeps every GB300 rack placed and on liquid cooling', () => {
      expect(spread.placements).toHaveLength(liquid.placements.length)
      expect(fixed.headline.placedPflops).toBe(cascade.headline.placedPflops)
      expect(check(fixed, 'cooling.rackHeatLimit:g2').status).toBe('pass')
    })
  })
})
