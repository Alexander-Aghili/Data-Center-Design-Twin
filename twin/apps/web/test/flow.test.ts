import { createDefaultPlan } from '@twin/catalog'
import { emptyEvaluation } from '@twin/engine'
import type { Evaluation, Plan, RackResult } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import {
  airNetwork,
  liquidNetwork,
  particleCount,
  particleSpeed,
  supplyReturnColor,
  type Circuit,
  type Vec3,
} from '../src/scene/overlays/flowPaths'
import { PALETTE } from '../src/scene/palette'

/** Liquid racks in R3 slots 0–3 with a falling manifold share, air racks in R1 slots 0–1. */
function fixture(): { plan: Plan; evaluation: Evaluation } {
  const plan = createDefaultPlan()
  plan.cooling.pipingRoute = 'raisedFloor'
  const liquid = (slot: number, flowShare: number): RackResult => ({
    placementId: `R3-0${slot}`,
    groupId: 'g2',
    rowId: 'R3',
    slot,
    objectId: `rack:R3-0${slot}`,
    powerW: 132_000,
    heatW: 132_000,
    liquidW: 120_000,
    facilityWaterW: 120_000,
    airW: 12_000,
    flowLps: 2.9 * flowShare,
    supplyC: 25,
    returnC: 25 + 10 / flowShare,
    airInletC: 24,
    airOutletC: 38,
    weightKg: 1_400,
    bayId: 'B3-3',
    flowShare,
    coolingOk: flowShare >= 0.85,
  })
  const air = (slot: number): RackResult => ({
    placementId: `R1-0${slot}`,
    groupId: 'g1',
    rowId: 'R1',
    slot,
    objectId: `rack:R1-0${slot}`,
    powerW: 28_000,
    heatW: 28_000,
    liquidW: 0,
    facilityWaterW: 0,
    airW: 28_000 * (slot + 1),
    flowLps: null,
    supplyC: null,
    returnC: null,
    airInletC: 24,
    airOutletC: 36,
    weightKg: 1_100,
    bayId: 'B3-2',
    flowShare: null,
    coolingOk: true,
  })
  const evaluation: Evaluation = {
    ...emptyEvaluation(),
    racks: [liquid(0, 1.06), liquid(1, 1.02), liquid(2, 0.98), liquid(3, 0.8), air(0), air(1)],
    equipment: [
      { key: 'plant', category: 'chiller', modelId: null, count: 2, required: 2, positionIds: ['plant-1'], autoSized: true, loadW: 480_000, capacityW: 1_000_000, objectIds: [] },
      { key: 'cdu:R3', category: 'cdu', modelId: null, count: 1, required: 1, positionIds: ['cdu-E3'], autoSized: true, loadW: 480_000, capacityW: 1_000_000, objectIds: [] },
      { key: 'crah:Z1', category: 'crah', modelId: null, count: 1, required: 1, positionIds: ['crah-W1'], autoSized: true, loadW: 84_000, capacityW: 150_000, objectIds: [] },
    ],
    rows: [
      { rowId: 'R1', airW: 84_000, liquidW: 0, flowLps: 0, buswayLoadA: 0, cduKey: null },
      { rowId: 'R3', airW: 48_000, liquidW: 480_000, flowLps: 11.4, buswayLoadA: 0, cduKey: 'cdu:R3' },
    ],
  }
  return { plan, evaluation }
}

const xz = (p: Vec3) => [p[0], p[2]] as const
const distXZ = (p: Vec3, x: number, z: number) => Math.hypot(p[0] - x, p[2] - z)
const near = (points: Vec3[], x: number, z: number, tol: number) => points.some((p) => distXZ(p, x, z) <= tol)
const position = (plan: Plan, id: string) => plan.hall.positions.find((p) => p.id === id)!
const byId = (circuits: Circuit[], id: string) => circuits.find((c) => c.id === id)!

