import { randomUUID } from 'node:crypto'
import { applyCommand, formatIssues, listCommands, registry, type Registry } from '@twin/commands'
import { diffEvaluations, evaluate, makeCatalogIndex } from '@twin/engine'
import type { Builtins, Command, EvalDiff, Evaluation, Plan, Proposal, ProposalStatus, ViewAction } from '@twin/schema'
import type { PlanStore } from '../../contracts.js'
import { compactDiff, defineTool, describeDiff, failure, success, type AgentTool } from './schema.js'
import type { TagCounter } from './view.js'

/** What the tools need to try commands without touching the store. Injectable for tests. */
export interface PlanEngine {
  registry: Pick<Registry, 'registry' | 'applyCommand' | 'listCommands'>
  evaluate(plan: Plan, builtins: Builtins): Evaluation
  diff(prev: Evaluation, next: Evaluation): EvalDiff
}

export const defaultEngine: PlanEngine = {
  registry: { registry, applyCommand, listCommands },
  evaluate,
  diff: diffEvaluations,
}

type Simulated = { ok: true; plan: Plan; summaries: string[] } | { ok: false; error: string }

/**
 * Applies commands to a copy of the plan, one at a time, so an error names the failing command:
 * `commands.<i>.type`, `commands.<i>.payload.<path>`, or `commands.<i> (<type>): <reason>`.
 */
