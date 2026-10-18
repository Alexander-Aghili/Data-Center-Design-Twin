import { createDefaultPlan } from '@twin/catalog'
import {
  CLIMATE,
  COOLANT,
  EQUIPMENT,
  HEAT_REJECTION,
  HOURS_PER_YEAR,
  RACK,
  RACK_COOLING,
  type CatalogEntry,
  type CatalogIndex,
  type CatalogKind,
  type ClimateEntry,
  type CoolantEntry,
  type EquipmentEntry,
  type HeatRejectionEntry,
  type Plan,
  type Quantity,
  type RackCoolingCategory,
  type RackCoolingEntry,
  type RackEntry,
} from '@twin/schema'

/** Small inline catalog built from the schema, so command tests do not depend on data files. */
const q = (value: number | null, unit: string): Quantity => ({ value, unit, basis: 'textbook' })

const meta = { asOf: '2026-10', summary: 'Test fixture.' }

function rack(id: string, name: string, widthMm: number, supportedCooling: RackCoolingCategory[]): RackEntry {
  return {
    ...meta,
    id,
    name,
    kind: 'rack',
    role: 'compute',
    gpuCount: 16,
    nominalPowerW: q(28_000, 'W'),
    peakPowerW: q(32_000, 'W'),
    weightKg: q(900, 'kg'),
    widthMm: q(widthMm, 'mm'),
    depthMm: q(1200, 'mm'),
    heightMm: q(2000, 'mm'),
    slotsWide: Math.ceil(widthMm / 600),
    feet: 4,
    maxLiquidFraction: q(0, 'fraction'),
    maxCoolantSupplyC: q(null, '°C'),
    supportedCooling,
    supportedPower: ['ac54'],
    scaleOutPorts: 8,
    portGbps: 800,
    fp8Pflops: q(72, 'PFLOPS'),
    trays: { compute: 2, switch: 0, power: 1 },
    capexUsd: q(3_000_000, 'USD'),
    leadTimeWeeks: q(20, 'weeks'),
  }
}

function rackCooling(id: string, name: string, category: RackCoolingCategory, coolantId?: string): RackCoolingEntry {
  return {
    ...meta,
    id,
    name,
    kind: 'rackCooling',
    category,
    maxRackW: q(40_000, 'W'),
    toTechnicalLoop: q(category === 'air' ? 0 : 0.85, 'fraction'),
    coolantId,
    supplyRangeC: { min: q(18, '°C'), max: q(40, '°C') },
    deltaTK: q(10, 'K'),
    pressureDropKpa: q(50, 'kPa'),
    addedWeightKgPerRack: q(0, 'kg'),
    formFactor: 'rack',
    requiresCdu: category !== 'air',
    pumpPowerFraction: q(0.01, 'fraction'),
    capexUsdPerKw: q(300, 'USD/kW'),
    installWeeks: q(4, 'weeks'),
    leadTimeWeeks: q(12, 'weeks'),
    risks: [],
    status: 'mainstream',
  }
}

const coolant: CoolantEntry = {
  ...meta,
  id: COOLANT.PG25,
  name: 'PG25',
  kind: 'coolant',
  cpJPerKgK: q(3900, 'J/(kg·K)'),
  densityKgM3: q(1020, 'kg/m³'),
  viscosityPaS: q(0.002, 'Pa·s'),
  dielectric: false,
  glycolFraction: q(0.25, 'fraction'),
  twoPhase: false,
}

function heatRejection(id: string, name: string): HeatRejectionEntry {
  return {
    ...meta,
    id,
    name,
    kind: 'heatRejection',
    category: 'dryCooler',
    basis: 'dryBulb',
    approachK: q(5, 'K'),
    copRef: q(4, 'ratio'),
    copRefOutdoorC: q(35, '°C'),
    copSlopePerK: q(0.1, '1/K'),
    economizer: false,
    fanPowerFraction: q(0.02, 'fraction'),
    waterLPerKwh: q(0, 'L/kWh'),
    unitCapacityW: q(1_000_000, 'W'),
    capexUsdPerKw: q(150, 'USD/kW'),
    leadTimeWeeks: q(20, 'weeks'),
    installWeeks: q(6, 'weeks'),
    footprintM2PerMw: q(40, 'm²/MW'),
  }
}

function climate(id: string, city: string): ClimateEntry {
  return {
    ...meta,
    id,
    name: city,
    kind: 'climate',
    city,
    lat: 0,
    lon: 0,
    dryBulbC: Array.from({ length: HOURS_PER_YEAR }, () => 20),
    wetBulbC: Array.from({ length: HOURS_PER_YEAR }, () => 15),
    designDryBulbC: q(35, '°C'),
  }
}

const cdu: EquipmentEntry = {
  ...meta,
  id: EQUIPMENT.CDU_1200KW,
  name: 'CDU 1.2 MW',
  kind: 'equipment',
  category: 'cdu',
  params: {
    capacityW: q(1_200_000, 'W'),
    maxFlowLps: q(30, 'L/s'),
    approachK: q(3, 'K'),
    pumpPowerW: q(15_000, 'W'),
    weightKg: q(1500, 'kg'),
    capexUsd: q(250_000, 'USD'),
    leadTimeWeeks: q(16, 'weeks'),
  },
}

/** A double-wide liquid rack (1200 mm wide), only in the test catalog. */
export const WIDE_RACK = 'rack.test-wide'

export const builtinEntries: CatalogEntry[] = [
  rack(RACK.HGX_B300_AIR, 'HGX B300 air', 600, ['air', 'rdhx']),
  rack(RACK.GB300_NVL72, 'GB300 NVL72', 600, ['dlc-1p', 'dlc-2p']),
  rack(WIDE_RACK, 'Wide test rack', 1200, ['air', 'dlc-1p']),
  rackCooling(RACK_COOLING.AIR_CONTAINED, 'Air with containment', 'air'),
  rackCooling(RACK_COOLING.DLC_1P, 'Single-phase direct-to-chip', 'dlc-1p', COOLANT.PG25),
  coolant,
  heatRejection(HEAT_REJECTION.CHILLER_AIR, 'Air-cooled chiller'),
  heatRejection(HEAT_REJECTION.DRY_COOLER, 'Dry cooler'),
  climate(CLIMATE.DALLAS, 'Dallas'),
  climate(CLIMATE.STOCKHOLM, 'Stockholm'),
  cdu,
]

export function makeIndex(entries: CatalogEntry[]): CatalogIndex {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return {
    get<K extends CatalogKind>(id: string, kind?: K) {
      const entry = byId.get(id)
      if (!entry || (kind !== undefined && entry.kind !== kind)) return undefined
      return entry as Extract<CatalogEntry, { kind: K }>
    },
    all: () => [...byId.values()],
  }
}

export const catalog = makeIndex(builtinEntries)

/** The default plan (R1–R2 = g1, R3–R5 = g2, 16 racks per row in 24-slot rows). */
export function plan(): Plan {
  return createDefaultPlan()
}

/** A custom rack entry as a person would type it: quantities without a basis. */
export function customRackInput(id: string): unknown {
  const entry = rack(id, 'My rack', 600, ['air'])
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) if (k !== 'basis') out[k] = strip(v)
      return out
    }
    return value
  }
  return strip(entry)
}
