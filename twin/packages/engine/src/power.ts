import {
  num,
  type Check,
  type EquipmentEntry,
  type Evaluation,
  type HourlySeries,
  type Metric,
  type Plan,
  type PowerDistribution,
  type RackResult,
  type RowLoad,
  type RuleKey,
  type SizedEquipment,
  type Status,
} from '@twin/schema'
import type { EvalContext } from './context'
import type { RejectionResult } from './cooling/rejection'
import type { NetworkSlice } from './network'
import { rackPeakW, resolveGroup, type ResolvedGroup } from './racks'

/** What the training-swing check needs per loaded row, from the row's busway model and sizing. */
export interface BuswayRow {
  rowId: string
  /** Σ nominal (average) rack power in the row. */
  nominalW: number
  /** Line current per watt, 1 / (√3 · V · pf); null when the busway model lacks voltage or power factor. */
  ampsPerW: number | null
  /** Serving feeds × rating, the same limit as the `power.busway` check; null when no rated busway is sized. */
  capacityA: number | null
  objectIds: string[]
}

export interface PowerResult {
  hourly: Pick<HourlySeries, 'itW' | 'facilityW' | 'pue'>
  rows: Pick<RowLoad, 'rowId' | 'buswayLoadA'>[]
  busways: BuswayRow[]
  checks: Check[]
  metrics: Metric[]
  headline: Partial<Evaluation['headline']>
}

type Redundancy = Plan['power']['redundancy']

const NBSP = ' '
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const DISTRIBUTION_LABEL: Record<PowerDistribution, string> = { ac54: '54 V AC busbar', dc800: '800 V DC' }

/**
 * FP8 compute and GPUs of the placed racks. A rack type without an FP8 figure falls back to its GPU's FP8 ×
 * GPU count; racks with neither count 0 PFLOPS and are tallied in `unknownRacks`.
 */
export function placedCompute(ctx: EvalContext, racks: RackResult[]): { pflops: number; gpuCount: number; unknownRacks: number } {
  let pflops = 0
  let gpuCount = 0
  let unknownRacks = 0
  for (const r of racks) {
    const rack = resolveGroup(ctx, r.groupId)?.rack
    if (!rack) {
      unknownRacks++
      continue
    }
    const gpu = rack.gpuId ? ctx.catalog.get(rack.gpuId, 'gpu') : undefined
    const gpuPflops = gpu ? num(gpu.fp8Pflops) : null
    const rackPflops = num(rack.fp8Pflops) ?? (gpuPflops === null ? null : gpuPflops * rack.gpuCount)
    if (rackPflops === null) unknownRacks++
    pflops += rackPflops ?? 0
    gpuCount += rack.gpuCount
  }
  return { pflops, gpuCount, unknownRacks }
}

/** A series of exactly `hours` entries; missing or non-finite entries become `missing` (0 unless given). */
export function toHours(values: readonly (number | null)[], hours: number): number[]
export function toHours(values: readonly (number | null)[], hours: number, missing: null): (number | null)[]
export function toHours(values: readonly (number | null)[], hours: number, missing: 0 | null = 0): (number | null)[] {
  return Array.from({ length: hours }, (_, h) => {
    const v = values[h]
    return typeof v === 'number' && Number.isFinite(v) ? v : missing
  })
}

/** Units that carry the load once the redundant ones are set aside: N all, N+1 one fewer, 2N half. */
function servingUnits(count: number, redundancy: Redundancy): number {
  if (redundancy === 'N+1') return Math.max(count - 1, 0)
  if (redundancy === '2N') return Math.floor(count / 2)
  return count
}

/** Units to install when `needed` carry the load. */
function unitsWithRedundancy(needed: number, redundancy: Redundancy): number {
  if (redundancy === 'N+1') return needed + 1
  if (redundancy === '2N') return needed * 2
  return needed
}

const round = (v: number, digits: number) => Number(v.toFixed(digits)).toLocaleString('en-US')

