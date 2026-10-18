import { useLayoutEffect, useRef } from 'react'
import type { Object3D } from 'three'
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

/**
 * Keeps the previous reference while the value's JSON is unchanged, so geometry memoized on it survives
 * re-evaluations that leave equipment and pipe routes where they were.
 */
export function useStable<T>(value: T): T {
  const held = useRef<{ key: string; value: T } | null>(null)
  const key = JSON.stringify(value)
  if (held.current?.key !== key) held.current = { key, value }
  return held.current.value
}
