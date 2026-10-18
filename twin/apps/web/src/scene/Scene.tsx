import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, SMAA, SSAO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { NoToneMapping, PCFShadowMap, type Object3D } from 'three'
import { useTwinStore } from '../state/store'
import { CameraBridge } from './annotations/cameraBridge'
import { CameraRig } from './camera/CameraRig'
import { useRackOpenness } from './camera/openness'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { Hall, equipmentUnits } from './models/Hall'
import { Pipes, pipeRuns } from './models/Pipes'
import { Site } from './models/Site'
import { Overlays } from './overlays'
import { PipeFillTransition } from './overlays/pipeFill'
import { PALETTE } from './palette'
import { Picking } from './Picking'
import { useSceneRegistry } from './registry'

/**
 * Registers an object under its scene id for its lifetime and tags it with `userData.objectId`,
 * so the camera, picking and annotations can find it.
 */
export function useRegistered<T extends Object3D>(id: string, kind: string) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const object = ref.current
    if (!object) return
    object.userData.objectId = id
    return useSceneRegistry.getState().register(id, kind, object)
  }, [id, kind])
  return ref
}

function World() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const shot = useTwinStore((s) => s.shot)
  const overlay = useTwinStore((s) => s.overlay)
  const openRack = useRackOpenness((s) => (s.value > 0 ? s.placementId : null))

  const units = useMemo(() => (plan ? equipmentUnits(plan, evaluation) : []), [plan, evaluation])
  const runs = useMemo(() => (plan ? pipeRuns(plan, units) : []), [plan, units])

  if (!plan) return null
  return (
    <>
      <Ground plan={plan} runs={runs} />
      <Site plan={plan} units={units} roof={shot === 'site'} />
      <Hall plan={plan} units={units} openRack={openRack} />
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
