import type { EquipmentPosition, Evaluation, Plan, RackEntry, RackResult, Row } from '@twin/schema'
import { rackSize, slotWorld } from '../geometry'
import { PALETTE } from '../palette'

/**
 * Pure geometry and scaling for the flow overlays. Paths are illustrative routes through the hall,
 * scaled from the engine's computed flows and temperatures; nothing here is a fluid simulation.
 * Coordinates are hall meters (x east, y up, z south), as in `geometry.ts`.
 */

export type Vec3 = [number, number, number]
export type Leg = 'supply' | 'return'

/** One visible tube. `fills` is the normalized hydraulic distance from the plant at each point (0..1). */
export interface PipeRun {
  id: string
  leg: Leg
  radius: number
  points: Vec3[]
  fills: number[]
}

/** A closed route particles travel. `temps` (°C) and `fills` are given per point. */
export interface Circuit {
  id: string
  tier: 'facility' | 'cdu' | 'header' | 'rack' | 'air'
  points: Vec3[]
  temps: number[]
  fills: number[]
  /** Particle speed along the route, m/s. */
  speed: number
  count: number
}

export interface TempScale {
  lo: number
  hi: number
}

export interface LiquidNetwork {
  pipes: PipeRun[]
  circuits: Circuit[]
  scale: TempScale
}

export interface AirNetwork {
  circuits: Circuit[]
  scale: TempScale
}

// Chilled-water piping is sized for about 1.2 m/s at design flow, and kept under about 3 m/s to limit
// erosion and noise (ASHRAE Handbook—Fundamentals, ch. 22 "Pipe sizing"). Particles move at the water
// velocity a pipe sized for design flow would see; the floor keeps a stalled loop visibly crawling.
const LIQUID_DESIGN_MPS = 1.2
const LIQUID_MAX_MPS = 3
const LIQUID_MIN_MPS = 0.05

// Air particles are deliberately slow and sparse (visual choice): 0.5 m/s at the hall's mean rack airflow.
const AIR_DESIGN_MPS = 0.5
const AIR_MAX_MPS = 1.5
const AIR_MIN_MPS = 0.1
const AIR_PARTICLES_PER_RACK = 3
// Air at about 25 °C: ρ ≈ 1.18 kg/m³, cp ≈ 1006 J/(kg·K) (ASHRAE Handbook—Fundamentals, ch. 1).
const AIR_RHO_CP = 1.18 * 1006

// Visual density: beads per meter of main pipe at design flow, beads per rack branch at a flow share of 1.
const BEADS_PER_M = 1.6
const RACK_BEADS = 8

// Visual layout (m). Raised-floor pipes are drawn at floor level so they stay visible; return pipes run
// higher than supply pipes so the two never intersect where they cross.
const FLOOR_PIPE_Y = 0.12
const OVERHEAD_CLEARANCE = 0.35
const RETURN_RISE = 0.2
const RADIUS = { main: 0.08, header: 0.05, branch: 0.022 }
const BEND = { main: 0.35, header: 0.25, branch: 0.06 }
// EIA-310 rack unit (44.45 mm) × 42U, the height used when a rack type is not in the plan catalog.
const FALLBACK_RACK_H = 42 * 0.04445
// Typical perimeter CRAH: about 2 m tall, return air enters at the top.
const CRAH_RETURN_Y = 2.1

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Particle speed proportional to flow: `k·flowLps` with `k = design velocity / design flow`, clamped. */
export function particleSpeed(flowLps: number, designLps: number): number {
  if (!(designLps > 0)) return LIQUID_MIN_MPS
  return clamp((LIQUID_DESIGN_MPS * flowLps) / designLps, LIQUID_MIN_MPS, LIQUID_MAX_MPS)
}

/** Beads on a rack branch, proportional to its manifold flow share; air-only racks get none. */
export function particleCount(flowShare: number | null): number {
  if (flowShare === null || !(flowShare > 0)) return 0
  return Math.max(1, Math.round(RACK_BEADS * flowShare))
}

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const SUPPLY_RGB = rgb(PALETTE.supply)
const RETURN_RGB = rgb(PALETTE.return)

