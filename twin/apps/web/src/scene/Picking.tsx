import { Edges } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { Selection } from '@twin/schema'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Matrix4, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { useTwinStore } from '../state/store'
import { useRackOpenness } from './camera/openness'
import { useSiteReveal } from './camera/siteReveal'
import { PALETTE } from './palette'
import { useSceneRegistry, type SceneObject } from './registry'

/**
 * The selection a scene object stands for, or null when it is not selectable:
 * `rack:<placement>` and its trays and GPUs select the rack, `eq:<key>:<unit>` selects the equipment key
 * (as in `SizedEquipment.key`), `bay:<id>` the bay and `row:<id>` the row.
 */
export function selectionForObjectId(id: string): Selection | null {
  const [prefix, ...rest] = id.split(':')
  if (rest.length === 0) return null
  switch (prefix) {
    case 'rack':
      return { kind: 'rack', id: rest[0]! }
    case 'eq':
      return rest.length > 1 ? { kind: 'equipment', id: rest.slice(0, -1).join(':') } : null
    case 'bay':
    case 'row':
      return { kind: prefix, id: rest.join(':') }
    default:
      return null
  }
}

/** The object to outline for a hit: a tray or GPU outlines its whole rack when the rack is registered. */
function outlineId(id: string, objects: Map<string, SceneObject>): string {
  const selection = selectionForObjectId(id)
  const rackId = selection?.kind === 'rack' ? `rack:${selection.id}` : null
  return rackId && objects.has(rackId) ? rackId : id
}

export interface PickHit {
  /** Registered scene id to outline. */
  objectId: string
  selection: Selection
}

export interface Picker {
  /** Nearest selectable object under a point in normalized device coordinates (−1…1, y up). */
  pick(ndc: { x: number; y: number }): PickHit | null
  /** Selects what is under the point; empty space clears the selection. */
  click(ndc: { x: number; y: number }): void
}

/** Visible along with all its ancestors (the raycaster itself ignores visibility). */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

/**
 * Raycasts against the registered scene objects. A hit counts for the nearest registered ancestor of the mesh it
 * struck; registered objects that are not selectable (the hall shell, pipes) let the ray pass on to what is behind,
 * except a shown mesh marked `userData.occludesPicks` (the roof), which hides everything under it.
 * An InstancedMesh can name its instances through `userData.instanceObjectIds[instanceId]`.
 */
export function createPicker({
  camera,
  objects,
  select,
}: {
  camera: Camera
  objects: () => Map<string, SceneObject>
  select: (target: Selection | null) => void
}): Picker {
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let indexed: Map<string, SceneObject> | null = null
  let byRef = new Map<Object3D, string>()
  // Registered objects with no registered ancestor; the recursive raycast reaches the rest through them.
  let roots: Object3D[] = []

  function idOf(object: Object3D, instanceId: number | undefined): string | null {
    const instanceIds: unknown = object.userData.instanceObjectIds
    if (instanceId !== undefined && Array.isArray(instanceIds) && typeof instanceIds[instanceId] === 'string') return instanceIds[instanceId]
    for (let o: Object3D | null = object; o; o = o.parent) {
      const id = byRef.get(o)
      if (id !== undefined) return id
    }
    return null
  }

  function pick(ndc: { x: number; y: number }): PickHit | null {
    const registered = objects()
    if (registered !== indexed) {
      indexed = registered
      byRef = new Map([...registered].map(([id, o]) => [o.ref, id]))
      roots = [...byRef.keys()].filter((ref) => {
        for (let o = ref.parent; o; o = o.parent) if (byRef.has(o)) return false
        return true
      })
    }
    raycaster.setFromCamera(pointer.set(ndc.x, ndc.y), camera)
    for (const hit of raycaster.intersectObjects(roots, true)) {
      if (hit.object.userData.occludesPicks === true && shown(hit.object)) return null
      // Inside a hidden group (busways under a flow overlay, the neutral pipes): not there for the user. The mesh
      // itself may be invisible, as the instanced racks' pick proxies are.
      if (hit.object.parent && !shown(hit.object.parent)) continue
      const id = idOf(hit.object, hit.instanceId)
      const selection = id === null ? null : selectionForObjectId(id)
      if (id !== null && selection) return { objectId: outlineId(id, registered), selection }
    }
    return null
  }

  return {
    pick,
    click: (ndc) => select(pick(ndc)?.selection ?? null),
  }
}

