import type { BetaMessageDeltaUsage, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AgentLimits } from './limits'
import { costUsd, type TokenUsage, type UsageLedger } from './usage'

/** Where each request's tokens and cost are logged (the server's pino logger). Never given the key. */
export interface SpendLog {
  info(details: object, message: string): void
}

const usd = (amount: number) => `$${amount.toFixed(2)}`
const count = (n: number) => n.toLocaleString('en-US')
const KEEP_GOING = 'to save your API budget. Say continue to keep going.'

/**
 * Characters per prompt token assumed for the estimate. count_tokens measured 2.2 for this agent's JSON (87 000
 * characters of tools and system prompt are 39 000 tokens; a 164 000-character numeric tool result is 77 000); 2 errs
 * high, so the estimate does too.
 */
const CHARS_PER_TOKEN = 2
/** Output assumed for a request when the turn has seen no larger one. Live steps of this agent wrote 27 to 361 tokens. */
const OUTPUT_FLOOR_TOKENS = 2000
/** The prompt cache lives 5 minutes after its last use; within that the previous prompt is read, not written. */
const CACHE_TTL_MS = 5 * 60_000

/** The prompt size of the agent's last request and when it ended, shared by all turns. */
export interface CacheState {
  last: { promptTokens: number; at: number } | null
}

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
  #maxOutput = 0

  constructor(
    private readonly opts: {
      model: string
      limits: AgentLimits
      ledger: UsageLedger
      cache: CacheState
      now: () => number
      log?: SpendLog
      onChange: () => void
    },
  ) {}

  /** What the turn has cost so far, including the request in flight. */
  get usd(): number {
    return this.#settledUsd + (this.#pending ? costUsd(this.opts.model, this.#pending) : 0)
  }

  /**
   * A high estimate of what a request with this many prompt characters costs: the part the last request (within the
   * cache lifetime) already had is read from the cache, the rest is written to it, and the output is the larger of
   * the floor and the turn's largest so far.
   */
  estimateUsd(promptChars: number): number {
    const { model, cache, now } = this.opts
    const tokens = Math.ceil(promptChars / CHARS_PER_TOKEN)
    const warm = cache.last && now() - cache.last.at < CACHE_TTL_MS ? Math.min(cache.last.promptTokens, tokens) : 0
    return costUsd(model, { input: 0, output: Math.max(OUTPUT_FLOOR_TOKENS, this.#maxOutput), cacheWrite: tokens - warm, cacheRead: warm })
  }

  /**
   * The message to post instead of the next request when it could break a cap; null when it may go. The request
   * is priced in advance, so a cap is overshot by no more than the estimate's error.
   */
  stopBeforeRequest(promptChars: number): string | null {
    const { limits, ledger } = this.opts
    const estimate = this.estimateUsd(promptChars)
    const today = ledger.todayUsd()
    if (today >= limits.dailyBudgetUsd) return dailyBudgetMessage(today, limits.dailyBudgetUsd)
    if (today + estimate > limits.dailyBudgetUsd) {
      return `I stopped because the next request could take today's API spend over the ${usd(limits.dailyBudgetUsd)} daily budget (${usd(today)} spent so far). To raise it, set AGENT_DAILY_BUDGET_USD in .env and restart the server.`
    }
    if (this.#requests >= limits.maxRequestsPerTurn) return `I stopped after ${this.#requests} model requests ${KEEP_GOING}`
    if (estimate > limits.maxTurnUsd) {
      return `The next request alone could cost about ${usd(estimate)}, more than this turn's ${usd(limits.maxTurnUsd)} limit. Start a new conversation to make requests smaller, or raise AGENT_MAX_TURN_USD.`
    }
    if (this.usd + estimate > limits.maxTurnUsd) {
      return `I stopped because the next request could take this turn over its ${usd(limits.maxTurnUsd)} limit (${usd(this.usd)} spent so far), ${KEEP_GOING}`
    }
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
    const { model, ledger, log, cache, now } = this.opts
    const cost = ledger.record(model, usage)
    this.#settledUsd += cost
    this.#maxOutput = Math.max(this.#maxOutput, usage.output)
    cache.last = { promptTokens: usage.input + usage.cacheRead + usage.cacheWrite, at: now() }
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

  /** The tool_result text for a result too long to send, or null when it fits. */
  oversizeMessage(chars: number): string | null {
    const limit = this.opts.limits.maxToolResultChars
    if (chars <= limit) return null
    return `Not sent: the result is ${count(chars)} characters, over the ${count(limit)}-character limit for one tool result. Ask for less: a shorter range, a larger step, fewer series, or the summary detail.`
  }

  /** The tool_result text for a call the cap kept from running. */
  notRunMessage(): string {
    return `Not run: this turn reached its limit of ${this.opts.limits.maxToolCallsPerTurn} tool calls. The person can say continue.`
  }
}
