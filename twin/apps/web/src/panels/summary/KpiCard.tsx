import { StatusMark } from '../StatusMark'
import type { Kpi } from './kpis'

/** 0.794 is "79.4%"; the bar stops at the limit, the number in the card says by how much it is passed. */
const fillWidth = (ratio: number) => `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%`

/**
 * One number with its limit. A warning or failing check puts its status mark on the label and colors the
 * gauge, so the color never stands alone. The gauge repeats the text, so screen readers skip it.
 */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  const flagged = kpi.status === 'fail' || kpi.status === 'warn'
  return (
    <div className="kpi" data-status={flagged ? kpi.status : undefined}>
      <dt className="kpi__label">{flagged ? <StatusMark status={kpi.status} label={kpi.label} /> : kpi.label}</dt>
      <dd className="kpi__figure">
        <span className="kpi__value">{kpi.value}</span>
        {kpi.unit && (
          <>
            {' '}
            <span className="kpi__unit">{kpi.unit}</span>
          </>
        )}
      </dd>
      <dd className="kpi__context">{kpi.context}</dd>
      {kpi.gauge !== undefined && (
        <dd className="kpi__gauge" data-status={kpi.status} aria-hidden="true">
          <span className="kpi__gauge-fill" style={{ width: fillWidth(kpi.gauge) }} />
        </dd>
      )}
    </div>
  )
}
