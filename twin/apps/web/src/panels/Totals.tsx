import type { Check, CheckKind, Evaluation, Plan, Status } from '@twin/schema'
import type { CSSProperties } from 'react'
import { fmtMoney, fmtNull, fmtNumber, fmtPower, fmtValue, fmtWeeks } from '../format'
import { useTwinStore } from '../state/store'
import { Checks } from './Checks'
import { StatusMark } from './StatusMark'

interface Row {
  label: string
  value: string
  /** The limit the value is read against, shown quieter: "of 10.0 MW". */
  limit?: string
  /** Share of the limit used, drawn on the row's rule; colored by the matching check's status. */
  meter?: { ratio: number; status: Status }
}

const STATUS_ORDER: Status[] = ['fail', 'warn', 'unknown', 'pass']

/** Worst status among the checks of one kind, or unknown when the engine produced none. */
function worstOf(checks: readonly Check[], kind: CheckKind): Status {
  const statuses = new Set(checks.filter((c) => c.kind === kind).map((c) => c.status))
  return STATUS_ORDER.find((s) => statuses.has(s)) ?? 'unknown'
}

/** "8.4 MW" against "10.0 MW" reads as "8.4 of 10.0 MW": the unit is said once when both share it. */
function against(value: string, limit: string): Pick<Row, 'value' | 'limit'> {
  const unit = (s: string) => s.split('\u00a0')[1]
  return { value: unit(value) === unit(limit) ? (value.split('\u00a0')[0] ?? value) : value, limit: `of ${limit}` }
}

function ratio(value: number | null, limit: number): number | null {
  return value === null || limit <= 0 ? null : value / limit
}

function rows(plan: Plan, e: Evaluation): Row[] {
  const { headline, hourly, checks, cost } = e
  const gridW = plan.site.gridCapacityW
  const waterLimit = plan.site.waterAllowanceM3PerDay
  const itW = e.racks.reduce((sum, r) => sum + r.powerW, 0)
  const facilityPeakW = hourly.facilityW[headline.worstHour] ?? null
  const facilityShare = ratio(facilityPeakW, gridW)
  const waterShare = ratio(headline.waterM3PerDayPeak, waterLimit)
  return [
    { label: 'IT load', value: fmtPower(itW) },
    {
      label: 'Facility power, worst hour',
      ...against(fmtNull(facilityPeakW, fmtPower), fmtPower(gridW)),
      ...(facilityShare !== null && { meter: { ratio: facilityShare, status: worstOf(checks, 'power.gridWorstHour') } }),
    },
    { label: 'Hours over the grid cap', value: `${fmtNumber(headline.hoursOverCap, 0)} h` },
    { label: 'PUE, annual', value: fmtNull(headline.pueAnnual, (n) => fmtNumber(n, 2)) },
    { label: 'PUE, hottest hour', value: fmtNull(headline.pueWorst, (n) => fmtNumber(n, 2)) },
    {
      label: 'Water, peak day',
      ...against(fmtValue(headline.waterM3PerDayPeak, 'm³/day'), fmtValue(waterLimit, 'm³/day')),
      ...(waterShare !== null && { meter: { ratio: waterShare, status: worstOf(checks, 'cooling.waterPeakDay') } }),
    },
    { label: 'Capex', value: fmtMoney(cost.capexUsd) },
    { label: 'Build-out', value: fmtWeeks(cost.buildWeeks) },
  ]
}

function verdict(e: Evaluation): { status: Status; text: string } {
  const fails = e.checks.filter((c) => c.status === 'fail').length
  const warns = e.checks.filter((c) => c.status === 'warn').length
  if (!e.headline.buildable) {
    const reason = fails > 0 ? `: ${fails} failing ${fails === 1 ? 'check' : 'checks'}` : ''
    return { status: 'fail', text: `Not buildable as drawn${reason}` }
  }
  if (warns > 0) return { status: 'warn', text: `Buildable, with ${warns} ${warns === 1 ? 'warning' : 'warnings'}` }
  return { status: 'pass', text: 'Buildable as drawn' }
}

const CONNECTION_EMPTY = {
  connecting: 'Loading the plan…',
  online: 'Waiting for the first evaluation…',
  local: 'Waiting for the first evaluation…',
  offline: 'The plan server is not running. Start it with npm run dev.',
} as const

/** Plan totals: usable compute first, then the key numbers against their limits, then the ranked checks. */
export function Totals({ allOpen, onToggleAll }: { allOpen: boolean; onToggleAll: () => void }) {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const connection = useTwinStore((s) => s.connection)

  if (!plan || !evaluation) return <p className="empty-note">{CONNECTION_EMPTY[connection]}</p>

  const { headline } = evaluation
  const v = verdict(evaluation)
  return (
    <div className="totals">
      <h2 className="section-title">Usable compute under the {fmtPower(plan.site.gridCapacityW)} grid cap</h2>
      <p className="hero">
        <span className="hero__value">{fmtNumber(headline.usablePflops, 0)}</span>
        <span className="hero__unit">PFLOPS</span>
      </p>
      <p className="hero__context">
        of {fmtNumber(headline.placedPflops, 0)} placed, on {fmtNumber(headline.gpuCount, 0)} GPUs
      </p>
      <p className="verdict">
        <StatusMark status={v.status} label={v.text} />
      </p>

      <table className="totals-table">
        <tbody>
          {rows(plan, evaluation).map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                <span className="totals-table__value">{r.value}</span>
                {r.limit && <span className="totals-table__limit"> {r.limit}</span>}
                {r.meter && (
                  <span
                    className="meter-rule"
                    data-status={r.meter.status}
                    style={{ '--fill': `${Math.min(1, r.meter.ratio) * 100}%` } as CSSProperties}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="visually-hidden">Checks</h2>
      <Checks
        action={
          <button type="button" className="btn btn--quiet totals__all" aria-expanded={allOpen} onClick={onToggleAll}>
            All variables
          </button>
        }
      />
    </div>
  )
}
