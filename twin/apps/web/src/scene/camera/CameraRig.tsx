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
// camera-controls' own default damping, restored for the user once a choreographed move settles or is grabbed.
const USER_SMOOTH_TIME_S = 0.25
// The drawer slides in over a few frames; measure it for this many frames after the selection or the size changes.
const MEASURE_FRAMES = 12
// How quickly the framing recenters when the inspector opens or closes (damping rate, 1/s).
const INSET_RATE = 6

/** Width of the scene the inspector drawer covers on the right, in CSS pixels (0 when it is closed). */
function coveredRight(canvas: HTMLCanvasElement): number {
  const stage = canvas.closest<HTMLElement>('.scene-stage')
  const drawer = stage?.querySelector<HTMLElement>('.dt-inspector')
  if (!stage || !drawer) return 0
  // offsetLeft ignores the drawer's slide-in transform, so the goal does not drift while it animates.
  return Math.min(stage.clientWidth / 2, Math.max(0, stage.clientWidth - drawer.offsetLeft))
}

function waypointOf(s: TwinState): Waypoint | null {
  if (!s.plan) return null
  return { shot: s.shot, focusId: resolveFocus({ plan: s.plan, evaluation: s.evaluation, focusId: s.selection?.id ?? null }) }
}

/**
 * Shifts the projection center left by half of `inset` (a view offset into a wider virtual frame), so the shot's
 * subject sits in the middle of the part of the scene the inspector leaves visible.
 */
function applyInset(camera: PerspectiveCamera, width: number, height: number, inset: number) {
  if (width <= 0 || height <= 0) return
  const view = camera.view
  if (inset < 0.5) {
    if (view?.enabled || Math.abs(camera.aspect - width / height) > 1e-6) {
      camera.clearViewOffset()
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    return
  }
  const fullWidth = width + inset
  const current = view?.enabled && view.fullWidth === fullWidth && view.width === width && view.height === height
  if (!current || Math.abs(camera.aspect - fullWidth / height) > 1e-6) camera.setViewOffset(fullWidth, height, inset, 0, width, height)
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
  // Set by registry and openness changes; handled once per frame so a burst of registrations costs one re-resolve.
  const sceneChanged = useRef(true)
  const onSceneChange = useRef<() => void>(() => {})
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const size = useThree((s) => s.size)
  const getThree = useThree((s) => s.get)
  // The inspector covers the right of the scene; shots center their subject in what is left (see useFrame).
  const insetGoal = useRef(0)
  const inset = useRef(0)
  const measureFrames = useRef(MEASURE_FRAMES)

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
      const { width, height } = getThree().size
      const aspect = height > 0 ? Math.max(1, width - insetGoal.current) / height : camera.aspect
      return shotFor(w.shot, { plan, evaluation, focusId: w.focusId, worldBox, aspect })
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
    // Only what the shot depends on; hover, chat and the like never reach resolveFocus.
    const unsubscribe = useTwinStore.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.evaluation !== prev.evaluation) measureFrames.current = MEASURE_FRAMES
      if (s.shot !== prev.shot || s.selection !== prev.selection || s.plan !== prev.plan || s.evaluation !== prev.evaluation) follow(s)
    })
    const markChanged = () => {
      sceneChanged.current = true
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
      choreography.current?.invalidate()
    }
    const restoreUserDamping = () => {
      cc.smoothTime = USER_SMOOTH_TIME_S
    }
    const release = () => {
      choreography.current?.cancel()
      restoreUserDamping()
    }
    cc.addEventListener('controlstart', release)
    cc.addEventListener('rest', restoreUserDamping)
    return () => {
      unsubscribe()
      unsubscribeScene()
      unsubscribeOpenness()
      onSceneChange.current = () => {}
      cc.removeEventListener('controlstart', release)
      cc.removeEventListener('rest', restoreUserDamping)
      choreography.current = null
      canvas.style.opacity = ''
      camera.clearViewOffset()
      useRackOpenness.setState({ placementId: null, tray: null, value: 0 })
    }
  }, [camera, canvas, getThree])

  useEffect(() => {
    measureFrames.current = MEASURE_FRAMES
  }, [size])

  useFrame((_, dt) => {
    if (sceneChanged.current) {
      sceneChanged.current = false
      onSceneChange.current()
    }
    choreography.current?.tick(dt)
    const cc = controls.current
    if (!cc || !(camera instanceof PerspectiveCamera)) return
    if (measureFrames.current > 0) {
      measureFrames.current--
      const covered = coveredRight(canvas)
      if (Math.abs(covered - insetGoal.current) > 1) {
        insetGoal.current = covered
        choreography.current?.invalidate()
      }
    }
    inset.current = Math.abs(inset.current - insetGoal.current) < 0.5 ? insetGoal.current : MathUtils.damp(inset.current, insetGoal.current, INSET_RATE, dt)
    applyInset(camera, size.width, size.height, inset.current)
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
