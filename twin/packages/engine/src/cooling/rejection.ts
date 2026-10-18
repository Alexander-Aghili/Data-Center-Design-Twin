import {
  HEAT_REJECTION,
  num,
  type Check,
  type HeatRejectionEntry,
  type HourlySeries,
  type Metric,
  type Quantity,
  type RackResult,
  type SizedEquipment,
  type Status,
} from '@twin/schema'
import type { EvalContext } from '../context'

export interface RejectionResult {
  hourly: Pick<HourlySeries, 'outdoorC' | 'wetBulbC' | 'coolingW' | 'trimW' | 'waterM3'>
  checks: Check[]
  metrics: Metric[]
}

/** Lowest COP the chiller curve may reach on extreme hours (plan, Task 9 model). */
const COP_FLOOR = 1.5
/** Coil air temperature at which outdoor-coil fan power sits at its base fraction, and the rise that doubles it (plan, Task 9 model). */
const FAN_BASE_C = 10
const FAN_DOUBLING_K = 30
const HOURS_PER_DAY = 24
const NBSP = ' '

interface Plant {
  entry: HeatRejectionEntry
  approachK: number
  fanFraction: number
  unitW: number
  waterLPerKwh: number
  loopDeltaTK: number
  /** COP curve of the chiller itself, or of the trim chiller behind an outdoor coil. */
  cop: (outdoorC: number) => number
  /** Compressor plant (chiller); otherwise an outdoor coil backed by a trim chiller. */
  isChiller: boolean
  adiabaticAboveC: number | null
  blowdownFactor: number
}

interface Unresolved {
  missing: string[]
  entry: HeatRejectionEntry | undefined
}

interface PlantHour {
  coolingW: number
  trimW: number
  waterM3: number
  compressorOn: boolean
}

/** Hour-by-hour heat rejection power and water (Task 9). */
export function rejectHeat(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): RejectionResult {
  const { plan, climate } = ctx
  const hallW = hallPumpsAndFans(ctx, racks, equipment)
  const loadW = racks.reduce((sum, r) => sum + r.heatW, 0) + hallW
  const resolved = resolvePlant(ctx)
  const plant = 'missing' in resolved ? null : resolved

  const coolingW: number[] = []
  const trimW: number[] = []
  const waterM3: number[] = []
  let compressorHours = 0
  for (let h = 0; h < climate.dryBulbC.length; h++) {
    const hour = plant ? plantHour(plant, plan.cooling.facilitySupplyC, loadW, climate.dryBulbC[h], climate.wetBulbC[h]) : null
    coolingW.push(hallW + (hour?.coolingW ?? 0))
    trimW.push(hour?.trimW ?? 0)
    waterM3.push(hour?.waterM3 ?? 0)
    if (hour?.compressorOn) compressorHours++
  }

  const trimHours = trimW.filter((w) => w > 0).length
  const daily = dailySums(waterM3)
  const peakDay = daily.reduce((best, v, d) => (v > daily[best] ? d : best), 0)
  const peakDayM3 = daily[peakDay] ?? 0
  const known = plant !== null

  const metric = (id: string, label: string, value: number | null, unit: string, inputs: string[]): Metric => ({
    id,
    layer: 'cooling',
    label,
    value,
    unit,
    basis: 'calculated',
    inputs,
    group: 'Heat rejection',
  })
  const plantInputs = ['cooling.heatRejectionId', 'cooling.facilitySupplyC', 'site.climateId']
  const sum = (series: number[]) => series.reduce((a, b) => a + b, 0)
  const metrics = [
    metric('cooling.plantLoadW', 'Heat to reject', loadW, 'W', ['rackGroups', 'placements']),
    metric('cooling.hallPumpFanW', 'Hall pumps and fans', hallW, 'W', ['rackGroups', 'cooling.flowBalancing']),
    metric('cooling.coolingPowerPeakW', 'Cooling power at the worst hour', known ? Math.max(0, ...coolingW) : null, 'W', plantInputs),
    metric('cooling.coolingEnergyWh', 'Cooling energy per year', known ? sum(coolingW) : null, 'Wh', plantInputs),
    metric('cooling.trimHours', 'Hours needing trim cooling', known ? trimHours : null, 'h', plantInputs),
    metric('cooling.freeCoolingHours', 'Hours without compressors', known ? coolingW.length - compressorHours : null, 'h', plantInputs),
    metric('cooling.waterAnnualM3', 'Water per year', known ? sum(waterM3) : null, 'm³', plantInputs),
    metric('cooling.waterPeakDayM3', 'Water on the peak day', known ? peakDayM3 : null, 'm³/day', plantInputs),
  ]

  return {
    hourly: { outdoorC: [...climate.dryBulbC], wetBulbC: [...climate.wetBulbC], coolingW, trimW, waterM3 },
    checks: [
      capacityCheck(ctx, equipment, loadW, plant ? { plant, trimHours } : (resolved as Unresolved)),
      waterCheck(ctx, known, peakDayM3, peakDay),
    ],
    metrics,
  }
}

