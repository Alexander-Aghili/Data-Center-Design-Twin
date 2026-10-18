import type { Check } from '@twin/schema'
import { fmtNull, fmtPct } from '../../format'
import { useTwinStore } from '../../state/store'
import { StatusMark } from '../StatusMark'

/** Ranked issues; clicking one selects its check, which the scene and the inspector follow. */
export function IssueList({ id, issues, hidden }: { id: string; issues: readonly Check[]; hidden: boolean }) {
  const selection = useTwinStore((s) => s.selection)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  return (
    <ul id={id} className="issues" aria-label="Issues, worst first" hidden={hidden}>
      {issues.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="issue"
            aria-current={selection?.kind === 'check' && selection.id === c.id ? 'true' : undefined}
            onClick={() => dispatchView({ type: 'select', target: { kind: 'check', id: c.id } })}
          >
            <StatusMark status={c.status} label={c.title} />
            <span className="issue__use">{fmtNull(c.utilization, fmtPct)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
