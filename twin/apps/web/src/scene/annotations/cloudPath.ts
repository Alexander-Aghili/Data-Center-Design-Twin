import type { Annotation } from '@twin/schema'
import { Vector3, type Box3, type Camera } from 'three'

/** A point in overlay pixels: x right, y down. */
export type Pt = [number, number]
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Viewport {
  width: number
  height: number
}

/** Clearance between the objects' silhouette and the cloud's chord line. */
export const CLOUD_OFFSET_PX = 10
/** Nominal bump radius; the perimeter is split into arcs of about twice this length. */
export const CLOUD_ARC_PX = 8
/**
 * Angle each bump sweeps. Less than a half circle, so neighbouring bumps meet in a small inward
 * cusp the way a drafting pen leaves them, instead of the tangent scallops of true semicircles.
 */
const BUMP_SWEEP_RAD = (160 * Math.PI) / 180
/** How far a bump stands proud of its chord. */
const BUMP_RISE_PX = CLOUD_ARC_PX * (1 - Math.cos(BUMP_SWEEP_RAD / 2)) / Math.sin(BUMP_SWEEP_RAD / 2)
/** Vertices of the polygon a hull is grown by (a 16-gon reads as round at a 10 px offset). */
const OFFSET_SEGMENTS = 16

// Tag geometry, matching the mockup: a 22 × 19 px triangle, label 17 px to its side.
const TAG_HALF_W = 11
const TAG_UP = 10
const TAG_DOWN = 9
const LABEL_GAP = 17
const LABEL_LINE_PX = 14
/** Average advance of the 12 px semi-bold label at the condensed label width (measured in Chromium: 4.4 px), with margin. */
const LABEL_CHAR_PX = 5
const LABEL_MAX_CHARS = 32
const LABEL_MAX_LINES = 3
/** From the cloud's edge to the tag's center. */
const LEADER_PX = 64
const EDGE_MARGIN_PX = 6

/** Candidate leader directions in order of preference: right first (where the mockup puts it), then the diagonals, left, above, below. */
const DIRECTIONS: Pt[] = [0, -30, 30, 180, -150, 150, -90, 90].map((deg) => {
  const a = (deg * Math.PI) / 180
  return [Math.cos(a), Math.sin(a)]
})

const corner = new Vector3()

/**
 * The 8 corners of a world-space box in overlay pixels. Corners behind the camera or past its far
 * plane are dropped, so a box entirely behind the camera projects to nothing.
 */