/**
 * Pump and fan power inside the hall. Pumps are counted once (ruling R-pump): CDU pumps from the CDU model
 * at part load, and a method's pump fraction only for methods without a CDU.
 */
function hallPumpsAndFans(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): number {
  const { plan, catalog, rules } = ctx
  const penalty = plan.cooling.flowBalancing ? (num(rules.balancingValvePumpPenalty) ?? 0) : 0
  const partLoad = (eq: SizedEquipment, unitPowerKey: string) => {
    const params = eq.modelId ? catalog.get(eq.modelId, 'equipment')?.params : undefined
    const unitW = params?.[unitPowerKey] ? num(params[unitPowerKey]) : null
    const capacityW = params?.capacityW ? num(params.capacityW) : null
    if (unitW === null || capacityW === null || capacityW <= 0 || eq.count <= 0) return null
    return unitW * eq.count * clamp(eq.loadW / (eq.count * capacityW), 0, 1)
  }

  let watts = 0
  for (const eq of equipment.filter((e) => e.category === 'cdu')) watts += (partLoad(eq, 'pumpPowerW') ?? 0) * (1 + penalty)

  const crahs = equipment.filter((e) => e.category === 'crah')
  const fallbackFan = num(rules.crahFanFractionFallback) ?? 0
  for (const eq of crahs) watts += partLoad(eq, 'fanPowerW') ?? fallbackFan * eq.loadW
  if (crahs.length === 0) watts += fallbackFan * racks.reduce((sum, r) => sum + r.airW, 0)

  const methodOf = new Map(plan.rackGroups.map((g) => [g.id, g.coolingMethodId]))
  for (const rack of racks) {
    const methodId = methodOf.get(rack.groupId)
    const method = methodId ? catalog.get(methodId, 'rackCooling') : undefined
    if (method && !method.requiresCdu) watts += (num(method.pumpPowerFraction) ?? 0) * rack.heatW
  }
  return watts
}

function resolvePlant(ctx: EvalContext): Plant | Unresolved {
  const { plan, catalog, rules } = ctx
  const entry = catalog.get(plan.cooling.heatRejectionId, 'heatRejection')
  if (!entry) return { missing: [`catalog entry "${plan.cooling.heatRejectionId}"`], entry }

  const missing: string[] = []
  const need = (q: Quantity | undefined, label: string) => {
    const v = q ? num(q) : null
    if (v === null) missing.push(label)
    return v ?? 0
  }
  const ownCurve = num(entry.copRef) !== null
  const isChiller = entry.category === 'chiller' || (entry.category === 'custom' && ownCurve)
  // An outdoor coil without its own curve trims with the built-in air-cooled chiller.
  const curve = ownCurve || isChiller ? entry : catalog.get(HEAT_REJECTION.CHILLER_AIR, 'heatRejection')
  const copLabel = curve === entry ? '' : 'trim chiller '
  const copRef = need(curve?.copRef, `${copLabel}COP`)
  const copRefC = need(curve?.copRefOutdoorC, `${copLabel}COP reference temperature`)
  const copSlope = need(curve?.copSlopePerK, `${copLabel}COP slope`)
  const adiabatic = entry.category === 'adiabaticDryCooler' || entry.adiabaticAboveC !== undefined
  const plant: Plant = {
    entry,
    isChiller,
    approachK: need(entry.approachK, 'approach temperature'),
    fanFraction: need(entry.fanPowerFraction, 'fan power fraction'),
    unitW: need(entry.unitCapacityW, 'unit capacity'),
    waterLPerKwh: need(entry.waterLPerKwh, 'water per kWh'),
    loopDeltaTK: need(rules.facilityLoopDeltaTK, 'facility loop temperature rise (rules)'),
    cop: (t) => Math.max(COP_FLOOR, copRef - copSlope * (t - copRefC)),
    adiabaticAboveC: adiabatic ? need(entry.adiabaticAboveC, 'adiabatic threshold') : null,
    blowdownFactor: entry.basis === 'wetBulb' && !adiabatic ? need(rules.towerBlowdownFactor, 'tower blowdown factor (rules)') : 0,
  }
  if (plant.unitW <= 0 && !missing.includes('unit capacity')) missing.push('unit capacity')
  return missing.length > 0 ? { missing, entry } : plant
}

