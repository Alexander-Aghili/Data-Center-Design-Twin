import { RowSchema, type Check, type Evaluation, type Plan, type ShotId } from '@twin/schema'
import { Box3, MathUtils, Vector3 } from 'three'
import { hallBounds, objectIdForPlacement } from '../geometry'

type Vec3 = [number, number, number]

export interface Shot {
  position: Vec3
  target: Vec3
  /** Vertical field of view in degrees. */
  fov: number
}

type WorldBox = (id: string) => Box3 | null

export interface ShotContext {
  plan: Plan
  evaluation: Pick<Evaluation, 'checks' | 'racks'> | null
  /** What the shot centers on: a placement id, a rack, tray or gpu object id, or a row id. */
  focusId: string | null
  worldBox: WorldBox
  /** Viewport width / height; the scene region is landscape, 3:2 when unknown. */
  aspect?: number
}

// EIA-310 rack unit (44.45 mm). Without a rendered model a rack is 42U tall and a tray is 1U, as in geometry.ts.
const RACK_UNIT_M = 0.04445
const FALLBACK_RACK_HEIGHT_M = 42 * RACK_UNIT_M
const SLOT_PITCH_M = RowSchema.shape.slotPitchM.value
const RACK_DEPTH_M = RowSchema.shape.rackDepthM.value
const DEFAULT_ASPECT = 3 / 2
// Trays are probed by index until one is missing; no rack model holds more than this many.
const MAX_TRAYS = 128
const GPUS_PER_TRAY = 4

/**
 * How each shot looks at its subject. Site and hall share one south-east bearing; row and closer shots swing to the
 * focus rack's front (doors and trays open there), each a little more head-on and steeper, so a zoom from site to
 * gpu reads as one crane move: descend, arc round to the rack face, then look down onto the board.
 * `offsetDeg` is measured from the rack front toward the east; `margin` pads the subject box.
 */
const STYLE: Record<ShotId, { elevationDeg: number; offsetDeg: number; fov: number; margin: number }> = {
  // The site keeps a ring of yard and feeds around the building, so it reads wider than the hall.
  site: { elevationDeg: 32, offsetDeg: 50, fov: 34, margin: 1.6 },
  hall: { elevationDeg: 56, offsetDeg: 58, fov: 36, margin: 1.12 },
  row: { elevationDeg: 32, offsetDeg: 60, fov: 38, margin: 1.1 },
  rack: { elevationDeg: 26, offsetDeg: 22, fov: 34, margin: 1.25 },
  tray: { elevationDeg: 40, offsetDeg: 14, fov: 32, margin: 1.3 },
  // Looks down onto the slid-out tray: board, GPU packages, cold plates, hoses and the quick disconnects at its rear.
  gpu: { elevationDeg: 56, offsetDeg: 10, fov: 30, margin: 1.12 },
}

interface Focus {
  placementId: string
  tray: number | null
  gpu: number | null
}

const FOCUS_PATTERN = /^(?:rack:)?([^:]+)(?::tray:(\d+)(?::gpu:(\d+))?)?$/

function parseFocus(id: string): Focus | null {
  const m = FOCUS_PATTERN.exec(id)
  if (!m) return null
  return { placementId: m[1]!, tray: m[2] === undefined ? null : Number(m[2]), gpu: m[3] === undefined ? null : Number(m[3]) }
}

function formatFocus(f: Focus): string {
  const tray = f.tray === null ? '' : `:tray:${f.tray}${f.gpu === null ? '' : `:gpu:${f.gpu}`}`
  return `${objectIdForPlacement(f.placementId)}${tray}`
}

/** Placement id of the rack a focus id points into ("rack:R3-07:tray:2" gives "R3-07"). */
export function focusRack(focusId: string | null): string | null {
  return focusId === null ? null : (parseFocus(focusId)?.placementId ?? null)
}

const STATUS_RANK: Partial<Record<Check['status'], number>> = { fail: 0, warn: 1 }

