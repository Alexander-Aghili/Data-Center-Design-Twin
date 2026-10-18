import type { AgentStatus } from '@twin/schema'
import toggle from '../panels/fields/Toggle.module.css'
import { useTwinStore } from '../state/store'

/** API spend in dollars and cents: agent turns cost cents, so the app's whole-dollar money format would show $0. */
const usd = (amount: number) => `$${amount.toFixed(2)}`

function spendText(s: AgentStatus): string {
  const today = `Spent ${usd(s.todayUsd)} of ${usd(s.dailyBudgetUsd)} today.`
  if (s.running) return `Working, ${usd(s.turnUsd)} so far. ${today}`
  return s.turnUsd > 0 ? `${today} Last turn ${usd(s.turnUsd)}.` : today
}

/**
 * What the agent has spent on the Claude API today and on its current turn, live. While a turn runs, a Stop button
 * takes the place of the automatic review switch, so a long turn is never silent and can be cut short.
 */
export function SpendLine() {
  const status = useTwinStore((s) => s.agentStatus)
  const stopTurn = useTwinStore((s) => s.stopTurn)
  if (!status) return null
  const near = status.budgetSpent || status.todayUsd >= status.dailyBudgetUsd * 0.8
  return (
    <div className={`ag-spend${status.running ? ' ag-spend--running' : ''}`}>
      <p role="status" aria-label="API spend" className={`ag-spend__text${near ? ' ag-spend__text--near' : ''}`}>
        {spendText(status)}
      </p>
      {status.running ? (
        <button type="button" className="btn btn--quiet ag-spend__stop" onClick={stopTurn}>
          Stop
        </button>
      ) : (
        <AutoReviewSwitch autoReview={status.autoReview} />
      )}
    </div>
  )
}

/** Whether the agent reviews the person's edits on its own; each review is a paid turn. */
function AutoReviewSwitch({ autoReview }: { autoReview: boolean }) {
  const setAutoReview = useTwinStore((s) => s.setAutoReview)
  return (
    <label className="ag-review">
      <span className={toggle.toggle}>
        <input type="checkbox" role="switch" checked={autoReview} onChange={(e) => setAutoReview(e.currentTarget.checked)} />
        <span className={toggle.track} aria-hidden="true" />
      </span>
      Automatic review
    </label>
  )
}
