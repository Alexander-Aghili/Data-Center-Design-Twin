import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, SMAA, SSAO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useMemo, type ReactNode } from 'react'
import { NoToneMapping, PCFShadowMap } from 'three'
import type { Overlay } from '@twin/schema'
import { useTwinStore } from '../state/store'
import { CameraBridge } from './annotations/cameraBridge'
import { CameraRig } from './camera/CameraRig'
import { useRackOpenness } from './camera/openness'
import { Ground } from './Ground'
import { useStable } from './hooks'
import { Lighting } from './Lighting'
import { Hall, equipmentUnits } from './models/Hall'
import { Pipes, pipeRuns } from './models/Pipes'
import { Site } from './models/Site'
import { Overlays } from './overlays'
import { PipeFillTransition } from './overlays/pipeFill'
import { PALETTE } from './palette'
import { Picking } from './Picking'

const BUSWAY_FREE_OVERLAYS = new Set<Overlay>(['air', 'liquid', 'temperature', 'floorLoad'])

function World() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const overlay = useTwinStore((s) => s.overlay)
  const layer = useTwinStore((s) => s.activeLayer)
  const openRack = useRackOpenness((s) => (s.value > 0 ? s.placementId : null))

  // Stable while unchanged, so a re-evaluation does not rebuild pipe and deck geometry.
  const units = useStable(useMemo(() => (plan ? equipmentUnits(plan, evaluation) : []), [plan, evaluation]))
  const runs = useStable(useMemo(() => (plan ? pipeRuns(plan, units) : []), [plan, units]))
  // Overhead busways hide under the flow and floor load overlays and on the workload layer: several ducts per row
  // would bar the view down into the aisles, bays and racks those views color.
  const hideBusways = BUSWAY_FREE_OVERLAYS.has(overlay) || layer === 'workload'
  const hallUnits = useMemo(() => (hideBusways ? units.filter((u) => u.kind !== 'busway') : units), [units, hideBusways])

  if (!plan) return null
  return (
    <>
      <Ground plan={plan} runs={runs} />
      <Site plan={plan} units={units} />
      <Hall plan={plan} units={hallUnits} openRack={openRack} />
      {/* The liquid overlay draws its own colored pipes; the neutral ones would double them. */}
      {overlay === 'liquid' ? null : <Pipes runs={runs} />}
    </>
  )
}

// The canvas needs WebGL 2 and ResizeObserver (absent in old browsers and in jsdom).
const webglAvailable = typeof WebGL2RenderingContext !== 'undefined' && typeof ResizeObserver !== 'undefined'

// Dev-only frame-time readout: append ?perf=1 to the URL.
const showPerf = import.meta.env.DEV && new URLSearchParams(location.search).get('perf') === '1'

/**
 * 3D canvas: the site, hall and equipment as a white architectural model, with overlays, camera rig and picking.
 * `children` render inside the Canvas (bridges for DOM overlays, dev tools).
 */
export function Scene({ children }: { children?: ReactNode }) {
  if (!webglAvailable) {
    return <p style={{ margin: 0, padding: 'var(--space-4)', color: 'var(--graphite)' }}>The 3D view needs a browser with WebGL 2.</p>
  }
  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ far: 900 }}
      onCreated={({ gl }) => {
        // The composer's neutral tone mapping runs last; the renderer itself stays linear.
        gl.toneMapping = NoToneMapping
      }}
    >
      <color attach="background" args={[PALETTE.canvas]} />
      <fog attach="fog" args={[PALETTE.canvas, 160, 520]} />
      <Lighting />
      <World />
      <Overlays />
      <PipeFillTransition />
      <CameraRig />
      <CameraBridge />
      <Picking />
      <EffectComposer multisampling={0} enableNormalPass>
        <SSAO
          samples={21}
          rings={4}
          radius={0.025}
          intensity={4}
          luminanceInfluence={0.5}
          resolutionScale={1}
          worldDistanceThreshold={30}
          worldDistanceFalloff={6}
          worldProximityThreshold={0.25}
          worldProximityFalloff={0.1}
          color={PALETTE.ink}
        />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <SMAA />
      </EffectComposer>
      {children}
      {showPerf ? <Stats /> : null}
    </Canvas>
  )
}
