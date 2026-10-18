import Anthropic from '@anthropic-ai/sdk'
import { diffEvaluations } from '@twin/engine'
import type { AgentEvent, EvalDiff, Evaluation, Proposal, Severity, ViewAction } from '@twin/schema'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentRuntime, PlanStore, StoreChange, ToolRunResult } from '../contracts'
import { AGENT_MODEL, createAnthropicClient, type AnthropicLike } from './client'
import { Conversation, type Effort } from './conversation'
import { errorText, runTurn, toolParams } from './loop'
import { ChangeCoalescer, formatAppEvent, isWorthObserving, severityOf, type MergedChanges } from './observe'
import type { AgentTool } from './tools/index'

/** Task 13's `ProposalBook`, as far as applying and dismissing go. */
export interface ProposalControl {
  apply(id: string): { proposal: Proposal; summary: string }
  dismiss(id: string): Proposal
}

/** Where the view actions of the agent's view tools come from (the `emitView` given to Task 13's tools). */
export interface ViewSource {
  subscribe(cb: (a: ViewAction) => void): () => void
}

export interface AgentRuntimeDeps {
  store: PlanStore
  tools: AgentTool[]
  client?: AnthropicLike
  model?: string
  /** `conversation.json` lives here; without it the conversation is kept in memory only. */
  dataDir?: string
  diff?: (prev: Evaluation, next: Evaluation) => EvalDiff
  proposals?: ProposalControl
  views?: ViewSource
}

const MISSING_KEY = 'The agent needs an API key in .env'
const FRESH_CONVERSATION_OFFER = 'This is a different plan now. Start a new conversation if the earlier discussion no longer applies.'

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const client = deps.client ?? createAnthropicClient()
  // Without a key every request would fail inside the SDK; say so plainly instead of calling the API.
  const missingKey = client instanceof Anthropic && client.apiKey === null && client.authToken === null
  const model = deps.model ?? AGENT_MODEL
  const diff = deps.diff ?? diffEvaluations
  const file = deps.dataDir ? join(deps.dataDir, 'conversation.json') : null
  const tools = toolParams(deps.tools)
  const listeners = new Set<(e: AgentEvent) => void>()
  let conversation = new Conversation(file)
  let planId = deps.store.state().plan.id
  let queue = Promise.resolve()

  /** Events of a conversation that has since been reset are kept out of the live thread. */
  const emitTo = (conv: Conversation) => (e: AgentEvent) => {
    conv.record(e)
    // Saved before listeners hear the end, so a finished message is always on disk.
    if (e.kind === 'messageEnd') save(conv)
    if (conv === conversation) for (const cb of listeners) cb(e)
  }
  const emit = (e: AgentEvent) => emitTo(conversation)(e)

  const save = (conv: Conversation) => {
    if (conv !== conversation) return
    try {
      conv.save()
    } catch (err) {
      emit({ kind: 'error', message: `Could not save the conversation: ${errorText(err)}` })
    }
  }

  /** Turns run one at a time, in arrival order; a turn appends its user message only when it starts. */
  const enqueueTurn = (turn: { text: string; effort: Effort; trigger: 'chat' | 'observation'; severity: Severity }) => {
    queue = queue.then(async () => {
      const conv = conversation
      conv.appendUserTurn(turn.text, turn.effort)
      await runTurn({
        client,
        model,
        tools: deps.tools,
        toolParams: tools,
        conversation: conv,
        messageId: randomUUID(),
        trigger: turn.trigger,
        severity: turn.severity,
        emit: emitTo(conv),
      })
      save(conv)
    })
  }

  const observe = ({ prev, next, summaries }: MergedChanges) => {
    const d = diff(prev, next)
    if (missingKey || !isWorthObserving(d)) return
    enqueueTurn({ text: formatAppEvent(d, summaries), effort: 'low', trigger: 'observation', severity: severityOf(d) })
  }
  const coalescer = new ChangeCoalescer(observe)

  const offerFreshConversation = () => {
    if (conversation.messages().length === 0) return
    const messageId = randomUUID()
    emit({ kind: 'messageStart', messageId, trigger: 'observation', severity: 'info' })
    emit({ kind: 'textDelta', messageId, text: FRESH_CONVERSATION_OFFER })
    emit({ kind: 'messageEnd', messageId })
  }

  const settleProposal = (id: string, action: (p: ProposalControl) => { proposal: Proposal; summary?: string }) => {
    if (!deps.proposals) return emit({ kind: 'error', message: 'Proposals are not available in this session.' })
    try {
      const { proposal, summary } = action(deps.proposals)
      emit({ kind: 'proposalStatus', proposalId: proposal.id, status: proposal.status })
      // A stale proposal was not applied; the summary says why.
      if (proposal.status === 'stale' && summary) emit({ kind: 'error', message: summary })
    } catch (err) {
      emit({ kind: 'error', message: errorText(err) })
    }
    save(conversation)
  }

  return {
    handleChat(text) {
      emit({ kind: 'userMessage', messageId: randomUUID(), text })
      if (missingKey) return emit({ kind: 'error', message: MISSING_KEY })
      enqueueTurn({ text, effort: 'high', trigger: 'chat', severity: 'info' })
    },

    handleChange(change: StoreChange) {
      const id = deps.store.state().plan.id
      const replaced = change.kind === 'replace' || id !== planId
      planId = id
      if (replaced) {
        coalescer.clear()
        offerFreshConversation()
        return
      }
      if (change.author === 'user') coalescer.add(change)
      else coalescer.cut()
    },

    resetConversation() {
      coalescer.clear()
      conversation = new Conversation(file)
      conversation.reset()
    },

    applyProposal: (id) => settleProposal(id, (p) => p.apply(id)),
    dismissProposal: (id) => settleProposal(id, (p) => ({ proposal: p.dismiss(id) })),

    onEvent(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    onView: (cb) => deps.views?.subscribe(cb) ?? (() => undefined),

    threadEvents: () => conversation.thread(),

    async runTool(name, input): Promise<ToolRunResult> {
      const tool = deps.tools.find((t) => t.name === name)
      if (!tool) return { ok: false, error: `Unknown tool "${name}".` }
      try {
        const outcome = await tool.run(input)
        return outcome.ok ? { ok: true, result: outcome.content } : { ok: false, error: outcome.error }
      } catch (err) {
        return { ok: false, error: errorText(err) }
      }
    },

    listTools: () => deps.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }
}
