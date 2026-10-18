import type { Check, CheckKind, Evaluation, Plan, Status } from '@twin/schema'
import { fmtNull, fmtNumber, fmtPower, fmtValue } from '../../format'
import { rankChecks } from '../Checks'

const NBSP = ' '

export interface Kpi {
  label: string
  /** The number as shown ("8.4", "—"); the unit follows it apart so the two can be set in different sizes. */
  value: string
  unit?: string
  /** One quiet line under the number: the limit or the second reading. */
  context: string
  /** Worst status of the check that judges this number; unknown when no check does. */
  status: Status
  /** Share of the limit in use (may pass 1); left out when there is no limit to read against. */
  gauge?: number
}

const STATUS_ORDER: Status[] = ['fail', 'warn', 'unknown', 'pass']

function worstOf(checks: readonly Check[], kind: CheckKind): Status {
  const statuses = new Set(checks.filter((c) => c.kind === kind).map((c) => c.status))
  return STATUS_ORDER.find((s) => statuses.has(s)) ?? 'unknown'
}

/** "8.4 MW" becomes value "8.4" and unit "MW"; "—" has no unit. */
function split(formatted: string): Pick<Kpi, 'value' | 'unit'> {
  const [value = formatted, unit] = formatted.split(NBSP)
  return unit === undefined ? { value } : { value, unit }
}

function share(value: number | null, limit: number): Pick<Kpi, 'gauge'> {
  return value === null || limit <= 0 ? {} : { gauge: value / limit }
}

const pue = (n: number | null) => fmtNull(n, (x) => fmtNumber(x, 2))

/** The four numbers the right panel leads with: usable compute, facility power, PUE and water. */
export function summaryKpis(plan: Plan, e: Evaluation): Kpi[] {
  const { headline, hourly, checks } = e
  const gridW = plan.site.gridCapacityW
  const waterLimit = plan.site.waterAllowanceM3PerDay
  const facilityW = hourly.facilityW[headline.worstHour] ?? null
  return [
    {
      label: 'Usable compute',
      value: fmtNumber(headline.usablePflops, 0),
      unit: 'PFLOPS',
      context: `of ${fmtNumber(headline.placedPflops, 0)} placed`,
      status: worstOf(checks, 'workload.targetCompute'),
    },
    {
      label: 'Facility power, worst hour',
      ...split(fmtNull(facilityW, fmtPower)),
      context: `of ${fmtPower(gridW)} grid cap`,
      status: worstOf(checks, 'power.gridWorstHour'),
      ...share(facilityW, gridW),
    },
    {
      label: 'PUE, annual',
      value: pue(headline.pueAnnual),
      context: `${pue(headline.pueWorst)} hottest hour`,
      status: 'unknown',
    },
    {
      label: 'Water, peak day',
      ...split(fmtValue(headline.waterM3PerDayPeak, 'm³/day')),
      context: `of ${fmtValue(waterLimit, 'm³/day')} allowance`,
      status: worstOf(checks, 'cooling.waterPeakDay'),
      ...share(headline.waterM3PerDayPeak, waterLimit),
    },
  ]
}

/** Failing and warning checks, worst first. Unknown and passing checks live in the all-variables drawer. */
export function issueChecks(checks: readonly Check[]): Check[] {
  return rankChecks(checks).filter((c) => c.status === 'fail' || c.status === 'warn')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One line on whether the plan can be built as drawn, and how many issues stand in the way. */
export function verdict(e: Evaluation): { status: Status; text: string } {
  const issues = issueChecks(e.checks)
  const count = plural(issues.length, 'issue', 'issues')
  if (!e.headline.buildable) return { status: 'fail', text: issues.length > 0 ? `Not buildable, ${count}` : 'Not buildable' }
  if (issues.length === 0) return { status: 'pass', text: 'Buildable' }
  return { status: issues[0]?.status ?? 'warn', text: `Buildable, ${count}` }
}
