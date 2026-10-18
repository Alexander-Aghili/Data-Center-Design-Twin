import {
  COOLANT,
  num,
  type Check,
  type EquipmentEntry,
  type EquipmentPosition,
  type Metric,
  type Plan,
  type RackCoolingEntry,
  type RackEntry,
  type RackResult,
  type RuleKey,
  type SizedEquipment,
  type Status,
} from '@twin/schema'
import type { EvalContext } from './context'
import type { AirSideResult } from './cooling/air'
import { rejectHeat } from './cooling/rejection'
import type { LiquidSideResult } from './cooling/liquid'
import { networkFabric } from './network'
import { rackPeakW } from './racks'

export interface SizingResult {
  equipment: SizedEquipment[]
  checks: Check[]
}

type Redundancy = Plan['power']['redundancy']

// Shared helpers for the air side, the liquid side and sizing. They live here so that air.ts and
// liquid.ts import from sizing.ts while sizing.ts imports only their types (no import cycle).

const NBSP = ' '

export function rule(ctx: EvalContext, key: RuleKey): number | null {
  return num(ctx.rules[key])
}

export function groupEntries(ctx: EvalContext, groupId: string): { method?: RackCoolingEntry; rack?: RackEntry } {
  const group = ctx.plan.rackGroups.find((g) => g.id === groupId)
  if (!group) return {}
  return { method: ctx.catalog.get(group.coolingMethodId, 'rackCooling'), rack: ctx.catalog.get(group.rackTypeId, 'rack') }
}

/** Utilization above 1 fails, above the rules' warnThreshold warns; no ratio means unknown. */
export function capacityStatus(ctx: EvalContext, utilization: number | null): Status {
  if (utilization === null) return 'unknown'
  if (utilization > 1) return 'fail'
  return utilization > (rule(ctx, 'warnThreshold') ?? 1) ? 'warn' : 'pass'
}

const STATUS_ORDER: Status[] = ['pass', 'unknown', 'warn', 'fail']
function worse(a: Status, b: Status): Status {
  return STATUS_ORDER.indexOf(a) >= STATUS_ORDER.indexOf(b) ? a : b
}

export function ratio(value: number, limit: number | null): number | null {
  return limit !== null && limit > 0 ? value / limit : null
}

/** A cooling check with id `<kind>:<subject id>`; causes are attached later by the causes module. */
export function makeCheck(c: Omit<Check, 'id' | 'layer' | 'causes'>): Check {
  return { ...c, id: `${c.kind}:${c.subject.id}`, layer: 'cooling', causes: [] }
}

export function metric(id: string, label: string, value: number | null, unit: string, inputs: string[], group: string): Metric {
  return { id, layer: 'cooling', label, value: value !== null && Number.isFinite(value) ? value : null, unit, basis: 'calculated', inputs, group }
}

