import { z } from 'zod'
import { CatalogEntrySchema, PowerDistributionSchema } from './catalog'

export const LAYER_IDS = ['site', 'workload', 'compute', 'layout', 'cooling', 'power', 'network'] as const
export const LayerIdSchema = z.enum(LAYER_IDS)
export type LayerId = z.infer<typeof LayerIdSchema>

export const WorkloadPurposeSchema = z.enum(['training', 'inference', 'mixed'])
export const ContainmentSchema = z.enum(['none', 'hotAisle', 'coldAisle'])
export const PipingRouteSchema = z.enum(['raisedFloor', 'overhead'])
export const RedundancySchema = z.enum(['N', 'N+1', '2N'])
export const FabricSchema = z.enum(['railOptimized', 'fatTree'])
export const FloorTypeSchema = z.enum(['raised', 'slab'])
export const NoteImportanceSchema = z.enum(['must', 'prefer', 'fyi'])
export const PositionKindSchema = z.enum(['cdu', 'crah', 'plant', 'electrical', 'leaf'])

/** Floor bay. Coordinates in meters from the hall's north-west corner (x east, z south); x/z is the bay's north-west corner. */
export const BaySchema = z.object({
  id: z.string(), // "B3-2": column 3 (along x), row 2 (along z), 1-based
  x: z.number(),
  z: z.number(),
  w: z.number().positive(),
  d: z.number().positive(),
  ratingKnM2: z.number().positive(),
  pointLimitKn: z.number().positive(),
})
export type Bay = z.infer<typeof BaySchema>

/** Rack row. x/z is the north-west corner of the row footprint; slots run east at `slotPitchM`. */
export const RowSchema = z.object({
  id: z.string(), // "R1"
  x: z.number(),
  z: z.number(),
  slotCount: z.number().int().positive(),
  slotPitchM: z.literal(0.6),
  rackDepthM: z.literal(1.2),
  hotAisle: z.enum(['north', 'south']),
})
export type Row = z.infer<typeof RowSchema>

/** A place the engine may fill with auto-sized equipment. `capacity` is the number of units it holds. */
export const EquipmentPositionSchema = z.object({
  id: z.string(),
  kind: PositionKindSchema,
  x: z.number(),
  z: z.number(),
  servesRows: z.array(z.string()),
  capacity: z.number().int().nonnegative(),
})
export type EquipmentPosition = z.infer<typeof EquipmentPositionSchema>

export const HallSchema = z.object({
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  ceilingM: z.number().positive(),
  floor: z.object({ type: FloorTypeSchema }),
  bays: z.array(BaySchema),
  rows: z.array(RowSchema),
  positions: z.array(EquipmentPositionSchema),
})
export type Hall = z.infer<typeof HallSchema>

export const RackGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  rackTypeId: z.string(),
  coolingMethodId: z.string(),
})
export type RackGroup = z.infer<typeof RackGroupSchema>

export const PlacementSchema = z.object({
  id: z.string(), // "<rowId>-<slot, 2 digits>", e.g. "R3-07"
  groupId: z.string(),
  rowId: z.string(),
  slot: z.number().int().nonnegative(), // leftmost slot
})
export type Placement = z.infer<typeof PlacementSchema>

export const EquipmentOverrideSchema = z.object({
  key: z.string(),
  modelId: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  positionIds: z.array(z.string()).optional(),
})
export type EquipmentOverride = z.infer<typeof EquipmentOverrideSchema>

/** Note targets: `decision:<dot.path>`, `group:<groupId>`, `layer:<LayerId>`, `rack:<placementId>`. */
export const NoteSchema = z.object({
  id: z.string(),
  target: z.string(),
  importance: NoteImportanceSchema,
  authorRole: LayerIdSchema,
  text: z.string().min(1),
  createdAt: z.string(),
})
export type Note = z.infer<typeof NoteSchema>

export const OwnerSchema = z.object({ initials: z.string(), name: z.string() })

export const SiteSchema = z.object({
  climateId: z.string(),
  gridCapacityW: z.number().positive(),
  waterAllowanceM3PerDay: z.number().nonnegative(),
  valueOfComputeUsdPerGpuHour: z.number().nonnegative(),
})

export const CoolingDecisionsSchema = z.object({
  heatRejectionId: z.string(),
  facilitySupplyC: z.number(),
  pipingRoute: PipingRouteSchema,
  flowBalancing: z.boolean(),
  bufferTankM3: z.number().nonnegative(),
  containment: ContainmentSchema,
})

/**
 * Power oversubscription: summed rack peak over provisioned power. 1 is none; 2 (half the peak provisioned)
 * is already far past what operators run, and smaller values would size unbounded equipment counts.
 */
export const POWER_OVERSUBSCRIPTION_RANGE = { min: 1, max: 2 } as const
/** Leaf uplink oversubscription as the number before ":1". 1:1 is non-blocking; 8:1 is the far end for AI fabrics. */
export const NETWORK_OVERSUBSCRIPTION_RANGE = { min: 1, max: 8 } as const

export const PowerOversubscriptionSchema = z
  .number()
  .min(POWER_OVERSUBSCRIPTION_RANGE.min, `Power oversubscription must be at least ${POWER_OVERSUBSCRIPTION_RANGE.min} (1 means no oversubscription)`)
  .max(POWER_OVERSUBSCRIPTION_RANGE.max, `Power oversubscription must be at most ${POWER_OVERSUBSCRIPTION_RANGE.max} (provisioning for half the rack peak)`)
export const NetworkOversubscriptionSchema = z
  .number()
  .min(NETWORK_OVERSUBSCRIPTION_RANGE.min, `Network oversubscription must be at least ${NETWORK_OVERSUBSCRIPTION_RANGE.min} (1 means 1:1, non-blocking)`)
  .max(NETWORK_OVERSUBSCRIPTION_RANGE.max, `Network oversubscription must be at most ${NETWORK_OVERSUBSCRIPTION_RANGE.max} (8:1)`)

export const PowerDecisionsSchema = z.object({
  redundancy: RedundancySchema,
  distribution: PowerDistributionSchema,
  oversubscription: PowerOversubscriptionSchema,
})

export const NetworkDecisionsSchema = z.object({
  fabric: FabricSchema,
  oversubscription: NetworkOversubscriptionSchema,
})

export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  updatedAt: z.string(),
  owners: z.record(LayerIdSchema, OwnerSchema),
  site: SiteSchema,
  hall: HallSchema,
  workload: z.object({ purpose: WorkloadPurposeSchema, targetPflops: z.number().nonnegative() }),
  rackGroups: z.array(RackGroupSchema),
  placements: z.array(PlacementSchema),
  cooling: CoolingDecisionsSchema,
  power: PowerDecisionsSchema,
  network: NetworkDecisionsSchema,
  overrides: z.array(EquipmentOverrideSchema),
  notes: z.array(NoteSchema),
  catalog: z.record(z.string(), CatalogEntrySchema),
})
export type Plan = z.infer<typeof PlanSchema>

export function placementId(rowId: string, slot: number): string {
  return `${rowId}-${String(slot).padStart(2, '0')}`
}
