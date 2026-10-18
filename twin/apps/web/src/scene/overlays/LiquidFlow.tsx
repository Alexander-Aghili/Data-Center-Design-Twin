import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type InstancedMesh,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { create } from 'zustand'
import { useTwinStore } from '../../state/store'
import { PALETTE } from '../palette'
import { cumulativeLengths, liquidNetwork, sampleAt, supplyReturnRgb, type Circuit, type Leg, type PipeRun, type TempScale, type Vec3 } from './flowPaths'

const usePipeFill = create<{ progress: number }>()(() => ({ progress: 1 }))

/**
 * Sets how far the liquid network is filled, from the plant outward: 0 shows no pipes, 1 the whole loop.
 * The cooling transition animates this from 0 to 1 after a cooling change is applied.
 */
export function fillPipes(progress: number): void {
  usePipeFill.setState({ progress: Math.min(1, Math.max(0, progress)) })
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const SUPPLY = new Color(PALETTE.supply)
const RETURN = new Color(PALETTE.return)
const CLAY = new Color(PALETTE.clay.light)
// Pipe walls are the physics colors washed toward clay white, so the saturated beads on them read clearly.
const PIPE_WASH = 0.4

/** Fractional part of `i·φ`: a deterministic, evenly spread sequence for phases and offsets. */
const spreadSeq = (i: number) => (i * 0.6180339887) % 1

function curveFor(points: Vec3[], length: number): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'centripetal')
  curve.arcLengthDivisions = Math.max(200, Math.ceil(length * 20))
  return curve
}

interface FlowParticlesProps {
  circuits: Circuit[]
  scale: TempScale
  radiusFor: (c: Circuit) => number
  opacity?: number
  /** Elongates each particle along its direction of travel (1 = round bead). */
  stretch?: number
  /** Fixed per-particle offset from the path, in meters, so a stream reads as a soft plume. */
  spread?: number
  /** Hide particles ahead of the pipe fill front. */
  followFill?: boolean
}

const tmpPos = new Vector3()
const tmpVec = new Vector3()
const tmpScale = new Vector3()
const tmpQuat = new Quaternion()
const tmpMatrix = new Matrix4()
const tmpColor = new Color()
const rgbOut = [0, 0, 0]
const FORWARD = new Vector3(0, 0, 1)

/** Instanced particles moving along `CatmullRomCurve3`s at each circuit's speed, colored supply→return by temperature. */
export function FlowParticles({ circuits, scale, radiusFor, opacity = 1, stretch = 1, spread = 0, followFill = false }: FlowParticlesProps) {
  const mesh = useRef<InstancedMesh>(null)
  const time = useRef(0)
  const reduced = useMemo(prefersReducedMotion, [])
  const prepared = useMemo(
    () =>
      circuits
        .filter((c) => c.count > 0 && c.points.length > 1)
        .map((circuit) => {
          const cum = cumulativeLengths(circuit.points)
          const length = cum.at(-1)!
          return { curve: curveFor(circuit.points, length), cum, length, circuit, radius: radiusFor(circuit) }
        }),
    [circuits, radiusFor],
  )
  const total = prepared.reduce((s, p) => s + p.circuit.count, 0)
  const geometry = useMemo(() => new IcosahedronGeometry(1, 2), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false }),
    [opacity],
  )
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 3), 3), [total])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return
    m.instanceColor = colors
    if (!reduced) time.current += Math.min(delta, 0.1)
    const progress = usePipeFill.getState().progress
    let i = 0
    prepared.forEach(({ curve, cum, length, circuit, radius }, ci) => {
      const phase = spreadSeq(ci + 1)
      for (let k = 0; k < circuit.count; k++, i++) {
        const s = ((((k + phase) / circuit.count) * length + circuit.speed * time.current) % length + length) % length
        const u = s / length
        curve.getPointAt(u, tmpPos)
        if (spread > 0) {
          tmpPos.add(tmpVec.set(spreadSeq(3 * i + 1) - 0.5, spreadSeq(3 * i + 2) - 0.5, spreadSeq(3 * i + 3) - 0.5).multiplyScalar(spread))
        }
        if (stretch !== 1) tmpQuat.setFromUnitVectors(FORWARD, curve.getTangentAt(u, tmpVec))
        else tmpQuat.identity()
        const visible = !followFill || sampleAt(cum, circuit.fills, s) <= progress
        tmpScale.set(radius, radius, radius * stretch).multiplyScalar(visible ? 1 : 0)
        m.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale))
        const [r, g, b] = supplyReturnRgb(sampleAt(cum, circuit.temps, s), scale, rgbOut)
        m.setColorAt(i, tmpColor.setRGB(r! / 255, g! / 255, b! / 255, SRGBColorSpace))
      }
    })
    m.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  })

  if (total === 0) return null
  return <instancedMesh key={total} ref={mesh} args={[geometry, material, total]} frustumCulled={false} renderOrder={2} />
}

