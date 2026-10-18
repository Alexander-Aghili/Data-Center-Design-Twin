import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Color, DoubleSide, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type InstancedMesh } from 'three'
import type { Evaluation, Plan, RackResult } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useRackOpenness } from '../camera/openness'
import { objectIdForPlacement } from '../geometry'
import { tempColor } from '../palette'
import { rackGeometry, rowFaces, temperatureScale, type TempScale } from './flowPaths'

interface Panel {
  position: Vector3
  /** Rotation about y so a rack-face panel faces its aisle; null lays the panel flat on the floor. */
  rotY: number | null
  w: number
  h: number
  color: string
}

// Panels sit just proud of the rack faces; aisle strips sit just above the floor (visual offsets, m).
const FACE_GAP = 0.015
const STRIP_Y = 0.006
const STRIP_DEPTH = 1.0

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length

/**
 * Rack front panels colored by inlet air, rear panels by outlet air, and half-aisle floor strips by their row means.
 * The rack the camera has opened gets no face panels: the close-up looks through its door at the trays, where the
 * coolant hoses carry the color.
 */
function temperaturePanels(plan: Plan, evaluation: Evaluation, scale: TempScale, openRack: string | null): { faces: Panel[]; aisles: Panel[] } {
  const color = (c: number) => tempColor(c, scale.lo, scale.hi)
  const faces: Panel[] = []
  const aisles: Panel[] = []
  for (const row of plan.hall.rows) {
    const racks = evaluation.racks.filter((r): r is RackResult & { airInletC: number; airOutletC: number } =>
      r.rowId === row.id && r.airInletC !== null && r.airOutletC !== null,
    )
    if (racks.length === 0) continue
    const { frontZ, rearZ, dir } = rowFaces(row)
    // dir points from the rear into the hot aisle; the front faces the opposite way.
    const rearRot = dir === 1 ? 0 : Math.PI
    const frontRot = rearRot + Math.PI
    const geo = racks.map((r) => ({ r, g: rackGeometry(plan, r) }))
    for (const { r, g } of geo) {
      if (r.placementId === openRack) continue
      const y = g.h / 2
      faces.push({ position: new Vector3(g.x, y, frontZ - dir * FACE_GAP), rotY: frontRot, w: g.w * 0.94, h: g.h * 0.96, color: color(r.airInletC) })
      faces.push({ position: new Vector3(g.x, y, rearZ + dir * FACE_GAP), rotY: rearRot, w: g.w * 0.94, h: g.h * 0.96, color: color(r.airOutletC) })
    }
    const x0 = Math.min(...geo.map(({ g }) => g.x - g.w / 2))
    const x1 = Math.max(...geo.map(({ g }) => g.x + g.w / 2))
    const strip = (z: number, c: number): Panel => ({ position: new Vector3((x0 + x1) / 2, STRIP_Y, z), rotY: null, w: x1 - x0, h: STRIP_DEPTH, color: color(c) })
    aisles.push(strip(frontZ - dir * (0.1 + STRIP_DEPTH / 2), mean(racks.map((r) => r.airInletC))))
    aisles.push(strip(rearZ + dir * (0.1 + STRIP_DEPTH / 2), mean(racks.map((r) => r.airOutletC))))
  }
  return { faces, aisles }
}

const up = new Vector3(0, 1, 0)
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const tmpQuat = new Quaternion()
const tmpMatrix = new Matrix4()
const tmpScale = new Vector3()
const tmpColor = new Color()

function Panels({ panels, opacity }: { panels: Panel[]; opacity: number }) {
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }),
    [opacity],
  )
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    panels.forEach((p, i) => {
      const q = p.rotY === null ? flat : tmpQuat.setFromAxisAngle(up, p.rotY)
      m.setMatrixAt(i, tmpMatrix.compose(p.position, q, tmpScale.set(p.w, p.h, 1)))
      m.setColorAt(i, tmpColor.set(p.color))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [panels])
  useLayoutEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  if (panels.length === 0) return null
  return <instancedMesh key={panels.length} ref={mesh} args={[geometry, material, panels.length]} renderOrder={1} />
}

