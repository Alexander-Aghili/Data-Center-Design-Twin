import type { Severity } from '@twin/schema'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTwinStore } from '../../state/store'
import { useSceneRegistry } from '../registry'
import { useCameraBridge, type CloudView } from './cameraBridge'
import { layoutClouds, projectBox, SEVERITY_SHAPE_PX, tagTrianglePath, type CloudLayout } from './cloudPath'

const FRAME_MS = 1000 / 30

const INK: Record<Severity, string> = {
  problem: 'var(--heat)',
  warning: 'var(--warning)',
  info: 'var(--graphite)',
}

const SEVERITY_WORD: Record<Severity, string> = { problem: 'problem', warning: 'warning', info: 'information' }

/** Severity by shape as well as ink, in StatusMark's 12 px geometry: ✕ problem, ▲ warning, i information. */
function SeverityShape({ severity }: { severity: Severity }) {
  switch (severity) {
    case 'problem':
      return <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    case 'warning':
      return <path d="M6 1.4L11.2 10.6H0.8Z" fill="currentColor" />
    case 'info':
      return (
        <>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 5.3v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="6" cy="3.5" r="0.9" fill="currentColor" />
        </>
      )
  }
}

const bridgeView = () => useCameraBridge.getState().view

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  pointerEvents: 'none',
}

// One orchestrated moment: the pen draws the cloud, then the leader and tag land. Timings scale
// from --dur, which is 0 under reduced motion.
// The dash runs 10% past the normalized length because browsers approximate arc length, which would leave a gap.
const css = `
.rc-halo, .rc-line { fill: none; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1.1; animation: rc-draw calc(var(--dur) * 3) var(--ease) both; }
.rc-halo { stroke: var(--canvas); stroke-width: 4.5; opacity: 0.8; }
.rc-line { stroke: var(--rc); stroke-width: 1.4; }
.rc-leader { stroke: var(--rc); stroke-width: 1; }
.rc-mark { color: var(--rc); animation: rc-land var(--dur) var(--ease) calc(var(--dur) * 2.5) both; }
.rc-tag { fill: var(--canvas); stroke: var(--rc); stroke-width: 1.5; stroke-linejoin: round; }
.rc-severity-ground { fill: var(--canvas); opacity: 0.8; }
.rc-num, .rc-label { font-family: var(--font); fill: var(--rc); font-variant-numeric: tabular-nums; }
.rc-num { font-size: 10px; font-weight: 700; text-anchor: middle; }
.rc-label { font-size: 12px; font-weight: 600; font-stretch: var(--stretch-label); paint-order: stroke; stroke: var(--canvas); stroke-width: 3px; stroke-linejoin: round; }
@keyframes rc-draw { from { stroke-dashoffset: 1.1; } to { stroke-dashoffset: 0; } }
@keyframes rc-land { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .rc-halo, .rc-line, .rc-mark { animation: none; } }
`

function Cloud({ cloud }: { cloud: CloudLayout }) {
  const { marker, severity } = cloud
  const [x, y] = marker.at
  const [[lx1, ly1], [lx2, ly2]] = marker.leader
  const [sx, sy] = marker.shapeAt
  const [tx, ty] = marker.labelAt
  const half = SEVERITY_SHAPE_PX / 2
  return (
    <g
      style={{ '--rc': INK[severity] } as CSSProperties}
      role="note"
      aria-label={`Revision ${cloud.tag}, ${SEVERITY_WORD[severity]}: ${cloud.label}`}
    >
      <path className="rc-halo" d={cloud.d} pathLength={1} />
      <path className="rc-line" d={cloud.d} pathLength={1} />
      <g className="rc-mark" aria-hidden="true">
        <line className="rc-leader" x1={lx1} y1={ly1} x2={lx2} y2={ly2} />
        <path className="rc-tag" d={tagTrianglePath(x, y)} />
        <text className="rc-num" x={x} y={y + 6}>
          {cloud.tag}
        </text>
        <circle className="rc-severity-ground" cx={sx} cy={sy} r={half + 1.5} />
        <g className="rc-severity" data-severity={severity} transform={`translate(${sx - half} ${sy - half})`}>
          <SeverityShape severity={severity} />
        </g>
        <text className="rc-label" x={tx} y={ty} textAnchor={marker.align}>
          {marker.lines.map((line, i) => (
            <tspan key={i} x={tx} dy={i === 0 ? 0 : 14}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  )
}

/**
 * Revision clouds above the 3D canvas: each annotation's objects are projected to the screen
 * (30 times a second while any annotation is shown), wrapped in a drafting cloud, and tied by a
 * leader to a numbered triangle, a severity shape and the label. The overlay must cover the same
 * box as the canvas; the camera comes from `<CameraBridge />` inside the Canvas. `view` replaces
 * the bridge (tests).
 */
export function RevisionClouds({ view = bridgeView }: { view?: () => CloudView | null }) {
  const annotations = useTwinStore((s) => s.annotations)
  const [clouds, setClouds] = useState<CloudLayout[]>([])
  // Last frame's tag sides, kept across annotation updates so tags don't hop.
  const previous = useRef(new Map<number, number>())

  useEffect(() => {
    if (annotations.length === 0) return
    let request = 0
    let last = Number.NEGATIVE_INFINITY
    let shown = ''
    const tick = (now: number) => {
      request = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      last = now
      const v = view()
      const { worldBox } = useSceneRegistry.getState()
      const next = v
        ? layoutClouds(
            annotations,
            (id) => {
              const box = worldBox(id)
              return box ? projectBox(box, v.camera, v.width, v.height) : null
            },
            v,
            previous.current,
          )
        : []
      previous.current = new Map(next.map((c) => [c.tag, c.marker.choice]))
      const key = JSON.stringify(next)
      if (key === shown) return
      shown = key
      setClouds(next)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [annotations, view])

  return (
    <svg style={overlay} aria-label="Revision clouds" role="group">
      <style>{css}</style>
      {annotations.length === 0
        ? null
        : clouds.map((cloud) => <Cloud key={`${cloud.tag}:${cloud.label}`} cloud={cloud} />)}
    </svg>
  )
}