describe('liquid flow paths', () => {
  it('pipe path runs plant→facility loop→CDU→row header→each rack and back', () => {
    const { plan, evaluation } = fixture()
    const net = liquidNetwork(plan, evaluation)
    const plant = position(plan, 'plant-1')
    const cdu = position(plan, 'cdu-E3')

    // Facility loop leaves the plant and comes back to it.
    const facility = byId(net.circuits, 'facility')
    expect(distXZ(facility.points[0]!, plant.x, plant.z)).toBeLessThan(0.01)
    expect(distXZ(facility.points.at(-1)!, plant.x, plant.z)).toBeLessThan(0.01)

    // The CDU tap leaves the facility supply main, reaches the CDU and returns to the main.
    const tap = byId(net.circuits, 'cdu:R3')
    expect(near(facility.points, tap.points[0]![0], tap.points[0]![2], 0.01)).toBe(true)
    expect(near(tap.points, cdu.x, cdu.z, 0.35)).toBe(true)
    expect(near(facility.points, tap.points.at(-1)![0], tap.points.at(-1)![2], 0.01)).toBe(true)

    // The row header starts and ends at the CDU and reaches the farthest liquid rack (slot 0).
    const header = byId(net.circuits, 'header:R3')
    expect(distXZ(header.points[0]!, cdu.x, cdu.z)).toBeLessThan(0.35)
    expect(distXZ(header.points.at(-1)!, cdu.x, cdu.z)).toBeLessThan(0.35)
    const farX = 8 + 0.3 // R3 slot 0 center
    expect(Math.min(...header.points.map((p) => p[0]))).toBeLessThanOrEqual(farX)

    // Each rack branch taps the header, climbs into the rack footprint and returns to the header.
    const rackZ0 = 4 + 3.6 * 2
    for (const slot of [0, 1, 2, 3]) {
      const branch = byId(net.circuits, `rack:R3-0${slot}`)
      const [first, last] = [branch.points[0]!, branch.points.at(-1)!]
      expect(near(header.points, ...xz(first), 0.01)).toBe(true)
      expect(near(header.points, ...xz(last), 0.01)).toBe(true)
      const top = Math.max(...branch.points.map((p) => p[1]))
      expect(top).toBeGreaterThan(1)
      const rackX = 8 + 0.6 * slot + 0.3
      expect(branch.points.some((p) => Math.abs(p[0] - rackX) < 0.3 && p[2] >= rackZ0 - 0.1 && p[2] <= rackZ0 + 1.3)).toBe(true)
    }
    // Air racks get no liquid branch.
    expect(net.circuits.some((c) => c.id === 'rack:R1-00')).toBe(false)
  })

  it('particle speed proportional to flow (k·flowLps, clamped)', () => {
    const design = 2.9
    const base = particleSpeed(design, design)
    expect(particleSpeed(design * 0.8, design)).toBeCloseTo(base * 0.8)
    expect(particleSpeed(design * 1.1, design)).toBeCloseTo(base * 1.1)
    expect(particleSpeed(design * 50, design)).toBe(particleSpeed(design * 100, design))
    expect(particleSpeed(0, design)).toBeGreaterThan(0)
    expect(particleSpeed(0, design)).toBe(particleSpeed(design * 0.001, design))

    const { plan, evaluation } = fixture()
    const net = liquidNetwork(plan, evaluation)
    const starved = byId(net.circuits, 'rack:R3-03')
    const first = byId(net.circuits, 'rack:R3-00')
    expect(starved.speed / first.speed).toBeCloseTo(0.8 / 1.06)
  })

  it('particle count per rack ∝ flowShare', () => {
    expect(particleCount(1)).toBe(2 * particleCount(0.5))
    expect(particleCount(0.8)).toBeLessThan(particleCount(1))
    expect(particleCount(null)).toBe(0)
    expect(particleCount(0)).toBe(0)
    expect(particleCount(0.01)).toBe(1)

    const { plan, evaluation } = fixture()
    const net = liquidNetwork(plan, evaluation)
    expect(byId(net.circuits, 'rack:R3-03').count).toBe(particleCount(0.8))
    expect(byId(net.circuits, 'rack:R3-00').count).toBe(particleCount(1.06))
  })

  it('pipe fill grows from the plant outward', () => {
    const { plan, evaluation } = fixture()
    const net = liquidNetwork(plan, evaluation)
    const facility = byId(net.circuits, 'facility')
    const header = byId(net.circuits, 'header:R3')
    const branch = byId(net.circuits, 'rack:R3-00')
    expect(facility.fills[0]).toBe(0)
    expect(header.fills[0]!).toBeGreaterThan(0)
    expect(branch.fills[0]!).toBeGreaterThan(header.fills[0]!)
    for (const pipe of net.pipes) {
      expect(Math.max(...pipe.fills)).toBeLessThanOrEqual(1)
      if (pipe.leg === 'supply') pipe.fills.slice(1).forEach((f, i) => expect(f).toBeGreaterThanOrEqual(pipe.fills[i]!))
    }
    expect(Math.max(...net.pipes.flatMap((p) => p.fills))).toBe(1)
  })

  it('an empty hall has no liquid network', () => {
    const plan = createDefaultPlan()
    const net = liquidNetwork(plan, emptyEvaluation())
    expect(net.circuits).toEqual([])
    expect(net.pipes).toEqual([])
  })
})

