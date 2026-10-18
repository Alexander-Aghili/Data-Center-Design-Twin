import Anthropic from '@anthropic-ai/sdk'
import { diffEvaluations } from '@twin/engine'
import type { AgentEvent, AgentStatus, EvalDiff, Evaluation, Proposal, Severity, ViewAction } from '@twin/schema'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentRuntime, PlanStore, StoreChange, ToolRunResult } from '../contracts'
import { AGENT_MODEL, createAnthropicClient, type AnthropicLike } from './client'
import { Conversation, type Effort } from './conversation'
import { DEFAULT_LIMITS, type AgentLimits } from './limits'
import { callSummary, errorText, runTurn, toolParams } from './loop'
import { dailyBudgetMessage, TurnMeter, type SpendLog } from './meter'
import { ChangeCoalescer, formatAppEvent, isWorthObserving, severityOf, type MergedChanges } from './observe'
import { toolResultNumbers, type AgentTool, type ToolOutcome } from './tools/index'
import { UsageLedger } from './usage'

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
  /** Spending caps; the defaults unless the server read overrides from the environment. */
  limits?: AgentLimits
  /** Each API request's tokens and cost go here at info level. */
  log?: SpendLog
  /** Milliseconds since the epoch; the day of the budget and the review rate limit follow it. */
  now?: () => number
}

interface Turn {
  text: string
  effort: Effort
  trigger: 'chat' | 'observation'
  severity: Severity
}

const MISSING_KEY = 'The agent needs an API key in .env'
const HOUR_MS = 3_600_000

const SettingsSchema = z.object({ autoReview: z.boolean() })
type Settings = z.infer<typeof SettingsSchema>

function loadSettings(file: string | null): Settings {
  if (!file || !existsSync(file)) return { autoReview: true }
  try {
    const parsed = SettingsSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : { autoReview: true }
  } catch {
    return { autoReview: true }
  }
}
const FRESH_CONVERSATION_OFFER = 'This is a different plan now. Start a new conversation if the earlier discussion no longer applies.'

