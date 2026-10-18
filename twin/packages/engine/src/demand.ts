import { num, type Check, type RackResult } from '@twin/schema'
import type { EvalContext } from './context'
import type { PowerResult } from './power'

export interface DemandResult {
  checks: Check[]
}

/**
 * Share of a busway rating that synchronized training peaks may reach before the breaker-trip risk is
 * flagged (Task 11 brief). Breakers are rated for steady load; repeated swings close to the rating trip them.
 */
const SWING_LIMIT_FRACTION = 0.9

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const unit = (n: number, u: string) => `${fmt.format(n)} ${u}`

function rowObjectIds(racks: RackResult[], rowId: string): string[] {
  return racks.filter((r) => r.rowId === rowId).map((r) => r.objectId)
}

function trainingSwingChecks(ctx: EvalContext, racks: RackResult[], power: PowerResult): Check[] {
  if (ctx.plan.workload.purpose !== 'training') return []
  const peakToAverage = num(ctx.rules.peakToAverageTraining)
  return power.rows
    .filter((row) => row.buswayLoadA > 0)
    .map((row): Check => {
      const busway = power.checks.find(
        (c) => c.kind === 'power.busway' && (c.subject.id === row.rowId || c.id === `power.busway:${row.rowId}`),
      )
      const rating = busway?.limit ?? null
      const value = peakToAverage === null ? null : row.buswayLoadA * peakToAverage
      const limit = rating === null ? null : rating * SWING_LIMIT_FRACTION
      const utilization = value !== null && limit !== null && limit > 0 ? value / limit : null
      const status = utilization === null ? 'unknown' : utilization > 1 ? 'warn' : 'pass'
      const explanation =
        value === null || limit === null || rating === null
          ? `Row ${row.rowId} carries ${unit(row.buswayLoadA, 'A')}, but the busway rating or the training peak factor is unknown.`
          : `Synchronized training steps raise row ${row.rowId} from ${unit(row.buswayLoadA, 'A')} to ${unit(value, 'A')} at peak ` +
            `(×${peakToAverage}). That is ${Math.round((value / rating) * 100)}% of the ${unit(rating, 'A')} busway; ` +
            `above ${Math.round(SWING_LIMIT_FRACTION * 100)}% the breaker may trip on the swings.`
      return {
        id: `power.trainingSwing:${row.rowId}`,
        kind: 'power.trainingSwing',
        layer: 'power',
        subject: { kind: 'row', id: row.rowId, objectIds: [...(busway?.subject.objectIds ?? []), ...rowObjectIds(racks, row.rowId)] },
        title: `Training power swing on row ${row.rowId}`,
        value,
        limit,
        unit: 'A',
        utilization,
        status,
        explanation,
        causes: [],
        ...(status === 'warn' ? { advice: `Spread the training racks over more rows, or fit a higher-rated busway on row ${row.rowId}.` } : {}),
      }
    })
}

/** Σ FP8 PFLOPS of placed racks; null when any placed rack's figure is unknown. */
function placedPflops(ctx: EvalContext, racks: RackResult[]): number | null {
  let total = 0
  for (const rack of racks) {
    const typeId = ctx.plan.rackGroups.find((g) => g.id === rack.groupId)?.rackTypeId
    const entry = typeId ? ctx.catalog.get(typeId, 'rack') : undefined
    const pflops = entry ? num(entry.fp8Pflops) : null
    if (pflops === null) return null
    total += pflops
  }
  return total
}

function targetComputeCheck(ctx: EvalContext, racks: RackResult[]): Check {
  const target = ctx.plan.workload.targetPflops
  const placed = placedPflops(ctx, racks)
  const utilization = placed !== null && placed > 0 ? target / placed : null
  let status: Check['status']
  let explanation: string
  if (racks.length === 0) {
    status = 'unknown'
    explanation = `No racks are placed yet. The workload target is ${unit(target, 'PFLOPS')} FP8.`
  } else if (placed === null) {
    status = 'unknown'
    explanation = 'At least one placed rack type has no FP8 compute figure, so placed compute is unknown.'
  } else if (placed < target) {
    status = 'warn'
    explanation = `Placed racks deliver ${unit(placed, 'PFLOPS')} FP8, ${unit(target - placed, 'PFLOPS')} short of the ${unit(target, 'PFLOPS')} target.`
  } else {
    status = 'pass'
    explanation = `Placed racks deliver ${unit(placed, 'PFLOPS')} FP8 against a target of ${unit(target, 'PFLOPS')}.`
  }
  return {
    id: 'workload.targetCompute:site',
    kind: 'workload.targetCompute',
    layer: 'workload',
    subject: { kind: 'site', id: 'site', objectIds: [] },
    title: 'Target compute',
    value: placed,
    limit: target,
    unit: 'PFLOPS',
    utilization,
    status,
    explanation,
    causes: [],
    ...(status === 'warn' ? { advice: 'Place more racks, or choose a rack type with more FP8 compute per rack.' } : {}),
  }
}

/** Demand problems: synchronized training swings on busways and placed compute against the target. */
export function demandChecks(ctx: EvalContext, racks: RackResult[], power: PowerResult): DemandResult {
  return { checks: [...trainingSwingChecks(ctx, racks, power), targetComputeCheck(ctx, racks)] }
}
