import { Edges } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { Selection } from '@twin/schema'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { useTwinStore } from '../state/store'
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

/**
 * Raycasts against the registered scene objects. A hit counts for the nearest registered ancestor of the mesh it
 * struck; registered objects that are not selectable (the hall shell, pipes) let the ray pass on to what is behind.
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
    }
    raycaster.setFromCamera(pointer.set(ndc.x, ndc.y), camera)
    for (const hit of raycaster.intersectObjects([...byRef.keys()], true)) {
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

function HoverOutline({ id }: { id: string }) {
  const box = useMemo(() => useSceneRegistry.getState().worldBox(id), [id])
  if (!box || box.isEmpty()) return null
  const size = box.getSize(new Vector3()).addScalar(2 * OUTLINE_INFLATE_M).max(new Vector3(MIN_OUTLINE_M, MIN_OUTLINE_M, MIN_OUTLINE_M))
  return (
    <mesh position={box.getCenter(new Vector3())} raycast={() => null} renderOrder={3}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial visible={false} />
      <Edges color={PALETTE.ink} lineWidth={2} raycast={() => null} />
    </mesh>
  )
}

/** Click selects the rack, equipment, bay or row under the pointer (empty space clears it); hover outlines it. */
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
  const [hovered, setHovered] = useState<string | null>(null)
  // Pointer moves are only recorded here; the raycast runs at most once per frame.
  const pendingHover = useRef<{ x: number; y: number } | null>(null)

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
      pendingHover.current = ndc(e)
    }
    const onLeave = () => {
      pendingHover.current = null
      setHovered(null)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [canvas, picker])

  useFrame(() => {
    const at = pendingHover.current
    if (!at) return
    pendingHover.current = null
    const hit = picker.pick(at)
    setHovered(hit?.objectId ?? null)
  })

  useEffect(() => {
    canvas.style.cursor = hovered ? 'pointer' : ''
  }, [canvas, hovered])

  return hovered ? <HoverOutline id={hovered} /> : null
}