function plantHour(plant: Plant, supplyC: number, loadW: number, dryBulbC: number, wetBulbC: number): PlantHour {
  const loadKwh = loadW / 1000
  if (plant.isChiller) {
    const free = plant.entry.economizer && dryBulbC + plant.approachK <= supplyC - plant.loopDeltaTK
    return {
      coolingW: free ? plant.fanFraction * loadW : loadW / plant.cop(dryBulbC),
      trimW: 0,
      waterM3: (loadKwh * plant.waterLPerKwh) / 1000,
      compressorOn: !free && loadW > 0,
    }
  }

  const spraying = plant.adiabaticAboveC !== null && dryBulbC > plant.adiabaticAboveC
  const coilAirC = plant.entry.basis === 'wetBulb' || spraying ? wetBulbC : dryBulbC
  const leavingC = coilAirC + plant.approachK
  // The outdoor coil cools the loop from return (supply + loop rise) down to coil air + approach; the trim chiller does the rest.
  const coilShare =
    plant.loopDeltaTK > 0 ? clamp((supplyC + plant.loopDeltaTK - leavingC) / plant.loopDeltaTK, 0, 1) : leavingC <= supplyC ? 1 : 0
  const trimW = loadW * (1 - coilShare)
  const fanW = plant.fanFraction * loadW * Math.max(1, 1 + (coilAirC - FAN_BASE_C) / FAN_DOUBLING_K)
  const evaporating = plant.adiabaticAboveC === null || spraying
  const waterLPerKwh = evaporating ? plant.waterLPerKwh * (1 + plant.blowdownFactor) : 0
  return {
    coolingW: fanW + trimW / plant.cop(dryBulbC),
    trimW,
    waterM3: (loadKwh * waterLPerKwh) / 1000,
    compressorOn: trimW > 0,
  }
}

type Redundancy = EvalContext['plan']['power']['redundancy']

/** Units installed for a load that needs `required` units. */
function installedUnits(redundancy: Redundancy, required: number): number {
  if (redundancy === 'N+1') return required > 0 ? required + 1 : 0
  if (redundancy === '2N') return 2 * required
  return required
}

/** Units that remain once the redundancy spares are set aside. */
function usableUnits(redundancy: Redundancy, count: number): number {
  if (redundancy === 'N+1') return Math.max(0, count - 1)
  if (redundancy === '2N') return Math.floor(count / 2)
  return count
}

