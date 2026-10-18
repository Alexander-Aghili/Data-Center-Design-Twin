import { create } from 'zustand'

/**
 * How far the building is closed for the site shot (0 walls cut low and no roof, 1 full walls and roof). The camera
 * rig writes it on the legs into and out of the site shot; the building and the site labels read it.
 */
export const useSiteReveal = create<{ value: number }>()(() => ({ value: 0 }))
