import { CLIMATE, HEAT_REJECTION, RACK, RACK_COOLING, placementId, type Bay, type EquipmentPosition, type Placement, type Plan, type Row } from '@twin/schema'

// Hall geometry (spec: the ordinary starting hall).
const HALL_W = 40
const HALL_D = 36
const CEILING = 4.5
const BAY = 3.6
// ≈150 psf, an older raised floor; chosen so GB300 + DLC overloads it (Task 31 tunes).
const BAY_RATING_KN_M2 = 7.2
const POINT_LIMIT_KN = 4.5

const ROW_COUNT = 8
const ROW_X = 8
const ROW_Z0 = 4
const ROW_PITCH = 3.6 // rack depth 1.2 m + 1.2 m hot aisle and 1.2 m cold aisle shared between rows
const SLOTS = 24
const SLOT_PITCH = 0.6
const RACK_DEPTH = 1.2
const ROW_END_X = ROW_X + SLOTS * SLOT_PITCH

// Position capacities, in units each position holds, from the space it occupies.
// CDU at a row end: the 3.6 m row pitch fits two ~1.2 m wide CDU cabinets with service clearance.
const CDU_UNITS_PER_POSITION = 2
// CRAH on the west wall: 36 m / 4 positions = 9 m of wall each, ~2.2 m per CRAH with clearance → 4.
const CRAH_UNITS_PER_POSITION = Math.floor(HALL_D / 4 / 2.2)
// Plant yard north of the hall: 40 m × 12 m, ~40 m² per 1 MW-class chiller or dry cooler → 12.
const PLANT_UNITS = Math.floor((HALL_W * 12) / 40)
// Electrical room: line-ups for UPS modules and transformers.
const ELECTRICAL_UNITS = 24
// Leaf position: one network rack at the row end.
const LEAF_UNITS = 1
// Workload target: below the default hall's placed FP8 compute (80 racks × 16 B300 GPUs at roughly
// 4.5 PFLOPS dense FP8 each ≈ 5,760 PFLOPS), so the default plan meets it. Task 31 tunes it with the catalog.
const TARGET_PFLOPS = 4000

const rowIds = Array.from({ length: ROW_COUNT }, (_, j) => `R${j + 1}`)

function rows(): Row[] {
  return rowIds.map((id, j) => ({
    id,
    x: ROW_X,
    z: ROW_Z0 + ROW_PITCH * j,
    slotCount: SLOTS,
    slotPitchM: SLOT_PITCH,
    rackDepthM: RACK_DEPTH,
    // Odd rows exhaust south, even rows north, so each pair shares one hot aisle.
    hotAisle: j % 2 === 0 ? 'south' : 'north',
  }))
}

function bays(): Bay[] {
  const out: Bay[] = []
  const cols = Math.ceil(HALL_W / BAY)
  const depthRows = Math.ceil(HALL_D / BAY)
  for (let r = 0; r < depthRows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * BAY
      const z = r * BAY
      out.push({
        id: `B${c + 1}-${r + 1}`,
        x,
        z,
        w: Math.min(BAY, HALL_W - x),
        d: Math.min(BAY, HALL_D - z),
        ratingKnM2: BAY_RATING_KN_M2,
        pointLimitKn: POINT_LIMIT_KN,
      })
    }
  }
  return out
}