function fmtScaled(v: number, unit: string): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${round(v / 1e6, 2)}${NBSP}M${unit}`
  if (a >= 1e3) return `${round(v / 1e3, 0)}${NBSP}k${unit}`
  return `${round(v, 0)}${NBSP}${unit}`
}
const fmtW = (w: number) => fmtScaled(w, 'W')
const fmtVA = (va: number) => fmtScaled(va, 'VA')
const fmtA = (a: number) => `${round(a, 0)}${NBSP}A`
const pct = (u: number) => `${Math.round(u * 100)}%`
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

/** "15 Aug 15:00" for an hour index into a non-leap year starting 1 Jan 00:00. */
function hourLabel(hour: number): string {
  let day = Math.floor(hour / 24)
  let month = 0
  while (month < 11 && day >= MONTH_DAYS[month]!) day -= MONTH_DAYS[month++]!
  return `${day + 1} ${MONTHS[month]} ${String(hour % 24).padStart(2, '0')}:00`
}

/** "4 of them carry the load, giving 2 MW (80%)." or, with no serving units, that none are left. */
function carrying(serving: number, capacity: number, load: number, fmt: (v: number) => string): string {
  if (serving === 0) return 'none are left to carry the load once redundancy is set aside.'
  return `${serving} of them carry the load, giving ${fmt(capacity)} (${pct(load / capacity)}).`
}

function statusOf(utilization: number | null, warnAt: number): Status {
  if (utilization === null) return 'unknown'
  if (utilization > 1) return 'fail'
  return utilization > warnAt ? 'warn' : 'pass'
}

interface CheckInput {
  kind: Check['kind']
  subject: Check['subject']
  title: string
  value: number | null
  limit: number | null
  unit: string
  explanation: string
  advice?: string
}

/** A capacity check: utilization = value / limit; a zero limit under a real load fails. */
function capacityCheck(input: CheckInput, warnAt: number): Check {
  const { value, limit, advice, ...rest } = input
  let utilization: number | null = null
  let status: Status = 'unknown'
  if (value !== null && limit !== null) {
    if (limit > 0) {
      utilization = value / limit
      status = statusOf(utilization, warnAt)
    } else {
      utilization = value > 0 ? null : 0
      status = value > 0 ? 'fail' : 'pass'
    }
  }
  return {
    id: `${input.kind}:${input.subject.id}`,
    layer: 'power',
    ...rest,
    value,
    limit,
    utilization,
    status,
    causes: [],
    ...(advice !== undefined && (status === 'fail' || status === 'warn') ? { advice } : {}),
  }
}

function equipmentModel(ctx: EvalContext, item: SizedEquipment | undefined): EquipmentEntry | undefined {
  return item?.modelId ? ctx.catalog.get(item.modelId, 'equipment') : undefined
}

const param = (entry: EquipmentEntry | undefined, key: string): number | null => {
  const q = entry?.params[key]
  return q ? num(q) : null
}

/** The busway model a row uses: its sized model, else the smallest busway in the catalog (for voltage and power factor). */
function buswayModel(ctx: EvalContext, item: SizedEquipment | undefined): EquipmentEntry | undefined {
  const sized = equipmentModel(ctx, item)
  if (sized) return sized
  return ctx.catalog
    .all()
    .filter((e): e is EquipmentEntry => e.kind === 'equipment' && e.category === 'busway')
    .sort((a, b) => (param(a, 'ratingA') ?? Infinity) - (param(b, 'ratingA') ?? Infinity))[0]
}

/** Facility power, hour by hour and at the worst hour, against the grid cap; busways, UPS and transformers (Task 7). */
export function powerBudget(
  ctx: EvalContext,
  racks: RackResult[],
  equipment: SizedEquipment[],
  rejection: RejectionResult,
  network: NetworkSlice,
): PowerResult {
  const { plan, rules, climate } = ctx
  const rule = (key: RuleKey, identity: number) => num(rules[key]) ?? identity
  const upsEff = rule('upsEfficiency', 1)
  const txEff = rule('transformerEfficiency', 1)
  const distEff = rule('distributionEfficiency', 1)
  const chain = upsEff * txEff * distEff
  const misc = rule('miscFacilityFraction', 0)
  const warnAt = rule('warnThreshold', 1)
  const cap = plan.site.gridCapacityW
  const redundancy = plan.power.redundancy
  const hours = climate.dryBulbC.length

  const groups = new Map<string, ResolvedGroup | undefined>()
  const groupOf = (groupId: string) => {
    if (!groups.has(groupId)) groups.set(groupId, resolveGroup(ctx, groupId))
    return groups.get(groupId)
  }
  const peakOf = (r: RackResult) => {
    const g = groupOf(r.groupId)
    return g ? rackPeakW(g.rack) : r.powerW
  }

  // Hourly budget: IT at nominal power (energy), plus optics, leaf switches in hall positions (sized with their
  // typical power), cooling and misc loads, through the loss chain.
  const opticsW = Number.isFinite(network.network.opticsW) ? network.network.opticsW : 0
  const switchW = equipment.filter((e) => e.category === 'leaf').reduce((s, e) => s + e.loadW, 0)
  const itW = racks.reduce((s, r) => s + r.powerW, 0) + opticsW + switchW
  const itPeakW = racks.reduce((s, r) => s + peakOf(r), 0) + opticsW + switchW
  const facilityAt = (it: number, cooling: number) => (it + cooling + misc * it) / chain
  const coolingW = toHours(rejection.hourly.coolingW, hours)
  const itSeries = Array.from({ length: hours }, () => itW)
  const facilityW = coolingW.map((c) => facilityAt(itW, c))
  const pue = facilityW.map((f) => (itW > 0 ? f / itW : null))

  let worstHour = 0
  for (let h = 1; h < hours; h++) if (facilityW[h]! > facilityW[worstHour]!) worstHour = h
  const worstW = facilityW[worstHour] ?? 0
  const coolingWorst = coolingW[worstHour] ?? 0
  const hoursOverCap = facilityW.filter((f) => f > cap).length
  const totalIt = itW * hours
  const pueAnnual = totalIt > 0 ? facilityW.reduce((s, f) => s + f, 0) / totalIt : null
  const pueWorst = pue[worstHour] ?? null

  // Headline: placed compute, limited by what the grid carries at the worst hour.
  const { pflops: placedPflops, gpuCount } = placedCompute(ctx, racks)
  const usableFraction = itW > 0 ? Math.min(1, Math.max(0, (cap * chain - coolingWorst - misc * itW) / itW)) : 0
  const usablePflops = placedPflops * usableFraction

  const busways = buswayChecks()
  const checks: Check[] = [
    gridCheck(),
    ...busways.checks,
    upsCheck(),
    transformerCheck(),
    ...inputCompatChecks(),
  ]

  function gridCheck(): Check {
    const outdoor = climate.dryBulbC[worstHour] ?? null
    const when = outdoor === null ? hourLabel(worstHour) : `${hourLabel(worstHour)} with ${round(outdoor, 1)}${NBSP}°C outdoors`
    const overCap =
      hoursOverCap === 0
        ? 'It stays under the cap every hour of the year.'
        : `It is over the cap for ${plural(hoursOverCap, 'hour')} a year, so the grid carries ${round(usablePflops, 0)} of the ${round(placedPflops, 0)}${NBSP}PFLOPS placed.`
    return capacityCheck(
      {
        kind: 'power.gridWorstHour',
        subject: { kind: 'site', id: 'site', objectIds: [] },
        title: 'Grid capacity at the worst hour',
        value: worstW,
        limit: cap,
        unit: 'W',
        explanation:
          `At the worst hour, ${when}, the facility draws ${fmtW(worstW)} against the ${fmtW(cap)} grid connection` +
          ` (${pct(worstW / cap)}). IT is ${fmtW(itW)} and cooling ${fmtW(coolingWorst)}; UPS, transformer and distribution losses take ${pct(1 - chain)} of the total. ${overCap}`,
        advice: 'Lower the IT load, raise the facility supply temperature to cut cooling power, or pick heat rejection that needs less trim cooling on hot hours.',
      },
      warnAt,
    )
  }

  function buswayChecks() {
    const allowance = plan.power.oversubscription
    const rowLoads = new Map<string, number>()
    const rows: BuswayRow[] = []
    const out: Check[] = []
    for (const row of plan.hall.rows) {
      const inRow = racks.filter((r) => r.rowId === row.id)
      if (inRow.length === 0) continue
      const item = equipment.find((e) => e.key === `busway:${row.id}`)
      const model = buswayModel(ctx, item)
      const volts = param(model, 'voltageV')
      const pf = param(model, 'powerFactor')
      const peakW = inRow.reduce((s, r) => s + peakOf(r), 0)
      const lineA = volts && pf ? peakW / (Math.sqrt(3) * volts * pf) : null
      // Rack peak power already is the electrical peak, so no peak-to-average factor goes on top.
      const designA = lineA === null ? null : lineA / allowance
      if (designA !== null) rowLoads.set(row.id, designA)

      const ratingA = item && model ? param(model, 'ratingA') : null
      const feeds = item ? servingUnits(item.count, redundancy) : 0
      const limit = ratingA === null ? null : feeds * ratingA
      const objectIds = item?.objectIds.length ? item.objectIds : inRow.map((r) => r.objectId)
      rows.push({
        rowId: row.id,
        nominalW: inRow.reduce((s, r) => s + r.powerW, 0),
        ampsPerW: volts && pf ? 1 / (Math.sqrt(3) * volts * pf) : null,
        capacityA: limit,
        objectIds,
      })

      let explanation: string
      if (lineA === null || designA === null) {
        explanation = `No busway model gives a voltage and power factor, so the current in row ${row.id} cannot be calculated.`
      } else {
        const derivation =
          `Row ${row.id} racks draw up to ${fmtW(peakW)} at peak, which is ${fmtA(lineA)} at ${round(volts!, 0)}${NBSP}V and power factor ${pf}.` +
          (allowance === 1
            ? ` The design current is ${fmtA(designA)}`
            : ` With an oversubscription allowance of ${allowance}, the design current is ${fmtA(designA)}`)
        explanation =
          limit === null
            ? `${derivation}, but no busway is sized for the row, so the load cannot be checked.`
            : `${derivation} against ${fmtA(limit)} of busway capacity: ${plural(item!.count, 'feed')} of ${fmtA(ratingA!)}, ${feeds} counted under ${redundancy}.`
      }
      out.push(
        capacityCheck(
          {
            kind: 'power.busway',
            subject: { kind: 'row', id: row.id, objectIds },
            title: `Busway load, row ${row.id}`,
            value: designA,
            limit,
            unit: 'A',
            explanation,
            advice: `Add a busway feed to row ${row.id}, choose a larger busway, or move racks to a row with spare capacity.`,
          },
          warnAt,
        ),
      )
    }
    return { checks: out, rowLoads, rows }
  }

  /** UPS or transformer: the load against the units left once redundant ones are set aside. */
  function redundantUnitsCheck(spec: {
    kind: 'power.ups' | 'power.transformer'
    key: string
    title: string
    unit: string
    fmt: (v: number) => string
    load: number | null
    unitCapacity: number | null
    unitWord: string
    loadText: string
    unsized: string
    idle: string
  }): Check {
    const item = equipment.find((e) => e.key === spec.key)
    const base = { kind: spec.kind, subject: { kind: 'equipment' as const, id: spec.key, objectIds: item?.objectIds ?? [] }, title: spec.title, unit: spec.unit }
    const { load, unitCapacity, fmt } = spec
    if (load === 0) return capacityCheck({ ...base, value: 0, limit: 0, explanation: spec.idle }, warnAt)
    if (!item || unitCapacity === null || unitCapacity <= 0 || load === null) {
      return capacityCheck({ ...base, value: load, limit: null, explanation: `${spec.loadText} ${spec.unsized}` }, warnAt)
    }
    const serving = servingUnits(item.count, redundancy)
    const needed = Math.ceil(load / unitCapacity)
    return capacityCheck(
      {
        ...base,
        value: load,
        limit: serving * unitCapacity,
        explanation: `${spec.loadText} ${plural(item.count, spec.unitWord)} of ${fmt(unitCapacity)} are installed for ${redundancy}; ${carrying(serving, serving * unitCapacity, load, fmt)}`,
        advice: `The load needs ${plural(needed, spec.unitWord)} of ${fmt(unitCapacity)}, so ${redundancy} needs ${unitsWithRedundancy(needed, redundancy)}; ${item.count} installed.`,
      },
      warnAt,
    )
  }

  function upsCheck(): Check {
    const load = itPeakW / distEff
    return redundantUnitsCheck({
      kind: 'power.ups',
      key: 'ups',
      title: 'UPS capacity',
      unit: 'W',
      fmt: fmtW,
      load,
      unitCapacity: param(equipmentModel(ctx, equipment.find((e) => e.key === 'ups')), 'moduleW'),
      unitWord: 'module',
      loadText: `The UPS carries ${fmtW(load)} of critical load with racks at peak, including ${pct(1 - distEff)} distribution losses.`,
      unsized: 'No UPS with a known module size is sized, so it cannot be checked.',
      idle: 'No IT load is placed, so the UPS carries nothing.',
    })
  }

  function transformerCheck(): Check {
    const pf = param(buswayModel(ctx, equipment.find((e) => e.category === 'busway')), 'powerFactor')
    const loadW = facilityAt(itPeakW, coolingWorst) * txEff
    const loadVa = pf ? loadW / pf : null
    const atPeak = `The transformers feed ${fmtW(loadW)} at the worst hour with racks at peak`
    return redundantUnitsCheck({
      kind: 'power.transformer',
      key: 'transformer',
      title: 'Transformer capacity',
      unit: 'VA',
      fmt: fmtVA,
      load: loadW === 0 ? 0 : loadVa,
      unitCapacity: param(equipmentModel(ctx, equipment.find((e) => e.key === 'transformer')), 'ratingVa'),
      unitWord: 'unit',
      loadText: loadVa === null ? `${atPeak}.` : `${atPeak}, ${fmtVA(loadVa)} at power factor ${pf}.`,
      unsized: 'No transformer with a known rating and power factor is sized, so it cannot be checked.',
      idle: 'Nothing draws power, so the transformers carry no load.',
    })
  }

  function inputCompatChecks(): Check[] {
    const distribution = plan.power.distribution
    const out: Check[] = []
    for (const group of plan.rackGroups) {
      const inGroup = racks.filter((r) => r.groupId === group.id)
      const rack = groupOf(group.id)?.rack
      if (inGroup.length === 0 || !rack) continue
      const ok = rack.supportedPower.includes(distribution)
      const accepts = rack.supportedPower.map((p) => DISTRIBUTION_LABEL[p]).join(' or ')
      out.push({
        id: `power.inputCompat:${group.id}`,
        kind: 'power.inputCompat',
        layer: 'power',
        subject: { kind: 'group', id: group.id, objectIds: inGroup.map((r) => r.objectId) },
        title: `Power input, ${group.name}`,
        value: null,
        limit: null,
        unit: '',
        utilization: null,
        status: ok ? 'pass' : 'fail',
        explanation: ok
          ? `${rack.name} racks accept ${accepts} power, which matches the plan's ${DISTRIBUTION_LABEL[distribution]} distribution.`
          : `${rack.name} racks accept only ${accepts} power, but the plan distributes ${DISTRIBUTION_LABEL[distribution]}.`,
        causes: [],
        ...(ok ? {} : { advice: `Switch distribution to ${accepts}, or choose a rack type that takes ${DISTRIBUTION_LABEL[distribution]}.` }),
      })
    }
    return out
  }

  const metric = (id: string, label: string, value: number | null, unit: string, inputs: string[]): Metric => ({
    id,
    layer: 'power',
    label,
    value,
    unit,
    basis: 'calculated',
    inputs,
    group: 'Power budget',
  })
  const lossInputs = ['rules.upsEfficiency', 'rules.transformerEfficiency', 'rules.distributionEfficiency', 'rules.miscFacilityFraction']

  return {
    hourly: { itW: itSeries, facilityW, pue },
    rows: plan.hall.rows.map((r) => ({ rowId: r.id, buswayLoadA: busways.rowLoads.get(r.id) ?? 0 })),
    busways: busways.rows,
    checks,
    metrics: [
      metric('power.itW', 'IT load', itW, 'W', ['placements', 'rackGroups.rackTypeId', 'network.opticsW']),
      metric('power.itPeakW', 'IT load with racks at peak', itPeakW, 'W', ['placements', 'rackGroups.rackTypeId', 'network.opticsW']),
      metric('power.facilityWorstW', 'Facility power at the worst hour', worstW, 'W', ['power.itW', 'cooling.coolingW', ...lossInputs]),
      metric('power.gridHeadroomW', 'Grid headroom at the worst hour', cap - worstW, 'W', ['site.gridCapacityW', 'power.facilityWorstW']),
      metric('power.hoursOverCap', 'Hours over the grid cap', hoursOverCap, 'h', ['site.gridCapacityW', 'power.facilityW']),
      metric('power.pueAnnual', 'PUE, annual', pueAnnual, '-', ['power.facilityW', 'power.itW']),
      metric('power.pueWorst', 'PUE at the worst hour', pueWorst, '-', ['power.facilityW', 'power.itW']),
      metric('power.usableFraction', 'Share of placed compute the grid carries', itW > 0 ? usableFraction : null, 'fraction', [
        'site.gridCapacityW',
        'power.facilityWorstW',
        ...lossInputs,
      ]),
    ],
    headline: { usablePflops, placedPflops, gpuCount, hoursOverCap, worstHour, pueAnnual, pueWorst },
  }
}
