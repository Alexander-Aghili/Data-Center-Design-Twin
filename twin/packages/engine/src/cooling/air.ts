import { num, type Check, type Metric, type RackResult, type RowLoad } from '@twin/schema'
import type { EvalContext } from '../context'
import { airDeltaTK, airflowM3s, capacityStatus, crahFanW, fmt, groupEntries, kw, makeCheck, metric, planCrahs, ratio, rule, sumBy } from '../sizing'

export interface AirSideResult {
  rows: Pick<RowLoad, 'rowId' | 'airW'>[]
  checks: Check[]
  metrics: Metric[]
  /** Air heat per CRAH position id, in W. */
  crahLoads: Record<string, number>
  /** The input racks with `airInletC` and `airOutletC` filled in. */
  racks: RackResult[]
}

/** CRAH supply air is not run below the ASHRAE recommended inlet envelope's 18 °C lower bound. */
const MIN_AIR_INLET_C = 18

/**
 * Room air at each rack. Inlet: the CRAH coils cool air to the facility supply plus the coil approach,
 * never below 18 °C. Outlet: inlet plus the room-air ΔT, scaled up by how far the rack's air heat exceeds
 * its cooling method's per-rack rating, so overloaded air racks run visibly hot. A rack with no air heat
 * passes no air, so its outlet equals its inlet. Unknown inputs leave the temperature null.
 */
function withAirTemperatures(ctx: EvalContext, racks: RackResult[]): RackResult[] {
  const approach = rule(ctx, 'crahCoilApproachK')
  const deltaT = airDeltaTK(ctx)
  const inlet = approach === null ? null : Math.max(MIN_AIR_INLET_C, ctx.plan.cooling.facilitySupplyC + approach)
  const limits = new Map(
    ctx.plan.rackGroups.map((g) => {
      const { method } = groupEntries(ctx, g.id)
      return [g.id, method ? num(method.maxRackW) : null]
    }),
  )
  return racks.map((r) => {
    if (inlet === null || r.airW === 0) return { ...r, airInletC: inlet, airOutletC: inlet }
    const overload = ratio(r.airW, limits.get(r.groupId) ?? null)
    const outlet = deltaT === null || overload === null ? null : inlet + deltaT * Math.max(1, overload)
    return { ...r, airInletC: inlet, airOutletC: outlet }
  })
}

/** Per rack group: the hottest rack's heat against the cooling method's per-rack limit. */
function rackHeatLimitChecks(ctx: EvalContext, racks: RackResult[]): Check[] {
  return ctx.plan.rackGroups.flatMap((group) => {
    const members = racks.filter((r) => r.groupId === group.id)
    if (members.length === 0) return []
    const { method } = groupEntries(ctx, group.id)
    const heatW = Math.max(...members.map((r) => r.heatW))
    const limit = method ? num(method.maxRackW) : null
    const utilization = ratio(heatW, limit)
    const status = capacityStatus(ctx, utilization)
    const methodName = method?.name ?? `the missing cooling method "${group.coolingMethodId}"`
    return [
      makeCheck({
        kind: 'cooling.rackHeatLimit',
        subject: { kind: 'group', id: group.id, objectIds: members.map((r) => r.objectId) },
        title: `Rack heat limit, ${group.name}`,
        value: heatW,
        limit,
        unit: 'W',
        utilization,
        status,
        explanation:
          limit === null
            ? `Racks in ${group.name} give off ${kw(heatW)}, but ${methodName} has no known per-rack limit.`
            : `Racks in ${group.name} give off ${kw(heatW)} each; ${methodName} is rated to ${kw(limit)} per rack.`,
        ...(status === 'fail'
          ? { advice: `Choose a cooling method rated for at least ${kw(heatW)} per rack (direct-to-chip liquid or immersion for dense racks), or a lower-power rack type.` }
          : {}),
      }),
    ]
  })
}

// ASHRAE TC9.9 Thermal Guidelines, class A1 air-cooled IT: recommended inlet 18 to 27 °C, allowable 15 to 32 °C.
const A1_RECOMMENDED_MAX_C = 27
const A1_ALLOWABLE_MAX_C = 32
const ROOM_AIR_CATEGORIES = new Set(['air', 'rdhx'])

/**
 * Per air or rear-door group: the inlet air the CRAHs deliver against ASHRAE A1. The CRAHs share the facility
 * loop, so warm water for liquid racks warms the room air too. Warn above 27 °C, fail above 32 °C.
 */
