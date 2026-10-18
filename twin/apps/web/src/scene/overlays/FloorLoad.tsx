import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { Evaluation, Plan, Status } from '@twin/schema'
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Color, SRGBColorSpace, type Mesh } from 'three'
import { useTwinStore } from '../../state/store'
import { PALETTE } from '../palette'
import { useSceneRegistry } from '../registry'

/** Top of the load color scale: 120% of the rating. Anything heavier reads as the same full red. */
export const LOAD_SCALE_MAX = 1.2

const SCALE_LOW = new Color(PALETTE.floor)
const SCALE_HIGH = new Color(PALETTE.heat)
const mixed = new Color()

/**
 * Sequential load color, one hue from the bare floor (0%) to heat red (120% and over). Mixed in sRGB rather than
 * three's linear working space, which would keep the middle of the scale nearly as pale as the floor.
 * Null (unknown) is dark clay.
 */
export function utilizationColor(utilization: number | null): string {
  if (utilization === null) return PALETTE.clay.dark
  const t = Math.min(1, Math.max(0, utilization / LOAD_SCALE_MAX))
  const low = SCALE_LOW.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace)
  const high = SCALE_HIGH.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace)
  mixed.setRGB(low.r + (high.r - low.r) * t, low.g + (high.g - low.g) * t, low.b + (high.b - low.b) * t, SRGBColorSpace)
  return `#${mixed.getHexString().toUpperCase()}`
}

export const STATUS_GLYPH: Record<Status, string> = { pass: '✓', warn: '▲', fail: '✕', unknown: '?' }

/** "112 %" with a non-breaking space; "—" when unknown. */
export function percent(utilization: number | null): string {
  return utilization === null ? '—' : `${Math.round(utilization * 100)} %`
}

export interface BayOverlay {
  bayId: string
  x: number
  z: number
  w: number
  d: number
  /** Load over rating; null when a weight in the bay is unknown. */
  utilization: number | null
  status: Status
}

/** One entry per floor bay: the engine's bay load, with status (and unknown weights) from its `layout.floorBay` check. */
export function bayOverlays(plan: Plan, evaluation: Evaluation): BayOverlay[] {
  const loads = new Map(evaluation.bays.map((b) => [b.bayId, b]))
  const checks = new Map(evaluation.checks.filter((c) => c.kind === 'layout.floorBay').map((c) => [c.subject.id, c]))
  return plan.hall.bays.map((bay) => {
    const check = checks.get(bay.id)
    return {
      bayId: bay.id,
      x: bay.x,
      z: bay.z,
      w: bay.w,
      d: bay.d,
      utilization: check ? check.utilization : (loads.get(bay.id)?.utilization ?? 0),
      status: check?.status ?? 'pass',
    }
  })
}

// Gap between neighbouring tiles so the bay grid reads: the 2 px surface gap between fills, at plan scale.
const TILE_GAP_M = 0.06
// Lifts the tiles off the floor plane; polygon offset does the rest against z-fighting.
const TILE_Y_M = 0.004