/** One merged tube mesh per leg; fragments past the fill front are discarded in the shader. */
function PipeTubes({ pipes, leg }: { pipes: PipeRun[]; leg: Leg }) {
  const geometry = useMemo(() => {
    const parts = pipes
      .filter((p) => p.leg === leg && p.points.length > 1)
      .map((p) => {
        const cum = cumulativeLengths(p.points)
        const length = cum.at(-1)!
        const segments = Math.max(4, Math.ceil(length * 6) + p.points.length * 2)
        const radial = p.radius > 0.04 ? 12 : 8
        const tube = new TubeGeometry(curveFor(p.points, length), segments, p.radius, radial, false)
        // TubeGeometry lays out `segments + 1` rings of `radial + 1` vertices along the curve's arc length.
        const fill = new Float32Array(tube.attributes.position!.count)
        for (let ring = 0; ring <= segments; ring++) {
          fill.fill(sampleAt(cum, p.fills, (ring / segments) * length), ring * (radial + 1), (ring + 1) * (radial + 1))
        }
        tube.setAttribute('aFill', new BufferAttribute(fill, 1))
        return tube
      })
    const merged = parts.length > 0 ? mergeGeometries(parts) : null
    for (const part of parts) part.dispose()
    return merged
  }, [pipes, leg])

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: (leg === 'supply' ? SUPPLY : RETURN).clone().lerp(CLAY, PIPE_WASH), roughness: 0.55 })
    const uniforms = { uProgress: { value: 1 } }
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uProgress = uniforms.uProgress
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFill;\nvarying float vFill;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = aFill;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uProgress;\nvarying float vFill;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFill > uProgress) discard;')
    }
    m.customProgramCacheKey = () => 'twin-pipe-fill'
    return { m, uniforms }
  }, [leg])

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => material.m.dispose(), [material])
  useFrame(() => {
    material.uniforms.uProgress.value = usePipeFill.getState().progress
  })

  if (!geometry) return null
  return <mesh geometry={geometry} material={material.m} receiveShadow />
}

// Water beads are a little wider than their pipe, so they read as moving water on every tube size; air streaks
// are translucent and sparse so the racks stay the subject, but wide enough (7 cm) to read from the hall shot.
const PARTICLE_RADIUS: Record<Circuit['tier'], number> = { facility: 0.1, cdu: 0.065, header: 0.065, rack: 0.032, air: 0.07 }
export const particleRadius = (c: Circuit) => PARTICLE_RADIUS[c.tier]

/** Supply and return pipes from the plant to every liquid-cooled rack, with beads moving at the computed flow. */
export function LiquidFlow() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const network = useMemo(() => (plan && evaluation ? liquidNetwork(plan, evaluation) : null), [plan, evaluation])
  if (!network) return null
  return (
    <group name="liquid-flow">
      <PipeTubes pipes={network.pipes} leg="supply" />
      <PipeTubes pipes={network.pipes} leg="return" />
      <FlowParticles circuits={network.circuits} scale={network.scale} radiusFor={particleRadius} followFill />
    </group>
  )
}