export function projectBox(box: Box3, camera: Camera, width: number, height: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    corner.project(camera)
    if (corner.z <= -1 || corner.z >= 1) continue
    out.push([((corner.x + 1) / 2) * width, ((1 - corner.y) / 2) * height])
  }
  return out
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Convex hull (monotone chain), wound clockwise on screen so cloud bumps sweep outward. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const chain = (list: Pt[]) => {
    const out: Pt[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  // With y pointing down, keeping right turns of the screen walks the hull clockwise.
  return [...chain(pts), ...chain([...pts].reverse())]
}

/** The hull grown outward by `d` pixels with rounded corners (Minkowski sum with a small polygon). */
export function offsetHull(hull: Pt[], d: number): Pt[] {
  // Circumradius chosen so the polygon's flat sides sit exactly `d` out.
  const r = d / Math.cos(Math.PI / OFFSET_SEGMENTS)
  const ring: Pt[] = []
  for (const [x, y] of hull) {
    for (let k = 0; k < OFFSET_SEGMENTS; k++) {
      const a = (2 * Math.PI * k) / OFFSET_SEGMENTS
      ring.push([x + r * Math.cos(a), y + r * Math.sin(a)])
    }
  }
  return convexHull(ring)
}

const fmt = (n: number) => n.toFixed(1)

/**
 * A closed revision-cloud path around a clockwise polygon: the perimeter is cut into equal
 * stretches of about 2r and each stretch becomes one outward arc.
 */
export function cloudPath(poly: Pt[], r: number): { d: string; arcs: number } {
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }
  })
  const total = edges.reduce((s, e) => s + e.len, 0)
  const arcs = Math.max(3, Math.round(total / (2 * r)))
  const step = total / arcs
  const points: Pt[] = []
  let edge = 0
  let walked = 0
  for (let k = 0; k < arcs; k++) {
    const at = k * step
    while (edge < edges.length - 1 && walked + edges[edge].len < at) walked += edges[edge++].len
    const { p, q, len } = edges[edge]
    const t = len > 0 ? (at - walked) / len : 0
    points.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
  }
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`
  for (let k = 0; k < arcs; k++) {
    const a = points[k]
    const b = points[(k + 1) % arcs]
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * Math.sin(BUMP_SWEEP_RAD / 2))
    d += ` A${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(b[0])} ${fmt(b[1])}`
  }
  return { d: `${d} Z`, arcs }
}

/** Word-wraps on ordinary spaces only, so number–unit pairs joined by a no-break space stay together. */
function wrapLabel(label: string): string[] {
  const lines: string[] = []
  for (const word of label.split(' ').filter(Boolean)) {
    const last = lines[lines.length - 1]
    if (last !== undefined && last.length + 1 + word.length <= LABEL_MAX_CHARS) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  if (lines.length <= LABEL_MAX_LINES) return lines
  const kept = lines.slice(0, LABEL_MAX_LINES)
  kept[LABEL_MAX_LINES - 1] = `${kept[LABEL_MAX_LINES - 1].slice(0, LABEL_MAX_CHARS - 1)}…`
  return kept
}

function bbox(poly: Pt[]): Rect {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function union(a: Rect, b: Rect, pad: number): Rect {
  const x = Math.min(a.x, b.x) - pad
  const y = Math.min(a.y, b.y) - pad
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) + pad - x, h: Math.max(a.y + a.h, b.y + b.h) + pad - y }
}

/** Where a ray from `from` along `u` leaves the convex polygon. */
function exitPoint(poly: Pt[], from: Pt, u: Pt): Pt {
  let best = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const e: Pt = [b[0] - a[0], b[1] - a[1]]
    const denom = u[0] * e[1] - u[1] * e[0]
    if (Math.abs(denom) < 1e-9) continue
    const w: Pt = [a[0] - from[0], a[1] - from[1]]
    const t = (w[0] * e[1] - w[1] * e[0]) / denom
    const s = (w[0] * u[1] - w[1] * u[0]) / denom
    if (t > best && s >= -1e-9 && s <= 1 + 1e-9) best = t
  }
  return [from[0] + u[0] * best, from[1] + u[1] * best]
}

export interface TagPlacement {
  tag: number
  /** Center of the triangle. */
  at: Pt
  /** From just outside the cloud's bumps to just short of the triangle. */
  leader: [Pt, Pt]
  /** Label side: `start` reads rightward from the tag, `end` sits to its left. */
  align: 'start' | 'end'
  lines: string[]
  /** First baseline of the label. */
  labelAt: Pt
  /** Triangle plus label, padded; used to keep tags apart. */
  bounds: Rect
  /** Index of the chosen direction, fed back next frame so tags don't hop. */
  choice: number
}

export interface CloudShape {
  tag: number
  label: string
  /** Clockwise cloud polygon (the grown hull). */
  hull: Pt[]
}

/**
 * Places each cloud's tag in the clearest spot around it: inside the viewport, off every other tag,
 * and over as little cloud as possible. Tags are placed in tag order; `previous` keeps a tag on the
 * side it used last frame unless that side has become blocked.
 */
export function placeTags(clouds: CloudShape[], view: Viewport, previous?: ReadonlyMap<number, number>): TagPlacement[] {
  const ordered = [...clouds].sort((a, b) => a.tag - b.tag)
  const cloudBoxes = ordered.map((c) => bbox(c.hull))
  const placed: TagPlacement[] = []
  for (const cloud of ordered) {
    const lines = wrapLabel(cloud.label)
    const labelW = Math.max(...lines.map((l) => l.length)) * LABEL_CHAR_PX
    const labelH = lines.length * LABEL_LINE_PX
    const center: Pt = [
      cloud.hull.reduce((s, p) => s + p[0], 0) / cloud.hull.length,
      cloud.hull.reduce((s, p) => s + p[1], 0) / cloud.hull.length,
    ]
    let best: { score: number; placement: TagPlacement } | null = null
    for (const [choice, u] of DIRECTIONS.entries()) {
      const edge = exitPoint(cloud.hull, center, u)
      const at: Pt = [edge[0] + u[0] * LEADER_PX, edge[1] + u[1] * LEADER_PX]
      const align = u[0] < -1e-6 ? 'end' : 'start'
      const firstBaseline = at[1] + 4 - ((lines.length - 1) * LABEL_LINE_PX) / 2
      const labelX = align === 'start' ? at[0] + LABEL_GAP : at[0] - LABEL_GAP
      const triangle: Rect = { x: at[0] - TAG_HALF_W, y: at[1] - TAG_UP, w: 2 * TAG_HALF_W, h: TAG_UP + TAG_DOWN }
      const text: Rect = { x: align === 'start' ? labelX : labelX - labelW, y: firstBaseline - 11, w: labelW, h: labelH }
      const bounds = union(triangle, text, 4)
      const outside =
        bounds.x < EDGE_MARGIN_PX ||
        bounds.y < EDGE_MARGIN_PX ||
        bounds.x + bounds.w > view.width - EDGE_MARGIN_PX ||
        bounds.y + bounds.h > view.height - EDGE_MARGIN_PX
      let score = choice * 10 + (outside ? 1e6 : 0)
      for (const other of placed) if (overlapArea(bounds, other.bounds) > 0) score += 1e5
      for (const box of cloudBoxes) score += overlapArea(bounds, box)
      if (previous?.get(cloud.tag) === choice) score -= 25
      if (best && best.score <= score) continue
      const rise = BUMP_RISE_PX + 2
      best = {
        score,
        placement: {
          tag: cloud.tag,
          at,
          leader: [
            [edge[0] + u[0] * rise, edge[1] + u[1] * rise],
            [at[0] - u[0] * (TAG_HALF_W + 2), at[1] - u[1] * (TAG_HALF_W + 2)],
          ],
          align,
          lines,
          labelAt: [labelX, firstBaseline],
          bounds,
          choice,
        },
      }
    }
    if (best) placed.push(best.placement)
  }
  return placed
}

export interface CloudLayout {
  tag: number
  label: string
  severity: Annotation['severity']
  d: string
  arcs: number
  marker: TagPlacement
}

/**
 * Screen layout for every annotation whose objects are on screen. `project` returns an object's
 * projected box corners, or null when the object is no longer rendered; an annotation keeps the
 * objects that remain and disappears when none do.
 */
export function layoutClouds(
  annotations: Annotation[],
  project: (objectId: string) => Pt[] | null,
  view: Viewport,
  previous?: ReadonlyMap<number, number>,
): CloudLayout[] {
  const shapes: (CloudShape & { severity: Annotation['severity']; d: string; arcs: number })[] = []
  for (const annotation of [...annotations].sort((a, b) => a.tag - b.tag)) {
    const corners = annotation.objectIds.flatMap((id) => project(id) ?? [])
    if (corners.length === 0) continue
    const hull = offsetHull(convexHull(corners), CLOUD_OFFSET_PX)
    const box = bbox(hull)
    if (box.x > view.width || box.y > view.height || box.x + box.w < 0 || box.y + box.h < 0) continue
    const { tag, label, severity } = annotation
    shapes.push({ tag, label, severity, hull, ...cloudPath(hull, CLOUD_ARC_PX) })
  }
  const markers = new Map(placeTags(shapes, view, previous).map((m) => [m.tag, m]))
  return shapes.flatMap(({ tag, label, severity, d, arcs }) => {
    const marker = markers.get(tag)
    return marker ? [{ tag, label, severity, d, arcs, marker }] : []
  })
}
