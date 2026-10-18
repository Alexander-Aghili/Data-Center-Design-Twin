import type { Check, Status } from '@twin/schema'
import type { ReactNode } from 'react'
import { fmtNull, fmtPct } from '../format'
import { useTwinStore } from '../state/store'
import { StatusMark } from './StatusMark'

const STATUS_RANK: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 }

/** Worst first: fail, warn, unknown, pass; within a status, the highest utilization first (unknown utilization last). */
export function rankChecks(checks: readonly Check[]): Check[] {
  const use = (c: Check) => c.utilization ?? -1
  return [...checks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || use(b) - use(a))
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The ranked checks: every issue up to `limit`, then one line for the rest, which can carry an action
 * (the totals panel puts "All variables" there). Clicking a check selects it.
 */
export function Checks({ limit = 5, action }: { limit?: number; action?: ReactNode }) {
  const checks = useTwinStore((s) => s.evaluation?.checks)
  const selection = useTwinStore((s) => s.selection)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  if (!checks || checks.length === 0) return null

  const ranked = rankChecks(checks)
  const issues = ranked.filter((c) => c.status !== 'pass')
  const shown = issues.slice(0, limit)
  const moreIssues = issues.length - shown.length
  const passing = ranked.length - issues.length

  return (
    <ul className="check-list" aria-label="Checks, worst first">
      {shown.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="check-row"
            aria-current={selection?.kind === 'check' && selection.id === c.id ? 'true' : undefined}
            onClick={() => dispatchView({ type: 'select', target: { kind: 'check', id: c.id } })}
          >
            <StatusMark status={c.status} label={c.title} />
            <span className="check-row__value">{fmtNull(c.utilization, fmtPct)}</span>
          </button>
        </li>
      ))}
      <li className="check-list__note">
        {moreIssues > 0 ? (
          <span>
            {plural(moreIssues, 'more issue', 'more issues')}, {plural(passing, 'check passes', 'checks pass')}
          </span>
        ) : (
          <StatusMark
            status="pass"
            label={issues.length === 0 ? `All ${passing} checks pass` : plural(passing, 'other check passes', 'other checks pass')}
          />
        )}
        {action}
      </li>
    </ul>
  )
}
