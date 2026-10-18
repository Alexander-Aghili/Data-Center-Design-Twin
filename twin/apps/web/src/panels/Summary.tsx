import { useId, useState } from 'react'
import { useTwinStore } from '../state/store'
import { StatusMark } from './StatusMark'
import { IssueList } from './summary/IssueList'
import { KpiCard } from './summary/KpiCard'
import { issueChecks, summaryKpis, verdict } from './summary/kpis'
import './summary/summary.css'

const CONNECTION_EMPTY = {
  connecting: 'Loading the plan…',
  online: 'Waiting for the first evaluation…',
  local: 'Waiting for the first evaluation…',
  offline: 'The plan server is not running. Start it with npm run dev.',
} as const

/**
 * Right-panel summary: whether the plan is buildable, four KPI cards, the issues behind a disclosure
 * (collapsed until asked for) and the link to every variable. The drawer's open state belongs to the shell.
 */
export function SummaryPanel({ allOpen, onToggleAll }: { allOpen: boolean; onToggleAll: () => void }) {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const connection = useTwinStore((s) => s.connection)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const listId = useId()

  if (!plan || !evaluation) return <p className="empty-note">{CONNECTION_EMPTY[connection]}</p>

  const v = verdict(evaluation)
  const issues = issueChecks(evaluation.checks)
  return (
    <div className="summary">
      <h2 className="visually-hidden">Summary</h2>
      <p className="summary__verdict" role="status">
        <StatusMark status={v.status} label={v.text} />
      </p>
      <dl className="kpis">
        {summaryKpis(plan, evaluation).map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </dl>
      <div className="summary__bar">
        {issues.length > 0 && (
          <button
            type="button"
            className="summary__disclosure"
            aria-expanded={issuesOpen}
            aria-controls={listId}
            onClick={() => setIssuesOpen((open) => !open)}
          >
            <svg className="summary__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Issues ({issues.length})
          </button>
        )}
        <button type="button" className="summary__all" aria-expanded={allOpen} onClick={onToggleAll}>
          All variables
        </button>
      </div>
      {issues.length > 0 && <IssueList id={listId} issues={issues} hidden={!issuesOpen} />}
    </div>
  )
}