function positions(hallRows: Row[]): EquipmentPosition[] {
  const rowCenterZ = (row: Row) => row.z + RACK_DEPTH / 2
  const crah = Array.from({ length: 4 }, (_, k): EquipmentPosition => {
    const served = hallRows.slice(2 * k, 2 * k + 2)
    return {
      id: `crah-W${k + 1}`,
      kind: 'crah',
      x: 1.5,
      z: (rowCenterZ(served[0]!) + rowCenterZ(served[1]!)) / 2,
      servesRows: served.map((r) => r.id),
      capacity: CRAH_UNITS_PER_POSITION,
    }
  })
  const cdu = hallRows.map(
    (row, j): EquipmentPosition => ({
      id: `cdu-E${j + 1}`,
      kind: 'cdu',
      x: ROW_END_X + 1.2,
      z: rowCenterZ(row),
      servesRows: [row.id],
      capacity: CDU_UNITS_PER_POSITION,
    }),
  )
  const all = hallRows.map((r) => r.id)
  const leaf = [0, 1].map((k): EquipmentPosition => {
    const served = hallRows.slice(4 * k, 4 * k + 4)
    return {
      id: `leaf-${k + 1}`,
      kind: 'leaf',
      x: ROW_X - 1.2,
      z: (rowCenterZ(served[0]!) + rowCenterZ(served[served.length - 1]!)) / 2,
      servesRows: served.map((r) => r.id),
      capacity: LEAF_UNITS,
    }
  })
  return [
    ...crah,
    ...cdu,
    { id: 'plant-1', kind: 'plant', x: HALL_W / 2, z: -6, servesRows: all, capacity: PLANT_UNITS },
    { id: 'elec-1', kind: 'electrical', x: HALL_W - 6, z: HALL_D / 2, servesRows: all, capacity: ELECTRICAL_UNITS },
    ...leaf,
  ]
}

function fill(groupId: string, rowRange: string[], slotCount: number): Placement[] {
  return rowRange.flatMap((rowId) =>
    Array.from({ length: slotCount }, (_, slot) => ({ id: placementId(rowId, slot), groupId, rowId, slot })),
  )
}

/** The ordinary starting plan. `catalog` is empty; the server fills it with `snapshotCatalog`. */
export function createDefaultPlan(): Plan {
  const now = new Date().toISOString()
  const hallRows = rows()
  return {
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    name: 'Default hall',
    updatedAt: now,
    owners: {
      site: { initials: '—', name: 'Fixed inputs' },
      workload: { initials: 'AK', name: 'Product and compute buyer' },
      compute: { initials: 'JR', name: 'Hardware planner' },
      layout: { initials: 'MS', name: 'Facility planner' },
      cooling: { initials: 'LH', name: 'Mechanical engineer' },
      power: { initials: 'DC', name: 'Electrical engineer' },
      network: { initials: 'RM', name: 'Network engineer' },
    },
    site: {
      climateId: CLIMATE.DALLAS,
      gridCapacityW: 10_000_000,
      waterAllowanceM3PerDay: 120,
      valueOfComputeUsdPerGpuHour: 2.5,
    },
    hall: {
      widthM: HALL_W,
      depthM: HALL_D,
      ceilingM: CEILING,
      floor: { type: 'raised' },
      bays: bays(),
      rows: hallRows,
      positions: positions(hallRows),
    },
    workload: { purpose: 'mixed', targetPflops: TARGET_PFLOPS },
    rackGroups: [
      { id: 'g1', name: 'Inference block', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED },
      { id: 'g2', name: 'Training block', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED },
    ],
    placements: [...fill('g1', ['R1', 'R2'], 16), ...fill('g2', ['R3', 'R4', 'R5'], 16)],
    cooling: {
      heatRejectionId: HEAT_REJECTION.CHILLER_AIR,
      facilitySupplyC: 18,
      pipingRoute: 'raisedFloor',
      flowBalancing: false,
      bufferTankM3: 0,
      containment: 'hotAisle',
    },
    power: { redundancy: 'N+1', distribution: 'ac54', oversubscription: 1.0 },
    network: { fabric: 'railOptimized', oversubscription: 1 },
    overrides: [],
    notes: [
      {
        id: 'note-1',
        target: 'decision:cooling.heatRejectionId',
        importance: 'prefer',
        authorRole: 'cooling',
        text: 'Water is scarce on this site. Avoid evaporative towers.',
        createdAt: now,
      },
    ],
    catalog: {},
  }
}