/** The hottest rack of the worst failing (else warning) check whose subject includes racks. */
function worstCheckRack(plan: Plan, evaluation: ShotContext['evaluation']): string | null {
  if (!evaluation) return null
  const placed = new Set(plan.placements.map((p) => p.id))
  const heat = new Map(evaluation.racks.map((r) => [r.placementId, r.heatW]))
  const ranked = evaluation.checks
    .filter((c) => STATUS_RANK[c.status] !== undefined)
    .sort((a, b) => STATUS_RANK[a.status]! - STATUS_RANK[b.status]! || (b.utilization ?? 0) - (a.utilization ?? 0))
  for (const c of ranked) {
    const racks = c.subject.objectIds.map((id) => focusRack(id)).filter((id): id is string => id !== null && placed.has(id))
    const hottest = racks.reduce<string | null>((best, id) => (best === null || (heat.get(id) ?? 0) > (heat.get(best) ?? 0) ? id : best), null)
    if (hottest) return hottest
  }
  return null
}

/** The placed rack whose slot is nearest the hall center, so close shots never frame empty floor. */
function centralRack(plan: Plan): string | null {
  const cx = plan.hall.widthM / 2
  const cz = plan.hall.depthM / 2
  let best: { id: string; d: number } | null = null
  for (const p of plan.placements) {
    const row = plan.hall.rows.find((r) => r.id === p.rowId)
    if (!row) continue
    const d = Math.hypot(row.x + (p.slot + 0.5) * row.slotPitchM - cx, row.z + row.rackDepthM / 2 - cz)
    if (!best || d < best.d) best = { id: p.id, d }
  }
  return best?.id ?? null
}

/**
 * The rack (or tray or gpu inside it) the close shots center on: the focus when it is a rack of this plan, the
 * middle rack of a focused row, else the rack of the worst failing check, else the rack nearest the hall center.
 * Null (an empty hall) means the hall center itself.
 */
export function resolveFocus(ctx: Pick<ShotContext, 'plan' | 'evaluation' | 'focusId'>): string | null {
  const { plan, focusId } = ctx
  if (focusId !== null) {
    const parsed = parseFocus(focusId)
    if (parsed && plan.placements.some((p) => p.id === parsed.placementId)) return formatFocus(parsed)
    const rowId = focusId.replace(/^row:/, '')
    const inRow = plan.placements.filter((p) => p.rowId === rowId).sort((a, b) => a.slot - b.slot)
    const middle = inRow[Math.floor(inRow.length / 2)]
    if (middle) return objectIdForPlacement(middle.id)
  }
  const rack = worstCheckRack(plan, ctx.evaluation) ?? centralRack(plan)
  return rack === null ? null : objectIdForPlacement(rack)
}

interface RackFrame {
  box: Box3
  /** +1 when the rack front faces south (+z), −1 when it faces north. */
  front: 1 | -1
  rowLengthM: number
  rowX: number
  rowZ: number
}

function registered(worldBox: WorldBox, id: string): Box3 | null {
  const box = worldBox(id)
  return box && !box.isEmpty() ? box : null
}

/**
 * The rack's closed box. Its x extent and height come from the rendered model when there is one, its depth from
 * the row, so doors and trays swinging out (which grow the model's box along z) never shift the framing.
 */
function rackFrame(ctx: ShotContext, focus: Focus | null): RackFrame {
  const { plan } = ctx
  const placement = focus && plan.placements.find((p) => p.id === focus.placementId)
  const row = placement && plan.hall.rows.find((r) => r.id === placement.rowId)
  if (!placement || !row) {
    const { widthM, depthM } = plan.hall
    const longest = Math.max(SLOT_PITCH_M, ...plan.hall.rows.map((r) => r.slotCount * r.slotPitchM))
    const box = new Box3(
      new Vector3(widthM / 2 - SLOT_PITCH_M / 2, 0, depthM / 2 - RACK_DEPTH_M / 2),
      new Vector3(widthM / 2 + SLOT_PITCH_M / 2, FALLBACK_RACK_HEIGHT_M, depthM / 2 + RACK_DEPTH_M / 2),
    )
    return { box, front: 1, rowLengthM: longest, rowX: widthM / 2 - longest / 2, rowZ: depthM / 2 - RACK_DEPTH_M / 2 }
  }
  const model = registered(ctx.worldBox, objectIdForPlacement(placement.id))
  const x0 = row.x + placement.slot * row.slotPitchM
  const box = new Box3(
    new Vector3(model?.min.x ?? x0, 0, row.z),
    new Vector3(model?.max.x ?? x0 + row.slotPitchM, model?.max.y ?? FALLBACK_RACK_HEIGHT_M, row.z + row.rackDepthM),
  )
  return { box, front: row.hotAisle === 'south' ? -1 : 1, rowLengthM: row.slotCount * row.slotPitchM, rowX: row.x, rowZ: row.z }
}