// A press that travels further than this is an orbit or pan drag, not a click.
const CLICK_SLOP_PX = 4
// Outline sits just outside the object so its own faces do not hide it.
const OUTLINE_INFLATE_M = 0.03
// Flat objects such as bay tiles still get a visible outline box.
const MIN_OUTLINE_M = 0.02

// Edges hidden behind other geometry still show, faint, so a box half buried in a row reads as a box.
const HIDDEN_EDGE_OPACITY = 0.45
// While the camera moves under a resting pointer, what is under it is re-picked at most this often.
const REPICK_INTERVAL_S = 1 / 15

const unitBox = new BoxGeometry(1, 1, 1)
const noRaycast = () => null

interface Outline {
  id: string
  center: [number, number, number]
  size: [number, number, number]
}

/** The outline box of a registered object, slightly inflated, or null when it is no longer rendered. */
function outlineFor(id: string): Outline | null {
  const box = useSceneRegistry.getState().worldBox(id)
  if (!box || box.isEmpty()) return null
  const size = box.getSize(new Vector3()).addScalar(2 * OUTLINE_INFLATE_M).max(new Vector3(MIN_OUTLINE_M, MIN_OUTLINE_M, MIN_OUTLINE_M))
  return { id, center: box.getCenter(new Vector3()).toArray(), size: size.toArray() }
}

const sameOutline = (a: Outline | null, b: Outline | null) => JSON.stringify(a) === JSON.stringify(b)

function HoverOutline({ outline }: { outline: Outline }) {
  return (
    <mesh geometry={unitBox} position={outline.center} scale={outline.size} raycast={noRaycast}>
      <meshBasicMaterial visible={false} />
      <Edges color={PALETTE.ink} lineWidth={2} raycast={noRaycast} renderOrder={3} />
      <Edges
        color={PALETTE.ink}
        lineWidth={1}
        depthTest={false}
        transparent
        opacity={HIDDEN_EDGE_OPACITY}
        raycast={noRaycast}
        renderOrder={2}
      />
    </mesh>
  )
}

/**
 * Click selects the rack, equipment, bay or row under the pointer (empty space clears it); hover outlines it, with
 * the edges other geometry hides drawn faint.
 */
export function Picking() {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const picker = useMemo(
    () =>
      createPicker({
        camera,
        objects: () => useSceneRegistry.getState().objects,
        select: (target) => dispatchView({ type: 'select', target }),
      }),
    [camera, dispatchView],
  )
  const [outline, setOutline] = useState<Outline | null>(null)
  // Last pointer position over the canvas (null outside). The raycast runs in the frame loop: at once after a pointer
  // move, and while the camera moves or the scene changes under a resting pointer, so the outline never stays on
  // what used to be under it.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const pointerMoved = useRef(false)
  const sceneChanged = useRef(false)
  const lastView = useRef({ world: new Matrix4(), projection: new Matrix4(), sinceS: 0 })

  useEffect(() => {
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
    }
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (down && e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_SLOP_PX) picker.click(ndc(e))
      down = null
    }
    const onMove = (e: PointerEvent) => {
      pointer.current = ndc(e)
      pointerMoved.current = true
    }
    const onLeave = () => {
      pointer.current = null
      setOutline(null)
    }
    const markChanged = () => {
      sceneChanged.current = true
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    const unsubscribeScene = useSceneRegistry.subscribe(markChanged)
    const unsubscribeOpenness = useRackOpenness.subscribe(markChanged)
    const unsubscribeReveal = useSiteReveal.subscribe(markChanged)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      unsubscribeScene()
      unsubscribeOpenness()
      unsubscribeReveal()
    }
  }, [canvas, picker])

  useFrame((_, dt) => {
    const at = pointer.current
    const view = lastView.current
    view.sinceS += dt
    if (!at) return
    const viewMoved = !view.world.equals(camera.matrixWorld) || !view.projection.equals(camera.projectionMatrix)
    const due = (viewMoved || sceneChanged.current) && view.sinceS >= REPICK_INTERVAL_S
    if (!pointerMoved.current && !due) return
    pointerMoved.current = false
    sceneChanged.current = false
    view.world.copy(camera.matrixWorld)
    view.projection.copy(camera.projectionMatrix)
    view.sinceS = 0
    const hit = picker.pick(at)
    const next = hit ? outlineFor(hit.objectId) : null
    setOutline((prev) => (sameOutline(prev, next) ? prev : next))
  })

  useEffect(() => {
    canvas.style.cursor = outline ? 'pointer' : ''
  }, [canvas, outline])

  return outline ? <HoverOutline outline={outline} /> : null
}
