import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Camera } from 'three'
import { create } from 'zustand'

/** The scene camera and the canvas size in CSS pixels, for overlays drawn outside the Canvas. */
export interface CloudView {
  camera: Camera
  width: number
  height: number
}

export const useCameraBridge = create<{ view: CloudView | null }>()(() => ({ view: null }))

/**
 * Publishes the Canvas camera and size to `useCameraBridge`. Render it inside the R3F Canvas.
 * The camera object is shared, so overlays read its current matrices on every tick; the store
 * changes only when the camera is replaced or the canvas resizes.
 */
export function CameraBridge() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useEffect(() => {
    useCameraBridge.setState({ view: { camera, width, height } })
    return () => useCameraBridge.setState({ view: null })
  }, [camera, width, height])
  return null
}