/** Ids of proposals in a thread that no later status event settled. */
function openProposalIds(thread: AgentEvent[]): string[] {
  const open = new Set<string>()
  for (const e of thread) {
    if (e.kind === 'proposal') open.add(e.proposal.id)
    else if (e.kind === 'proposalStatus' && e.status !== 'open') open.delete(e.proposalId)
  }
  return [...open]
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const client = deps.client ?? createAnthropicClient()
  // Without a key every request would fail inside the SDK; say so plainly instead of calling the API.
  const missingKey = client instanceof Anthropic && client.apiKey === null && client.authToken === null
  const model = deps.model ?? AGENT_MODEL
  const diff = deps.diff ?? diffEvaluations
  const file = deps.dataDir ? join(deps.dataDir, 'conversation.json') : null
  const settingsFile = deps.dataDir ? join(deps.dataDir, 'agent-settings.json') : null
  const limits = deps.limits ?? DEFAULT_LIMITS
  const now = deps.now ?? Date.now
  const ledger = new UsageLedger(deps.dataDir ? join(deps.dataDir, 'usage.json') : null, () => new Date(now()))
  const tools = toolParams(deps.tools)
  const listeners = new Set<(e: AgentEvent) => void>()
  const statusListeners = new Set<(s: AgentStatus) => void>()
  let settings = loadSettings(settingsFile)
  /** The turn now running: its meter for the live cost, its controller for Stop. */
  let running: { meter: TurnMeter; abort: AbortController } | null = null
  let lastTurnUsd = 0
  /** When each automatic review of the last hour started. */
  let reviewTimes: number[] = []
  let conversation = new Conversation(file)
  let planId = deps.store.state().plan.id
  let queue = Promise.resolve()
  /** The message of the turn now running; its tools' revision clouds are tied to it in the thread. */
  let turnMessageId: string | null = null

  /** Events of a conversation that has since been reset are kept out of the live thread. */
  const emitTo = (conv: Conversation) => (e: AgentEvent) => {
    conv.record(e)
    // Saved before listeners hear the end, so a finished message is always on disk.
    if (e.kind === 'messageEnd') save(conv)
    if (conv === conversation) for (const cb of listeners) cb(e)
  }
  const emit = (e: AgentEvent) => emitTo(conversation)(e)

  const status = (): AgentStatus => {
    const todayUsd = ledger.todayUsd()
    return {
      running: running !== null,
      turnUsd: running ? running.meter.usd : lastTurnUsd,
      todayUsd,
      dailyBudgetUsd: limits.dailyBudgetUsd,
      budgetSpent: todayUsd >= limits.dailyBudgetUsd,
      autoReview: settings.autoReview,
    }
  }
  const emitStatus = () => {
    const s = status()
    for (const cb of [...statusListeners]) cb(s)
  }
  const budgetSpent = () => ledger.todayUsd() >= limits.dailyBudgetUsd
  const budgetNotice = () => emit({ kind: 'notice', message: dailyBudgetMessage(ledger.todayUsd(), limits.dailyBudgetUsd) })

  const save = (conv: Conversation) => {
    if (conv !== conversation) return
    try {
      conv.save()
    } catch (err) {
      emit({ kind: 'error', message: `Could not save the conversation: ${errorText(err)}` })
    }
  }

  /**
   * Turns run one at a time, in arrival order; a turn appends its user message only when it starts. A turn given
   * as a function is built when it starts, and skipped when that gives null.
   */
  const enqueueTurn = (next: Turn | (() => Turn | null)) => {
    queue = queue.then(async () => {
      const turn = typeof next === 'function' ? next() : next
      if (!turn) return
      // A chat queued behind a turn that used up the budget is not sent.
      if (budgetSpent()) return budgetNotice()
      const conv = conversation
      conv.appendUserTurn(turn.text, turn.effort)
      const messageId = randomUUID()
      turnMessageId = messageId
      const abort = new AbortController()
      const meter = new TurnMeter({ model, limits, ledger, ...(deps.log ? { log: deps.log } : {}), onChange: emitStatus })
      running = { meter, abort }
      emitStatus()
      try {
        await runTurn({
          client,
          model,
          tools: deps.tools,
          toolParams: tools,
          conversation: conv,
          messageId,
          trigger: turn.trigger,
          severity: turn.severity,
          emit: emitTo(conv),
          signal: abort.signal,
          meter,
        })
      } finally {
        turnMessageId = null
        running = null
        lastTurnUsd = meter.usd
        emitStatus()
      }
      save(conv)
    })
  }

  /**
   * Edits waiting for their observation turn. Bursts that close while another turn runs merge into it (the
   * evaluation before the first, after the last, every summary), so the person gets one remark after the turn;
   * the diff is taken when that turn starts and dropped if it no longer says anything.
   */
  let pendingObservation: MergedChanges | null = null

  /**
   * Whether an automatic review may run now: it is on, the hourly count has room, and at least the reserve share
   * of today's budget is left for chat.
   */
  const reviewAllowed = (t: number): boolean => {
    reviewTimes = reviewTimes.filter((at) => t - at < HOUR_MS)
    if (!settings.autoReview || reviewTimes.length >= limits.observationsPerHour) return false
    return ledger.todayUsd() <= limits.dailyBudgetUsd * (1 - limits.observationReserve)
  }

  const reviewTurn = (): Turn | null => {
    const changes = pendingObservation
    pendingObservation = null
    if (!changes) return null
    const t = now()
    if (!reviewAllowed(t)) return null
    const d = diff(changes.prev, changes.next)
    if (!isWorthObserving(d)) return null
    reviewTimes.push(t)
    return { text: formatAppEvent(d, changes.summaries), effort: 'low', trigger: 'observation', severity: severityOf(d) }
  }

  /** A review closer than the minimum gap to the last one waits for the gap to pass; edits meanwhile merge into it. */
  const observe = (merged: MergedChanges) => {
    if (missingKey || !settings.autoReview) return
    if (pendingObservation) {
      pendingObservation = { prev: pendingObservation.prev, next: merged.next, summaries: [...pendingObservation.summaries, ...merged.summaries] }
      return
    }
    pendingObservation = merged
    const wait = (reviewTimes.at(-1) ?? -Infinity) + limits.observationGapMs - now()
    if (wait <= 0) enqueueTurn(reviewTurn)
    else setTimeout(() => enqueueTurn(reviewTurn), wait).unref?.()
  }
  const coalescer = new ChangeCoalescer(observe)

  const offerFreshConversation = () => {
    if (conversation.messages().length === 0) return
    const messageId = randomUUID()
    emit({ kind: 'messageStart', messageId, trigger: 'observation', severity: 'info' })
    emit({ kind: 'textDelta', messageId, text: FRESH_CONVERSATION_OFFER })
    emit({ kind: 'messageEnd', messageId })
  }

  /**
   * A tool run from outside a turn (the MCP server) that made a proposal or a file gets its own short message in
   * the thread, as an agent run would, so the card can be applied and the link downloaded.
   */
  const showExternalRun = (name: string, outcome: Extract<ToolOutcome, { ok: true }>) => {
    const messageId = randomUUID()
    const callId = randomUUID()
    emit({ kind: 'messageStart', messageId, trigger: 'observation', severity: 'info' })
    emit({ kind: 'toolCall', messageId, callId, name, summary: callSummary(name) })
    emit({ kind: 'toolResult', callId, ok: true, summary: outcome.summary, numbers: toolResultNumbers(outcome.content) })
    for (const e of outcome.events ?? []) emit({ ...e, messageId })
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

  // Proposals live in memory; cards replayed from conversation.json that were still open can no longer be applied.
  const replayedOpen = openProposalIds(conversation.thread())
  for (const proposalId of replayedOpen) emit({ kind: 'proposalStatus', proposalId, status: 'stale' })
  if (replayedOpen.length > 0) save(conversation)

  return {
    handleChat(text) {
      emit({ kind: 'userMessage', messageId: randomUUID(), text })
      if (missingKey) return emit({ kind: 'error', message: MISSING_KEY })
      if (budgetSpent()) return budgetNotice()
      enqueueTurn({ text, effort: 'high', trigger: 'chat', severity: 'info' })
    },

    stopTurn() {
      running?.abort.abort()
    },

    setAutoReview(on) {
      settings = { ...settings, autoReview: on }
      if (!on) pendingObservation = null
      if (settingsFile) {
        try {
          mkdirSync(deps.dataDir!, { recursive: true })
          writeFileSync(settingsFile, JSON.stringify(settings))
        } catch (err) {
          emit({ kind: 'error', message: `Could not save the agent settings: ${errorText(err)}` })
        }
      }
      emitStatus()
    },

    status: () => (missingKey ? null : status()),

    onStatus(cb) {
      statusListeners.add(cb)
      return () => {
        statusListeners.delete(cb)
      }
    },

    handleChange(change: StoreChange) {
      const id = deps.store.state().plan.id
      const replaced = change.kind === 'replace' || id !== planId
      planId = id
      if (replaced) {
        coalescer.clear()
        pendingObservation = null
        // Undo and redo step back to a plan this conversation already knows, so the offer is made once.
        if (change.kind === 'replace' || change.kind === 'command') offerFreshConversation()
        return
      }
      if (change.author === 'user') coalescer.add(change)
      else coalescer.cut()
    },

    resetConversation() {
      coalescer.clear()
      pendingObservation = null
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

    onView: (cb) =>
      deps.views?.subscribe((a) =>
        cb(a.type === 'annotate' && turnMessageId ? { ...a, annotation: { ...a.annotation, messageId: turnMessageId } } : a),
      ) ?? (() => undefined),

    threadEvents: () => conversation.thread(),

    async runTool(name, input): Promise<ToolRunResult> {
      const tool = deps.tools.find((t) => t.name === name)
      if (!tool) return { ok: false, error: `Unknown tool "${name}".` }
      try {
        const outcome = await tool.run(input)
        if (outcome.ok && outcome.events?.length) showExternalRun(name, outcome)
        return outcome.ok ? { ok: true, result: outcome.content } : { ok: false, error: outcome.error }
      } catch (err) {
        return { ok: false, error: errorText(err) }
      }
    },

    listTools: () => deps.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }
}