/** The focused tray (else the middle one) as rendered, slid out with the rack's openness. */
function focusedTray(ctx: Pick<ShotContext, 'worldBox'>, focus: Focus | null): { index: number; box: Box3 } | null {
  if (!focus) return null
  const trays: Box3[] = []
  for (let i = 0; i < MAX_TRAYS; i++) {
    const box = registered(ctx.worldBox, `${objectIdForPlacement(focus.placementId)}:tray:${i}`)
    if (!box) break
    trays.push(box)
  }
  const index = focus.tray !== null && focus.tray < trays.length ? focus.tray : Math.floor(trays.length / 2)
  const box = trays[index]
  return box ? { index, box } : null
}

/** A 1U slab at the rack's mid-height, for racks rendered without trays. */
function slab(rack: Box3): Box3 {
  const midY = rack.max.y / 2
  return new Box3(new Vector3(rack.min.x, midY - RACK_UNIT_M / 2, rack.min.z), new Vector3(rack.max.x, midY + RACK_UNIT_M / 2, rack.max.z))
}

/** Index of the tray the tray and gpu shots of `focusId` look at, or null when its rack has no rendered trays. */
export function focusTray(focusId: string, worldBox: WorldBox): number | null {
  const focus = parseFocus(focusId)
  return focusedTray({ worldBox }, focus)?.index ?? null
}

function trayBox(ctx: ShotContext, focus: Focus | null, rack: Box3): Box3 {
  return focusedTray(ctx, focus)?.box.clone() ?? slab(rack)
}

/**
 * The focused GPU (else the tray's first) as rendered. Otherwise a quarter of the tray in width and depth: an NVL72
 * compute tray carries 4 of the rack's 72 GPUs (18 trays).
 */
function gpuBox(ctx: ShotContext, focus: Focus | null, rack: Box3): Box3 {
  const tray = focusedTray(ctx, focus)
  const gpuId = focus && tray && `${objectIdForPlacement(focus.placementId)}:tray:${tray.index}:gpu:${focus.gpu ?? 0}`
  const gpu = gpuId ? registered(ctx.worldBox, gpuId) : null
  if (gpu) return gpu.clone()
  const base = tray?.box ?? slab(rack)
  const size = base.getSize(new Vector3())
  return new Box3().setFromCenterAndSize(base.getCenter(new Vector3()), new Vector3(size.x / GPUS_PER_TRAY, size.y, size.z / GPUS_PER_TRAY))
}

/**
 * What the gpu shot frames: the focused GPU with its neighbours, cold-plate hoses and the quick disconnects at the
 * tray's rear. That is the tray's full width, from the GPU's front edge back to the tray's rear, and from the tray
 * floor up to the GPU's top; the drive cage and bezel at the tray front stay out of frame.
 */
function gpuSubject(ctx: ShotContext, focus: Focus | null, rack: RackFrame): Box3 {
  const gpu = gpuBox(ctx, focus, rack.box)
  const tray = focusedTray(ctx, focus)?.box
  if (!tray) return gpu
  const [z0, z1] = rack.front > 0 ? [tray.min.z, gpu.max.z] : [gpu.min.z, tray.max.z]
  return new Box3(new Vector3(tray.min.x, tray.min.y, z0), new Vector3(tray.max.x, Math.max(gpu.max.y, tray.min.y), z1))
}

function siteBox(ctx: ShotContext): Box3 {
  const model = registered(ctx.worldBox, 'site')
  if (model) return model.clone()
  const { min, max } = hallBounds(ctx.plan)
  const box = new Box3(new Vector3(...min), new Vector3(...max))
  for (const p of ctx.plan.hall.positions) box.expandByPoint(new Vector3(p.x, 0, p.z))
  return box
}

