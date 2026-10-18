import type { BetaMessageDeltaUsage, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AgentLimits } from './limits'
import { costUsd, type TokenUsage, type UsageLedger } from './usage'

/** Where each request's tokens and cost are logged (the server's pino logger). Never given the key. */
export interface SpendLog {
  info(details: object, message: string): void
}

const usd = (amount: number) => `$${amount.toFixed(2)}`
const KEEP_GOING = 'to save your API budget. Say continue to keep going.'

export function dailyBudgetMessage(todayUsd: number, budgetUsd: number): string {
  return `The agent is paused until tomorrow: today's API spend is ${usd(todayUsd)} of the ${usd(budgetUsd)} daily budget. To raise it, set AGENT_DAILY_BUDGET_USD in .env and restart the server.`
}

/** The usage a stream reports so far: `message_start` has the input, `message_delta` the cumulative totals. */
export function usageFromStart(u: BetaUsage): TokenUsage {
  return { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 }
}

export function usageFromDelta(prev: TokenUsage, u: BetaMessageDeltaUsage): TokenUsage {
  return {
    input: u.input_tokens ?? prev.input,
    output: u.output_tokens,
    cacheWrite: u.cache_creation_input_tokens ?? prev.cacheWrite,
    cacheRead: u.cache_read_input_tokens ?? prev.cacheRead,
  }
}

/**
 * Counts one turn against the caps: model requests, tool calls, its own cost and the day's budget. The request in
 * flight counts with what its stream has reported so far; `settle` books it in the ledger once it ends, however it ends.
 */
export class TurnMeter {
  #requests = 0
  #toolCalls = 0
  #settledUsd = 0
  #pending: TokenUsage | null = null

  constructor(
    private readonly opts: { model: string; limits: AgentLimits; ledger: UsageLedger; log?: SpendLog; onChange: () => void },
  ) {}

  /** What the turn has cost so far, including the request in flight. */
  get usd(): number {
    return this.#settledUsd + (this.#pending ? costUsd(this.opts.model, this.#pending) : 0)
  }

  /** The message to post instead of the next request when it would break a cap; null when it may go. */
  stopBeforeRequest(): string | null {
    const { limits, ledger } = this.opts
    const today = ledger.todayUsd()
    if (today >= limits.dailyBudgetUsd) return dailyBudgetMessage(today, limits.dailyBudgetUsd)
    if (this.#requests >= limits.maxRequestsPerTurn) return `I stopped after ${this.#requests} model requests ${KEEP_GOING}`
    if (this.usd >= limits.maxTurnUsd) return `I stopped after this turn spent ${usd(this.usd)}, over its ${usd(limits.maxTurnUsd)} limit, ${KEEP_GOING}`
    this.#requests++
    return null
  }

  progress(usage: TokenUsage): void {
    this.#pending = usage
    this.opts.onChange()
  }

  /** Books the request that just ended (completed, failed or aborted) with the usage its stream reported. */
  settle(): void {
    const usage = this.#pending
    if (!usage) return
    this.#pending = null
    const { model, ledger, log } = this.opts
    const cost = ledger.record(model, usage)
    this.#settledUsd += cost
    log?.info({ model, ...usage, usd: cost, turnUsd: this.#settledUsd, todayUsd: ledger.todayUsd() }, 'Claude API request')
    this.opts.onChange()
  }

  /** How many of `wanted` tool calls may still run this turn; those are counted. */
  takeToolCalls(wanted: number): number {
    const allowed = Math.max(0, Math.min(wanted, this.opts.limits.maxToolCallsPerTurn - this.#toolCalls))
    this.#toolCalls += allowed
    return allowed
  }

  toolCapMessage(): string {
    return `I stopped after ${this.#toolCalls} tool calls ${KEEP_GOING}`
  }

  /** The tool_result text for a call the cap kept from running. */
  notRunMessage(): string {
    return `Not run: this turn reached its limit of ${this.opts.limits.maxToolCallsPerTurn} tool calls. The person can say continue.`
  }
}