function BayTile({ bay }: { bay: BayOverlay }) {
  const ref = useRef<Mesh>(null)
  const register = useSceneRegistry((s) => s.register)
  useEffect(() => (ref.current ? register(`bay:${bay.bayId}`, 'bay', ref.current) : undefined), [register, bay.bayId])
  return (
    <mesh ref={ref} position={[bay.x + bay.w / 2, TILE_Y_M, bay.z + bay.d / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[bay.w - TILE_GAP_M, bay.d - TILE_GAP_M]} />
      <meshBasicMaterial color={utilizationColor(bay.utilization)} toneMapped={false} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  )
}

const tagStyle: CSSProperties = {
  display: 'inline-block',
  font: '600 var(--text-xs)/1 var(--font)',
  fontStretch: 'var(--stretch-label)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  padding: '3px 5px',
  background: 'var(--panel)',
  border: 'var(--rule)',
  borderRadius: 'var(--radius)',
  color: 'var(--ink)',
  userSelect: 'none',
}

/**
 * Lets pointer input reach the canvas through labels. drei's `pointerEvents` prop only applies in `transform` mode;
 * without this the full-canvas legend would swallow every click and drag.
 */
const PASS_THROUGH: CSSProperties = { pointerEvents: 'none' }

/** drei's Html remounts (and drops its content) when the canvas event target attaches, so labels wait for it. */
function useHtmlReady(): boolean {
  return Boolean(useThree((s) => s.events.connected))
}

const GLYPH_COLOR: Record<Status, string> = { pass: 'var(--ok)', warn: 'var(--warning)', fail: 'var(--heat)', unknown: 'var(--graphite)' }

/** A small tag pinned to a point in the hall. With a status it leads with the status glyph: shape plus text, never color alone. */
export function SceneTag({ position, status, children }: { position: [number, number, number]; status?: Status; children: ReactNode }) {
  if (!useHtmlReady()) return null
  return (
    <Html position={position} center zIndexRange={[20, 10]} style={PASS_THROUGH}>
      <span style={tagStyle}>
        {status ? (
          <span aria-hidden style={{ color: GLYPH_COLOR[status], marginRight: 4 }}>
            {STATUS_GLYPH[status]}
          </span>
        ) : null}
        {children}
      </span>
    </Html>
  )
}

const legendStyle: CSSProperties = {
  position: 'absolute',
  // The shell can lift the legend clear of its own chrome at the bottom of the scene (the rack bar).
  left: 'var(--scene-legend-left, var(--space-4))',
  bottom: 'var(--scene-legend-bottom, var(--space-4))',
  width: 248,
  margin: 0,
  padding: 'var(--space-2) var(--space-3) var(--space-3)',
  background: 'var(--panel)',
  border: 'var(--rule)',
  borderRadius: 'var(--radius)',
  color: 'var(--ink)',
  font: '400 var(--text-sm)/1.4 var(--font)',
  fontVariantNumeric: 'tabular-nums',
}

const legendTitleStyle: CSSProperties = {
  font: '600 var(--text-sm)/1.2 var(--font)',
  fontStretch: 'var(--stretch-label)',
  marginBottom: 'var(--space-2)',
}

// With `fullscreen`, drei offsets the wrapper by half the canvas; anchoring it at the centre makes it cover the canvas.
const centerOfCanvas = (_: unknown, __: unknown, size: { width: number; height: number }) => [size.width / 2, size.height / 2]

/** Legend card in the scene's bottom-left corner, laid over the canvas. */
export function OverlayLegend({ title, children }: { title: string; children: ReactNode }) {
  if (!useHtmlReady()) return null
  return (
    <Html fullscreen calculatePosition={centerOfCanvas} zIndexRange={[30, 20]} style={PASS_THROUGH}>
      <figure aria-label={title} style={legendStyle}>
        <figcaption style={legendTitleStyle}>{title}</figcaption>
        {children}
      </figure>
    </Html>
  )
}

/** One legend line: a swatch or glyph, a label and a right-aligned count. */
export function LegendRow({ mark, label, value }: { mark: ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr auto', alignItems: 'center', columnGap: 'var(--space-2)' }}>
      <span aria-hidden style={{ display: 'flex', justifyContent: 'center' }}>
        {mark}
      </span>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

const SCALE_TICKS = [0, 0.5, 1]
const GRADIENT_STOPS = 6

/** Gradient bar for the 0–120% load scale; the line at 100% marks the rating. */
export function LoadScale() {
  const stops = Array.from({ length: GRADIENT_STOPS + 1 }, (_, i) => {
    const t = i / GRADIENT_STOPS
    return `${utilizationColor(t * LOAD_SCALE_MAX)} ${(t * 100).toFixed(1)}%`
  })
  const at = (u: number) => `${(u / LOAD_SCALE_MAX) * 100}%`
  return (
    <div>
      <div style={{ position: 'relative', height: 10, borderRadius: 'var(--radius)', background: `linear-gradient(to right, ${stops.join(', ')})` }}>
        <span style={{ position: 'absolute', left: at(1), top: -3, bottom: -3, borderLeft: '1px solid var(--ink)' }} />
      </div>
      <div style={{ position: 'relative', height: 18, fontSize: 'var(--text-xs)', color: 'var(--graphite)' }}>
        {SCALE_TICKS.map((u) => (
          <span key={u} style={{ position: 'absolute', top: 3, left: at(u), transform: u === 0 ? 'none' : 'translateX(-50%)' }}>
            {percent(u)}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--graphite)' }}>
        The line marks the rating; {percent(LOAD_SCALE_MAX)} and over is full red.
      </div>
    </div>
  )
}

/** Legend lines counting fail, warn and unknown subjects, each led by its status glyph. */
export function StatusCounts({ statuses, noun }: { statuses: Status[]; noun: { fail: string; warn: string; unknown: string } }) {
  const count = (s: Status) => statuses.filter((x) => x === s).length
  const rows = (['fail', 'warn', 'unknown'] as const).filter((s) => s !== 'unknown' || count(s) > 0)
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      {rows.map((s) => (
        <LegendRow key={s} mark={<span style={{ color: GLYPH_COLOR[s] }}>{STATUS_GLYPH[s]}</span>} label={noun[s]} value={String(count(s))} />
      ))}
    </div>
  )
}

/** Floor-load heatmap: every bay tinted by its load against its rating, with a tag on bays that warn, fail or are unknown. */
export function FloorLoad() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const bays = useMemo(() => (plan && evaluation ? bayOverlays(plan, evaluation) : []), [plan, evaluation])
  if (bays.length === 0) return null
  return (
    <group name="overlay:floorLoad">
      {bays.map((bay) => (
        <BayTile key={bay.bayId} bay={bay} />
      ))}
      {bays
        .filter((bay) => bay.status !== 'pass')
        .map((bay) => (
          <SceneTag key={bay.bayId} position={[bay.x + bay.w / 2, 0.05, bay.z + bay.d / 2]} status={bay.status}>
            {bay.status === 'unknown' ? 'unknown' : percent(bay.utilization)}
          </SceneTag>
        ))}
      <OverlayLegend title="Floor load against bay rating">
        <LoadScale />
        <StatusCounts
          statuses={bays.map((b) => b.status)}
          noun={{ fail: 'Bays over rating', warn: 'Bays near rating', unknown: 'Bays with unknown weight' }}
        />
      </OverlayLegend>
    </group>
  )
}
