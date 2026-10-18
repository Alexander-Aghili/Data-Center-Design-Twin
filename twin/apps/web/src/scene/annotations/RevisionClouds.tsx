import { _roots } from '@react-three/fiber'
import type { Severity } from '@twin/schema'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Camera } from 'three'
import { useTwinStore } from '../../state/store'
import { useSceneRegistry } from '../registry'
import { layoutClouds, projectBox, type CloudLayout } from './cloudPath'

/** The camera to project with and where its canvas sits inside the overlay, in CSS pixels. */
export interface CloudView {
  camera: Camera
  width: number
  height: number
  left: number
  top: number
}

const FRAME_MS = 1000 / 30

const INK: Record<Severity, string> = {
  problem: 'var(--heat)',
  warning: 'var(--warning)',
  info: 'var(--graphite)',
}

/** Finds the three.js canvas that shares the overlay's container and reads its live camera. */
function canvasView(svg: SVGSVGElement): CloudView | null {
  const canvas = svg.parentElement?.querySelector('canvas')
  const root = canvas ? _roots.get(canvas) : undefined
  if (!canvas || !root) return null
  const c = canvas.getBoundingClientRect()
  const o = svg.getBoundingClientRect()
  return { camera: root.store.getState().camera, width: c.width, height: c.height, left: c.left - o.left, top: c.top - o.top }
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  pointerEvents: 'none',
}

// One orchestrated moment: the pen draws the cloud, then the leader and tag land.
// The dash runs 10% past the normalized length because browsers approximate arc length, which would leave a gap.
const css = `
.rc-halo, .rc-line { fill: none; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1.1; animation: rc-draw 720ms var(--ease) both; }
.rc-halo { stroke: var(--canvas); stroke-width: 4.5; opacity: 0.8; }
.rc-line { stroke: var(--rc); stroke-width: 1.4; }
.rc-leader { stroke: var(--rc); stroke-width: 1; }
.rc-mark { animation: rc-land 240ms var(--ease) 560ms both; }
.rc-tag { fill: var(--canvas); stroke: var(--rc); stroke-width: 1.5; stroke-linejoin: round; }
.rc-num, .rc-label { font-family: var(--font); fill: var(--rc); font-variant-numeric: tabular-nums; }
.rc-num { font-size: 10px; font-weight: 700; text-anchor: middle; }
.rc-label { font-size: 12px; font-weight: 600; font-stretch: var(--stretch-label); paint-order: stroke; stroke: var(--canvas); stroke-width: 3px; stroke-linejoin: round; }
@keyframes rc-draw { from { stroke-dashoffset: 1.1; } to { stroke-dashoffset: 0; } }
@keyframes rc-land { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .rc-halo, .rc-line, .rc-mark { animation: none; } }
`

function Cloud({ cloud }: { cloud: CloudLayout }) {
  const { marker } = cloud
  const [x, y] = marker.at
  const [[lx1, ly1], [lx2, ly2]] = marker.leader
  const [tx, ty] = marker.labelAt
  return (
    <g style={{ '--rc': INK[cloud.severity] } as CSSProperties} role="note" aria-label={`Revision ${cloud.tag}: ${cloud.label}`}>
      <path className="rc-halo" d={cloud.d} pathLength={1} />
      <path className="rc-line" d={cloud.d} pathLength={1} />
      <g className="rc-mark">
        <line className="rc-leader" x1={lx1} y1={ly1} x2={lx2} y2={ly2} />
        <path className="rc-tag" d={`M${x} ${y - 10} L${x + 11} ${y + 9} H${x - 11} Z`} />
        <text className="rc-num" x={x} y={y + 6}>
          {cloud.tag}
        </text>
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
 * leader to a numbered triangle and its label. Mount it as a sibling of the scene's canvas inside
 * a positioned container. `view` replaces the canvas lookup (tests).
 */
export function RevisionClouds({ view = canvasView }: { view?: (svg: SVGSVGElement) => CloudView | null }) {
  const annotations = useTwinStore((s) => s.annotations)
  const svgRef = useRef<SVGSVGElement>(null)
  const [frame, setFrame] = useState<{ clouds: CloudLayout[]; left: number; top: number }>({ clouds: [], left: 0, top: 0 })

  useEffect(() => {
    if (annotations.length === 0) {
      setFrame({ clouds: [], left: 0, top: 0 })
      return
    }
    const previous = new Map<number, number>()
    let request = 0
    let last = Number.NEGATIVE_INFINITY
    let shown = ''
    const tick = (now: number) => {
      request = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      last = now
      const svg = svgRef.current
      const v = svg ? view(svg) : null
      const { worldBox } = useSceneRegistry.getState()
      const clouds = v
        ? layoutClouds(
            annotations,
            (id) => {
              const box = worldBox(id)
              return box ? projectBox(box, v.camera, v.width, v.height) : null
            },
            v,
            previous,
          )
        : []
      previous.clear()
      for (const c of clouds) previous.set(c.tag, c.marker.choice)
      const next = { clouds, left: v?.left ?? 0, top: v?.top ?? 0 }
      const key = JSON.stringify(next)
      if (key === shown) return
      shown = key
      setFrame(next)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [annotations, view])

  return (
    <svg ref={svgRef} style={overlay} aria-label="Revision clouds" role="group">
      <style>{css}</style>
      <g transform={`translate(${frame.left} ${frame.top})`}>
        {frame.clouds.map((cloud) => (
          <Cloud key={`${cloud.tag}:${cloud.label}`} cloud={cloud} />
        ))}
      </g>
    </svg>
  )
}