function airInletChecks(ctx: EvalContext, racks: RackResult[]): Check[] {
  const approach = rule(ctx, 'crahCoilApproachK')
  const supplyC = ctx.plan.cooling.facilitySupplyC
  return ctx.plan.rackGroups.flatMap((group) => {
    const { method } = groupEntries(ctx, group.id)
    const members = racks.filter((r) => r.groupId === group.id)
    const [first] = members
    if (!first || !method || !ROOM_AIR_CATEGORIES.has(method.category)) return []
    const inlet = first.airInletC
    const status = inlet === null ? 'unknown' : inlet > A1_ALLOWABLE_MAX_C ? 'fail' : inlet > A1_RECOMMENDED_MAX_C ? 'warn' : 'pass'
    const air = (c: number) => fmt(c, '°C')
    const source = `${air(supplyC)} water plus the ${approach === null ? 'CRAH' : fmt(approach, 'K')} coil approach`
    const explanation =
      inlet === null
        ? `The inlet air temperature for ${group.name} is unknown because the CRAH coil approach is unknown.`
        : status === 'pass'
          ? `${group.name} racks get ${air(inlet)} inlet air from the CRAHs (${source}), inside ASHRAE TC9.9's recommended ${air(18)} to ${air(A1_RECOMMENDED_MAX_C)} for air-cooled servers.`
          : status === 'warn'
            ? `${group.name} racks get ${air(inlet)} inlet air because the CRAHs share the facility loop (${source}). That is above ASHRAE TC9.9's recommended ${air(A1_RECOMMENDED_MAX_C)} for air-cooled servers, within the ${air(A1_ALLOWABLE_MAX_C)} allowable limit.`
            : `${group.name} racks get ${air(inlet)} inlet air because the CRAHs share the facility loop, which supplies ${air(supplyC)} water. Air-cooled servers are rated to ${air(A1_ALLOWABLE_MAX_C)} (ASHRAE TC9.9 class A1 allowable).`
    const maxSupply = approach === null ? null : A1_ALLOWABLE_MAX_C - approach
    return [
      makeCheck({
        kind: 'cooling.airInletTemp',
        subject: { kind: 'group', id: group.id, objectIds: members.map((r) => r.objectId) },
        title: `Rack inlet air, ${group.name}`,
        value: inlet,
        limit: A1_ALLOWABLE_MAX_C,
        unit: '°C',
        utilization: ratio(inlet ?? 0, inlet === null ? null : A1_ALLOWABLE_MAX_C),
        status,
        explanation,
        ...(status === 'fail' && maxSupply !== null
          ? { advice: `Keep the facility supply at ${air(maxSupply)} or less, give the CRAHs their own colder chilled-water loop, or move ${group.name} to liquid cooling.` }
          : {}),
      }),
    ]
  })
}

/** Airflow, CRAH zone loads, rack air limits and rack air temperatures (Task 8). */
export function airSide(ctx: EvalContext, racks: RackResult[]): AirSideResult {
  const { hall } = ctx.plan
  const rows = hall.rows.map((row) => ({ rowId: row.id, airW: sumBy(racks.filter((r) => r.rowId === row.id), (r) => r.airW) }))

  // Each row's room-air heat is shared evenly by the CRAH positions that serve it.
  const crahPositions = hall.positions.filter((p) => p.kind === 'crah')
  const crahLoads: Record<string, number> = {}
  for (const p of crahPositions) {
    crahLoads[p.id] = sumBy(
      rows.filter((r) => p.servesRows.includes(r.rowId)),
      (r) => r.airW / crahPositions.filter((q) => q.servesRows.includes(r.rowId)).length,
    )
  }

  const airW = sumBy(rows, (r) => r.airW)
  const crahs = planCrahs(ctx, crahLoads)
  const zonedW = sumBy(crahs, (f) => f.item.loadW)
  // Air in rows no CRAH zone covers still needs fans somewhere; count it at the rules' fallback fraction.
  const unzonedFanW = (rule(ctx, 'crahFanFractionFallback') ?? 0) * Math.max(0, airW - zonedW)
  const fanParts = crahs.map((f) => crahFanW(ctx, f))
  const fanW = fanParts.includes(null) ? null : sumBy(fanParts, (w) => w ?? 0) + unzonedFanW

  const inputs = ['rackGroups', 'placements', 'cooling.containment']
  const withTemps = withAirTemperatures(ctx, racks)
  return {
    rows,
    crahLoads,
    racks: withTemps,
    checks: [...rackHeatLimitChecks(ctx, racks), ...airInletChecks(ctx, withTemps)],
    metrics: [
      metric('cooling.airW', 'Heat to room air', airW, 'W', inputs, 'air'),
      metric('cooling.airDeltaTK', 'Room air ΔT', airDeltaTK(ctx), 'K', ['cooling.containment'], 'air'),
      metric('cooling.airflowM3s', 'Airflow needed', airflowM3s(ctx, airW), 'm³/s', inputs, 'air'),
      metric('cooling.crahFanW', 'CRAH fan power', fanW, 'W', [...inputs, 'overrides'], 'air'),
    ],
  }
}
