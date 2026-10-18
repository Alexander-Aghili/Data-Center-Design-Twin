import { COOLANT, num, type Check, type CoolantEntry, type Metric, type RackCoolingEntry, type RackResult, type Row, type RowLoad, type Status } from '@twin/schema'
import type { EvalContext } from '../context'
import {
  balancingFactor,
  cduApproachK,
  cduPumpW,
  fmt,
  groupEntries,
  loopW,
  makeCheck,
  methodPumpW,
  metric,
  planCdus,
  rule,
  sumBy,
  type CduFill,
} from '../sizing'

export interface LiquidSideResult {
  /** The input racks with flow, temperatures and flowShare filled in. */
  racks: RackResult[]
  rowFlows: Pick<RowLoad, 'rowId' | 'liquidW' | 'flowLps'>[]
  checks: Check[]
  metrics: Metric[]
}

// Manifold thresholds from the plan: the starved end of a row warns below 90% of design flow and fails below 80%.
const MANIFOLD_WARN_SHARE = 0.9
const MANIFOLD_FAIL_SHARE = 0.8

/** One rack's loop at design flow, before the row manifold shares the flow out. */
interface Loop {
  rack: RackResult
  method: RackCoolingEntry
  heatW: number
  deltaTK: number | null
  designLps: number | null
  supplyC: number | null
  twoPhase: boolean
}

/**
 * ṁ = Q / (cp·ΔT) with the loop fluid's catalog properties. Two-phase loops (R-2p) boil near-isothermally, so
 * the method's ΔT is the facility-water rise: the flow is facility water's, at the facility supply temperature.
 */
function loopOf(ctx: EvalContext, rack: RackResult, cdus: Map<string, CduFill>): Loop | null {
  const method = groupEntries(ctx, rack.groupId).method
  const heatW = loopW(rack)
  if (!method || heatW <= 0) return null
  const coolant = method.coolantId ? ctx.catalog.get(method.coolantId, 'coolant') : undefined
  const twoPhase = coolant?.twoPhase ?? false
  const fluid: CoolantEntry | undefined = twoPhase ? ctx.catalog.get(COOLANT.WATER, 'coolant') : coolant
  const cp = fluid ? num(fluid.cpJPerKgK) : null
  const rho = fluid ? num(fluid.densityKgM3) : null
  const deltaTK = num(method.deltaTK)
  const facility = ctx.plan.cooling.facilitySupplyC
  let supplyC: number | null = facility
  if (method.requiresCdu && !twoPhase) {
    const approach = cduApproachK(cdus.get(rack.rowId))
    supplyC = approach === null ? null : facility + approach
  }
  return {
    rack,
    method,
    heatW,
    deltaTK,
    designLps: cp && rho && deltaTK ? (heatW / (cp * deltaTK) / rho) * 1000 : null,
    supplyC,
    twoPhase,
  }
}

/** The row end a header is fed from: the side of the CDU position serving the row, else slot 0. */
function feedsFromEast(ctx: EvalContext, row: Row): boolean {
  const cdu = ctx.plan.hall.positions.find((p) => p.kind === 'cdu' && p.servesRows.includes(row.id))
  return cdu !== undefined && cdu.x > row.x + (row.slotCount * row.slotPitchM) / 2
}

/**
 * Header pressure loss along a row: without balancing, rack k of n (k = 0 nearest the feed) gets
 * s_k = 1 − h·k/(n−1), scaled so the row's total flow is conserved (mean 1 for equal racks).
 * Balancing valves give every rack its design flow.
 */
function manifoldShares(ctx: EvalContext, row: Row, loops: Loop[]): Map<Loop, number> {
  const shares = new Map<Loop, number>()
  const ordered = loops.toSorted((a, b) => (feedsFromEast(ctx, row) ? b.rack.slot - a.rack.slot : a.rack.slot - b.rack.slot))
  const h = ctx.plan.cooling.flowBalancing ? 0 : (rule(ctx, 'manifoldHeaderLossFraction') ?? 0)
  const n = ordered.length
  const raw = ordered.map((_, k) => (n > 1 ? 1 - (h * k) / (n - 1) : 1))
  const design = sumBy(ordered, (l) => l.designLps ?? 0)
  const delivered = sumBy(ordered.map((l, k) => (l.designLps ?? 0) * raw[k]!), (v) => v)
  const scale = delivered > 0 ? design / delivered : 1
  ordered.forEach((l, k) => shares.set(l, raw[k]! * scale))
  return shares
}

