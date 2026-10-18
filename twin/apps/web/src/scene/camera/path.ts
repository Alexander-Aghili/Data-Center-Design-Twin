import { SHOT_IDS, type ShotId } from '@twin/schema'
import { MathUtils, Vector3 } from 'three'
import { focusRack, type Shot } from './shots'

/** A shot of a particular focus: where the camera heads on one leg of a transition. */
export interface Waypoint {
  shot: ShotId
  focusId: string | null
}

/** What the choreography drives: the camera controls, the cross-fade and the open rack. */
export interface CameraDriver {
  /** Heads toward `pose`, damped over about `smoothTimeS`; 0 cuts straight to it. */
  moveTo(pose: Shot, smoothTimeS: number): void
  /** Where the camera is now. */
  pose(): Shot
  /** Scene opacity during a reduced-motion cross-fade: 1 shown, 0 faded out. */
  setFade(opacity: number): void
  setOpenness(placementId: string | null, value: number): void
}

const MIN_TOTAL_S = 0.8
const MAX_TOTAL_S = 1.6
// Seconds per unit of visual distance (log zoom + relative pan + turn in radians). One level of zoom (about 3×,
// ln 3 ≈ 1.1) with its turn lands near 1 s; gpu to site saturates at the 1.6 s cap.
const SECONDS_PER_UNIT = 0.15
const CROSS_FADE_S = 0.2
// A resting shot that shifts because the scene changed eases over a short half second rather than jumping.
const REFRAME_S = 0.4
// After the scene changes, shots are re-resolved for this long (models ease toward their state a few frames late,
// e.g. a rack's doors and trays) and at most this often: resolving probes every tray box of the open rack.
const SETTLE_S = 0.5
const RESOLVE_INTERVAL_S = 1 / 15
// The rack is shut down to the rack shot and fully open (doors swung, trays out) at tray and gpu.
const OPENNESS: Record<ShotId, number> = { site: 0, hall: 0, row: 0, rack: 0, tray: 1, gpu: 1 }

const level = (shot: ShotId) => SHOT_IDS.indexOf(shot)
const ROW = level('row')
const insideRow = (shot: ShotId) => level(shot) > ROW

/** Every level from `from` to `to`, both included, along site > hall > row > rack > tray > gpu. */
export function transitionPath(from: ShotId, to: ShotId): ShotId[] {
  const a = level(from)
  const b = level(to)
  const step = b >= a ? 1 : -1
  const out: ShotId[] = []
  for (let i = a; i !== b + step; i += step) out.push(SHOT_IDS[i]!)
  return out
}

/** Site and hall shots look the same whatever the focus; row and closer shots depend on it. */
function sameWaypoint(a: Waypoint, b: Waypoint): boolean {
  return a.shot === b.shot && (level(a.shot) < ROW || a.focusId === b.focusId)
}

/**
 * Waypoints after `from` up to and including `to`. Rising out of a rack keeps that rack's focus until the row; moving
 * between racks below the row level rises to the row of the new rack and descends into it.
 */
function route(from: Waypoint, to: Waypoint): Waypoint[] {
  if (sameWaypoint(from, to)) return []
  const leaves = (shots: ShotId[], focusId: string | null) => shots.map((shot) => ({ shot, focusId }))
  if (insideRow(from.shot) && insideRow(to.shot) && focusRack(from.focusId) !== focusRack(to.focusId)) {
    return [
      ...leaves(transitionPath(from.shot, 'row').slice(1, -1), from.focusId),
      { shot: 'row', focusId: to.focusId },
      ...leaves(transitionPath('row', to.shot).slice(1), to.focusId),
    ]
  }
  const path = transitionPath(from.shot, to.shot).slice(1)
  if (path.length === 0) return [to]
  const rising = level(to.shot) < level(from.shot)
  return path.map((shot) => ({ shot, focusId: rising && insideRow(shot) ? from.focusId : to.focusId }))
}

/** Log zoom change, target travel relative to the viewing distance, and turn of the view direction. */
function visualDistance(a: Shot, b: Shot): number {
  const offsetA = new Vector3(...a.position).sub(new Vector3(...a.target))
  const offsetB = new Vector3(...b.position).sub(new Vector3(...b.target))
  const ra = Math.max(offsetA.length(), 1e-6)
  const rb = Math.max(offsetB.length(), 1e-6)
  const pan = new Vector3(...a.target).distanceTo(new Vector3(...b.target)) / ((ra + rb) / 2)
  return Math.abs(Math.log(rb / ra)) + pan + offsetA.angleTo(offsetB)
}

