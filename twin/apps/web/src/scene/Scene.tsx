import { Stats } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { EffectComposer, SMAA, SSAO, ToneMapping } from '@react-three/postprocessing'
import type { Evaluation, Plan, ShotId } from '@twin/schema'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { NoToneMapping, PCFSoftShadowMap, type Camera, type Object3D } from 'three'
import { create } from 'zustand'
import { useTwinStore } from '../state/store'
import { CameraRig } from './camera/CameraRig'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { Hall, equipmentUnits, type OpenRack } from './models/Hall'
import { Pipes, pipeRuns } from './models/Pipes'
import { Site } from './models/Site'
import { Overlays } from './overlays'
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

export interface SceneCamera {
  /** The canvas camera, for DOM overlays outside the Canvas (projection to screen). Null until the canvas mounts. */
  camera: Camera | null
  /** Canvas size in CSS pixels. */
  size: { width: number; height: number }
}

/** The R3F camera and canvas size, readable outside the Canvas (revision clouds, labels). */
export const useSceneCamera = create<SceneCamera>()(() => ({ camera: null, size: { width: 0, height: 0 } }))

function PublishCamera() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useEffect(() => {
    useSceneCamera.setState({ camera, size: { width, height } })
  }, [camera, width, height])
  useEffect(() => () => useSceneCamera.setState({ camera: null }), [])
  return null
}

/** How far the focused rack opens at each shot: closed down to the row, door open at the rack, trays out closer in. */
const OPENNESS: Record<ShotId, number> = { site: 0, hall: 0, row: 0, rack: 0.4, tray: 1, gpu: 1 }

/** The rack the close shots look at: the selected one, else the rack of the first failing check, else the first placed. */
export function focusedRack(plan: Plan, evaluation: Evaluation | null, selection: { kind: string; id: string } | null): string | null {
  const placed = new Set(plan.placements.map((p) => p.id))
  const fromId = (id: string) => /^(?:rack:)?([^:]+)/.exec(id)?.[1] ?? null
  if (selection && ['rack', 'tray', 'gpu'].includes(selection.kind)) {
    const id = fromId(selection.id)
    if (id && placed.has(id)) return id
  }
  for (const check of evaluation?.checks ?? []) {
    if (check.status !== 'fail') continue
    const rack = check.subject.objectIds.map(fromId).find((id): id is string => id !== null && placed.has(id))
    if (rack) return rack
  }
  return plan.placements[0]?.id ?? null
}

function World() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const selection = useTwinStore((s) => s.selection)
  const shot = useTwinStore((s) => s.shot)

  const units = useMemo(() => (plan ? equipmentUnits(plan, evaluation) : []), [plan, evaluation])
  const runs = useMemo(() => (plan ? pipeRuns(plan, units) : []), [plan, units])
  const focus = plan ? focusedRack(plan, evaluation, selection) : null
  const openRack = useMemo((): OpenRack | null => (focus ? { placementId: focus, openness: OPENNESS[shot] } : null), [focus, shot])

  if (!plan) return null
  return (
    <>
      <Ground plan={plan} runs={runs} />
      <Site plan={plan} units={units} roof={shot === 'site'} />
      <Hall plan={plan} units={units} openRack={openRack} />
      <Pipes runs={runs} />
    </>
  )
}

// Dev-only frame-time readout: append ?perf=1 to the URL.
const showPerf = import.meta.env.DEV && new URLSearchParams(location.search).get('perf') === '1'

/** 3D canvas: the site, hall and equipment as a white architectural model, with overlays, camera rig and picking. */
export function Scene() {
  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ position: [62, 46, 66], fov: 30, near: 0.05, far: 900 }}
      onCreated={({ gl, camera }) => {
        // The composer's neutral tone mapping runs last; the renderer itself stays linear.
        gl.toneMapping = NoToneMapping
        camera.lookAt(20, 0, 12)
      }}
    >
      <color attach="background" args={[PALETTE.canvas]} />
      <fog attach="fog" args={[PALETTE.canvas, 160, 520]} />
      <PublishCamera />
      <Lighting />
      <World />
      <Overlays />
      <CameraRig />
      <Picking />
      <EffectComposer multisampling={0} enableNormalPass>
        <SSAO
          samples={16}
          rings={5}
          radius={0.06}
          intensity={10}
          luminanceInfluence={0.4}
          worldDistanceThreshold={60}
          worldDistanceFalloff={20}
          worldProximityThreshold={0.5}
          worldProximityFalloff={0.3}
          color={PALETTE.ink}
        />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <SMAA />
      </EffectComposer>
      {showPerf ? <Stats /> : null}
    </Canvas>
  )
}
