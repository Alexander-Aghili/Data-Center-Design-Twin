import { EvaluationSchema, RACK, type Evaluation } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../src'
import { apply, assertFinite, builtins, defaultPlan, demoPlan } from './integrationFixture'

const { rules } = builtins
const nonPassing = (ev: Evaluation) => ev.checks.filter((c) => c.status !== 'pass').map((c) => `${c.status} ${c.id}: ${c.explanation}`)

describe('golden: default plan', () => {
  const plan = defaultPlan()
  const ev = evaluate(plan, builtins)

  it('is schema-valid and finite everywhere', () => {
    expect(() => EvaluationSchema.parse(ev)).not.toThrow()
    assertFinite(ev)
  })

  it('has every check pass (info checks pass with no limit)', () => {
    expect(ev.checks.length).toBeGreaterThan(0)
    expect(nonPassing(ev)).toEqual([])
  })

  it('stays inside the grid every hour with a buildable headline and PUE between 1.2 and 1.6', () => {
    expect(ev.headline.hoursOverCap).toBe(0)
    expect(ev.headline.buildable).toBe(true)
    expect(ev.headline.usablePflops).toBe(ev.headline.placedPflops)
    expect(ev.headline.pueAnnual).toBeGreaterThan(1.2)
    expect(ev.headline.pueAnnual).toBeLessThan(1.6)
    expect(ev.headline.pueWorst).toBeGreaterThan(ev.headline.pueAnnual!)
    expect(ev.headline.pueWorst).toBeLessThan(1.6)
  })

  it('has enough leaf switch ports for 80 HGX racks at 1:1 (ruling b)', () => {
    const leaf = ev.checks.find((c) => c.id === 'network.leafPorts:leaf')!
    expect(leaf.value).toBe(2 * 80 * 16)
    expect(leaf.status).toBe('pass')
  })

  it('room air reaches the racks at facility supply + CRAH coil approach and leaves one contained ΔT warmer (ruling a)', () => {
    const inlet = Math.max(18, plan.cooling.facilitySupplyC + rules.crahCoilApproachK.value!)
    for (const r of ev.racks) {
      expect(r.airInletC).toBeCloseTo(inlet, 9)
      expect(r.airOutletC).toBeCloseTo(inlet + rules.airDeltaTKContained.value!, 9)
    }
  })

  it('evaluates identically after a JSON round trip (export, then import)', () => {
    expect(evaluate(JSON.parse(JSON.stringify(plan)), builtins)).toEqual(ev)
  })
})

describe('golden: rules data', () => {
  it('overhead piping installs faster than under a raised floor (ruling d)', () => {
    expect(rules.overheadInstallWeeks.value!).toBeLessThan(rules.raisedFloorInstallWeeks.value!)
  })

  it('switching the liquid-cooled demo hall to overhead piping does not lengthen the build', () => {
    const raised = evaluate(demoPlan(), builtins)
    const overhead = evaluate(apply(demoPlan(), [{ type: 'setPipingRoute', payload: { route: 'overhead' } }]), builtins)
    expect(overhead.cost.buildWeeks).toBeLessThanOrEqual(raised.cost.buildWeeks)
  })
})

describe('golden: empty hall', () => {
  const plan = apply(defaultPlan(), [{ type: 'removeRacks', payload: { placementIds: defaultPlan().placements.map((p) => p.id) } }])
  const ev = evaluate(plan, builtins)

  it('evaluates without NaN or Infinity, with PUE null and checks only pass or unknown', () => {
    expect(plan.placements).toHaveLength(0)
    expect(() => EvaluationSchema.parse(ev)).not.toThrow()
    assertFinite(ev)
    expect(ev.headline.pueAnnual).toBeNull()
    expect(ev.headline.pueWorst).toBeNull()
    expect(ev.headline.buildable).toBe(false)
    for (const c of ev.checks) expect(['pass', 'unknown']).toContain(c.status)
  })
})

describe('golden: air rack temperatures', () => {
  it('an air rack carrying more than its method allows runs proportionally hotter (ruling a)', () => {
    const ev = evaluate(apply(defaultPlan(), [{ type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } }]), builtins)
    const gb = ev.racks.find((r) => r.groupId === 'g2')!
    const hgx = ev.racks.find((r) => r.groupId === 'g1')!
    const inlet = 18 + rules.crahCoilApproachK.value!
    expect(gb.airInletC).toBeCloseTo(inlet, 9)
    // 132 kW of air against the 40 kW air-contained rating: ΔT scales by 3.3.
    expect(gb.airOutletC).toBeCloseTo(inlet + rules.airDeltaTKContained.value! * 3.3, 6)
    expect(hgx.airOutletC).toBeCloseTo(inlet + rules.airDeltaTKContained.value!, 9)
  })
})