/**
 * Leg durations for a camera passing through `poses` (the first is where it starts). The total scales with the
 * visual distance within 0.8–1.6 s; half of it is shared equally so short legs still read as steps.
 */
export function legDurations(poses: Shot[]): number[] {
  const weights = poses.slice(1).map((pose, i) => visualDistance(poses[i]!, pose))
  const sum = weights.reduce((a, b) => a + b, 0)
  const total = MathUtils.clamp(MIN_TOTAL_S + SECONDS_PER_UNIT * sum, MIN_TOTAL_S, MAX_TOTAL_S)
  const n = weights.length
  return weights.map((w) => total * (sum > 0 ? 0.5 / n + (0.5 * w) / sum : 1 / n))
}

interface Leg {
  from: Waypoint
  to: Waypoint
  startS: number
  durationS: number
}

// The rack opens early in its leg and closes late, so the tray is out before the camera (which damps behind the
// schedule) arrives, and stays out until the camera has pulled back.
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t ** 3

const close = (x: number, y: number) => Math.abs(x - y) < 1e-4

function samePose(a: Shot, b: Shot): boolean {
  for (let i = 0; i < 3; i++) if (!close(a.position[i]!, b.position[i]!) || !close(a.target[i]!, b.target[i]!)) return false
  return close(a.fov, b.fov)
}

/**
 * Moves the camera through every level between shots, one damped leg per waypoint, handing each leg to the next
 * before it settles so the whole move reads as one. A new target redirects from where the camera is; the rack opens
 * and closes on the rack ↔ tray legs. Driven by `tick` from the frame loop.
 */
export class Choreography {
  private legs: Leg[] = []
  private legIndex = -1
  private elapsedS = 0
  private fadeS: number | null = null
  private target: Waypoint
  private open: { placementId: string | null; value: number }
  private openFrom = 0
  private openTo = 0
  private commanded: Shot | null = null
  private released = false
  /** The last move asked for reduced motion: re-frames cut instead of gliding. */
  private reducedMotion = false
  private staleForS = 0
  private sinceResolveS = 0
  private readonly driver: CameraDriver
  private readonly resolve: (w: Waypoint) => Shot

  constructor(driver: CameraDriver, resolve: (w: Waypoint) => Shot, start: Waypoint) {
    this.driver = driver
    this.resolve = resolve
    this.target = start
    this.open = { placementId: focusRack(start.focusId), value: OPENNESS[start.shot] }
    driver.setOpenness(this.open.placementId, this.open.value)
  }

  /** True while a transition or cross-fade is under way. */
  get busy(): boolean {
    return this.legs.length > 0 || this.fadeS !== null
  }

  go(target: Waypoint, reducedMotion: boolean): void {
    if (sameWaypoint(target, this.target)) return
    const { from, waypoints } = this.plan(target)
    this.target = target
    this.released = false
    this.reducedMotion = reducedMotion
    this.legs = []
    this.legIndex = -1
    this.elapsedS = 0
    if (reducedMotion) {
      this.fadeS = 0
      return
    }
    if (this.fadeS !== null) this.driver.setFade(1)
    this.fadeS = null
    const durations = legDurations([this.driver.pose(), ...waypoints.map(this.resolve)])
    let startS = 0
    this.legs = waypoints.map((to, i) => {
      const leg = { from: i === 0 ? from : waypoints[i - 1]!, to, startS, durationS: durations[i]! }
      startS += leg.durationS
      return leg
    })
  }

  /**
   * Stops scheduling legs (the user took the camera); the camera settles wherever the controls leave it and the
   * rack finishes opening or closing as the interrupted leg intended.
   */
  cancel(): void {
    const leg = this.legs[this.legIndex]
    if (leg) {
      this.setOpen(this.open.placementId, this.openTo)
      // The controls carry on to the leg's pose under the user's hand, so the next move starts from there, not from
      // the abandoned target (which would first fly back in, opening the rack, on the way out).
      this.target = leg.to
    }
    this.legs = []
    this.legIndex = -1
    this.released = true
  }

