import { createDefaultPlan } from '@twin/catalog'
import type { Check, ClientMsg, Evaluation, Plan, RackResult, ServerMsg } from '@twin/schema'
import { Box3, Vector3 } from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Choreography, legDurations, transitionPath, type CameraDriver, type Waypoint } from '../src/scene/camera/path'
import { resolveFocus, shotFor, type Shot, type ShotContext } from '../src/scene/camera/shots'
import { selectOpenness, useRackOpenness } from '../src/scene/camera/openness'
import type { Backend, BackendStatus } from '../src/state/backend'
import type { createTwinStore as CreateTwinStore } from '../src/state/store'

class FakeBackend implements Backend {
  connect(_onMsg: (m: ServerMsg) => void, _onStatus?: (s: BackendStatus) => void) {}
  send(_m: ClientMsg) {}
  sendAll = async () => {}
}

let createTwinStore: typeof CreateTwinStore

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ createTwinStore } = await import('../src/state/store'))
})

const plan: Plan = createDefaultPlan()
const noBoxes = () => null

function check(id: string, status: Check['status'], utilization: number | null, objectIds: string[]): Check {
  return {
    id,
    kind: 'cooling.rackHeatLimit',
    layer: 'cooling',
    subject: { kind: 'group', id: 'g', objectIds },
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

function rack(placementId: string, heatW: number): RackResult {
  const [rowId] = placementId.split('-')
  return {
    placementId,
    groupId: 'g',
    rowId: rowId!,
    slot: 0,
    objectId: `rack:${placementId}`,
    powerW: heatW,
    heatW,
    liquidW: 0,
    facilityWaterW: 0,
    airW: heatW,
    flowLps: null,
    supplyC: null,
    returnC: null,
    airInletC: null,
    airOutletC: null,
    weightKg: 0,
    bayId: 'B1-1',
    flowShare: null,
    coolingOk: true,
  }
}

const failing: Pick<Evaluation, 'checks' | 'racks'> = {
  checks: [
    check('warn', 'warn', 0.95, ['rack:R1-00']),
    check('fail-small', 'fail', 1.1, ['rack:R2-03']),
    check('fail-cdu', 'fail', 1.9, ['eq:cdu:R4:0']),
    check('fail-big', 'fail', 1.4, ['rack:R5-02', 'rack:R5-09', 'rack:R5-04']),
  ],
  racks: [rack('R5-02', 30_000), rack('R5-09', 132_000), rack('R5-04', 60_000)],
}

function ctx(over: Partial<ShotContext> = {}): ShotContext {
  return { plan, evaluation: null, focusId: null, worldBox: noBoxes, ...over }
}

function distance(s: Shot): number {
  return new Vector3(...s.position).distanceTo(new Vector3(...s.target))
}

/** Rack center on the floor plan, from the plan's own row geometry (one 0.6 m slot wide). */
function rackCenter(placementId: string): { x: number; z: number } {
  const p = plan.placements.find((x) => x.id === placementId)!
  const row = plan.hall.rows.find((r) => r.id === p.rowId)!
  return { x: row.x + (p.slot + 0.5) * row.slotPitchM, z: row.z + row.rackDepthM / 2 }
}

describe('transitionPath', () => {
  it('passes every level between gpu and site', () => {
    expect(transitionPath('gpu', 'site')).toEqual(['gpu', 'tray', 'rack', 'row', 'hall', 'site'])
    expect(transitionPath('site', 'gpu')).toEqual(['site', 'hall', 'row', 'rack', 'tray', 'gpu'])
    expect(transitionPath('row', 'hall')).toEqual(['row', 'hall'])
    expect(transitionPath('rack', 'rack')).toEqual(['rack'])
  })
})

describe('focus', () => {
  it('picks the selected rack, else the rack of the worst failing check, else the hall center', () => {
    // Without a failing rack the close shots take the rack nearest the hall center, never empty floor.
    const cx = plan.hall.widthM / 2
    const cz = plan.hall.depthM / 2
    const central = plan.placements
      .map((p) => ({ id: p.id, d: Math.hypot(rackCenter(p.id).x - cx, rackCenter(p.id).z - cz) }))
      .reduce((a, b) => (b.d < a.d ? b : a)).id
    expect(resolveFocus(ctx({ evaluation: failing, focusId: 'R3-07' }))).toBe('rack:R3-07')
    expect(resolveFocus(ctx({ evaluation: failing, focusId: 'rack:R3-07:tray:4:gpu:1' }))).toBe('rack:R3-07:tray:4:gpu:1')
    // Worst failing check with a rack subject is fail-big (fail-cdu has no rack); within it the hottest rack.
    expect(resolveFocus(ctx({ evaluation: failing }))).toBe('rack:R5-09')
    expect(resolveFocus(ctx({ evaluation: { checks: [check('ok', 'pass', 0.2, ['rack:R1-00'])], racks: [] } }))).toBe(`rack:${central}`)

    const selected = shotFor('rack', ctx({ evaluation: failing, focusId: 'R3-07' }))
    expect(selected.target[0]).toBeCloseTo(rackCenter('R3-07').x)
    expect(selected.target[2]).toBeCloseTo(rackCenter('R3-07').z)

    const worst = shotFor('rack', ctx({ evaluation: failing }))
    expect(worst.target[0]).toBeCloseTo(rackCenter('R5-09').x)
    expect(worst.target[2]).toBeCloseTo(rackCenter('R5-09').z)

    const empty: Plan = { ...plan, placements: [] }
    expect(resolveFocus(ctx({ plan: empty }))).toBeNull()
    const none = shotFor('rack', ctx({ plan: empty }))
    expect(none.target[0]).toBeCloseTo(plan.hall.widthM / 2)
    expect(none.target[2]).toBeCloseTo(plan.hall.depthM / 2)
  })

  it('a selected row focuses its middle rack', () => {
    const slots = plan.placements.filter((p) => p.rowId === 'R4').map((p) => p.slot)
    const middle = `rack:R4-${String(slots.sort((a, b) => a - b)[Math.floor(slots.length / 2)]).padStart(2, '0')}`
    expect(resolveFocus(ctx({ focusId: 'R4' }))).toBe(middle)
    expect(resolveFocus(ctx({ focusId: 'row:R4' }))).toBe(middle)
  })

  it('ignores selections that are not racks or rows of this plan', () => {
    expect(resolveFocus(ctx({ evaluation: failing, focusId: 'eq:cdu:R3:0' }))).toBe('rack:R5-09')
    expect(resolveFocus(ctx({ evaluation: failing, focusId: 'R9-99' }))).toBe('rack:R5-09')
  })
})

describe('shotFor', () => {
  it('zooms in monotonically from site to gpu', () => {
    const c = ctx({ focusId: 'R3-07' })
    const d = (['site', 'hall', 'row', 'rack', 'tray', 'gpu'] as const).map((id) => distance(shotFor(id, c)))
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]!)
  })

  it('looks at the rack front and stays above the neighbouring row', () => {
    // R1 has its hot aisle south, so its front faces north (−z); R2 faces south.
    const north = shotFor('rack', ctx({ focusId: 'R1-05' }))
    const south = shotFor('rack', ctx({ focusId: 'R2-05' }))
    expect(north.position[2]).toBeLessThan(north.target[2])
    expect(south.position[2]).toBeGreaterThan(south.target[2])
    expect(south.position[1]).toBeGreaterThan(42 * 0.04445)
  })

  it('uses registered boxes for trays and gpus', () => {
    const gpuBox = new Box3(new Vector3(10, 1.2, 9), new Vector3(10.1, 1.23, 9.1))
    const boxes: Record<string, Box3> = {
      'rack:R3-07:tray:0': new Box3(new Vector3(9.9, 0.4, 8), new Vector3(10.5, 0.44, 9.2)),
      'rack:R3-07:tray:1': new Box3(new Vector3(9.9, 1.2, 8), new Vector3(10.5, 1.24, 9.2)),
      'rack:R3-07:tray:1:gpu:0': gpuBox,
      'rack:R3-07:tray:2': new Box3(new Vector3(9.9, 1.6, 8), new Vector3(10.5, 1.64, 9.2)),
    }
    const worldBox = (id: string) => boxes[id] ?? null
    const tray = shotFor('tray', ctx({ focusId: 'R3-07', worldBox }))
    expect(tray.target[1]).toBeCloseTo(1.22)
    // The gpu shot spans the tray's width and the GPU row, from the tray floor to the GPU's top.
    const gpu = shotFor('gpu', ctx({ focusId: 'rack:R3-07:tray:1:gpu:0', worldBox }))
    expect(gpu.target).toEqual([10.2, 1.215, 9.05].map((v) => expect.closeTo(v, 5)))
    // A cold-plate tray adds its hoses back to the quick disconnects at the tray's rear.
    boxes['rack:R3-07:tray:1:hoses'] = new Box3(new Vector3(9.95, 1.21, 9.02), new Vector3(10.45, 1.23, 9.18))
    const plated = shotFor('gpu', ctx({ focusId: 'rack:R3-07:tray:1:gpu:0', worldBox }))
    expect(plated.target).toEqual([10.2, 1.215, 9.09].map((v) => expect.closeTo(v, 5)))
  })

  it('frames the populated rows and the units that serve them, not the empty hall floor', () => {
    // The default plan fills R1–R5 (x 8–22.4 m, z 4–19.6 m) in a 40 m × 36 m hall; CRAHs stand at x 1.5 m and CDU
    // positions at x 23.6 m.
    const hall = shotFor('hall', ctx({}))
    expect(hall.target[0]).toBeCloseTo((1.5 + 23.6) / 2, 0)
    expect(hall.target[2]).toBeLessThan(plan.hall.depthM / 2)
    const filled = Math.max(...plan.placements.map((p) => plan.hall.rows.findIndex((r) => r.id === p.rowId)))
    const lastRow = plan.hall.rows[filled]!
    expect(hall.target[2]).toBeCloseTo((plan.hall.rows[0]!.z + lastRow.z + lastRow.rackDepthM) / 2, 0)
    const whole = shotFor('hall', ctx({ plan: { ...plan, placements: [], rackGroups: [] } }))
    expect(distance(hall)).toBeLessThan(distance(whole) * 0.8)
  })

  it('frames an empty hall without NaN', () => {
    const empty: Plan = { ...plan, placements: [], rackGroups: [] }
    for (const id of ['site', 'hall', 'row', 'rack', 'tray', 'gpu'] as const) {
      const s = shotFor(id, ctx({ plan: empty }))
      expect([...s.position, ...s.target, s.fov].every(Number.isFinite)).toBe(true)
    }
  })
})