function manifoldCheck(row: Row, shares: number[], loops: Loop[], balanced: boolean): Check {
  const minShare = Math.min(...shares)
  const status: Status = minShare < MANIFOLD_FAIL_SHARE ? 'fail' : minShare < MANIFOLD_WARN_SHARE ? 'warn' : 'pass'
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return makeCheck({
    kind: 'cooling.manifoldBalance',
    subject: { kind: 'row', id: row.id, objectIds: loops.map((l) => l.rack.objectId) },
    title: `Manifold balance, row ${row.id}`,
    value: minShare,
    limit: MANIFOLD_FAIL_SHARE,
    unit: 'fraction',
    utilization: null,
    status,
    explanation: balanced
      ? `Balancing valves give all ${loops.length} racks in row ${row.id} their design flow, at the cost of extra pump head.`
      : `Without balancing valves, header pressure loss leaves the rack farthest from the feed in row ${row.id} with ${pct(minShare)} of its design flow. Below ${pct(MANIFOLD_WARN_SHARE)} warns and below ${pct(MANIFOLD_FAIL_SHARE)} fails.`,
    ...(status !== 'pass' ? { advice: `Turn on flow balancing (balancing valves on each rack branch), or shorten row ${row.id}'s liquid-cooled run.` } : {}),
  })
}

/** Per group: the warmest coolant supply at its racks against the rack's and the method's maximum. */
function coolantTempChecks(ctx: EvalContext, loops: Loop[]): Check[] {
  return ctx.plan.rackGroups.flatMap((group) => {
    const members = loops.filter((l) => l.rack.groupId === group.id)
    if (members.length === 0) return []
    const { rack } = groupEntries(ctx, group.id)
    const method = members[0]!.method
    const supplies = members.map((l) => l.supplyC)
    const value = supplies.includes(null) ? null : Math.max(...supplies.map((s) => s ?? 0))
    const rackMax = rack ? num(rack.maxCoolantSupplyC) : null
    const methodMax = num(method.supplyRangeC.max)
    const methodMin = num(method.supplyRangeC.min)
    const limits = [rackMax, methodMax].filter((v): v is number => v !== null)
    const limit = limits.length > 0 ? Math.min(...limits) : null
    let status: Status = 'unknown'
    if (value !== null && limit !== null) status = value > limit ? 'fail' : methodMin !== null && value < methodMin ? 'warn' : 'pass'
    const approach = method.requiresCdu && !members[0]!.twoPhase ? ' plus the CDU approach' : ''
    const binding = limit === rackMax ? `${rack?.name ?? 'the rack'} accepts` : `${method.name} is rated for`
    const explanation =
      value === null || limit === null
        ? `The coolant supply temperature or its limit for ${group.name} is unknown.`
        : `Coolant reaches the racks in ${group.name} at ${fmt(value, '°C', 1)} (facility supply ${fmt(ctx.plan.cooling.facilitySupplyC, '°C', 1)}${approach}); ${binding} at most ${fmt(limit, '°C', 1)}.` +
          (status === 'warn' ? ` That is below the method's ${fmt(methodMin ?? 0, '°C', 1)} minimum, which adds condensation risk.` : '')
    return [
      makeCheck({
        kind: 'cooling.coolantTemp',
        subject: { kind: 'group', id: group.id, objectIds: members.map((l) => l.rack.objectId) },
        title: `Coolant supply temperature, ${group.name}`,
        value,
        limit,
        unit: '°C',
        utilization: null,
        status,
        explanation,
        ...(status === 'fail' && value !== null && limit !== null
          ? { advice: `Lower the facility supply temperature by at least ${fmt(value - limit, 'K', 1)}, or choose racks and a cooling method rated for warmer water.` }
          : {}),
      }),
    ]
  })
}

/** Floor area per group: immersion tanks take their own footprint, racks their slots. */
function floorAreaMetrics(ctx: EvalContext, racks: RackResult[]): Metric[] {
  return ctx.plan.rackGroups.flatMap((group) => {
    const members = racks.filter((r) => r.groupId === group.id)
    if (members.length === 0) return []
    const { method, rack } = groupEntries(ctx, group.id)
    const tank = method?.formFactor === 'tank' && method.tankFootprintM2PerRack ? num(method.tankFootprintM2PerRack) : null
    const area = sumBy(members, (r) => {
      if (tank !== null) return tank
      const row = ctx.plan.hall.rows.find((x) => x.id === r.rowId)
      return row ? (rack?.slotsWide ?? 1) * row.slotPitchM * row.rackDepthM : 0
    })
    return [metric(`cooling.floorAreaM2:${group.id}`, `Floor area, ${group.name}`, area, 'm²', [`rackGroups.${group.id}.coolingMethodId`], 'liquid')]
  })
}

