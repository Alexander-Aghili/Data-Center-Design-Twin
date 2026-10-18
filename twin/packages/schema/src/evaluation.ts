import { z } from 'zod'
import { LayerIdSchema } from './plan'
import { BasisSchema } from './quantity'

export const StatusSchema = z.enum(['pass', 'warn', 'fail', 'unknown'])
export type Status = z.infer<typeof StatusSchema>

export const CHECK_KINDS = [
  'cooling.rackHeatLimit', 'cooling.crahCapacity', 'cooling.cduCapacity', 'cooling.cduPositions', 'cooling.manifoldBalance',
  'cooling.coolantTemp', 'cooling.airInletTemp', 'cooling.heatRejection', 'cooling.rideThrough', 'cooling.waterPeakDay', 'cooling.leakExposure',
  'power.gridWorstHour', 'power.busway', 'power.trainingSwing', 'power.ups', 'power.transformer', 'power.inputCompat',
  'layout.floorBay', 'layout.pointLoad',
  'network.copperReach', 'network.leafPorts',
  'demand.leadTime', 'workload.targetCompute',
] as const
export const CheckKindSchema = z.enum(CHECK_KINDS)
export type CheckKind = z.infer<typeof CheckKindSchema>

export const MetricSchema = z.object({
  id: z.string(),
  layer: LayerIdSchema,
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  basis: BasisSchema,
  inputs: z.array(z.string()),
  group: z.string().optional(),
})
export type Metric = z.infer<typeof MetricSchema>

export const CauseSchema = z.object({
  layer: LayerIdSchema,
  path: z.string(), // "rackGroups.g2.rackTypeId"
  label: z.string(),
  value: z.string(),
})
export type Cause = z.infer<typeof CauseSchema>

export const CheckSchema = z.object({
  id: z.string(), // "<kind>:<subjectId>", e.g. "cooling.rackHeatLimit:g2"
  kind: CheckKindSchema,
  layer: LayerIdSchema,
  subject: z.object({
    kind: z.enum(['group', 'rack', 'row', 'bay', 'equipment', 'site', 'plant']),
    id: z.string(),
    objectIds: z.array(z.string()), // 3D object ids
  }),
  title: z.string(),
  value: z.number().nullable(),
  limit: z.number().nullable(),
  unit: z.string(),
  utilization: z.number().nullable(),
  status: StatusSchema,
  worstFailure: z
    .object({ scenario: z.string(), value: z.number().nullable(), utilization: z.number().nullable(), status: StatusSchema })
    .optional(),
  explanation: z.string(),
  causes: z.array(CauseSchema),
  advice: z.string().optional(),
})
export type Check = z.infer<typeof CheckSchema>

export const RackResultSchema = z.object({
  placementId: z.string(),
  groupId: z.string(),
  rowId: z.string(),
  slot: z.number(),
  objectId: z.string(),
  powerW: z.number(),
  heatW: z.number(),
  liquidW: z.number(),
  facilityWaterW: z.number(),
  airW: z.number(),
  flowLps: z.number().nullable(),
  supplyC: z.number().nullable(),
  returnC: z.number().nullable(),
  airInletC: z.number().nullable(),
  airOutletC: z.number().nullable(),
  weightKg: z.number(),
  bayId: z.string(),
  flowShare: z.number().nullable(),
  coolingOk: z.boolean(),
})
export type RackResult = z.infer<typeof RackResultSchema>

export const SizedEquipmentSchema = z.object({
  key: z.string(), // "cdu:R3" | "crah:Z1" | "plant" | "busway:R3" | "ups" | "transformer" | "leaf:L1" | "bufferTank"
  category: z.string(),
  modelId: z.string().nullable(),
  count: z.number(),
  required: z.number(),
  positionIds: z.array(z.string()),
  autoSized: z.boolean(),
  loadW: z.number(),
  capacityW: z.number().nullable(),
  objectIds: z.array(z.string()),
})
export type SizedEquipment = z.infer<typeof SizedEquipmentSchema>

export const HourlySeriesSchema = z.object({
  outdoorC: z.array(z.number()),
  wetBulbC: z.array(z.number()),
  itW: z.array(z.number()),
  coolingW: z.array(z.number()),
  facilityW: z.array(z.number()),
  pue: z.array(z.number().nullable()),
  waterM3: z.array(z.number()),
  trimW: z.array(z.number()),
})
export type HourlySeries = z.infer<typeof HourlySeriesSchema>
export type HourlySeriesKey = keyof HourlySeries

export const HeadlineSchema = z.object({
  usablePflops: z.number(),
  placedPflops: z.number(),
  gpuCount: z.number(),
  hoursOverCap: z.number(),
  worstHour: z.number(),
  buildable: z.boolean(),
  pueAnnual: z.number().nullable(),
  pueWorst: z.number().nullable(),
  waterM3PerDayPeak: z.number(),
})
export type Headline = z.infer<typeof HeadlineSchema>

export const RowLoadSchema = z.object({
  rowId: z.string(),
  airW: z.number(),
  liquidW: z.number(),
  flowLps: z.number(),
  buswayLoadA: z.number(),
  cduKey: z.string().nullable(),
})
export type RowLoad = z.infer<typeof RowLoadSchema>

export const BayLoadSchema = z.object({
  bayId: z.string(),
  loadKnM2: z.number(),
  ratingKnM2: z.number(),
  utilization: z.number(),
})
export type BayLoad = z.infer<typeof BayLoadSchema>

export const NetworkResultSchema = z.object({
  links: z.array(
    z.object({ fromId: z.string(), toId: z.string(), media: z.enum(['dac', 'aec', 'fiber']), lengthM: z.number() }),
  ),
  opticsW: z.number(),
  cableM: z.number(),
  baseLatencyNs: z.number().nullable(), // null when no link exists (empty hall)
  oversubscription: z.number(),
})
export type NetworkResult = z.infer<typeof NetworkResultSchema>

export const CostResultSchema = z.object({
  capexUsd: z.number(),
  byCategory: z.record(z.string(), z.number()),
  buildWeeks: z.number(),
  criticalPath: z.array(z.string()),
  delayCostUsd: z.number(),
})
export type CostResult = z.infer<typeof CostResultSchema>

export const EvaluationSchema = z.object({
  headline: HeadlineSchema,
  metrics: z.array(MetricSchema),
  checks: z.array(CheckSchema),
  racks: z.array(RackResultSchema),
  equipment: z.array(SizedEquipmentSchema),
  rows: z.array(RowLoadSchema),
  bays: z.array(BayLoadSchema),
  network: NetworkResultSchema,
  cost: CostResultSchema,
  hourly: HourlySeriesSchema,
})
export type Evaluation = z.infer<typeof EvaluationSchema>

const DeltaValueSchema = z.union([z.number(), z.boolean()]).nullable()

export const EvalDiffSchema = z.object({
  headline: z.partialRecord(HeadlineSchema.keyof(), z.object({ from: DeltaValueSchema, to: DeltaValueSchema })),
  worsened: z.array(CheckSchema),
  improved: z.array(CheckSchema),
  resolved: z.array(CheckSchema),
  newChecks: z.array(CheckSchema),
  capexDeltaUsd: z.number(),
  buildWeeksDelta: z.number(),
  waterDeltaM3PerDay: z.number(),
})
export type EvalDiff = z.infer<typeof EvalDiffSchema>
