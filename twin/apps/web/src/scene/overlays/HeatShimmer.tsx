import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, DoubleSide, ShaderMaterial } from 'three'
import { useTwinStore } from '../../state/store'
import { PALETTE } from '../palette'
import { heatRuns, type HeatRun } from './flowPaths'
import { prefersReducedMotion } from './LiquidFlow'

// A faint plume of rising heat-red bands above racks whose cooling is not OK. Height and strength are
// visual choices: enough to find the problem from the hall shot, never enough to hide the racks.
const PLUME_H = 1.3
const MAX_ALPHA = 0.6

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uWidth;
  uniform float uAlpha;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float x = vUv.x * uWidth;
    float y = vUv.y;
    // Bands rise and waver sideways; two incommensurate sines keep the pattern from looking periodic.
    float waver = sin(x * 4.7 + uTime * 1.3) * 0.06 + sin(x * 11.3 - uTime * 1.9) * 0.03;
    float bands = 0.5 + 0.5 * sin((y + waver) * 17.0 - uTime * 2.4);
    float plume = smoothstep(0.0, 0.12, y) * pow(1.0 - y, 1.8);
    float ends = smoothstep(0.0, 0.35, x) * smoothstep(0.0, 0.35, uWidth - x);
    gl_FragColor = vec4(uColor, uAlpha * plume * ends * mix(0.3, 1.0, bands));
  }
`

function Plume({ run }: { run: HeatRun }) {
  const width = run.x1 - run.x0
  const reduced = useMemo(prefersReducedMotion, [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uWidth: { value: width },
          uAlpha: { value: MAX_ALPHA },
          uColor: { value: new Color(PALETTE.heat) },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [width],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame((_, delta) => {
    if (!reduced) material.uniforms.uTime!.value += Math.min(delta, 0.1)
  })
  return (
    <mesh position={[(run.x0 + run.x1) / 2, run.top + PLUME_H / 2, run.z]} material={material} renderOrder={3}>
      <planeGeometry args={[width, PLUME_H]} />
    </mesh>
  )
}

/** Heat shimmer above every run of racks with `coolingOk === false`. */
export function HeatShimmer() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const runs = useMemo(() => (plan && evaluation ? heatRuns(plan, evaluation) : []), [plan, evaluation])
  return (
    <group name="heat-shimmer">
      {runs.map((run) => (
        <Plume key={`${run.rowId}:${run.x0}`} run={run} />
      ))}
    </group>
  )
}