  /**
   * The scene changed under the camera (models mounted or moved, the rack opened, the plan was edited). Shots are
   * re-resolved, throttled, for a short while: the current leg follows a sliding tray, and a resting shot re-frames
   * unless the user has taken the camera since the last move.
   */
  invalidate(): void {
    this.staleForS = SETTLE_S
  }

  tick(dt: number): void {
    const due = this.staleForS > 0 && this.sinceResolveS >= RESOLVE_INTERVAL_S
    this.staleForS = Math.max(0, this.staleForS - dt)
    this.sinceResolveS += dt
    if (this.fadeS !== null) return this.tickFade(dt, due)
    if (this.legs.length === 0) {
      if (due && !this.released) this.command(this.target, this.reducedMotion ? 0 : REFRAME_S)
      return
    }
    this.elapsedS += dt
    let i = this.legIndex
    while (i + 1 < this.legs.length && this.legs[i + 1]!.startS <= this.elapsedS) i++
    const leg = this.legs[i]!
    const started = i !== this.legIndex
    if (started) this.beginLeg(i, leg)
    const last = i === this.legs.length - 1
    // Each leg hands over at about 90 % of its way (smooth time half its duration); the last one settles fully.
    if (started || due) this.command(leg.to, leg.durationS / (last ? 3 : 2))
    const p = MathUtils.clamp((this.elapsedS - leg.startS) / leg.durationS, 0, 1)
    const eased = this.openTo > this.openFrom ? easeOut(p) : easeIn(p)
    this.setOpen(this.open.placementId, this.openFrom + (this.openTo - this.openFrom) * eased)
    if (last && p >= 1) {
      this.legs = []
      this.legIndex = -1
    }
  }

  /**
   * Where to head for a new target. Mid-leg the camera is between two waypoints; it continues to whichever of them
   * gives the shorter remaining route, counting the part of the current leg still to travel.
   */
  private plan(target: Waypoint): { from: Waypoint; waypoints: Waypoint[] } {
    const leg = this.legs[Math.max(this.legIndex, 0)]
    if (!leg || this.fadeS !== null) return { from: this.target, waypoints: route(this.target, target) }
    const p = MathUtils.clamp((this.elapsedS - leg.startS) / leg.durationS, 0, 1)
    const ahead = [leg.to, ...route(leg.to, target)]
    const back = [leg.from, ...route(leg.from, target)]
    return p + back.length < 1 - p + ahead.length ? { from: leg.to, waypoints: back } : { from: leg.from, waypoints: ahead }
  }

  /** Resolves the waypoint's shot and heads there, unless the camera is already headed to that exact pose. */
  private command(w: Waypoint, smoothTimeS: number): void {
    this.sinceResolveS = 0
    const pose = this.resolve(w)
    if (this.commanded && samePose(pose, this.commanded)) return
    this.driver.moveTo(pose, smoothTimeS)
    this.commanded = pose
  }

  private beginLeg(i: number, leg: Leg): void {
    this.legIndex = i
    this.commanded = null
    this.openTo = OPENNESS[leg.to.shot]
    const rack = this.openTo > 0 ? focusRack(leg.to.focusId) : this.open.placementId
    this.openFrom = rack === this.open.placementId ? this.open.value : 0
    this.setOpen(rack, this.openFrom)
  }

  private setOpen(placementId: string | null, value: number): void {
    if (placementId === this.open.placementId && value === this.open.value) return
    this.open = { placementId, value }
    this.driver.setOpenness(placementId, value)
  }

  /** Reduced motion: dip to the canvas over 0.2 s and cut to the target at the midpoint. */
  private tickFade(dt: number, due: boolean): void {
    const half = CROSS_FADE_S / 2
    const before = this.fadeS!
    const now = before + dt
    // Models settling after the cut (the rack opening at once) re-frame while the scene is still faded.
    if (before >= half && due) this.command(this.target, 0)
    if (before < half && now >= half) {
      this.commanded = this.resolve(this.target)
      this.driver.moveTo(this.commanded, 0)
      const value = OPENNESS[this.target.shot]
      this.setOpen(value > 0 ? focusRack(this.target.focusId) : this.open.placementId, value)
    }
    if (now >= CROSS_FADE_S) {
      this.fadeS = null
      this.driver.setFade(1)
      return
    }
    this.fadeS = now
    this.driver.setFade(Math.abs(now - half) / half)
  }
}