describe('air flow paths', () => {
  it('air paths start at the serving CRAH and end at its return', () => {
    const { plan, evaluation } = fixture()
    const air = airNetwork(plan, evaluation)
    const crah = position(plan, 'crah-W1')
    const paths = air.circuits.filter((c) => c.id.startsWith('air:R1-'))
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      const [first, last] = [path.points[0]!, path.points.at(-1)!]
      expect(distXZ(first, crah.x, crah.z)).toBeLessThan(1)
      expect(distXZ(last, crah.x, crah.z)).toBeLessThan(1)
      expect(first[1]).toBeLessThan(last[1])
      expect(path.temps[0]).toBe(24)
      expect(path.temps.at(-1)).toBe(36)
    }
    // Liquid racks still reject their residual air heat, through the CRAH position that serves R3.
    const residual = byId(air.circuits, 'air:R3-00')
    const w2 = position(plan, 'crah-W2')
    expect(distXZ(residual.points[0]!, w2.x, w2.z)).toBeLessThan(1)
  })

  it('air particle density scales with airflow', () => {
    const { plan, evaluation } = fixture()
    const air = airNetwork(plan, evaluation)
    const low = byId(air.circuits, 'air:R1-00')
    const high = byId(air.circuits, 'air:R1-01')
    expect(high.count).toBeGreaterThan(low.count)
    expect(high.speed).toBeGreaterThan(low.speed)
  })
})

describe('flow color', () => {
  it('color lerp supply→return from temperatures', () => {
    const scale = { lo: 20, hi: 40 }
    expect(supplyReturnColor(20, scale)).toBe(PALETTE.supply)
    expect(supplyReturnColor(40, scale)).toBe(PALETTE.return)
    expect(supplyReturnColor(10, scale)).toBe(PALETTE.supply)
    expect(supplyReturnColor(55, scale)).toBe(PALETTE.return)
    // Halfway: each channel is the mean of supply #2D6CDF and return #E0922A.
    expect(supplyReturnColor(30, scale)).toBe('#877F85')
    expect(supplyReturnColor(30, { lo: 30, hi: 30 })).toBe(PALETTE.supply)
  })

  it('rack branch particles warm from supply to return temperature', () => {
    const { plan, evaluation } = fixture()
    const branch = byId(liquidNetwork(plan, evaluation).circuits, 'rack:R3-03')
    expect(branch.temps[0]).toBe(25)
    expect(branch.temps.at(-1)).toBeCloseTo(25 + 10 / 0.8)
    branch.temps.slice(1).forEach((t, i) => expect(t).toBeGreaterThanOrEqual(branch.temps[i]!))
  })
})