const formatC = (c: number) => `${Math.round(c)} °C`
const LEGEND_SAMPLES = 9

/**
 * Legend for the sequential scale (the layer header names the overlay), sampled from `tempColor` so the CSS gradient
 * follows its OKLab blend rather than blending in RGB between a few stops.
 * Plain DOM in its own React root, pinned to the canvas container's lower-left corner.
 */
function Legend({ scale }: { scale: TempScale }) {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const root = useRef<Root | null>(null)
  useEffect(() => {
    if (!host) return
    const el = document.createElement('div')
    Object.assign(el.style, { position: 'absolute', left: 'var(--space-4)', bottom: 'var(--space-4)', pointerEvents: 'none' })
    host.appendChild(el)
    const r = createRoot(el)
    root.current = r
    return () => {
      root.current = null
      // React cannot unmount a root synchronously while R3F is rendering; do it right after.
      setTimeout(() => {
        r.unmount()
        el.remove()
      })
    }
  }, [host])
  useEffect(() => {
    const stops = Array.from({ length: LEGEND_SAMPLES }, (_, i) => i / (LEGEND_SAMPLES - 1)).map((t) => tempColor(scale.lo + t * (scale.hi - scale.lo), scale.lo, scale.hi))
    root.current?.render(
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 96px auto',
          alignItems: 'center',
          gap: 'var(--space-1) var(--space-2)',
          font: 'var(--text-xs)/1.3 var(--font)',
          fontStretch: 'var(--stretch-label)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink)',
        }}
      >
        <span>{formatC(scale.lo)}</span>
        <span style={{ height: 6, borderRadius: 'var(--radius)', background: `linear-gradient(to right, ${stops.join(', ')})` }} />
        <span>{formatC(scale.hi)}</span>
        <span style={{ gridColumn: '1 / -1', color: 'var(--graphite)' }}>Inlet air on rack fronts, outlet air on rack rears</span>
      </span>,
    )
  }, [scale, host])
  return null
}

// Checks that say a rack's air cooling cannot carry its heat.
const AIR_LIMIT_CHECKS = new Set(['cooling.rackHeatLimit', 'cooling.airInletTemp'])

/**
 * Color of a rack's exhaust (outlet air) on the overlay's scale, for the heatsinks of the rack the camera opens, when
 * a failing or warning air-limit check names the rack; null otherwise, so healthy racks keep bare metal.
 */
export function exhaustColor(evaluation: Evaluation | null, placementId: string): string | null {
  const outlet = evaluation?.racks.find((r) => r.placementId === placementId)?.airOutletC ?? null
  if (!evaluation || outlet === null) return null
  const objectId = objectIdForPlacement(placementId)
  const overLimit = evaluation.checks.some(
    (c) => AIR_LIMIT_CHECKS.has(c.kind) && (c.status === 'fail' || c.status === 'warn') && c.subject.objectIds.includes(objectId),
  )
  if (!overLimit) return null
  const scale = temperatureScale(evaluation)
  return tempColor(outlet, scale.lo, scale.hi)
}

/** Racks and aisles colored on a sequential scale from the computed inlet and outlet air temperatures. */
export function Temperature() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const openRack = useRackOpenness((s) => (s.value > 0 ? s.placementId : null))
  const view = useMemo(() => {
    if (!plan || !evaluation) return null
    const scale = temperatureScale(evaluation)
    return { scale, ...temperaturePanels(plan, evaluation, scale, openRack) }
  }, [plan, evaluation, openRack])
  if (!view) return null
  return (
    <group name="temperature">
      {/* Rack faces carry the reading; aisle floors are a quieter echo of the same scale. */}
      <Panels panels={view.faces} opacity={0.78} />
      <Panels panels={view.aisles} opacity={0.35} />
      {view.faces.length > 0 ? <Legend scale={view.scale} /> : null}
    </group>
  )
}