function simulate(engine: PlanEngine, plan: Plan, builtins: Builtins, commands: Command[]): Simulated {
  let current = plan
  const summaries: string[] = []
  for (const [i, cmd] of commands.entries()) {
    const def = engine.registry.registry.get(cmd.type)
    if (!def) return { ok: false, error: `commands.${i}.type: Unknown command "${cmd.type}"` }
    const parsed = def.payload.safeParse(cmd.payload)
    if (!parsed.success) return { ok: false, error: formatIssues(parsed.error, `commands.${i}.payload`) }
    try {
      // Rebuilt per command: an earlier command may add or change a custom catalog entry.
      const catalog = makeCatalogIndex([...builtins.entries, ...Object.values(current.catalog)])
      const result = engine.registry.applyCommand(current, cmd, catalog)
      current = result.plan
      summaries.push(result.summary)
    } catch (error) {
      return { ok: false, error: `commands.${i} (${cmd.type}): ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { ok: true, plan: current, summaries }
}

export type Preview = { ok: true; plan: Plan; evaluation: Evaluation; diff: EvalDiff; summaries: string[] } | { ok: false; error: string }

export interface ProposalDraft {
  title: string
  rationale: string
  commands: Command[]
  respectsNotes: string[]
  violatesNotes: string[]
  annotationTag?: number
}

export interface ProposalApplyResult {
  proposal: Proposal
  /** Change record, or why it was not applied. Mentions it when the plan changed after proposing. */
  summary: string
}

/** Open proposals and their fate. Applying re-validates against the current plan (stale detection). */
export class ProposalBook {
  private readonly store: PlanStore
  private readonly engine: PlanEngine
  private readonly proposals = new Map<string, Proposal>()

  constructor(store: PlanStore, engine: PlanEngine = defaultEngine) {
    this.store = store
    this.engine = engine
  }

  /** Evaluates commands against the current plan without applying them. */
  preview(commands: Command[]): Preview {
    const { plan, evaluation } = this.store.state()
    const builtins = this.store.builtins()
    const simulated = simulate(this.engine, plan, builtins, commands)
    if (!simulated.ok) return simulated
    const next = this.engine.evaluate(simulated.plan, builtins)
    return { ok: true, plan: simulated.plan, evaluation: next, diff: this.engine.diff(evaluation, next), summaries: simulated.summaries }
  }

  /** Throws when a command is invalid for the current plan. Pass a successful `preview` to skip evaluating twice. */
  create(draft: ProposalDraft, preview: Preview = this.preview(draft.commands)): Proposal {
    if (!preview.ok) throw new Error(preview.error)
    const proposal: Proposal = {
      id: `p-${randomUUID().slice(0, 8)}`,
      title: draft.title,
      rationale: draft.rationale,
      commands: draft.commands,
      respectsNotes: draft.respectsNotes,
      violatesNotes: draft.violatesNotes,
      diff: preview.diff,
      status: 'open',
      ...(draft.annotationTag !== undefined ? { annotationTag: draft.annotationTag } : {}),
      basePlanUpdatedAt: this.store.state().plan.updatedAt,
    }
    this.proposals.set(proposal.id, proposal)
    return proposal
  }

  /**
   * Re-validates the commands against the current plan. If any fails, the proposal becomes `stale` and the
   * plan is untouched; otherwise all commands apply as one undoable step.
   */
  apply(id: string): ProposalApplyResult {
    const proposal = this.open(id)
    const { plan } = this.store.state()
    const changed =
      plan.updatedAt !== proposal.basePlanUpdatedAt
        ? ` The plan changed after this proposal (proposed against ${proposal.basePlanUpdatedAt}, current ${plan.updatedAt}).`
        : ''
    const checked = simulate(this.engine, plan, this.store.builtins(), proposal.commands)
    if (!checked.ok) return { proposal: this.setStatus(proposal, 'stale'), summary: `Not applied: ${checked.error}.${changed}` }
    const result = this.store.dispatchAll(proposal.commands, 'agent')
    if (!result.ok) return { proposal: this.setStatus(proposal, 'stale'), summary: `Not applied: ${result.error}.${changed}` }
    const summary = result.summaries.join('; ')
    return {
      proposal: this.setStatus(proposal, 'applied'),
      summary: changed ? `${summary}.${changed} Every command still validated.` : summary,
    }
  }

  dismiss(id: string): Proposal {
    return this.setStatus(this.open(id), 'dismissed')
  }

  get(id: string): Proposal | undefined {
    return this.proposals.get(id)
  }

  list(): Proposal[] {
    return [...this.proposals.values()]
  }

  private open(id: string): Proposal {
    const proposal = this.proposals.get(id)
    if (!proposal) throw new Error(`Unknown proposal "${id}"`)
    if (proposal.status !== 'open') throw new Error(`Proposal "${id}" is ${proposal.status}, not open`)
    return proposal
  }

  private setStatus(proposal: Proposal, status: ProposalStatus): Proposal {
    const next = { ...proposal, status }
    this.proposals.set(next.id, next)
    return next
  }
}

export function proposeTools(deps: { proposals: ProposalBook; tags: TagCounter; emitView: (a: ViewAction) => void }): AgentTool[] {
  const { proposals, tags, emitView } = deps
  return [
    defineTool(
      'propose_change',
      'Suggests a change as a proposal card the person can preview, apply or dismiss; nothing changes until they apply it. Use it for every change you start on your own, such as a fix for a failing check, and list the notes it respects or violates. Settle the fix with what_if first and make one proposal per problem. The result has the proposal id and the evaluation diff it would cause. Pass annotate to mark the affected objects in 3D.',
      (input) => {
        const preview = proposals.preview(input.commands)
        if (!preview.ok) return failure(preview.error)
        const annotationTag = input.annotate ? tags.next() : undefined
        const proposal = proposals.create(
          {
            title: input.title,
            rationale: input.rationale,
            commands: input.commands,
            respectsNotes: input.respectsNotes,
            violatesNotes: input.violatesNotes,
            ...(annotationTag !== undefined ? { annotationTag } : {}),
          },
          preview,
        )
        if (input.annotate && annotationTag !== undefined) {
          emitView({ type: 'annotate', annotation: { tag: annotationTag, objectIds: input.annotate.objectIds, label: input.annotate.label, severity: 'info' } })
        }
        return success(
          { proposalId: proposal.id, status: proposal.status, annotationTag: proposal.annotationTag, changes: preview.summaries, diff: compactDiff(preview.diff) },
          `Proposed: ${proposal.title}`,
          [{ kind: 'proposal', proposal }],
        )
      },
    ),
    defineTool(
      'what_if',
      'Evaluates commands against the current plan without applying them. Use it to compare options or check a fix before proposing it. Returns the change records and the full evaluation diff: headline deltas, checks that got worse or better with their causes, and cost, build time and water deltas.',
      (input) => {
        const preview = proposals.preview(input.commands)
        if (!preview.ok) return failure(preview.error)
        return success({ summaries: preview.summaries, diff: preview.diff }, `What if: ${describeDiff(preview.diff)}`)
      },
    ),
  ]
}