export function fmt(value: number, unit: string, digits = 0): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${NBSP}${unit}`
}
export const kw = (w: number) => fmt(w / 1000, 'kW')

export function sumBy<T>(items: T[], f: (t: T) => number): number {
  return items.reduce((s, t) => s + f(t), 0)
}

/** Units needed for `n` working units: N adds none, N+1 adds one, 2N doubles. */
function withRedundancy(n: number, redundancy: Redundancy): number {
  if (n === 0) return 0
  if (redundancy === 'N+1') return n + 1
  return redundancy === '2N' ? 2 * n : n
}

/** Units left to carry the load once the redundant ones are set aside. */
function workingUnits(count: number, redundancy: Redundancy): number {
  if (redundancy === 'N+1') return Math.max(0, count - 1)
  return redundancy === '2N' ? Math.floor(count / 2) : count
}

/** Heat a rack puts into a water or coolant loop at the rack: its technical loop, else facility water (RDHx). */
export function loopW(rack: RackResult): number {
  return rack.liquidW > 0 ? rack.liquidW : rack.facilityWaterW
}

/**
 * A rack's loop fluid and design flow, ṁ = Q / (cp·ΔT), in L/s with the fluid's catalog cp and ρ. Two-phase loops
 * (R-2p) boil near-isothermally, so the method's ΔT is the facility-water rise and the flow is facility water's.
 */
export function loopFlow(ctx: EvalContext, rack: RackResult): { twoPhase: boolean; designLps: number | null } | null {
  const method = groupEntries(ctx, rack.groupId).method
  const heatW = loopW(rack)
  if (!method || heatW <= 0) return null
  const coolant = method.coolantId ? ctx.catalog.get(method.coolantId, 'coolant') : undefined
  const twoPhase = coolant?.twoPhase ?? false
  const fluid = twoPhase ? ctx.catalog.get(COOLANT.WATER, 'coolant') : coolant
  const cp = fluid ? num(fluid.cpJPerKgK) : null
  const rho = fluid ? num(fluid.densityKgM3) : null
  const deltaTK = num(method.deltaTK)
  return { twoPhase, designLps: cp && rho && deltaTK ? (heatW / (cp * deltaTK) / rho) * 1000 : null }
}

/** R-pump: a method's own pump fraction counts only when it has no CDU (the CDU's pumps are counted instead). */
export function methodPumpW(ctx: EvalContext, rack: RackResult): number {
  const method = groupEntries(ctx, rack.groupId).method
  if (!method || method.requiresCdu) return 0
  return (num(method.pumpPowerFraction) ?? 0) * loopW(rack)
}

/** Pump power multiplier: balancing valves add pump head. */
export function balancingFactor(ctx: EvalContext): number {
  return ctx.plan.cooling.flowBalancing ? 1 + (rule(ctx, 'balancingValvePumpPenalty') ?? 0) : 1
}

/** Room ΔT: containment keeps hot and cold air apart, so the usable ΔT rises. */
export function airDeltaTK(ctx: EvalContext): number | null {
  return rule(ctx, ctx.plan.cooling.containment === 'none' ? 'airDeltaTK' : 'airDeltaTKContained')
}

/** Airflow that carries `airW`: Q / (ρ·cp·ΔT). */
export function airflowM3s(ctx: EvalContext, airW: number): number | null {
  const rho = rule(ctx, 'airDensity')
  const cp = rule(ctx, 'airCp')
  const dT = airDeltaTK(ctx)
  return rho && cp && dT ? airW / (rho * cp * dT) : null
}

// Generic fill of auto-sized equipment into hall positions.

/** A model the sizer may pick. `unit` is one unit's capacity in the demand's own unit (W, A, VA or ports). */
interface Candidate {
  id: string
  unit: number
  /** One unit's capacity in W, for `SizedEquipment.capacityW`; null when it has no power meaning. */
  unitW: number | null
  name: string
  entry?: EquipmentEntry
}

/**
 * Most 3D object ids one sized item gets. The scene draws one object per id; hall positions and row busways
 * hold far fewer units, so only an override with a huge unit count reaches this, and then the item draws this many.
 */
const MAX_OBJECT_IDS = 1000

interface Demand {
  key: string
  category: string
  loadW: number
  candidates: Candidate[]
  /** Working units a candidate needs for the load, before redundancy, using `headroom` of each unit's capacity. */
  units: (c: Candidate, headroom: number) => number
  /** Positions the units may go into; null when the item is not placed in hall positions. */
  positions: EquipmentPosition[] | null
  redundancy: Redundancy
}

interface Fill {
  item: SizedEquipment
  model: Candidate | null
  /** Units asked for: the override count, or what load and redundancy need. */
  target: number
  /** Free units in the eligible positions before this item was placed (null: not placed in positions). */
  available: number | null
  freeBefore: { id: string; free: number }[]
  /** Capacity of the working units (redundant units set aside), in W. */
  usableW: number | null
}

/** Free units per position id. Each planner owns one map, so allocation is deterministic. */
type FreeMap = Map<string, number>

function freeMap(plan: Plan): FreeMap {
  return new Map(plan.hall.positions.map((p) => [p.id, p.capacity]))
}

/**
 * Picks the smallest model whose units fit the free positions and places them. An override fixes the
 * model, the count or the positions.
 */
function fill(ctx: EvalContext, d: Demand, free: FreeMap): Fill {
  const override = ctx.plan.overrides.find((o) => o.key === d.key)
  const pinned = override?.positionIds
  const positions = pinned ? ctx.plan.hall.positions.filter((p) => pinned.includes(p.id)) : d.positions
  const freeBefore = (positions ?? []).map((p) => ({ id: p.id, free: free.get(p.id) ?? 0 }))
  const available = positions ? sumBy(freeBefore, (p) => p.free) : null
  const candidates = (override?.modelId ? d.candidates.filter((c) => c.id === override.modelId) : d.candidates).toSorted(
    (a, b) => a.unit - b.unit,
  )

  // Prefer headroom (load within warnThreshold of the working units) when that still fits the positions,
  // then full capacity, then the model needing the fewest units (the positions check then fails).
  const margin = rule(ctx, 'warnThreshold') ?? 1
  const options = (headroom: number) =>
    candidates.map((model) => {
      const required = withRedundancy(d.units(model, headroom), d.redundancy)
      return { model, required, target: override?.count ?? required }
    })
  const fits = (o: { required: number; target: number }) => (available === null || o.target <= available) && o.required <= o.target
  const full = options(1)
  const chosen =
    options(margin).find(fits) ??
    full.find(fits) ??
    full.reduce<(typeof full)[number] | undefined>((best, o) => (!best || o.required <= best.required ? o : best), undefined)

  const model = chosen?.model ?? null
  const target = chosen?.target ?? override?.count ?? 0
  const count = available === null ? target : Math.min(target, available)
  const positionIds: string[] = []
  let remaining = count
  for (const p of freeBefore) {
    const take = Math.min(p.free, remaining)
    if (take === 0) continue
    free.set(p.id, p.free - take)
    positionIds.push(p.id)
    remaining -= take
  }
  const usableW = model?.unitW != null ? workingUnits(count, d.redundancy) * model.unitW : null
  return {
    model,
    target,
    available,
    freeBefore,
    usableW,
    item: {
      key: d.key,
      category: d.category,
      modelId: model?.id ?? override?.modelId ?? null,
      count,
      required: chosen?.required ?? 0,
      positionIds,
      autoSized: !override,
      loadW: d.loadW,
      capacityW: usableW,
      // Same form as the web geometry's objectIdForEquipment: "eq:<key>:<index>".
      objectIds: Array.from({ length: Math.min(count, MAX_OBJECT_IDS) }, (_, i) => `eq:${d.key}:${i}`),
    },
  }
}

function equipmentCandidates(ctx: EvalContext, category: string, capacityParam: string, toW: (unit: number, e: EquipmentEntry) => number | null): Candidate[] {
  return ctx.catalog
    .all()
    .filter((e): e is EquipmentEntry => e.kind === 'equipment' && e.category === category)
    .flatMap((entry) => {
      const q = entry.params[capacityParam]
      const unit = q ? num(q) : null
      return unit && unit > 0 ? [{ id: entry.id, unit, unitW: toW(unit, entry), name: entry.name, entry }] : []
    })
}

function param(c: Candidate | null, key: string): number | null {
  const q = c?.entry?.params[key]
  return q ? num(q) : null
}

// CDUs: one group per row, keyed "cdu:<rowId>".

export interface CduFill extends Fill {
  rowId: string
}

/**
 * CDUs per row = max(ceil(liquid heat / capacity), ceil(design flow / max flow)) + redundancy, in the CDU positions
 * that serve the row. A model without a known max flow is sized on heat.
 */
export function planCdus(ctx: EvalContext, racks: RackResult[]): CduFill[] {
  const load = new Map<string, number>()
  const flow = new Map<string, number>()
  for (const r of racks) {
    if (r.liquidW <= 0 || !groupEntries(ctx, r.groupId).method?.requiresCdu) continue
    load.set(r.rowId, (load.get(r.rowId) ?? 0) + r.liquidW)
    flow.set(r.rowId, (flow.get(r.rowId) ?? 0) + (loopFlow(ctx, r)?.designLps ?? 0))
  }
  const candidates = equipmentCandidates(ctx, 'cdu', 'capacityW', (w) => w)
  const free = freeMap(ctx.plan)
  return ctx.plan.hall.rows
    .filter((row) => load.has(row.id) || ctx.plan.overrides.some((o) => o.key === `cdu:${row.id}`))
    .map((row) => {
      const loadW = load.get(row.id) ?? 0
      const flowLps = flow.get(row.id) ?? 0
      const units = (c: Candidate, h: number) => {
        const maxFlow = param(c, 'maxFlowLps')
        return Math.max(Math.ceil(loadW / (c.unit * h)), maxFlow ? Math.ceil(flowLps / (maxFlow * h)) : 0)
      }
      const demand: Demand = {
        key: `cdu:${row.id}`,
        category: 'cdu',
        loadW,
        candidates,
        units,
        positions: ctx.plan.hall.positions.filter((p) => p.kind === 'cdu' && p.servesRows.includes(row.id)),
        redundancy: ctx.plan.power.redundancy,
      }
      return { ...fill(ctx, demand, free), rowId: row.id }
    })
}

export function cduApproachK(f: CduFill | undefined): number | null {
  return f ? param(f.model, 'approachK') : null
}

/** R-pump: CDU pumps = pumpPowerW × count × load fraction, which is pumpPowerW × load / unit capacity. */
export function cduPumpW(f: CduFill): number | null {
  const pump = param(f.model, 'pumpPowerW')
  return pump !== null && f.model ? (pump * f.item.loadW) / f.model.unit : null
}

// CRAHs: one group per zone, keyed "crah:<zoneId>".

interface CrahZone {
  id: string
  positions: EquipmentPosition[]
  rows: string[]
}

/** CRAH positions that share a served row form one zone, numbered Z1… in position order. */
function crahZones(plan: Plan): CrahZone[] {
  let zones: { positions: EquipmentPosition[]; rows: Set<string> }[] = []
  for (const p of plan.hall.positions.filter((q) => q.kind === 'crah')) {
    const touching = zones.filter((z) => p.servesRows.some((r) => z.rows.has(r)))
    const merged = {
      positions: [...touching.flatMap((z) => z.positions), p],
      rows: new Set([...touching.flatMap((z) => [...z.rows]), ...p.servesRows]),
    }
    const at = touching.length > 0 ? zones.indexOf(touching[0]!) : zones.length
    zones = [...zones.slice(0, at).filter((z) => !touching.includes(z)), merged, ...zones.slice(at).filter((z) => !touching.includes(z))]
  }
  return zones.map((z, i) => ({ id: `Z${i + 1}`, positions: z.positions, rows: [...z.rows] }))
}

interface CrahFill extends Fill {
  zone: CrahZone
  airflowM3s: number | null
}

/** CRAHs per zone = max(ceil(air heat / capacity), ceil(airflow / unit airflow)) + redundancy. */
export function planCrahs(ctx: EvalContext, crahLoads: Record<string, number>): CrahFill[] {
  const candidates = equipmentCandidates(ctx, 'crah', 'capacityW', (w) => w)
  const free = freeMap(ctx.plan)
  return crahZones(ctx.plan).flatMap((zone) => {
    const key = `crah:${zone.id}`
    const loadW = sumBy(zone.positions, (p) => crahLoads[p.id] ?? 0)
    if (loadW <= 0 && !ctx.plan.overrides.some((o) => o.key === key)) return []
    const airflow = airflowM3s(ctx, loadW)
    const units = (c: Candidate, h: number) => {
      const unitAirflow = param(c, 'airflowM3s')
      const byAirflow = airflow !== null && unitAirflow ? Math.ceil(airflow / (unitAirflow * h)) : 0
      return Math.max(Math.ceil(loadW / (c.unit * h)), byAirflow)
    }
    const demand: Demand = { key, category: 'crah', loadW, candidates, units, positions: zone.positions, redundancy: ctx.plan.power.redundancy }
    return [{ ...fill(ctx, demand, free), zone, airflowM3s: airflow }]
  })
}

/** CRAH fan power: fanPowerW × load / capacity, or the rules' fallback fraction of the load. */
export function crahFanW(ctx: EvalContext, f: CrahFill): number | null {
  const fan = param(f.model, 'fanPowerW')
  if (fan !== null && f.model) return (fan * f.item.loadW) / f.model.unit
  const fallback = rule(ctx, 'crahFanFractionFallback')
  return fallback !== null ? fallback * f.item.loadW : null
}

// Checks.

function cduCapacityCheck(ctx: EvalContext, f: CduFill, racks: RackResult[]): Check {
  const cduRacks = racks.filter((r) => r.rowId === f.rowId && r.liquidW > 0 && groupEntries(ctx, r.groupId).method?.requiresCdu)
  const flow = sumBy(cduRacks, (r) => r.flowLps ?? 0)
  const unitFlow = param(f.model, 'maxFlowLps')
  const flowLimit = unitFlow !== null ? workingUnits(f.item.count, ctx.plan.power.redundancy) * unitFlow : null
  const flowOver = flowLimit !== null && flow > flowLimit
  const utilization = ratio(f.item.loadW, f.usableW)
  let status: Status = 'unknown'
  if (f.model) status = f.usableW === 0 && f.item.loadW > 0 ? 'fail' : capacityStatus(ctx, utilization)
  if (f.model && flowOver) status = worse(status, 'warn')
  const flowText =
    flowLimit !== null && flow > 0
      ? ` Coolant flow is ${fmt(flow, 'L/s', 1)} against ${fmt(flowLimit, 'L/s', 1)} rated${flowOver ? ', so the pumps run past their rating or the loop ΔT has to rise' : ''}.`
      : ''
  return makeCheck({
    kind: 'cooling.cduCapacity',
    subject: { kind: 'equipment', id: f.item.key, objectIds: f.item.objectIds },
    title: `CDU capacity, row ${f.rowId}`,
    value: f.item.loadW,
    limit: f.usableW,
    unit: 'W',
    utilization,
    status,
    explanation: f.model
      ? `${f.item.count} × ${f.model.name} with ${ctx.plan.power.redundancy} redundancy carry ${kw(f.usableW ?? 0)} with the spare units set aside. Row ${f.rowId} puts ${kw(f.item.loadW)} of liquid heat on them.${flowText}`
      : `No CDU model with a known capacity is available for row ${f.rowId}.`,
    ...(status === 'fail' ? { advice: `Add CDU capacity for row ${f.rowId} (a larger model or more units), or move liquid-cooled racks to other rows.` } : {}),
  })
}

/** Fails when the positions serving an item cannot hold the units it needs; the advice names them. */
function positionsCheck(f: CduFill, racks: RackResult[]): Check {
  const short = f.item.count < f.target
  const freeText = f.freeBefore.length > 0 ? f.freeBefore.map((p) => `${p.id} has ${p.free} free`).join(', ') : 'no CDU position serves it'
  const freeUnits = f.available ?? 0
  return makeCheck({
    kind: 'cooling.cduPositions',
    subject: { kind: 'row', id: f.rowId, objectIds: racks.filter((r) => r.rowId === f.rowId).map((r) => r.objectId) },
    title: `CDU positions, row ${f.rowId}`,
    value: f.target,
    limit: f.available,
    unit: 'units',
    utilization: ratio(f.target, f.available),
    status: short ? 'fail' : 'pass',
    explanation: `Row ${f.rowId} needs ${f.target} CDU${f.target === 1 ? '' : 's'} and ${f.item.count} are placed (${freeText}).`,
    ...(short
      ? {
          advice: `Row ${f.rowId} needs ${f.target} CDUs; its positions have ${freeUnits} free (${freeText}). Add a CDU position serving ${f.rowId}, or move racks to rows with free CDU positions.`,
        }
      : {}),
  })
}

function crahCapacityCheck(ctx: EvalContext, f: CrahFill): Check {
  const working = workingUnits(f.item.count, ctx.plan.power.redundancy)
  const unitAirflow = param(f.model, 'airflowM3s')
  const airflowLimit = unitAirflow !== null ? working * unitAirflow : null
  const heatUtil = ratio(f.item.loadW, f.usableW)
  const airUtil = f.airflowM3s !== null ? ratio(f.airflowM3s, airflowLimit) : null
  const utilization = heatUtil !== null && airUtil !== null ? Math.max(heatUtil, airUtil) : heatUtil
  let status: Status = 'unknown'
  if (f.model) status = working === 0 && f.item.loadW > 0 ? 'fail' : capacityStatus(ctx, utilization)
  const rows = f.zone.rows.join(', ')
  const short = f.item.count < f.target
  const airflowText =
    f.airflowM3s !== null && airflowLimit !== null ? ` Airflow needed is ${fmt(f.airflowM3s, 'm³/s', 1)} against ${fmt(airflowLimit, 'm³/s', 1)}.` : ''
  const shortText = short ? ` The zone needs ${f.target} units and only ${f.item.count} fit its positions.` : ''
  return makeCheck({
    kind: 'cooling.crahCapacity',
    subject: { kind: 'equipment', id: f.item.key, objectIds: f.item.objectIds },
    title: `CRAH capacity, zone ${f.zone.id} (${rows})`,
    value: f.item.loadW,
    limit: f.usableW,
    unit: 'W',
    utilization,
    status,
    explanation: f.model
      ? `${f.item.count} × ${f.model.name} with ${ctx.plan.power.redundancy} redundancy carry ${kw(f.usableW ?? 0)} with the spare units set aside. Rows ${rows} put ${kw(f.item.loadW)} of heat into the room air.${airflowText}${shortText}`
      : `No CRAH model with a known capacity is available for zone ${f.zone.id}.`,
    ...(status === 'fail'
      ? {
          advice: `Rows ${rows} need ${f.target} CRAHs and ${f.item.count} fit. Move the densest racks to liquid cooling, add CRAH positions for the zone, or spread the racks out.`,
        }
      : {}),
  })
}

function unzonedAirChecks(ctx: EvalContext, air: AirSideResult, racks: RackResult[]): Check[] {
  const zoned = new Set(crahZones(ctx.plan).flatMap((z) => z.rows))
  return air.rows
    .filter((r) => r.airW > 0 && !zoned.has(r.rowId))
    .map((r) =>
      makeCheck({
        kind: 'cooling.crahCapacity',
        subject: { kind: 'row', id: r.rowId, objectIds: racks.filter((x) => x.rowId === r.rowId).map((x) => x.objectId) },
        title: `CRAH capacity, row ${r.rowId}`,
        value: r.airW,
        limit: 0,
        unit: 'W',
        utilization: null,
        status: 'fail',
        explanation: `Row ${r.rowId} puts ${kw(r.airW)} of heat into the room air, but no CRAH position serves it.`,
        advice: `Add a CRAH position serving ${r.rowId}, or move its racks to a row a CRAH zone covers.`,
      }),
    )
}

// Plant, electrical, network and buffer tank.

/** Plant units = ceil(heat to reject / unit capacity) + redundancy. Heat to reject = rack heat + hall pumps and fans. */
function plantFill(ctx: EvalContext, racks: RackResult[], hallW: number): Fill | null {
  const loadW = sumBy(racks, (r) => r.heatW) + hallW
  if (loadW <= 0) return null
  const override = ctx.plan.overrides.find((o) => o.key === 'plant')
  const entry = ctx.catalog.get(override?.modelId ?? ctx.plan.cooling.heatRejectionId, 'heatRejection')
  const unit = entry ? num(entry.unitCapacityW) : null
  const candidates = entry && unit ? [{ id: entry.id, unit, unitW: unit, name: entry.name }] : []
  const plantPositions = ctx.plan.hall.positions.filter((p) => p.kind === 'plant')
  const demand: Demand = { key: 'plant', category: 'plant', loadW, candidates, units: (c, h) => Math.ceil(loadW / (c.unit * h)), positions: plantPositions, redundancy: ctx.plan.power.redundancy }
  return fill(ctx, demand, freeMap(ctx.plan))
}

function buswayAmpsPerW(e: EquipmentEntry | undefined): number | null {
  const v = e?.params.voltageV ? num(e.params.voltageV) : null
  const pf = e?.params.powerFactor ? num(e.params.powerFactor) : null
  return v && pf ? 1 / (Math.sqrt(3) * v * pf) : null
}

/**
 * UPS modules, busways per row and transformers, with the loads the power checks use (Task 7), so that
 * auto-sized units pass them: racks at catalog peak plus optics and leaf switches; UPS = IT peak / distribution efficiency;
 * busway design current = row peak / (√3·V·pf) / oversubscription allowance (rack peak already is the electrical
 * peak, so no peak-to-average factor); transformers =
 * facility power at the worst cooling hour, in VA at the busway power factor.
 */
function electricalFills(ctx: EvalContext, racks: RackResult[], coolingItems: SizedEquipment[], switchW: number): Fill[] {
  const redundancy = ctx.plan.power.redundancy
  const peakOf = (r: RackResult) => {
    const rack = groupEntries(ctx, r.groupId).rack
    return rack ? rackPeakW(rack) : r.powerW
  }
  const rackPeak = sumBy(racks, peakOf)
  if (rackPeak <= 0) return []
  const opticsW = networkFabric(ctx, racks).network.opticsW
  const itPeakW = rackPeak + (Number.isFinite(opticsW) ? opticsW : 0) + switchW
  const electrical = ctx.plan.hall.positions.filter((p) => p.kind === 'electrical')
  const upsLoad = itPeakW / (rule(ctx, 'distributionEfficiency') ?? 1)
  const upsCandidates = equipmentCandidates(ctx, 'ups', 'moduleW', (w) => w)

  const allowance = ctx.plan.power.oversubscription
  const buswayCandidates = equipmentCandidates(ctx, 'busway', 'ratingA', (a, e) => {
    const k = buswayAmpsPerW(e)
    return k ? a / k : null
  }).filter((c) => c.unitW !== null)
  const busways = ctx.plan.hall.rows.flatMap((row) => {
    const rowPeak = sumBy(racks.filter((r) => r.rowId === row.id), peakOf)
    if (rowPeak <= 0) return []
    const units = (c: Candidate, h: number) => Math.ceil((rowPeak * (buswayAmpsPerW(c.entry) ?? 0)) / allowance / (c.unit * h))
    return [fill(ctx, { key: `busway:${row.id}`, category: 'busway', loadW: rowPeak, candidates: buswayCandidates, units, positions: null, redundancy }, new Map())]
  })

  const pf = param(busways[0]?.model ?? buswayCandidates[0] ?? null, 'powerFactor') ?? 1
  const coolingWorst = Math.max(0, ...rejectHeat(ctx, racks, coolingItems).hourly.coolingW.filter(Number.isFinite))
  const misc = rule(ctx, 'miscFacilityFraction') ?? 0
  const chain = (rule(ctx, 'upsEfficiency') ?? 1) * (rule(ctx, 'transformerEfficiency') ?? 1) * (rule(ctx, 'distributionEfficiency') ?? 1)
  const transformerW = ((itPeakW + coolingWorst + misc * itPeakW) / chain) * (rule(ctx, 'transformerEfficiency') ?? 1)
  const transformerCandidates = equipmentCandidates(ctx, 'transformer', 'ratingVa', (va) => va * pf)

  // UPS modules and transformers share the electrical positions. The UPS is placed first; if its headroom
  // would leave the transformers short, it is sized at full capacity instead.
  const upsAndTransformers = (upsHeadroom: boolean) => {
    const free = freeMap(ctx.plan)
    const upsUnits = (c: Candidate, h: number) => Math.ceil(upsLoad / (c.unit * (upsHeadroom ? h : 1)))
    const ups = fill(ctx, { key: 'ups', category: 'ups', loadW: upsLoad, candidates: upsCandidates, units: upsUnits, positions: electrical, redundancy }, free)
    const transformerUnits = (c: Candidate, h: number) => Math.ceil(transformerW / pf / (c.unit * h))
    const transformer = fill(
      ctx,
      { key: 'transformer', category: 'transformer', loadW: transformerW, candidates: transformerCandidates, units: transformerUnits, positions: electrical, redundancy },
      free,
    )
    return { ups, transformer }
  }
  const short = (f: Fill) => f.item.count < f.item.required
  const withHeadroom = upsAndTransformers(true)
  const { ups, transformer } = short(withHeadroom.transformer) ? upsAndTransformers(false) : withHeadroom
  return [ups, ...busways, transformer]
}

/**
 * Leaf switches per leaf position, each position holding `capacity` switches (as the network check counts
 * them): the served racks' scale-out ports as downlinks plus downlinks / oversubscription as uplinks.
 */
function leafFills(ctx: EvalContext, racks: RackResult[]): Fill[] {
  const leafPositions = ctx.plan.hall.positions.filter((p) => p.kind === 'leaf')
  const candidates = equipmentCandidates(ctx, 'leaf', 'ports', () => null)
  const o = ctx.plan.network.oversubscription
  const servingCount = (rowId: string) => leafPositions.filter((p) => p.servesRows.includes(rowId)).length
  const free = freeMap(ctx.plan)
  return leafPositions.flatMap((pos) => {
    const downlinks = sumBy(
      racks.filter((r) => pos.servesRows.includes(r.rowId)),
      (r) => (groupEntries(ctx, r.groupId).rack?.scaleOutPorts ?? 0) / servingCount(r.rowId),
    )
    if (downlinks <= 0) return []
    const units = (c: Candidate, h: number) => Math.ceil((downlinks + downlinks / o) / (c.unit * h))
    const f = fill(ctx, { key: `leaf:${pos.id}`, category: 'leaf', loadW: 0, candidates, units, positions: [pos], redundancy: 'N' }, free)
    const powerW = param(f.model, 'powerW')
    return [{ ...f, item: { ...f.item, loadW: powerW !== null ? powerW * f.item.count : 0 } }]
  })
}

/**
 * One buffer tank holding `cooling.bufferTankM3`, at the plant position, so ride-through and cost can find it.
 * A `bufferTank` override can set the model, the count or the positions.
 */
function bufferTank(ctx: EvalContext, racks: RackResult[]): SizedEquipment[] {
  if (ctx.plan.cooling.bufferTankM3 <= 0) return []
  const candidates = ctx.catalog
    .all()
    .filter((e): e is EquipmentEntry => e.kind === 'equipment' && e.category === 'bufferTank')
    .map((entry): Candidate => ({ id: entry.id, unit: 1, unitW: null, name: entry.name, entry }))
  const plant = ctx.plan.hall.positions.find((p) => p.kind === 'plant')
  const loadW = sumBy(racks, (r) => r.liquidW)
  const f = fill(ctx, { key: 'bufferTank', category: 'bufferTank', loadW, candidates, units: () => 1, positions: plant ? [plant] : null, redundancy: 'N' }, freeMap(ctx.plan))
  return [f.item]
}

/**
 * Auto-sizes CDUs (`cdu:<rowId>`), CRAHs (`crah:<zoneId>`), the plant (`plant`), UPS, transformers, busways
 * (`busway:<rowId>`), leaves (`leaf:<positionId>`) and the buffer tank into hall positions (Task 8).
 * `count` is the units placed, `required` what load and redundancy need, `capacityW` the working units' capacity.
 */
export function sizeEquipment(ctx: EvalContext, racks: RackResult[], air: AirSideResult, liquid: LiquidSideResult): SizingResult {
  const cdus = planCdus(ctx, liquid.racks)
  const crahs = planCrahs(ctx, air.crahLoads)
  const hallW =
    sumBy(cdus, (f) => cduPumpW(f) ?? 0) * balancingFactor(ctx) +
    sumBy(crahs, (f) => crahFanW(ctx, f) ?? 0) +
    sumBy(liquid.racks, (r) => methodPumpW(ctx, r)) * balancingFactor(ctx)
  const plant = plantFill(ctx, racks, hallW)
  const cooling: Fill[] = [...cdus, ...crahs, ...(plant ? [plant] : [])]
  const leaves = leafFills(ctx, racks)
  const switchW = sumBy(leaves, (f) => f.item.loadW)
  const fills = [...cooling, ...electricalFills(ctx, racks, cooling.map((f) => f.item), switchW), ...leaves]
  return {
    equipment: [...fills.map((f) => f.item), ...bufferTank(ctx, racks)],
    checks: [
      ...cdus.flatMap((f) => [cduCapacityCheck(ctx, f, liquid.racks), positionsCheck(f, liquid.racks)]),
      ...crahs.map((f) => crahCapacityCheck(ctx, f)),
      ...unzonedAirChecks(ctx, air, racks),
    ],
  }
}
