import { num, type Check, type Metric, type RackResult, type RowLoad } from '@twin/schema'
import type { EvalContext } from '../context'
import { airDeltaTK, airflowM3s, capacityStatus, crahFanW, groupEntries, kw, makeCheck, metric, planCrahs, ratio, rule, sumBy } from '../sizing'

export interface AirSideResult {
  rows: Pick<RowLoad, 'rowId' | 'airW'>[]
  checks: Check[]
  metrics: Metric[]
  /** Air heat per CRAH position id, in W. */
  crahLoads: Record<string, number>
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

/** Airflow, CRAH zone loads and rack air limits (Task 8). */
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
  return {
    rows,
    crahLoads,
    checks: rackHeatLimitChecks(ctx, racks),
    metrics: [
      metric('cooling.airW', 'Heat to room air', airW, 'W', inputs, 'air'),
      metric('cooling.airDeltaTK', 'Room air ΔT', airDeltaTK(ctx), 'K', ['cooling.containment'], 'air'),
      metric('cooling.airflowM3s', 'Airflow needed', airflowM3s(ctx, airW), 'm³/s', inputs, 'air'),
      metric('cooling.crahFanW', 'CRAH fan power', fanW, 'W', [...inputs, 'overrides'], 'air'),
    ],
  }
}
