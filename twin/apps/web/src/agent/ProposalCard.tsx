import { loadBuiltins } from '@twin/catalog'
import { registry, withCatalogNames } from '@twin/commands'
import { makeCatalogIndex } from '@twin/engine'
import type { Check, Command, EvalDiff, Plan, Proposal, Severity } from '@twin/schema'
import { useEffect, useId, useMemo } from 'react'
import { fmtMoney, fmtNull, fmtNumber, fmtPct, fmtValue, fmtWeeks } from '../format'
import { StatusMark } from '../panels/StatusMark'
import { useTwinStore } from '../state/store'
import { DeltaTag } from './DeltaTag'

/** "setCoolingMethod" → "Set cooling method", for commands the registry can't summarize. */
function humanize(type: string): string {
  const words = type.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The registry's change record for a command, read against the current plan with the built-in catalog behind it. */
function summarize(cmd: Command, plan: Plan | null): string {
  const def = registry.get(cmd.type)
  if (!def) return humanize(cmd.type)
  const parsed = def.payload.safeParse(cmd.payload)
  if (!plan || !parsed.success) return def.title
  try {
    return def.summarize(parsed.data, withCatalogNames(plan, makeCatalogIndex(loadBuiltins().entries)))
  } catch {
    return def.title
  }
}

/** A delta with its sign: +$4.8M, −2 weeks. */
const signed = (delta: number, format: (n: number) => string) => `${delta < 0 ? '−' : '+'}${format(Math.abs(delta))}`

const pue = (v: number | boolean | null) => fmtNull(typeof v === 'number' ? v : null, (n) => fmtNumber(n, 2))

const STATUS_RANK: Record<Check['status'], number> = { fail: 3, warn: 2, unknown: 1, pass: 0 }

/** Checks this change makes worse, or adds in a failing state. */
const hurtChecks = (diff: EvalDiff) => [...diff.worsened, ...diff.newChecks].filter((c) => c.status !== 'pass')

/** The check this change hurts most: worst status first, then highest utilization. */
function worstCheck(diff: EvalDiff): Check | undefined {
  return hurtChecks(diff).reduce<Check | undefined>((worst, c) => {
    if (!worst) return c
    const byStatus = STATUS_RANK[c.status] - STATUS_RANK[worst.status]
    if (byStatus !== 0) return byStatus > 0 ? c : worst
    return (c.utilization ?? 0) > (worst.utilization ?? 0) ? c : worst
  }, undefined)
}

/** A proposal that makes a check fail is a problem, one that adds a warning is a warning, the rest are information. */
function proposalSeverity(diff: EvalDiff): Severity {
  const statuses = new Set(hurtChecks(diff).map((c) => c.status))
  return statuses.has('fail') ? 'problem' : statuses.has('warn') ? 'warning' : 'info'
}

function checkEffect(c: Check): string {
  if (c.utilization !== null && c.status !== 'unknown') return `${c.title} rises to ${fmtPct(c.utilization)}.`
  return c.status === 'unknown' ? `${c.title} can't be checked.` : `${c.title} fails.`
}

function Effect({ diff }: { diff: EvalDiff }) {
  const sentences: string[] = []
  sentences.push(diff.capexDeltaUsd === 0 ? 'Capex unchanged.' : `Capex ${signed(diff.capexDeltaUsd, fmtMoney)}.`)
  const weeks = Math.round(diff.buildWeeksDelta)
  sentences.push(weeks === 0 ? 'Build time unchanged.' : `Build ${signed(weeks, fmtWeeks)}.`)
  const p = diff.headline.pueAnnual
  if (p) sentences.push(`PUE ${pue(p.from)} to ${pue(p.to)}.`)
  const water = Math.round(diff.waterDeltaM3PerDay)
  if (water !== 0) sentences.push(`Peak water ${signed(water, (n) => fmtValue(n, 'm³/day'))}.`)
  const worst = worstCheck(diff)
  const [cleared, ...moreCleared] = diff.resolved
  return (
    <p className="ag-card__effect">
      {sentences.join(' ')}
      {worst ? (
        <span className="ag-card__check">
          {' '}
          <StatusMark status={worst.status} label={checkEffect(worst)} />
        </span>
      ) : null}
      {cleared ? (
        <span className="ag-card__check">
          {' '}
          <StatusMark status="pass" label={`Clears ${cleared.title}${moreCleared.length ? ` and ${moreCleared.length} more` : ''}.`} />
        </span>
      ) : null}
    </p>
  )
}

/** A proposed change: what it does, what it costs, and the Preview, Apply and Dismiss actions. */
export function ProposalCard({ proposal: initial }: { proposal: Proposal }) {
  const proposal = useTwinStore((s) => s.proposals[initial.id]) ?? initial
  const hasPlan = useTwinStore((s) => s.plan !== null)
  const notes = useTwinStore((s) => s.plan?.notes)
  const previewing = useTwinStore((s) => s.previewProposalId === initial.id)
  const applyProposal = useTwinStore((s) => s.applyProposal)
  const dismissProposal = useTwinStore((s) => s.dismissProposal)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const titleId = useId()
  const { id, status, commands } = proposal

  // Summaries describe the change against the plan as it was when the card first had one (hence `hasPlan`).
  const summaries = useMemo(() => commands.map((cmd) => summarize(cmd, useTwinStore.getState().plan)), [commands, hasPlan])
  const noteText = (ref: string) => notes?.find((n) => n.id === ref)?.text ?? ref

  // A preview only makes sense while the proposal can still be applied.
  useEffect(() => {
    if (previewing && status !== 'open') dispatchView({ type: 'previewProposal', proposalId: null })
  }, [previewing, status, dispatchView])
  useEffect(
    () => () => {
      const s = useTwinStore.getState()
      if (s.previewProposalId === id) s.dispatchView({ type: 'previewProposal', proposalId: null })
    },
    [id],
  )

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={`ag-card ag-card--${status}${previewing ? ' ag-card--previewing' : ''}`}
    >
      <div className="ag-card__head">
        <h3 id={titleId} className="ag-card__title">
          {proposal.title}
        </h3>
        {proposal.annotationTag === undefined ? null : <DeltaTag tag={proposal.annotationTag} severity={proposalSeverity(proposal.diff)} />}
      </div>
      <p className="ag-card__why">{proposal.rationale}</p>
      <ul className="ag-card__changes">
        {summaries.map((summary, i) => (
          <li key={`c${i}`} data-mark="+">
            {summary}
          </li>
        ))}
        {proposal.respectsNotes.map((ref) => (
          <li key={`r${ref}`} data-mark="=">
            {`Respects note: ${noteText(ref)}`}
          </li>
        ))}
        {proposal.violatesNotes.map((ref) => (
          <li key={`v${ref}`} data-mark="▲" className="ag-card__breaks">
            {`Breaks note: ${noteText(ref)}`}
          </li>
        ))}
      </ul>
      <Effect diff={proposal.diff} />
      {status === 'stale' ? (
        <p className="ag-card__status ag-card__status--stale">
          <span aria-hidden="true">▲</span> <span>Plan changed since this was proposed</span>
        </p>
      ) : null}
      {status === 'open' || status === 'stale' ? (
        <div className="ag-card__actions">
          <button
            type="button"
            className="btn"
            aria-pressed={previewing}
            disabled={status === 'stale'}
            onClick={() => dispatchView({ type: 'previewProposal', proposalId: previewing ? null : id })}
          >
            Preview
          </button>
          <button type="button" className="btn btn--primary" disabled={status === 'stale'} onClick={() => applyProposal(id)}>
            Apply
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => dismissProposal(id)}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className={`ag-card__status ag-card__status--${status}`}>
          {status === 'applied' ? <span aria-hidden="true">✓ </span> : null}
          <span>{status === 'applied' ? 'Applied' : 'Dismissed'}</span>
        </p>
      )}
    </div>
  )
}
