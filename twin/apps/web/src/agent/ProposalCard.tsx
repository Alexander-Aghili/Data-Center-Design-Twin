import { registry } from '@twin/commands'
import type { Check, Command, EvalDiff, Plan, Proposal } from '@twin/schema'
import { useId } from 'react'
import { useTwinStore } from '../state/store'
import { DeltaTag } from './DeltaTag'

const NBSP = ' '
const MINUS = '−'

/** "setCoolingMethod" → "Set cooling method", for commands the registry can't summarize. */
function humanize(type: string): string {
  const words = type.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The registry's change record for a command, read against the plan the proposal was made on. */
function summarize(cmd: Command, plan: Plan | null): string {
  const def = registry.get(cmd.type)
  if (!def) return humanize(cmd.type)
  const parsed = def.payload.safeParse(cmd.payload)
  if (!plan || !parsed.success) return def.title
  try {
    return def.summarize(parsed.data, plan)
  } catch {
    return def.title
  }
}

const signed = (v: number, text: string) => `${v < 0 ? MINUS : '+'}${text}`

function money(usd: number): string {
  const abs = Math.abs(usd)
  if (abs >= 1e6) return signed(usd, `$${(abs / 1e6).toFixed(1)}M`)
  if (abs >= 1e3) return signed(usd, `$${Math.round(abs / 1e3)}k`)
  return signed(usd, `$${Math.round(abs)}`)
}

function weeks(delta: number): string {
  const abs = Math.abs(delta)
  const shown = abs < 1 ? abs.toFixed(1) : String(Math.round(abs))
  return signed(delta, `${shown}${NBSP}${shown === '1' ? 'week' : 'weeks'}`)
}

const pue = (v: number | boolean | null) => (typeof v === 'number' ? v.toFixed(2) : '—')

const STATUS_RANK: Record<Check['status'], number> = { fail: 3, warn: 2, unknown: 1, pass: 0 }
const STATUS_MARK: Record<Check['status'], string> = { fail: '✕', warn: '▲', unknown: '?', pass: '✓' }

/** The check this change hurts most: worst status first, then highest utilization. */
function worstCheck(diff: EvalDiff): Check | undefined {
  return [...diff.worsened, ...diff.newChecks]
    .filter((c) => c.status !== 'pass')
    .reduce<Check | undefined>((worst, c) => {
      if (!worst) return c
      const byStatus = STATUS_RANK[c.status] - STATUS_RANK[worst.status]
      if (byStatus !== 0) return byStatus > 0 ? c : worst
      return (c.utilization ?? 0) > (worst.utilization ?? 0) ? c : worst
    }, undefined)
}

function checkEffect(c: Check): string {
  if (c.utilization !== null && c.status !== 'unknown') return `${c.title} rises to ${Math.round(c.utilization * 100)}%.`
  return c.status === 'unknown' ? `${c.title} can't be checked.` : `${c.title} fails.`
}

function Effect({ diff }: { diff: EvalDiff }) {
  const sentences: string[] = []
  sentences.push(diff.capexDeltaUsd === 0 ? 'Capex unchanged.' : `Capex ${money(diff.capexDeltaUsd)}.`)
  sentences.push(diff.buildWeeksDelta === 0 ? 'Build time unchanged.' : `Build ${weeks(diff.buildWeeksDelta)}.`)
  const p = diff.headline.pueAnnual
  if (p) sentences.push(`PUE ${pue(p.from)} to ${pue(p.to)}.`)
  const water = Math.round(diff.waterDeltaM3PerDay)
  if (water !== 0) sentences.push(`Peak water ${signed(water, `${Math.abs(water)}${NBSP}m³/day`)}.`)
  const worst = worstCheck(diff)
  const [cleared, ...moreCleared] = diff.resolved
  return (
    <p className="ag-card__effect">
      {sentences.join(' ')}
      {worst ? (
        <span className={`ag-card__check ag-card__check--${worst.status}`}>
          {' '}
          <span aria-hidden="true">{STATUS_MARK[worst.status]}</span>
          {checkEffect(worst)}
        </span>
      ) : null}
      {cleared ? (
        <span className="ag-card__check ag-card__check--pass">
          {' '}
          <span aria-hidden="true">✓</span>
          {`Clears ${cleared.title}${moreCleared.length ? ` and ${moreCleared.length} more` : ''}.`}
        </span>
      ) : null}
    </p>
  )
}

const noteText = (plan: Plan | null, ref: string) => plan?.notes.find((n) => n.id === ref)?.text ?? ref

/** A proposed change: what it does, what it costs, and the Preview, Apply and Dismiss actions. */
export function ProposalCard({ proposal: initial }: { proposal: Proposal }) {
  const proposal = useTwinStore((s) => s.proposals[initial.id]) ?? initial
  const plan = useTwinStore((s) => s.plan)
  const previewing = useTwinStore((s) => s.previewProposalId === initial.id)
  const applyProposal = useTwinStore((s) => s.applyProposal)
  const dismissProposal = useTwinStore((s) => s.dismissProposal)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const titleId = useId()
  const { id, status } = proposal

  const endPreview = () => {
    if (previewing) dispatchView({ type: 'previewProposal', proposalId: null })
  }

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
        {proposal.annotationTag === undefined ? null : <DeltaTag tag={proposal.annotationTag} severity="problem" />}
      </div>
      <p className="ag-card__why">{proposal.rationale}</p>
      <ul className="ag-card__changes">
        {proposal.commands.map((cmd, i) => (
          <li key={`c${i}`} data-mark="+">
            {summarize(cmd, plan)}
          </li>
        ))}
        {proposal.respectsNotes.map((ref) => (
          <li key={`r${ref}`} data-mark="=">
            {`Respects note: ${noteText(plan, ref)}`}
          </li>
        ))}
        {proposal.violatesNotes.map((ref) => (
          <li key={`v${ref}`} data-mark="▲" className="ag-card__breaks">
            {`Breaks note: ${noteText(plan, ref)}`}
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
            className="ag-btn"
            aria-pressed={previewing}
            onClick={() => dispatchView({ type: 'previewProposal', proposalId: previewing ? null : id })}
          >
            Preview
          </button>
          <button
            type="button"
            className="ag-btn ag-btn--primary"
            disabled={status === 'stale'}
            onClick={() => {
              endPreview()
              applyProposal(id)
            }}
          >
            Apply
          </button>
          <button
            type="button"
            className="ag-btn ag-btn--quiet"
            onClick={() => {
              endPreview()
              dismissProposal(id)
            }}
          >
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
