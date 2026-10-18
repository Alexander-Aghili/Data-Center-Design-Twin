import { create } from 'zustand'

/**
 * How far the one open rack is opened (0 closed, 1 doors open and trays out). The camera rig writes it during
 * the rack, tray and gpu legs; `<Rack openness>` reads it with `useRackOpenness(selectOpenness(placementId))`.
 * `tray` is the tray the camera pushes into: it slides out clear of the chassis so the trays above do not cover
 * its GPUs (null when the rack has no rendered trays).
 */
export interface RackOpenness {
  placementId: string | null
  tray: number | null
  value: number
}

export const useRackOpenness = create<RackOpenness>()(() => ({ placementId: null, tray: null, value: 0 }))

export const selectOpenness =
  (placementId: string) =>
  (s: RackOpenness): number =>
    s.placementId === placementId ? s.value : 0
