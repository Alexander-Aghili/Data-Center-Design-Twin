import { CameraControls, type CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { useTwinStore, type TwinState } from '../../state/store'
import { useSceneRegistry } from '../registry'
import { useRackOpenness } from './openness'
import { Choreography, type CameraDriver, type Waypoint } from './path'
import { focusRack, focusTray, resolveFocus, shotFor, type Shot } from './shots'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
// Near plane at 1 % of the viewing distance keeps depth precision from the GPU close-up (about 1 m) to the site.
const NEAR_FRACTION = 0.01
const MIN_NEAR_M = 0.01
const MAX_NEAR_M = 1
// The user may zoom in to 10 cm, close enough to read a quick disconnect.
const MIN_DISTANCE_M = 0.1
// Models move a frame or two after the state that moves them (React commits, then the tray slides), so a resting
// shot keeps re-framing for a few frames after the scene or the open rack changes.
const REFRAME_FRAMES = 10

function waypointOf(s: TwinState): Waypoint | null {
  if (!s.plan) return null
  return { shot: s.shot, focusId: resolveFocus({ plan: s.plan, evaluation: s.evaluation, focusId: s.selection?.id ?? null }) }
}

/**
 * Drives the camera from the store's shot and selection: every layer switch travels through each level in between
 * (gpu, tray, rack, row, hall, site), opens the focus rack on the way into it, and can be redirected mid-move.
 * The user can orbit and zoom at any time; grabbing the camera ends the current move. Render inside the Canvas.
 */
export function CameraRig() {
  const controls = useRef<CameraControlsImpl>(null)
  const choreography = useRef<Choreography | null>(null)
  const fovGoal = useRef({ fov: 0, smoothTimeS: 0 })
  const reframeFrames = useRef(0)
  const onSceneChange = useRef<() => void>(() => {})
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)

  useEffect(() => {
    const cc = controls.current
    if (!cc || !(camera instanceof PerspectiveCamera)) return
    const reducedMotion = window.matchMedia(REDUCED_MOTION)

    const driver: CameraDriver = {
      moveTo(pose, smoothTimeS) {
        if (smoothTimeS > 0) cc.smoothTime = smoothTimeS
        void cc.setLookAt(...pose.position, ...pose.target, smoothTimeS > 0)
        cc.normalizeRotations()
        fovGoal.current = { fov: pose.fov, smoothTimeS }
        if (smoothTimeS === 0) {
          camera.fov = pose.fov
          camera.updateProjectionMatrix()
        }
      },
      pose() {
        return { position: cc.getPosition(new Vector3()).toArray(), target: cc.getTarget(new Vector3()).toArray(), fov: camera.fov }
      },
      setFade(opacity) {
        canvas.style.opacity = opacity < 1 ? String(opacity) : ''
      },
      setOpenness(placementId, value) {
        const open = useRackOpenness.getState()
        if (placementId === open.placementId && open.tray !== null && open.value > 0) return useRackOpenness.setState({ value })
        useRackOpenness.setState({ placementId, value, tray: placementId === null ? null : trayOf(placementId) })
      },
    }

    const resolve = (w: Waypoint): Shot => {
      const { plan, evaluation } = useTwinStore.getState()
      if (!plan) return driver.pose()
      const { worldBox } = useSceneRegistry.getState()
      return shotFor(w.shot, { plan, evaluation, focusId: w.focusId, worldBox, aspect: camera.aspect })
    }

    // The tray the camera pushes into: the selected one when the selection is inside this rack, else the middle one.
    const trayOf = (placementId: string): number | null => {
      const selected = waypointOf(useTwinStore.getState())?.focusId ?? null
      const focusId = selected !== null && focusRack(selected) === placementId ? selected : `rack:${placementId}`
      return focusTray(focusId, useSceneRegistry.getState().worldBox)
    }

    const follow = (s: TwinState) => {
      const target = waypointOf(s)
      if (!target) return
      if (!choreography.current) {
        choreography.current = new Choreography(driver, resolve, target)
        driver.moveTo(resolve(target), 0)
        return
      }
      choreography.current.go(target, reducedMotion.matches)
    }

    follow(useTwinStore.getState())
    const unsubscribe = useTwinStore.subscribe(follow)
    const markChanged = () => {
      reframeFrames.current = REFRAME_FRAMES
    }
    markChanged()
    const unsubscribeScene = useSceneRegistry.subscribe(markChanged)
    const unsubscribeOpenness = useRackOpenness.subscribe(markChanged)
    onSceneChange.current = () => {
      // Trays may register after the rack was opened; pick the tray to slide out once they exist.
      const open = useRackOpenness.getState()
      if (open.placementId !== null && open.value > 0 && open.tray === null) {
        const tray = trayOf(open.placementId)
        if (tray !== null) useRackOpenness.setState({ tray })
      }
      choreography.current?.refresh()
    }
    const release = () => choreography.current?.cancel()
    cc.addEventListener('controlstart', release)
    return () => {
      unsubscribe()
      unsubscribeScene()
      unsubscribeOpenness()
      onSceneChange.current = () => {}
      cc.removeEventListener('controlstart', release)
      choreography.current = null
      canvas.style.opacity = ''
    }
  }, [camera, canvas])

  useFrame((_, dt) => {
    choreography.current?.tick(dt)
    if (reframeFrames.current > 0) {
      reframeFrames.current -= 1
      onSceneChange.current()
    }
    const cc = controls.current
    if (!cc || !(camera instanceof PerspectiveCamera)) return
    const { fov, smoothTimeS } = fovGoal.current
    let changed = false
    if (fov > 0 && Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = MathUtils.damp(camera.fov, fov, 2 / Math.max(smoothTimeS, 1e-3), dt)
      changed = true
    }
    const near = MathUtils.clamp(cc.distance * NEAR_FRACTION, MIN_NEAR_M, MAX_NEAR_M)
    if (Math.abs(camera.near - near) > near * 0.1) {
      camera.near = near
      changed = true
    }
    if (changed) camera.updateProjectionMatrix()
  })

  return <CameraControls ref={controls} makeDefault dollyToCursor minDistance={MIN_DISTANCE_M} maxPolarAngle={Math.PI / 2} />
}