/** Supply blue at `scale.lo`, return amber at `scale.hi`, linear in between. */
export function supplyReturnColor(tempC: number, scale: TempScale): string {
  const span = scale.hi - scale.lo
  const t = span > 0 ? clamp((tempC - scale.lo) / span, 0, 1) : 0
  const mixed = SUPPLY_RGB.map((c, i) => Math.round(c + (RETURN_RGB[i]! - c) * t))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Cumulative arc length at each point. */
export function cumulativeLengths(points: Vec3[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + dist(points[i - 1]!, points[i]!))
  return out
}

/** Linear interpolation of per-point `values` at arc length `s`. */
export function sampleAt(cum: number[], values: number[], s: number): number {
  if (s <= 0) return values[0]!
  const last = cum.length - 1
  if (s >= cum[last]!) return values[last]!
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! <= s) lo = mid
    else hi = mid
  }
  const span = cum[hi]! - cum[lo]!
  const t = span > 0 ? (s - cum[lo]!) / span : 0
  return values[lo]! + (values[hi]! - values[lo]!) * t
}

/** Sequential temperature scale for the temperature overlay, from computed rack inlet and outlet air. */
export function temperatureScale(evaluation: Evaluation): TempScale {
  const inlets = evaluation.racks.flatMap((r) => (r.airInletC === null ? [] : [r.airInletC]))
  const outlets = evaluation.racks.flatMap((r) => (r.airOutletC === null ? [] : [r.airOutletC]))
  if (inlets.length === 0 || outlets.length === 0) return { lo: 0, hi: 0 }
  return { lo: Math.min(...inlets), hi: Math.max(...outlets) }
}

// ---------- polyline helpers ----------

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

interface Track {
  points: Vec3[]
  temps: number[]
  fills: number[]
}

/** A track whose fill grows with arc length from `fill0`, at constant temperature `temp`. */
function track(points: Vec3[], fill0: number, temp: number): Track {
  const cum = cumulativeLengths(points)
  return { points, temps: points.map(() => temp), fills: cum.map((s) => fill0 + s) }
}

function concat(...tracks: Track[]): Track {
  const out: Track = { points: [], temps: [], fills: [] }
  for (const t of tracks) {
    const skip = out.points.length > 0 && dist(out.points.at(-1)!, t.points[0]!) < 1e-9 ? 1 : 0
    out.points.push(...t.points.slice(skip))
    out.temps.push(...t.temps.slice(skip))
    out.fills.push(...t.fills.slice(skip))
  }
  return out
}

/** Re-times temperatures between point indices `i0` and `i1` as a linear ramp by arc length. */
function rampTemps(t: Track, i0: number, i1: number, from: number, to: number): Track {
  const cum = cumulativeLengths(t.points)
  const span = cum[i1]! - cum[i0]!
  const temps = t.temps.map((temp, i) => {
    if (i <= i0) return from
    if (i >= i1) return to
    return from + ((to - from) * (cum[i]! - cum[i0]!)) / span
  })
  return { ...t, temps }
}

const BEND_STEPS = 4

/** Replaces each corner with a short quadratic fillet; straight runs and endpoints are kept as given. */
function rounded(t: Track, radius: number): Track {
  const out: Track = { points: [t.points[0]!], temps: [t.temps[0]!], fills: [t.fills[0]!] }
  for (let i = 1; i < t.points.length - 1; i++) {
    const [a, p, b] = [t.points[i - 1]!, t.points[i]!, t.points[i + 1]!]
    const la = dist(a, p)
    const lb = dist(p, b)
    const da = la > 0 ? p.map((c, k) => (c - a[k]!) / la) : [0, 0, 0]
    const db = lb > 0 ? b.map((c, k) => (c - p[k]!) / lb) : [0, 0, 0]
    const cos = da[0]! * db[0]! + da[1]! * db[1]! + da[2]! * db[2]!
    const r = Math.min(radius, la / 2, lb / 2)
    if (cos > 0.999 || r <= 0) {
      out.points.push(p)
      out.temps.push(t.temps[i]!)
      out.fills.push(t.fills[i]!)
      continue
    }
    const start: Vec3 = [p[0] - da[0]! * r, p[1] - da[1]! * r, p[2] - da[2]! * r]
    const end: Vec3 = [p[0] + db[0]! * r, p[1] + db[1]! * r, p[2] + db[2]! * r]
    const lerp = (x: number, y: number, f: number) => x + (y - x) * f
    const at = (values: number[], side: 'in' | 'out') =>
      side === 'in' ? lerp(values[i]!, values[i - 1]!, r / la) : lerp(values[i]!, values[i + 1]!, r / lb)
    const [tIn, tOut, fIn, fOut] = [at(t.temps, 'in'), at(t.temps, 'out'), at(t.fills, 'in'), at(t.fills, 'out')]
    for (let s = 0; s <= BEND_STEPS; s++) {
      const u = s / BEND_STEPS
      const w0 = (1 - u) * (1 - u)
      const w1 = 2 * u * (1 - u)
      const w2 = u * u
      out.points.push([0, 1, 2].map((k) => w0 * start[k]! + w1 * p[k]! + w2 * end[k]!) as Vec3)
      out.temps.push(lerp(tIn, tOut, u))
      out.fills.push(lerp(fIn, fOut, u))
    }
  }
  const last = t.points.length - 1
  if (last > 0) {
    out.points.push(t.points[last]!)
    out.temps.push(t.temps[last]!)
    out.fills.push(t.fills[last]!)
  }
  return out
}

function splitAtMidpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

/** Inserts collinear stops along an axis-aligned segment so taps land exactly on a pipe vertex. */
function withStops(from: Vec3, to: Vec3, axis: 0 | 2, stops: number[]): Vec3[] {
  const lo = Math.min(from[axis], to[axis])
  const hi = Math.max(from[axis], to[axis])
  const dir = to[axis] >= from[axis] ? 1 : -1
  const inner = stops
    .filter((s) => s > lo + 1e-6 && s < hi - 1e-6)
    .sort((x, y) => (x - y) * dir)
    .map((s): Vec3 => (axis === 0 ? [s, from[1], from[2]] : [from[0], from[1], s]))
  return [from, ...inner, to]
}

// ---------- plan lookups ----------

function rackEntry(plan: Plan, groupId: string): RackEntry | null {
  const group = plan.rackGroups.find((g) => g.id === groupId)
  const entry = group ? plan.catalog[group.rackTypeId] : undefined
  return entry?.kind === 'rack' ? entry : null
}

function rackGeometry(plan: Plan, rack: RackResult): { x: number; h: number } {
  const entry = rackEntry(plan, rack.groupId)
  const { x } = slotWorld(plan, rack.rowId, rack.slot, entry?.slotsWide ?? 1)
  return { x, h: entry ? rackSize(entry).h : FALLBACK_RACK_H }
}

/** Rack faces and aisles of a row: `dir` points from the rack rear into its hot aisle. */
function rowFaces(row: Row): { rearZ: number; frontZ: number; dir: 1 | -1 } {
  return row.hotAisle === 'south'
    ? { rearZ: row.z + row.rackDepthM, frontZ: row.z, dir: 1 }
    : { rearZ: row.z, frontZ: row.z + row.rackDepthM, dir: -1 }
}

function positionById(plan: Plan, id: string | undefined): EquipmentPosition | null {
  return plan.hall.positions.find((p) => p.id === id) ?? null
}

/** Position of the sized equipment `key`, else the plan position of `kind` that serves `rowId`. */
function servingPosition(plan: Plan, evaluation: Evaluation, kind: 'cdu' | 'crah' | 'plant', rowId: string, key?: string | null): EquipmentPosition | null {
  const sized = evaluation.equipment.filter((e) => (key ? e.key === key : e.key === kind || e.key.startsWith(`${kind}:`)))
  for (const e of sized) {
    const pos = e.positionIds.map((id) => positionById(plan, id)).find((p) => p && (kind === 'plant' || p.servesRows.includes(rowId)))
    if (pos) return pos
  }
  return plan.hall.positions.find((p) => p.kind === kind && (kind === 'plant' || p.servesRows.includes(rowId))) ?? null
}

const flowWeighted = (racks: RackResult[], pick: (r: RackResult) => number | null, fallback: number) => {
  let sum = 0
  let weight = 0
  for (const r of racks) {
    const v = pick(r)
    const w = r.flowLps ?? 0
    if (v !== null && w > 0) {
      sum += v * w
      weight += w
    }
  }
  return weight > 0 ? sum / weight : fallback
}

// ---------- liquid ----------

const isLiquid = (r: RackResult) => r.flowLps !== null && r.flowLps > 0

interface RowLoop {
  row: Row
  racks: RackResult[]
  cdu: EquipmentPosition
  flowLps: number
}

