import { num, type Check, type RackResult } from '@twin/schema'
import { withUnit } from './causes'
import type { EvalContext } from './context'
import { placedCompute, type PowerResult } from './power'

export interface DemandResult {
  checks: Check[]
}

/**
 * Share of a busway rating that synchronized training peaks may reach before the breaker-trip risk is
 * flagged (Task 11 brief). Breakers are rated for steady load; repeated swings close to the rating trip them.
 */
const SWING_LIMIT_FRACTION = 0.9

const unit = (n: number, u: string) => withUnit(n, u, 0)

function rowObjectIds(racks: RackResult[], rowId: string): string[] {
  return racks.filter((r) => r.rowId === rowId).map((r) => r.objectId)
}

/**
 * Synchronized training steps swing a row around its average draw. The swing peak is the row's nominal
 * (average) rack power × `peakToAverageTraining`, as line current, against 90% of the busway capacity the
 * power module counts for the row (serving feeds × rating, the same limit as `power.busway`).
 */
function trainingSwingChecks(ctx: EvalContext, racks: RackResult[], power: PowerResult): Check[] {
  if (ctx.plan.workload.purpose !== 'training') return []
  const peakToAverage = num(ctx.rules.peakToAverageTraining)
  return power.busways
    .filter((row) => row.nominalW > 0)
    .map((row): Check => {
      const value = peakToAverage === null || row.ampsPerW === null ? null : row.nominalW * peakToAverage * row.ampsPerW
      const capacity = row.capacityA
      const limit = capacity === null ? null : capacity * SWING_LIMIT_FRACTION
      let utilization: number | null = null
      let status: Check['status'] = 'unknown'
      let explanation: string
      if (value === null) {
        explanation = `The busway model on row ${row.rowId} has no voltage or power factor, or the training peak factor is unknown, so the swing current cannot be calculated.`
      } else if (capacity === null || limit === null) {
        explanation = `Synchronized training steps take row ${row.rowId} to ${unit(value, 'A')} at peak, but no rated busway is sized for the row, so the swing cannot be checked.`
      } else if (capacity <= 0) {
        status = 'fail'
        explanation = `Synchronized training steps take row ${row.rowId} to ${unit(value, 'A')} at peak, but no busway capacity is left once redundancy is set aside.`
      } else {
        utilization = value / limit
        status = utilization > 1 ? 'warn' : 'pass'
        explanation =
          `Synchronized training steps take row ${row.rowId} from an average of ${unit(value / peakToAverage!, 'A')} to ${unit(value, 'A')} at peak ` +
          `(×${peakToAverage}). That is ${Math.round((value / capacity) * 100)}% of the ${unit(capacity, 'A')} busway capacity; ` +
          `above ${Math.round(SWING_LIMIT_FRACTION * 100)}% the breaker may trip on the swings.`
      }
      return {
        id: `power.trainingSwing:${row.rowId}`,
        kind: 'power.trainingSwing',
        layer: 'power',
        subject: { kind: 'row', id: row.rowId, objectIds: [...new Set([...row.objectIds, ...rowObjectIds(racks, row.rowId)])] },
        title: `Training power swing on row ${row.rowId}`,
        value,
        limit,
        unit: 'A',
        utilization,
        status,
        explanation,
        causes: [],
        ...(status === 'warn' || status === 'fail'
          ? { advice: `Spread the training racks over more rows, or fit a higher-rated busway or another feed on row ${row.rowId}.` }
          : {}),
      }
    })
}

function targetComputeCheck(ctx: EvalContext, racks: RackResult[]): Check {
  const target = ctx.plan.workload.targetPflops
  const compute = placedCompute(ctx, racks)
  const placed = compute.unknownRacks > 0 ? null : compute.pflops
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
