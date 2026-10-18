import { z } from 'zod'
import { QuantityInputSchema, QuantitySchema, type Quantity } from './quantity'

export const RACK_COOLING_CATEGORIES = ['air', 'rdhx', 'dlc-1p', 'dlc-2p', 'immersion-1p', 'immersion-2p', 'custom'] as const
export const RackCoolingCategorySchema = z.enum(RACK_COOLING_CATEGORIES)
export type RackCoolingCategory = z.infer<typeof RackCoolingCategorySchema>

export const PowerDistributionSchema = z.enum(['ac54', 'dc800'])
export type PowerDistribution = z.infer<typeof PowerDistributionSchema>

export const CATALOG_KINDS = ['gpu', 'rack', 'rackCooling', 'heatRejection', 'coolant', 'equipment', 'climate'] as const
export const CatalogKindSchema = z.enum(CATALOG_KINDS)
export type CatalogKind = z.infer<typeof CatalogKindSchema>

export const EQUIPMENT_CATEGORIES = ['cdu', 'crah', 'bufferTank', 'busway', 'ups', 'transformer', 'leaf', 'optic', 'cable'] as const
export const EquipmentCategorySchema = z.enum(EQUIPMENT_CATEGORIES)
export type EquipmentCategory = z.infer<typeof EquipmentCategorySchema>

/** Param keys every equipment entry of a category must carry. */
export const EQUIPMENT_REQUIRED_PARAMS: Record<EquipmentCategory, readonly string[]> = {
  cdu: ['capacityW', 'maxFlowLps', 'approachK', 'pumpPowerW', 'weightKg', 'capexUsd', 'leadTimeWeeks'],
  crah: ['capacityW', 'airflowM3s', 'fanPowerW', 'capexUsd', 'leadTimeWeeks'],
  bufferTank: ['capexUsdPerM3', 'leadTimeWeeks'],
  busway: ['ratingA', 'voltageV', 'powerFactor', 'capexUsdPerM', 'leadTimeWeeks'],
  ups: ['moduleW', 'efficiency', 'capexUsdPerKw', 'leadTimeWeeks'],
  transformer: ['ratingVa', 'efficiency', 'capexUsd', 'leadTimeWeeks'],
  leaf: ['ports', 'portGbps', 'powerW', 'capexUsd'],
  optic: ['powerW', 'reachM', 'capexUsd'],
  cable: ['reachM', 'powerWPerEnd', 'capexUsdPerM'],
}

export const HOURS_PER_YEAR = 8760

export const SourceRefSchema = z.object({ id: z.string(), url: z.url(), title: z.string() })

const base = {
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().optional(),
  asOf: z.string(),
  custom: z.boolean().optional(),
  sources: z.array(SourceRefSchema).optional(),
  summary: z.string(),
}

/** Builds the entry union over a quantity schema, so stored entries and user input share one shape. */
function catalogSchemas(q: z.ZodType<Quantity, unknown>) {
  const gpu = z.object({
    ...base,
    kind: z.literal('gpu'),
    tdpW: q,
    fp8Pflops: q,
    fp4Pflops: q,
    hbmGb: q,
    cooling: z.enum(['air', 'liquid', 'either']),
  })

  const rack = z
    .object({
      ...base,
      kind: z.literal('rack'),
      role: z.enum(['compute', 'network', 'storage']),
      gpuId: z.string().optional(),
      gpuCount: z.number().int().nonnegative(),
      nominalPowerW: q,
      peakPowerW: q,
      weightKg: q,
      widthMm: q,
      depthMm: q,
      heightMm: q,
      slotsWide: z.number().int().positive(),
      feet: z.number().int().positive(),
      maxLiquidFraction: q,
      maxCoolantSupplyC: q,
      supportedCooling: z.array(RackCoolingCategorySchema),
      supportedPower: z.array(PowerDistributionSchema),
      scaleOutPorts: z.number().int().nonnegative(),
      portGbps: z.number().nonnegative(),
      fp8Pflops: q,
      trays: z.object({
        compute: z.number().int().nonnegative(),
        switch: z.number().int().nonnegative(),
        power: z.number().int().nonnegative(),
      }),
      capexUsd: q,
      leadTimeWeeks: q,
    })
    .superRefine((r, ctx) => {
      const width = r.widthMm.value
      if (width !== null && r.slotsWide !== Math.ceil(width / 600)) {
        ctx.addIssue({ code: 'custom', path: ['slotsWide'], message: `slotsWide must be ceil(widthMm / 600) = ${Math.ceil(width / 600)}` })
      }
    })

  const rackCooling = z.object({
    ...base,
    kind: z.literal('rackCooling'),
    category: RackCoolingCategorySchema,
    maxRackW: q,
    toTechnicalLoop: q,
    toFacilityWaterAtRack: q.optional(),
    coolantId: z.string().optional(),
    supplyRangeC: z.object({ min: q, max: q }),
    deltaTK: q,
    pressureDropKpa: q,
    addedWeightKgPerRack: q,
    formFactor: z.enum(['rack', 'tank']),
    tankFootprintM2PerRack: q.optional(),
    requiresCdu: z.boolean(),
    pumpPowerFraction: q,
    capexUsdPerKw: q,
    installWeeks: q,
    leadTimeWeeks: q,
    risks: z.array(z.string()),
    status: z.enum(['mainstream', 'emerging', 'stalled', 'research']),
  })

  const heatRejection = z.object({
    ...base,
    kind: z.literal('heatRejection'),
    category: z.enum(['chiller', 'dryCooler', 'adiabaticDryCooler', 'coolingTower', 'custom']),
    basis: z.enum(['dryBulb', 'wetBulb']),
    approachK: q,
    copRef: q,
    copRefOutdoorC: q,
    copSlopePerK: q,
    economizer: z.boolean(),
    fanPowerFraction: q,
    waterLPerKwh: q,
    adiabaticAboveC: q.optional(),
    unitCapacityW: q,
    capexUsdPerKw: q,
    leadTimeWeeks: q,
    installWeeks: q,
    footprintM2PerMw: q,
  })

  const coolant = z.object({
    ...base,
    kind: z.literal('coolant'),
    cpJPerKgK: q,
    densityKgM3: q,
    viscosityPaS: q,
    dielectric: z.boolean(),
    glycolFraction: q,
    twoPhase: z.boolean(),
  })

  const equipment = z
    .object({
      ...base,
      kind: z.literal('equipment'),
      category: EquipmentCategorySchema,
      params: z.record(z.string(), q),
    })
    .superRefine((e, ctx) => {
      for (const key of EQUIPMENT_REQUIRED_PARAMS[e.category]) {
        if (!(key in e.params)) {
          ctx.addIssue({ code: 'custom', path: ['params', key], message: `${e.category} needs param "${key}"` })
        }
      }
    })

  const climate = z.object({
    ...base,
    kind: z.literal('climate'),
    city: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    dryBulbC: z.array(z.number()).length(HOURS_PER_YEAR),
    wetBulbC: z.array(z.number()).length(HOURS_PER_YEAR),
    designDryBulbC: q,
  })

  const entry = z.discriminatedUnion('kind', [gpu, rack, rackCooling, heatRejection, coolant, equipment, climate])
  return { gpu, rack, rackCooling, heatRejection, coolant, equipment, climate, entry }
}

