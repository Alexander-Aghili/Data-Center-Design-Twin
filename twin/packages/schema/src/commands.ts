import type { Draft } from 'immer'
import { z } from 'zod'
import { CatalogEntryInputSchema, PowerDistributionSchema, type CatalogIndex } from './catalog'
import {
  ContainmentSchema,
  FabricSchema,
  FloorTypeSchema,
  LayerIdSchema,
  NoteImportanceSchema,
  PipingRouteSchema,
  RedundancySchema,
  WorkloadPurposeSchema,
  type LayerId,
  type Plan,
} from './plan'

const id = z.string().min(1)
const slot = z.number().int().nonnegative()

/** Payload schema per command type. The registry (packages/commands) supplies `apply` and `summarize`. */
export const CommandSchemas = {
  // plan
  newPlan: z.object({}),
  importPlan: z.object({ plan: z.unknown() }),
  renamePlan: z.object({ name: z.string().min(1) }),
  // site
  setSiteInput: z.object({
    field: z.enum(['climateId', 'gridCapacityW', 'waterAllowanceM3PerDay', 'valueOfComputeUsdPerGpuHour']),
    value: z.union([z.string(), z.number()]),
  }),
  setFloor: z.object({ type: FloorTypeSchema, ratingKnM2: z.number().positive().optional() }),
  setBayRating: z.object({ bayId: id, ratingKnM2: z.number().positive() }),
  // workload
  setWorkload: z.object({ purpose: WorkloadPurposeSchema.optional(), targetPflops: z.number().nonnegative().optional() }),
  // compute
  createRackGroup: z.object({ name: z.string().min(1), rackTypeId: id, coolingMethodId: id }),
  setRackType: z.object({ groupId: id, rackTypeId: id }),
  renameRackGroup: z.object({ groupId: id, name: z.string().min(1) }),
  deleteRackGroup: z.object({ groupId: id }),
  // layout
  placeRacks: z.object({ groupId: id, rowId: id, slots: z.array(slot).min(1) }),
  fillRow: z.object({ groupId: id, rowId: id, from: slot, count: z.number().int().positive() }),
  moveRack: z.object({ placementId: id, rowId: id, slot }),
  removeRacks: z.object({ placementIds: z.array(id).min(1) }),
  setContainment: z.object({ containment: ContainmentSchema }),
  assignZone: z.object({ positionId: id, rowIds: z.array(id) }),
  // cooling
  setCoolingMethod: z.object({ groupId: id, coolingMethodId: id }),
  setHeatRejection: z.object({ heatRejectionId: id }),
  setFacilitySupplyTemp: z.object({ celsius: z.number() }),
  setPipingRoute: z.object({ route: PipingRouteSchema }),
  setFlowBalancing: z.object({ enabled: z.boolean() }),
  setBufferTank: z.object({ m3: z.number().nonnegative() }),
  // power
  setRedundancy: z.object({ redundancy: RedundancySchema }),
  setDistribution: z.object({ distribution: PowerDistributionSchema }),
  setOversubscription: z.object({ factor: z.number().positive() }),
  // network
  setFabric: z.object({ fabric: FabricSchema }),
  setNetworkOversubscription: z.object({ ratio: z.number().positive() }),
  // equipment
  overrideEquipment: z.object({
    key: id,
    modelId: id.optional(),
    count: z.number().int().nonnegative().optional(),
    positionIds: z.array(id).optional(),
  }),
  clearOverride: z.object({ key: id }),
  // notes
  addNote: z.object({ target: id, importance: NoteImportanceSchema, authorRole: LayerIdSchema, text: z.string().min(1) }),
  editNote: z.object({ id, text: z.string().min(1).optional(), importance: NoteImportanceSchema.optional() }),
  removeNote: z.object({ id }),
  // catalog
  addCatalogEntry: z.object({ entry: CatalogEntryInputSchema }),
  updateCatalogEntry: z.object({ entry: CatalogEntryInputSchema }),
  removeCatalogEntry: z.object({ id }),
} as const

export type CommandType = keyof typeof CommandSchemas
export type CommandPayloads = { [K in CommandType]: z.infer<(typeof CommandSchemas)[K]> }
export const COMMAND_TYPES = Object.keys(CommandSchemas) as CommandType[]

export interface Command<T extends string = string, P = unknown> {
  type: T
  payload: P
}

/** A command of a known type with its typed payload. */
export type TypedCommand = { [K in CommandType]: Command<K, CommandPayloads[K]> }[CommandType]

/** Wire shape of a command; the registry validates the payload against `CommandSchemas[type]`. */
export const CommandSchema = z.object({ type: z.string(), payload: z.unknown() })

/** The group a command belongs to: a layer, or one of the cross-cutting groups. */
export type CommandGroup = LayerId | 'plan' | 'equipment' | 'notes' | 'catalog'

export interface CommandContext {
  catalog: CatalogIndex
}

export interface CommandDef<T extends string, P> {
  type: T
  layer: CommandGroup
  title: string // "Set cooling method"
  description: string // used verbatim as the agent tool description
  payload: z.ZodType<P, unknown>
  /** Mutates the immer draft; throws CommandError to reject. */
  apply(draft: Draft<Plan>, payload: P, ctx: CommandContext): void
  /** Plain-language change record, e.g. "Rows 3–5: GB300 NVL72". */
  summarize(payload: P, plan: Plan): string
}

export class CommandError extends Error {
  readonly path?: string

  constructor(message: string, path?: string) {
    super(message)
    this.name = 'CommandError'
    this.path = path
  }
}