/** Fill value at the track point closest to `p` (taps always sit on a track vertex). */
function fillNear(t: Track, p: Vec3): number {
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  t.points.forEach((q, i) => {
    const d = dist(q, p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return t.fills[best]!
}

/** Splits a track at the midpoint of segment `i`→`i+1`, so a pipe changes color mid-run rather than at a bend. */
function splitTrack(t: Track, i: number): [Track, Track] {
  const mid: Track = {
    points: [splitAtMidpoint(t.points[i]!, t.points[i + 1]!)],
    temps: [(t.temps[i]! + t.temps[i + 1]!) / 2],
    fills: [(t.fills[i]! + t.fills[i + 1]!) / 2],
  }
  const slice = (a: number, b?: number): Track => ({ points: t.points.slice(a, b), temps: t.temps.slice(a, b), fills: t.fills.slice(a, b) })
  return [concat(slice(0, i + 1), mid), concat(mid, slice(i + 1))]
}

/**
 * Liquid network: plant → facility supply main → CDU tap → row supply header → rack branch, and back
 * along the return header, CDU tap and facility return main. Per-rack temperatures and flows come from
 * `evaluation.racks`. The facility return shows the flow-weighted mix of the rack returns (an upper
 * bound: the CDU heat exchanger approach is not part of the evaluation).
 */
export function liquidNetwork(plan: Plan, evaluation: Evaluation): LiquidNetwork {
  const liquid = evaluation.racks.filter(isLiquid)
  const facilitySupplyC = plan.cooling.facilitySupplyC
  const scale: TempScale = {
    lo: Math.min(facilitySupplyC, ...liquid.flatMap((r) => (r.supplyC === null ? [] : [r.supplyC]))),
    hi: Math.max(facilitySupplyC, ...liquid.flatMap((r) => (r.returnC === null ? [] : [r.returnC]))),
  }
  const loops: RowLoop[] = []
  for (const row of plan.hall.rows) {
    const racks = liquid.filter((r) => r.rowId === row.id)
    const cduKey = evaluation.rows.find((r) => r.rowId === row.id)?.cduKey
    const cdu = racks.length > 0 ? servingPosition(plan, evaluation, 'cdu', row.id, cduKey) : null
    if (cdu) loops.push({ row, racks, cdu, flowLps: racks.reduce((s, r) => s + (r.flowLps ?? 0), 0) })
  }
  if (loops.length === 0) return { pipes: [], circuits: [], scale }

  const overhead = plan.cooling.pipingRoute === 'overhead'
  const ys = overhead ? Math.max(...liquid.map((r) => rackGeometry(plan, r).h)) + OVERHEAD_CLEARANCE : FLOOR_PIPE_Y
  const yr = ys + RETURN_RISE
  const totalFlow = loops.reduce((s, l) => s + l.flowLps, 0)
  const maxRowFlow = Math.max(...loops.map((l) => l.flowLps))
  const meanRackFlow = liquid.reduce((s, r) => s + (r.flowLps ?? 0), 0) / liquid.length
  const facilityReturnC = flowWeighted(liquid, (r) => r.returnC, facilitySupplyC)
  const beads = (t: Track, flow: number, design: number) =>
    Math.max(1, Math.round(cumulativeLengths(t.points).at(-1)! * BEADS_PER_M * Math.min(1, flow / design)))

  const pipes: PipeRun[] = []
  const circuits: Circuit[] = []
  const addPipes = (id: string, supply: Track, ret: Track, radius: number, bend: number) => {
    pipes.push({ id: `${id}:supply`, leg: 'supply', radius, ...pick(rounded(supply, bend)) })
    pipes.push({ id: `${id}:return`, leg: 'return', radius, ...pick(rounded(ret, bend)) })
  }
  const pick = (t: Track) => ({ points: t.points, fills: t.fills })

  // Facility mains run north–south just east of the CDUs, from the plant past the farthest CDU.
  const plant = servingPosition(plan, evaluation, 'plant', loops[0]!.row.id)
  const mainX = Math.max(...loops.map((l) => l.cdu.x)) + 1
  const mainXr = mainX + 0.35
  const tapZ = (l: RowLoop, leg: Leg) => l.cdu.z + (leg === 'supply' ? -0.15 : 0.15)
  const zEnd = Math.max(...loops.map((l) => l.cdu.z)) + 0.6
  const supplyMain = plant
    ? track(
        [
          [plant.x, ys, plant.z],
          ...withStops([mainX, ys, plant.z], [mainX, ys, zEnd], 2, loops.map((l) => tapZ(l, 'supply'))),
        ],
        0,
        facilitySupplyC,
      )
    : null

  let returnMainFill = 0
  for (const l of loops) {
    const z = tapZ(l, 'supply')
    const tapSupply = supplyMain ? track([[mainX, ys, z], [l.cdu.x, ys, z]], fillNear(supplyMain, [mainX, ys, z]), facilitySupplyC) : null
    const atCdu = addRowLoop(l, tapSupply?.fills.at(-1) ?? 0)
    if (!tapSupply) continue
    const zr = tapZ(l, 'return')
    const tapReturn = track([[l.cdu.x, yr, zr], [mainXr, yr, zr]], atCdu, facilityReturnC)
    returnMainFill = Math.max(returnMainFill, tapReturn.fills.at(-1)!)
    addPipes(`cdu:${l.row.id}`, tapSupply, tapReturn, RADIUS.header, BEND.header)
    const through = concat(tapSupply, tapReturn)
    circuits.push({
      id: `cdu:${l.row.id}`,
      tier: 'cdu',
      ...through,
      speed: particleSpeed(l.flowLps, maxRowFlow),
      count: beads(through, l.flowLps, maxRowFlow),
    })
  }

  if (plant && supplyMain) {
    // The return main fills once the slowest row loop has come back through its CDU.
    const returnMain = track(
      [
        ...withStops([mainXr, yr, zEnd], [mainXr, yr, plant.z - 0.35], 2, loops.map((l) => tapZ(l, 'return'))),
        [plant.x, yr, plant.z - 0.35],
        [plant.x, yr, plant.z],
      ],
      returnMainFill,
      facilityReturnC,
    )
    const loop = concat(supplyMain, returnMain)
    const [supplyRun, returnRun] = splitTrack(loop, supplyMain.points.length - 1)
    addPipes('facility', supplyRun, returnRun, RADIUS.main, BEND.main)
    const route = rounded(loop, BEND.main)
    circuits.unshift({ id: 'facility', tier: 'facility', ...route, speed: particleSpeed(totalFlow, totalFlow), count: beads(route, totalFlow, totalFlow) })
  }

  return { pipes, circuits: normalizeFills(pipes, circuits), scale }

  /** Adds one row's supply and return headers and its rack branches; returns the fill back at the CDU. */
  function addRowLoop(l: RowLoop, fillAtCdu: number): number {
    const { rearZ, dir } = rowFaces(l.row)
    const hS = rearZ + dir * 0.18
    const hR = rearZ + dir * 0.38
    const faceZ = rearZ + dir * 0.06
    const supplyC = flowWeighted(l.racks, (r) => r.supplyC, scale.lo)
    const returnC = flowWeighted(l.racks, (r) => r.returnC, supplyC)
    const geo = new Map(l.racks.map((r) => [r, rackGeometry(plan, r)]))
    const xs = l.racks.map((r) => geo.get(r)!.x)
    const cx = l.cdu.x
    // Headers run from the CDU toward the far end of the row; supply sits on the far side of the return.
    const away = xs.reduce((s, x) => s + x, 0) / xs.length < cx ? -1 : 1
    const farX = (away < 0 ? Math.min(...xs) : Math.max(...xs)) + away * 0.3
    const supplyX = cx + away * 0.12
    const returnX = cx - away * 0.12

    const header = track(
      [
        [supplyX, ys, l.cdu.z],
        ...withStops([supplyX, ys, hS], [farX, ys, hS], 0, xs.map((x) => x - 0.1)),
        ...withStops([farX, yr, hR], [returnX, yr, hR], 0, xs.map((x) => x + 0.1)),
        [returnX, yr, l.cdu.z],
      ],
      fillAtCdu,
      supplyC,
    )
    const turnIndex = header.points.findIndex((p) => p[1] === yr)
    header.temps = header.temps.map((t, i) => (i < turnIndex ? supplyC : returnC))
    const [supplyRun, returnRun] = splitTrack(header, turnIndex - 1)
    addPipes(`header:${l.row.id}`, supplyRun, returnRun, RADIUS.header, BEND.header)
    const route = rounded(header, BEND.header)
    circuits.push({
      id: `header:${l.row.id}`,
      tier: 'header',
      ...route,
      speed: particleSpeed(l.flowLps, maxRowFlow),
      count: beads(route, l.flowLps, maxRowFlow),
    })

    for (const r of l.racks) {
      const { x, h } = geo.get(r)!
      // The rack manifold runs up the rear face: from the floor pipes to near the top, or down from overhead.
      const far = overhead ? 0.3 : h - 0.2
      const sup = r.supplyC ?? supplyC
      const ret = r.returnC ?? sup
      const branch = rampTemps(
        track(
          [
            [x - 0.1, ys, hS],
            [x - 0.1, ys, faceZ],
            [x - 0.1, far, faceZ],
            [x + 0.1, far, faceZ],
            [x + 0.1, yr, faceZ],
            [x + 0.1, yr, hR],
          ],
          fillNear(header, [x - 0.1, ys, hS]),
          sup,
        ),
        1,
        4,
        sup,
        ret,
      )
      const [supplyPart, returnPart] = splitTrack(branch, 2)
      addPipes(`rack:${r.placementId}`, supplyPart, returnPart, RADIUS.branch, BEND.branch)
      circuits.push({
        id: `rack:${r.placementId}`,
        tier: 'rack',
        ...rounded(branch, BEND.branch),
        speed: particleSpeed(r.flowLps ?? 0, meanRackFlow),
        count: particleCount(r.flowShare),
      })
    }
    return header.fills.at(-1)!
  }
}

/** Scales every fill so the last drop to arrive (back at the plant) reads 1. */
function normalizeFills(pipes: PipeRun[], circuits: Circuit[]): Circuit[] {
  const max = Math.max(...pipes.flatMap((p) => p.fills), ...circuits.flatMap((c) => c.fills))
  const norm = (f: number) => (max > 0 ? clamp(f / max, 0, 1) : 1)
  for (const p of pipes) p.fills = p.fills.map(norm)
  for (const c of circuits) c.fills = c.fills.map(norm)
  return circuits
}

// ---------- air ----------

/** Airflow through a rack in m³/s: Q_air / (ρ·cp·ΔT); null when the air temperatures are unknown. */
function rackAirflow(r: RackResult): number | null {
  if (r.airInletC === null || r.airOutletC === null) return null
  const dT = r.airOutletC - r.airInletC
  return dT > 0 ? r.airW / (AIR_RHO_CP * dT) : null
}

/**
 * Air paths: from the serving CRAH's discharge along the cold aisle, through the rack front to rear,
 * up the hot aisle and back along the ceiling to the CRAH's top return. Density and speed scale with
 * each rack's computed airflow relative to the hall mean.
 */
export function airNetwork(plan: Plan, evaluation: Evaluation): AirNetwork {
  const racks = evaluation.racks.filter((r) => r.airW > 0 && rackAirflow(r) !== null)
  const flows = racks.map((r) => rackAirflow(r)!)
  const meanFlow = flows.reduce((s, f) => s + f, 0) / Math.max(1, flows.length)
  const scale: TempScale =
    racks.length > 0
      ? { lo: Math.min(...racks.map((r) => r.airInletC!)), hi: Math.max(...racks.map((r) => r.airOutletC!)) }
      : { lo: 0, hi: 0 }
  const ceilingY = plan.hall.ceilingM - 0.6
  const circuits: Circuit[] = []
  racks.forEach((r, i) => {
    const row = plan.hall.rows.find((w) => w.id === r.rowId)
    const crah = row ? servingPosition(plan, evaluation, 'crah', r.rowId) : null
    if (!row || !crah) return
    const { x, h } = rackGeometry(plan, r)
    const { rearZ, frontZ, dir } = rowFaces(row)
    const coldZ = frontZ - dir * 0.6
    const hotZ = rearZ + dir * 0.5
    const side = x >= crah.x ? 1 : -1
    const midY = h * 0.5
    const pts: Vec3[] = [
      [crah.x + side * 0.5, 0.3, crah.z],
      [crah.x + side * 1.2, 0.3, coldZ],
      [x, 0.3, coldZ],
      [x, midY, coldZ],
      [x, midY, hotZ],
      [x, ceilingY, hotZ],
      [crah.x + side * 1.2, ceilingY, hotZ],
      [crah.x + side * 0.4, ceilingY, crah.z],
      [crah.x, CRAH_RETURN_Y, crah.z],
    ]
    const ratio = flows[i]! / meanFlow
    const path = rounded(rampTemps(track(pts, 0, r.airInletC!), 3, 4, r.airInletC!, r.airOutletC!), BEND.header)
    circuits.push({
      id: `air:${r.placementId}`,
      tier: 'air',
      ...path,
      speed: clamp(AIR_DESIGN_MPS * ratio, AIR_MIN_MPS, AIR_MAX_MPS),
      count: Math.max(1, Math.round(AIR_PARTICLES_PER_RACK * ratio)),
    })
  })
  return { circuits, scale }
}
