import { Box3, type Object3D } from 'three'
import { create } from 'zustand'

export interface SceneObject {
  kind: string
  ref: Object3D
}

export interface SceneRegistry {
  /** Every rendered object by its scene id ("rack:R3-07", "eq:cdu:R3:0", ...). */
  objects: Map<string, SceneObject>
  /** Registers an object; returns the function that unregisters it. */
  register(id: string, kind: string, ref: Object3D): () => void
  /** World-space bounding box of a registered object, or null when it is not rendered. */
  worldBox(id: string): Box3 | null
}

export const useSceneRegistry = create<SceneRegistry>()((set, get) => ({
  objects: new Map(),
  register(id, kind, ref) {
    set((s) => ({ objects: new Map(s.objects).set(id, { kind, ref }) }))
    return () => {
      if (get().objects.get(id)?.ref !== ref) return
      set((s) => {
        const objects = new Map(s.objects)
        objects.delete(id)
        return { objects }
      })
    }
  },
  worldBox(id) {
    const entry = get().objects.get(id)
    return entry ? new Box3().setFromObject(entry.ref) : null
  },
}))