function capacityCheck(
  ctx: EvalContext,
  equipment: SizedEquipment[],
  loadW: number,
  state: { plant: Plant; trimHours: number } | Unresolved,
): Check {
  const sized = equipment.find((e) => e.key === 'plant')
  const base = {
    id: 'cooling.heatRejection:plant',
    kind: 'cooling.heatRejection' as const,
    layer: 'cooling' as const,
    subject: { kind: 'plant' as const, id: 'plant', objectIds: sized?.objectIds ?? [] },
    title: 'Heat rejection plant capacity',
    value: loadW,
    unit: 'W',
    causes: [],
  }
  if ('missing' in state) {
    const name = state.entry?.name ?? 'The selected heat rejection'
    return {
      ...base,
      limit: null,
      utilization: null,
      status: 'unknown',
      explanation: `${name} is missing ${state.missing.join(', ')}, so the plant cannot be checked.`,
    }
  }

  const { plant, trimHours } = state
  const { redundancy } = ctx.plan.power
  const required = loadW > 0 ? Math.ceil(loadW / plant.unitW) : 0
  const count = sized?.count ?? installedUnits(redundancy, required)
  const usable = usableUnits(redundancy, count)
  const limit = usable * plant.unitW
  const utilization = limit > 0 ? loadW / limit : null
  const warnAt = num(ctx.rules.warnThreshold) ?? 1
  const needsTrim = !plant.isChiller && trimHours > 0

  let status: Status = 'pass'
  if (loadW > 0 && (utilization === null || utilization > 1)) status = 'fail'
  else if ((utilization !== null && utilization >= warnAt) || needsTrim) status = 'warn'

  const units = `${count} ${count === 1 ? 'unit' : 'units'} of ${mw(plant.unitW)}`
  const sentences = [
    `Heat to reject at the worst hour is ${mw(loadW)}.`,
    `${sized ? 'The plant has' : 'Sized to'} ${units} (${plant.entry.name}), ${usable} usable with ${redundancy} redundancy: ${mw(limit)}.`,
  ]
  if (needsTrim) {
    sentences.push(
      `Trim chillers carry part of the load in ${trimHours.toLocaleString('en-US')} hours of the year, ` +
        `when outdoor air plus the ${plant.approachK}${NBSP}K approach is above the ${ctx.plan.cooling.facilitySupplyC}${NBSP}°C supply.`,
    )
  }
  const advice =
    status === 'fail'
      ? 'Add plant units or lower the heat load.'
      : needsTrim
        ? 'Raise the facility supply temperature to cut trim hours, and plan trim chiller capacity.'
        : undefined
  return { ...base, limit, utilization, status, explanation: sentences.join(' '), ...(advice ? { advice } : {}) }
}

function waterCheck(ctx: EvalContext, known: boolean, peakDayM3: number, peakDay: number): Check {
  const allowance = ctx.plan.site.waterAllowanceM3PerDay
  const utilization = known && allowance > 0 ? peakDayM3 / allowance : null
  const warnAt = num(ctx.rules.warnThreshold) ?? 1
  let status: Status = 'pass'
  if (!known) status = 'unknown'
  else if (peakDayM3 > 0 && (utilization === null || utilization > 1)) status = 'fail'
  else if (utilization !== null && utilization >= warnAt) status = 'warn'

  // Climate series are a typical non-leap year starting 1 January.
  const day = new Date(Date.UTC(2023, 0, 1 + peakDay)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const plantName = ctx.catalog.get(ctx.plan.cooling.heatRejectionId, 'heatRejection')?.name ?? 'plant'
  const explanation = !known
    ? 'Water use is unknown until the heat rejection plant can be modeled.'
    : peakDayM3 === 0
      ? `The ${plantName.toLowerCase()} uses no water.`
      : `The peak day (${day}) uses ${round(peakDayM3)}${NBSP}m³ against a site allowance of ${round(allowance)}${NBSP}m³/day.`
  return {
    id: 'cooling.waterPeakDay:site',
    kind: 'cooling.waterPeakDay',
    layer: 'cooling',
    subject: { kind: 'site', id: 'site', objectIds: [] },
    title: 'Peak-day water use',
    value: known ? peakDayM3 : null,
    limit: allowance,
    unit: 'm³/day',
    utilization,
    status,
    explanation,
    causes: [],
    ...(status === 'fail' || status === 'warn'
      ? { advice: 'Use a dry cooler, or raise the supply temperature so evaporation runs fewer hours.' }
      : {}),
  }
}

function dailySums(hourly: number[]): number[] {
  const days: number[] = []
  for (let h = 0; h < hourly.length; h++) {
    const d = Math.floor(h / HOURS_PER_DAY)
    days[d] = (days[d] ?? 0) + hourly[h]
  }
  return days
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function mw(w: number): string {
  return `${(w / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}${NBSP}MW`
}
