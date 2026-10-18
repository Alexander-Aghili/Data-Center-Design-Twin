import { num, type Check, type CheckKind, type Evaluation, type SizedEquipment, type Status } from '@twin/schema'
import type { EvalContext } from './context'
import { isPlant } from './cost'

type WorstFailure = NonNullable<Check['worstFailure']>

/** A single-unit loss in one equipment line, and the capacity check it stresses. */
interface Scenario {
  kind: CheckKind
  eq: SizedEquipment
  name: string
  /** One unit's capacity in the check's unit ('W' or 'A'); null when unknown. */
  unitCapacity: (checkUnit: string) => number | null
  /** The line's own load in the check's unit. */
  ownLoad: (checkUnit: string) => number | null
}

const STATUS_ORDER: Record<Status, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 }
const suffix = (key: string) => key.slice(key.indexOf(':') + 1)

/** "row R3" / "rows R3, R4" from the line's positions or key, else "zone <key suffix>". */
function servedRows(ctx: EvalContext, eq: SizedEquipment): string {
  const rows = [...new Set(ctx.plan.hall.positions.filter((p) => eq.positionIds.includes(p.id)).flatMap((p) => p.servesRows))]
  if (rows.length === 0 && ctx.plan.hall.rows.some((r) => r.id === suffix(eq.key))) rows.push(suffix(eq.key))
  if (rows.length === 0) return `zone ${suffix(eq.key)}`
  return `${rows.length === 1 ? 'row' : 'rows'} ${rows.join(', ')}`
}

function scenarioFor(ctx: EvalContext, eq: SizedEquipment): Scenario | null {
  if (eq.count <= 0) return null
  const watts = (w: number | null) => (unit: string) => (unit === 'W' ? w : null)
  if (isPlant(ctx, eq)) {
    const entry = eq.modelId ? ctx.catalog.get(eq.modelId, 'heatRejection') : undefined
    return {
      kind: 'cooling.heatRejection',
      eq,
      name: `One heat rejection unit offline (${entry?.name ?? eq.modelId ?? 'unknown model'})`,
      unitCapacity: watts(entry ? num(entry.unitCapacityW) : null),
      ownLoad: watts(eq.loadW),
    }
  }
  const entry = eq.modelId ? ctx.catalog.get(eq.modelId, 'equipment') : undefined
  const p = (key: string) => {
    const quantity = entry?.params[key]
    return quantity ? num(quantity) : null
  }
  switch (eq.category) {
    case 'cdu':
      return { kind: 'cooling.cduCapacity', eq, name: `One CDU serving ${servedRows(ctx, eq)} offline`, unitCapacity: watts(p('capacityW')), ownLoad: watts(eq.loadW) }
    case 'crah':
      return { kind: 'cooling.crahCapacity', eq, name: `One CRAH in zone ${suffix(eq.key)} offline`, unitCapacity: watts(p('capacityW')), ownLoad: watts(eq.loadW) }
    case 'ups':
      return { kind: 'power.ups', eq, name: 'One UPS module offline', unitCapacity: watts(p('moduleW')), ownLoad: watts(eq.loadW) }
    case 'busway': {
      const ratingA = p('ratingA')
      const voltageV = p('voltageV')
      const pf = p('powerFactor')
      // Three-phase: P = √3 · V · I · pf
      const wattsPerAmp = voltageV !== null && pf !== null ? Math.sqrt(3) * voltageV * pf : null
      return {
        kind: 'power.busway',
        eq,
        name: `One busway feed to row ${suffix(eq.key)} lost`,
        unitCapacity: (unit) =>
          unit === 'A' ? ratingA : unit === 'W' && ratingA !== null && wattsPerAmp !== null ? ratingA * wattsPerAmp : null,
        ownLoad: (unit) => (unit === 'W' ? eq.loadW : unit === 'A' && wattsPerAmp ? eq.loadW / wattsPerAmp : null),
      }
    }
    default:
      return null
  }
}

/** The check this scenario stresses: one named after the line (key, row/zone or position), else the only check of its kind. */
function matchCheck(checks: Check[], s: Scenario): Check | undefined {
  const ofKind = checks.filter((c) => c.kind === s.kind)
  const names = new Set([s.eq.key, suffix(s.eq.key), ...s.eq.positionIds])
  const specific = ofKind.find((c) => names.has(c.subject.id) || [...names].some((n) => c.id === `${s.kind}:${n}`))
  return specific ?? (ofKind.length === 1 ? ofKind[0] : undefined)
}

function evaluateScenario(ctx: EvalContext, s: Scenario, check: Check, shared: boolean): WorstFailure {
  const unitCapacity = s.unitCapacity(check.unit)
  // A check that covers several lines carries their combined load; then each loss is judged on its own line's load.
  const load = shared ? s.ownLoad(check.unit) : (check.value ?? s.ownLoad(check.unit))
  const remaining = unitCapacity === null ? null : (s.eq.count - 1) * unitCapacity
  const warnAt = num(ctx.rules.warnThreshold) ?? 1
  if (load === null || remaining === null) return { scenario: s.name, value: load, utilization: null, status: 'unknown' }
  if (remaining <= 0) return { scenario: s.name, value: load, utilization: null, status: load > 0 ? 'fail' : 'pass' }
  const utilization = load / remaining
  const status: Status = utilization > 1 ? 'fail' : utilization > warnAt ? 'warn' : 'pass'
  return { scenario: s.name, value: load, utilization, status }
}

function worse(a: WorstFailure, b: WorstFailure): boolean {
  const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  return order !== 0 ? order > 0 : (a.utilization ?? 0) > (b.utilization ?? 0)
}

/**
 * Light N-1 pass: for each CDU zone, CRAH zone, plant, busway feed and UPS line, remove one unit and
 * re-run the matching capacity check against the remaining units. Each check keeps its normal status and
 * gains `worstFailure`, the worst single loss that affects it. Network N-1 is out of scope.
 */
export function applyFailureScenarios(ctx: EvalContext, base: Evaluation): Evaluation {
  const pairs = base.equipment.flatMap((eq) => {
    const s = scenarioFor(ctx, eq)
    const check = s && matchCheck(base.checks, s)
    return s && check ? [{ s, check }] : []
  })
  const linesPerCheck = new Map<string, number>()
  for (const { check } of pairs) linesPerCheck.set(check.id, (linesPerCheck.get(check.id) ?? 0) + 1)

  const worst = new Map<string, WorstFailure>()
  for (const { s, check } of pairs) {
    const result = evaluateScenario(ctx, s, check, (linesPerCheck.get(check.id) ?? 0) > 1)
    const current = worst.get(check.id)
    if (!current || worse(result, current)) worst.set(check.id, result)
  }
  if (worst.size === 0) return base
  return { ...base, checks: base.checks.map((c) => (worst.has(c.id) ? { ...c, worstFailure: worst.get(c.id)! } : c)) }
}