const stored = catalogSchemas(QuantitySchema)

export const GpuEntrySchema = stored.gpu
export const RackEntrySchema = stored.rack
export const RackCoolingEntrySchema = stored.rackCooling
export const HeatRejectionEntrySchema = stored.heatRejection
export const CoolantEntrySchema = stored.coolant
export const EquipmentEntrySchema = stored.equipment
export const ClimateEntrySchema = stored.climate
export const CatalogEntrySchema = stored.entry

/** Custom-entry input (commands, forms, catalog packs): quantities without a basis default to `user`. */
export const CatalogEntryInputSchema = catalogSchemas(QuantityInputSchema).entry

export type GpuEntry = z.infer<typeof GpuEntrySchema>
export type RackEntry = z.infer<typeof RackEntrySchema>
export type RackCoolingEntry = z.infer<typeof RackCoolingEntrySchema>
export type HeatRejectionEntry = z.infer<typeof HeatRejectionEntrySchema>
export type CoolantEntry = z.infer<typeof CoolantEntrySchema>
export type EquipmentEntry = z.infer<typeof EquipmentEntrySchema>
export type ClimateEntry = z.infer<typeof ClimateEntrySchema>
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>
export type CatalogEntryOfKind<K extends CatalogKind> = Extract<CatalogEntry, { kind: K }>

/** Lookup over the resolved catalog (plan snapshot merged over the built-ins). */
export interface CatalogIndex {
  get<K extends CatalogKind>(id: string, kind?: K): CatalogEntryOfKind<K> | undefined
  all(): CatalogEntry[]
}

export const RULE_KEYS = [
  'airDensity', 'airCp', 'airDeltaTK', 'airDeltaTKContained',
  'distributionEfficiency', 'upsEfficiency', 'transformerEfficiency',
  'miscFacilityFraction', 'crahFanFractionFallback',
  'facilityLoopDeltaTK', 'manifoldHeaderLossFraction', 'balancingValvePumpPenalty',
  'bufferAllowedRiseK', 'chillerRestartS', 'towerBlowdownFactor',
  'peakToAverageTraining', 'peakToAverageInference', 'peakToAverageMixed',
  'dacReachM', 'aecReachM', 'fiberNsPerM', 'copperNsPerM', 'hopNs',
  'pipingUsdPerMRaised', 'pipingUsdPerMOverhead', 'raisedFloorInstallWeeks', 'overheadInstallWeeks', 'routingSlackM',
  'warnThreshold',
] as const
export const RuleKeySchema = z.enum(RULE_KEYS)
export type RuleKey = z.infer<typeof RuleKeySchema>

/** Model coefficients; every key is required. Lives in `packages/catalog/data/rules.json`. */
export const RulesSchema = z.record(RuleKeySchema, QuantitySchema)
export type Rules = z.infer<typeof RulesSchema>

/** The built-in catalog as served by `GET /api/catalog` and passed to `evaluate`. */
export interface Builtins {
  entries: CatalogEntry[]
  rules: Rules
}