// Hall positions that stand beside the rows they serve; the plant yard and electrical room are framed by the site shot.
const ROW_SIDE_POSITIONS = new Set(['crah', 'cdu', 'leaf'])

/**
 * The populated part of the hall, rack-high: every row with racks placed, widened in x to the CRAH, CDU and leaf
 * positions serving those rows (their z stays within the rows). Flows and loads live there, so the hall shot frames
 * it rather than the whole floor. Null for an empty hall.
 */
function populatedBox(plan: Plan): Box3 | null {
  const filled = new Set(plan.placements.map((p) => p.rowId))
  const rows = plan.hall.rows.filter((r) => filled.has(r.id))
  if (rows.length === 0) return null
  const beside = plan.hall.positions.filter((p) => ROW_SIDE_POSITIONS.has(p.kind) && p.servesRows.some((id) => filled.has(id)))
  const xs = [...rows.flatMap((r) => [r.x, r.x + r.slotCount * r.slotPitchM]), ...beside.map((p) => p.x)]
  return new Box3(
    new Vector3(Math.min(...xs), 0, Math.min(...rows.map((r) => r.z))),
    new Vector3(Math.max(...xs), FALLBACK_RACK_HEIGHT_M, Math.max(...rows.map((r) => r.z + r.rackDepthM))),
  )
}

function subject(id: ShotId, ctx: ShotContext, focus: Focus | null, rack: RackFrame): Box3 {
  switch (id) {
    case 'site':
      return siteBox(ctx)
    case 'hall': {
      const populated = populatedBox(ctx.plan)
      if (populated) return populated
      const { min, max } = hallBounds(ctx.plan)
      return new Box3(new Vector3(...min), new Vector3(...max))
    }
    case 'row':
      return new Box3(
        new Vector3(rack.rowX, 0, rack.rowZ),
        new Vector3(rack.rowX + rack.rowLengthM, rack.box.max.y, rack.rowZ + RACK_DEPTH_M),
      )
    case 'rack':
      return rack.box
    case 'tray':
      return trayBox(ctx, focus, rack.box)
    case 'gpu':
      return gpuSubject(ctx, focus, rack)
  }
}

// Scratch vectors for `frame`, which runs on every re-resolve during a move.
const scratch = { center: new Vector3(), half: new Vector3(), back: new Vector3(), right: new Vector3(), up: new Vector3(), corner: new Vector3() }
const Y_UP = new Vector3(0, 1, 0)

/** Camera on a bearing that keeps every corner of `box` (padded by `margin`) inside the frustum. */
function frame(box: Box3, elevationDeg: number, azimuthDeg: number, fov: number, aspect: number, margin: number): Shot {
  const { center, half, back, right, up, corner } = scratch
  box.getCenter(center)
  box.getSize(half).multiplyScalar(margin / 2)
  const el = MathUtils.degToRad(elevationDeg)
  const az = MathUtils.degToRad(azimuthDeg)
  back.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
  right.crossVectors(Y_UP, back).normalize()
  up.crossVectors(back, right)
  const tanV = Math.tan(MathUtils.degToRad(fov) / 2)
  const tanH = tanV * aspect
  let distance = 0
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        corner.set(sx * half.x, sy * half.y, sz * half.z)
        const depth = corner.dot(back)
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(up)) / tanV)
      }
  const target = center.toArray()
  return { position: center.addScaledVector(back, distance).toArray(), target, fov }
}

/** Camera position, target and field of view for a shot of the current plan. */
export function shotFor(id: ShotId, ctx: ShotContext): Shot {
  const focusId = resolveFocus(ctx)
  const focus = focusId === null ? null : parseFocus(focusId)
  const rack = rackFrame(ctx, focus)
  const style = STYLE[id]
  const wide = id === 'site' || id === 'hall'
  const azimuth = wide ? style.offsetDeg : rack.front > 0 ? style.offsetDeg : 180 - style.offsetDeg
  return frame(subject(id, ctx, focus, rack), style.elevationDeg, azimuth, style.fov, ctx.aspect ?? DEFAULT_ASPECT, style.margin)
}