/** Coolant flow, temperatures and row manifold balance (Task 8). */
export function liquidSide(ctx: EvalContext, racks: RackResult[]): LiquidSideResult {
  const cdus = new Map(planCdus(ctx, racks).map((f) => [f.rowId, f]))
  const loops = new Map<RackResult, Loop>()
  for (const r of racks) {
    const loop = loopOf(ctx, r, cdus)
    if (loop) loops.set(r, loop)
  }

  const checks: Check[] = []
  const shares = new Map<Loop, number>()
  for (const row of ctx.plan.hall.rows) {
    const singlePhase = [...loops.values()].filter((l) => l.rack.rowId === row.id && !l.twoPhase && l.designLps !== null)
    if (singlePhase.length === 0) continue
    const rowShares = manifoldShares(ctx, row, singlePhase)
    rowShares.forEach((s, l) => shares.set(l, s))
    checks.push(manifoldCheck(row, [...rowShares.values()], singlePhase, ctx.plan.cooling.flowBalancing))
  }

  const out = racks.map((r): RackResult => {
    const loop = loops.get(r)
    const { method, rack } = groupEntries(ctx, r.groupId)
    const maxRackW = method ? num(method.maxRackW) : null
    const heatOk = maxRackW === null || r.heatW <= maxRackW
    if (!loop) return { ...r, coolingOk: r.coolingOk && heatOk }
    const share = shares.get(loop) ?? null
    const flowLps = loop.designLps === null ? null : loop.designLps * (share ?? 1)
    // Return = supply + Q/(ṁ·cp); with ṁ = share × design flow that is supply + ΔT/share.
    const rise = loop.deltaTK === null ? null : loop.deltaTK / (share ?? 1)
    const returnC = loop.supplyC === null || rise === null ? null : loop.supplyC + rise
    const maxSupply = rack ? num(rack.maxCoolantSupplyC) : null
    const tempOk = loop.supplyC === null || maxSupply === null || loop.supplyC <= maxSupply
    const flowOk = share === null || share >= MANIFOLD_FAIL_SHARE
    return { ...r, flowLps, supplyC: loop.supplyC, returnC, flowShare: share, coolingOk: r.coolingOk && heatOk && tempOk && flowOk }
  })

  checks.push(...coolantTempChecks(ctx, [...loops.values()]))

  const rowFlows = ctx.plan.hall.rows.map((row) => {
    const inRow = out.filter((r) => r.rowId === row.id)
    return { rowId: row.id, liquidW: sumBy(inRow, (r) => r.liquidW), flowLps: sumBy(inRow, (r) => r.flowLps ?? 0) }
  })
  const pumps = [...cdus.values()].map(cduPumpW)
  const cduPump = pumps.includes(null) ? null : sumBy(pumps, (w) => w ?? 0) * balancingFactor(ctx)
  const shareValues = [...shares.values()]
  const inputs = ['rackGroups', 'placements', 'cooling.facilitySupplyC', 'cooling.flowBalancing']
  return {
    racks: out,
    rowFlows,
    checks,
    metrics: [
      metric('cooling.liquidW', 'Heat to liquid loops', sumBy(out, (r) => r.liquidW), 'W', inputs, 'liquid'),
      metric('cooling.flowLps', 'Coolant flow', sumBy(out, (r) => r.flowLps ?? 0), 'L/s', inputs, 'liquid'),
      metric('cooling.cduPumpW', 'CDU pump power', cduPump, 'W', [...inputs, 'overrides'], 'liquid'),
      metric('cooling.rackPumpW', 'Rack and tank pump power', sumBy(out, (r) => methodPumpW(ctx, r)) * balancingFactor(ctx), 'W', inputs, 'liquid'),
      metric('cooling.minFlowShare', 'Lowest rack flow share', shareValues.length > 0 ? Math.min(...shareValues) : null, 'fraction', inputs, 'liquid'),
      ...floorAreaMetrics(ctx, racks),
    ],
  }
}