interface Move {
  pose: Shot
  smoothTimeS: number
}

class FakeDriver implements CameraDriver {
  moves: Move[] = []
  fades: number[] = []
  openness: { placementId: string | null; value: number }[] = []
  private current: Shot
  constructor(start: Shot) {
    this.current = start
  }
  moveTo(pose: Shot, smoothTimeS: number) {
    this.moves.push({ pose, smoothTimeS })
    // The fake camera arrives at each commanded pose at once; durations come from the poses alone.
    this.current = pose
  }
  pose() {
    return this.current
  }
  setFade(opacity: number) {
    this.fades.push(opacity)
  }
  setOpenness(placementId: string | null, value: number) {
    this.openness.push({ placementId, value })
  }
}

function run(choreo: Choreography, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) choreo.tick(dt)
}

const resolveIn = (c: Omit<ShotContext, 'focusId'>) => (w: Waypoint) => shotFor(w.shot, { ...c, focusId: w.focusId })

describe('Choreography', () => {
  it('visits every level on the way and scales the total to 0.8–1.6 s', () => {
    const resolve = resolveIn(ctx())
    const start: Waypoint = { shot: 'gpu', focusId: 'rack:R3-07' }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'site', focusId: 'rack:R3-07' }, false)
    run(choreo, 2)
    const targets = [...new Set(driver.moves.map((m) => JSON.stringify(m.pose)))]
    const expected = (['tray', 'rack', 'row', 'hall', 'site'] as const).map((shot) => JSON.stringify(resolve({ shot, focusId: 'rack:R3-07' })))
    expect(targets).toEqual(expected)
    expect(choreo.busy).toBe(false)
  })

  it('legDurations stay within 0.8–1.6 s in total and give long moves more time', () => {
    const resolve = resolveIn(ctx())
    const f = 'rack:R3-07'
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const far = legDurations(transitionPath('gpu', 'site').map((shot) => resolve({ shot, focusId: f })))
    const near = legDurations(transitionPath('hall', 'site').map((shot) => resolve({ shot, focusId: f })))
    const still = legDurations([resolve({ shot: 'hall', focusId: f }), resolve({ shot: 'hall', focusId: f })])
    expect(far).toHaveLength(5)
    expect(sum(far)).toBeLessThanOrEqual(1.6 + 1e-9)
    expect(sum(far)).toBeGreaterThan(sum(near))
    expect(sum(near)).toBeGreaterThanOrEqual(0.8)
    expect(sum(still)).toBeCloseTo(0.8)
  })

  it('opens the rack on the rack to tray leg and closes it on the way back', () => {
    const resolve = resolveIn(ctx())
    const start: Waypoint = { shot: 'hall', focusId: 'rack:R3-07' }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'gpu', focusId: 'rack:R3-07' }, false)
    run(choreo, 2)
    const opened = driver.openness.filter((o) => o.placementId === 'R3-07').map((o) => o.value)
    expect(opened.at(-1)).toBe(1)
    expect(opened.some((v) => v > 0.2 && v < 0.8)).toBe(true)
    for (let i = 1; i < opened.length; i++) expect(opened[i]).toBeGreaterThanOrEqual(opened[i - 1]!)

    driver.openness = []
    choreo.go({ shot: 'hall', focusId: 'rack:R3-07' }, false)
    run(choreo, 2)
    expect(driver.openness.at(-1)).toEqual({ placementId: 'R3-07', value: 0 })
  })

  it('interrupt keeps selection', () => {
    const store = createTwinStore({ backend: new FakeBackend() })
    store.setState({ plan })
    store.getState().dispatchView({ type: 'focus', target: { kind: 'gpu', id: 'rack:R3-07:tray:2:gpu:1' } })
    const selection = store.getState().selection
    const targetOf = (): Waypoint => {
      const s = store.getState()
      return { shot: s.shot, focusId: resolveFocus({ plan, evaluation: null, focusId: s.selection?.id ?? null }) }
    }
    const resolve = resolveIn(ctx())
    const driver = new FakeDriver(resolve(targetOf()))
    const choreo = new Choreography(driver, resolve, targetOf())
    store.subscribe(() => choreo.go(targetOf(), false))

    store.getState().dispatchView({ type: 'setLayer', layer: 'site' })
    run(choreo, 0.7)
    expect(choreo.busy).toBe(true)
    store.getState().dispatchView({ type: 'setLayer', layer: 'compute' })
    run(choreo, 3)

    expect(choreo.busy).toBe(false)
    expect(driver.moves.at(-1)!.pose).toEqual(resolve({ shot: 'gpu', focusId: 'rack:R3-07:tray:2:gpu:1' }))
    expect(store.getState().shot).toBe('gpu')
    expect(store.getState().selection).toEqual(selection)
    expect(driver.openness.at(-1)).toEqual({ placementId: 'R3-07', value: 1 })
  })

  it('a redirect mid-leg continues from where the camera is instead of restarting', () => {
    const resolve = resolveIn(ctx())
    const f = 'rack:R3-07'
    const start: Waypoint = { shot: 'rack', focusId: f }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'hall', focusId: f }, false)
    run(choreo, 0.15) // on the rack to row leg
    driver.moves = []
    choreo.go({ shot: 'site', focusId: f }, false)
    run(choreo, 2)
    const targets = [...new Set(driver.moves.map((m) => JSON.stringify(m.pose)))]
    expect(targets).toEqual((['row', 'hall', 'site'] as const).map((shot) => JSON.stringify(resolve({ shot, focusId: f }))))
  })

  it('re-frames the resting shot when the scene changes, unless the user took the camera', () => {
    const boxes: Record<string, Box3> = {}
    const c = ctx({ worldBox: (id) => boxes[id] ?? null })
    const resolve = resolveIn(c)
    const start: Waypoint = { shot: 'tray', focusId: 'rack:R3-07' }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.invalidate()
    run(choreo, 1)
    const before = driver.moves.length
    boxes['rack:R3-07:tray:0'] = new Box3(new Vector3(9.9, 1.2, 7), new Vector3(10.5, 1.24, 9.2))
    run(choreo, 1)
    expect(driver.moves).toHaveLength(before) // nothing re-resolves until the scene says it changed
    choreo.invalidate()
    run(choreo, 1)
    expect(driver.moves).toHaveLength(before + 1)
    expect(driver.moves.at(-1)!.pose.target[1]).toBeCloseTo(1.22)

    choreo.cancel()
    boxes['rack:R3-07:tray:0'] = new Box3(new Vector3(9.9, 0.4, 7), new Vector3(10.5, 0.44, 9.2))
    choreo.invalidate()
    run(choreo, 1)
    expect(driver.moves).toHaveLength(before + 1)
  })

  it('resolves shots at leg starts, and at most 15 times a second while the scene changes', () => {
    const calls: Waypoint[] = []
    const base = resolveIn(ctx())
    const resolve = (w: Waypoint) => {
      calls.push(w)
      return base(w)
    }
    const f = 'rack:R3-07'
    const start: Waypoint = { shot: 'hall', focusId: f }
    const driver = new FakeDriver(base(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'gpu', focusId: f }, false)
    const planned = calls.length
    run(choreo, 2)
    expect(calls.length - planned).toBe(4) // row, rack, tray, gpu

    calls.length = 0
    choreo.go({ shot: 'hall', focusId: f }, false)
    calls.length = 0
    for (let t = 0; t < 0.6; t += 1 / 120) {
      choreo.invalidate() // e.g. openness changing every frame
      choreo.tick(1 / 120)
    }
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(0.6 * 15) + 4)
    expect(calls.length).toBeGreaterThan(4)
  })

  it('a user grab mid-leg finishes the rack opening instead of leaving it half open', () => {
    const resolve = resolveIn(ctx())
    const f = 'rack:R3-07'
    const start: Waypoint = { shot: 'rack', focusId: f }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'tray', focusId: f }, false)
    run(choreo, 0.1)
    const mid = driver.openness.at(-1)!.value
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    choreo.cancel()
    expect(driver.openness.at(-1)).toEqual({ placementId: 'R3-07', value: 1 })
  })

  it('reduced motion uses cross-fade (duration 0.2 s, no path)', () => {
    const resolve = resolveIn(ctx())
    const start: Waypoint = { shot: 'gpu', focusId: 'rack:R3-07' }
    const driver = new FakeDriver(resolve(start))
    const choreo = new Choreography(driver, resolve, start)
    choreo.go({ shot: 'site', focusId: 'rack:R3-07' }, true)
    run(choreo, 0.19)
    expect(choreo.busy).toBe(true)
    run(choreo, 0.05)
    expect(choreo.busy).toBe(false)
    expect(driver.moves).toEqual([{ pose: resolve({ shot: 'site', focusId: 'rack:R3-07' }), smoothTimeS: 0 }])
    expect(Math.min(...driver.fades)).toBeLessThan(0.2)
    expect(driver.fades.at(-1)).toBe(1)
    expect(driver.openness.at(-1)).toEqual({ placementId: 'R3-07', value: 0 })
  })
})

describe('rack openness slice', () => {
  it('reports the value only for the open rack', () => {
    useRackOpenness.setState({ placementId: 'R3-07', tray: 9, value: 0.6 })
    expect(selectOpenness('R3-07')(useRackOpenness.getState())).toBe(0.6)
    expect(selectOpenness('R3-08')(useRackOpenness.getState())).toBe(0)
  })
})
