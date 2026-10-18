import { num, type Plan, type RackEntry, type Row } from '@twin/schema'

// EIA-310 rack unit (44.45 mm) × 42U, used when a rack entry has no height value.
const FALLBACK_RACK_HEIGHT_M = 42 * 0.04445

function findRow(plan: Plan, rowId: string): Row {
  const row = plan.hall.rows.find((r) => r.id === rowId)
  if (!row) throw new Error(`Unknown row ${rowId}`)
  return row
}

/**
 * Center of a rack's footprint on the floor, in hall meters (origin north-west corner, x east, z south, y up).
 * rotY 0 means the rack front faces north (−z); racks whose hot aisle is north are turned by π.
 */
export function slotWorld(plan: Plan, rowId: string, slot: number, slotsWide = 1): { x: number; z: number; rotY: number } {
  const row = findRow(plan, rowId)
  return {
    x: row.x + (slot + slotsWide / 2) * row.slotPitchM,
    z: row.z + row.rackDepthM / 2,
    rotY: row.hotAisle === 'south' ? 0 : Math.PI,
  }
}

/** Rack dimensions in meters; unknown values fall back to the slot grid and a 42U height. */
export function rackSize(entry: RackEntry): { w: number; d: number; h: number } {
  const mm = (v: number | null) => (v === null ? null : v / 1000)
  return {
    w: mm(num(entry.widthMm)) ?? entry.slotsWide * 0.6,
    d: mm(num(entry.depthMm)) ?? 1.2,
    h: mm(num(entry.heightMm)) ?? FALLBACK_RACK_HEIGHT_M,
  }
}

export function positionWorld(plan: Plan, positionId: string): { x: number; z: number } {
  const position = plan.hall.positions.find((p) => p.id === positionId)
  if (!position) throw new Error(`Unknown equipment position ${positionId}`)
  return { x: position.x, z: position.z }
}

export function hallBounds(plan: Plan): { min: [number, number, number]; max: [number, number, number] } {
  const { widthM, ceilingM, depthM } = plan.hall
  return { min: [0, 0, 0], max: [widthM, ceilingM, depthM] }
}

/** "rack:R3-07" */
export function objectIdForPlacement(placementId: string): string {
  return `rack:${placementId}`
}

/** "eq:cdu:R3:0" for the first unit of equipment key "cdu:R3". */
export function objectIdForEquipment(key: string, index: number): string {
  return `eq:${key}:${index}`
}
