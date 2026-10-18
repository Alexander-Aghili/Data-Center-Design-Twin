import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createDefaultPlan } from '@twin/catalog'
import { emptyEvaluation } from '@twin/engine'
import type { AgentEvent, AgentStatus, Check, EvalDiff, Evaluation, Status } from '@twin/schema'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnthropicLike } from '../src/agent/client'
import { DEFAULT_LIMITS, limitsFromEnv, type AgentLimits } from '../src/agent/limits'
import { createAgentRuntime } from '../src/agent/runtime'
import type { AgentTool } from '../src/agent/tools/index'
import type { AgentRuntime, PlanStore, StoreChange } from '../src/contracts'

// ---------- a scripted client that reports usage and honours abort ----------

interface Step {
  content: BetaContentBlock[]
  /** Tokens this response reports in its message_start and message_delta events. */
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
  /** Streams this text, then waits until the request is aborted. */
  hangAfter?: string
}

const text = (t: string): BetaContentBlock => ({ type: 'text', text: t, citations: null })
const toolUse = (id: string, name: string): BetaContentBlock => ({ type: 'tool_use', id, name, input: {} })
const reply = (t: string, usage?: Step['usage']): Step => ({ content: [text(t)], ...(usage ? { usage } : {}) })
/** A model that never stops asking for tools: each step calls `n` tools. */
const toolSteps = (count: number, n: number, usage?: Step['usage']): Step[] =>
  Array.from({ length: count }, (_, s) => ({
    content: Array.from({ length: n }, (_, i) => toolUse(`t${s}_${i}`, 'get_plan')),
    ...(usage ? { usage } : {}),
  }))

function scriptedClient(script: Step[]) {
  const requests: BetaMessageStreamParams[] = []
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(params, options) {
          requests.push({ ...params, messages: structuredClone(params.messages) })
          const step = script.shift()
          if (!step) throw new Error('script exhausted')
          const signal = options?.signal ?? undefined
          const usage = step.usage ?? { input: 0, output: 0 }
          const aborted = () =>
            new Promise<never>((_, reject) => {
              const fail = () => reject(new Anthropic.APIUserAbortError())
              if (signal?.aborted) fail()
              signal?.addEventListener('abort', fail)
            })
          const hasTools = step.content.some((b) => b.type === 'tool_use')
          return {
            async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
              yield {
                type: 'message_start',
                message: {
                  id: 'msg',
                  type: 'message',
                  role: 'assistant',
                  model: 'claude-opus-5-5',
                  content: [],
                  container: null,
                  context_management: null,
                  stop_reason: null,
                  stop_sequence: null,
                  stop_details: null,
                  usage: {
                    input_tokens: usage.input,
                    output_tokens: 1,
                    cache_read_input_tokens: usage.cacheRead ?? 0,
                    cache_creation_input_tokens: usage.cacheWrite ?? 0,
                  },
                } as unknown as Extract<BetaRawMessageStreamEvent, { type: 'message_start' }>['message'],
              }
              if (step.hangAfter !== undefined) {
                yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.hangAfter } }
                await aborted()
              }
              for (const [index, block] of step.content.entries()) {
                if (block.type === 'text') yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }
              }
              yield {
                type: 'message_delta',
                delta: { stop_reason: hasTools ? 'tool_use' : 'end_turn', stop_sequence: null, stop_details: null, container: null },
                usage: { output_tokens: usage.output },
              } as unknown as BetaRawMessageStreamEvent
            },
            finalMessage: async () => ({ content: step.content, stop_reason: hasTools ? 'tool_use' : 'end_turn', stop_details: null }),
          }
        },
      },
    },
  }
  return { client, requests }
}

// ---------- fixtures ----------

function check(id: string, status: Status): Check {
  return {
    id,
    kind: 'cooling.rackHeatLimit',
    layer: 'cooling',
    subject: { kind: 'group', id: 'g2', objectIds: [] },
    title: `Rack heat for ${id}`,
    value: 132000,
    limit: 40000,
    unit: 'W',
    utilization: 3.3,
    status,
    explanation: 'Air cannot carry this heat.',
    causes: [],
  }
}

const evaluation = (checks: Check[]): Evaluation => ({ ...emptyEvaluation(), checks })
const passing = evaluation([check('cooling.rackHeatLimit:g2', 'pass')])
const failing = evaluation([check('cooling.rackHeatLimit:g2', 'fail')])

/** Worsened when a check's status was pass and is not any more. */
function testDiff(prev: Evaluation, next: Evaluation): EvalDiff {
  const before = new Map(prev.checks.map((c) => [c.id, c.status]))
  const worsened = next.checks.filter((c) => before.get(c.id) === 'pass' && c.status !== 'pass')
  return { headline: {}, worsened, improved: [], resolved: [], newChecks: [], capexDeltaUsd: 0, buildWeeksDelta: 0, waterDeltaM3PerDay: 0 }
}

function fakeStore(): PlanStore {
  const plan = createDefaultPlan()
  return {
    state: () => ({ plan, evaluation: passing, history: { canUndo: false, canRedo: false } }),
    dispatch: () => ({ ok: true, summary: '' }),
    dispatchAll: () => ({ ok: true, summaries: [] }),
    undo: () => false,
    redo: () => false,
    replace: () => undefined,
    onChange: () => () => undefined,
    builtins: () => {
      throw new Error('not used')
    },
  }
}

function countingTool(name: string): AgentTool & { calls: number } {
  const t = {
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: {} },
    calls: 0,
    run: async () => {
      t.calls++
      return { ok: true as const, content: '{"rows":8}', summary: `${name} done` }
    },
  }
  return t
}

const userEdit = (summary: string): StoreChange => ({ prev: passing, next: failing, author: 'user', summary, kind: 'command' })

function recorder(rt: AgentRuntime) {
  const events: AgentEvent[] = []
  const statuses: AgentStatus[] = []
  rt.onEvent((e) => events.push(e))
  rt.onStatus((s) => statuses.push(s))
  /** Resolves once no turn runs and `n` turns have started and finished. */
  const idleAfter = (n: number) =>
    vi.waitFor(() => {
      const started = statuses.filter((s, i) => s.running && !statuses[i - 1]?.running).length
      if (started < n || statuses.at(-1)?.running !== false) throw new Error(`waiting for ${n} turns`)
    })
  const notices = () => events.flatMap((e) => (e.kind === 'notice' ? [e.message] : []))
  return { events, statuses, idleAfter, notices }
}

/** Every tool_use the model made has a tool_result in the next message, and nothing else is pending. */
function expectCompleteToolResults(messages: BetaMessageParam[]) {
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return
    const ids = m.content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : []))
    if (ids.length === 0) return
    const next = messages[i + 1]
    const answered = next && typeof next.content !== 'string' ? next.content.flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : [])) : []
    expect(next?.role).toBe('user')
    expect(answered).toEqual(ids)
  })
}

/** Every chat message in the API history has its userMessage in the thread the person sees. */
function expectEveryUserTurnInThread(rt: AgentRuntime, messages: BetaMessageParam[]) {
  const shown = rt.threadEvents().flatMap((e) => (e.kind === 'userMessage' ? [e.text] : []))
  const sent = messages.flatMap((m) => (m.role === 'user' && typeof m.content === 'string' ? [m.content] : []))
  expect(shown).toEqual(sent)
}

const limits = (over: Partial<AgentLimits>): AgentLimits => ({ ...DEFAULT_LIMITS, ...over })

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-safeguards-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dataDir, { recursive: true, force: true })
})

// ---------- tests ----------

describe('limits from the environment', () => {
  it('uses the defaults, takes AGENT_* overrides and refuses malformed values by name', () => {
    expect(limitsFromEnv({})).toEqual({
      dailyBudgetUsd: 5,
      maxRequestsPerTurn: 8,
      maxToolCallsPerTurn: 16,
      maxTurnUsd: 0.75,
      observationGapMs: 120_000,
      observationsPerHour: 10,
      observationReserve: 0.2,
      maxToolResultChars: 30_000,
    })
    expect(limitsFromEnv({ AGENT_DAILY_BUDGET_USD: '12.5', AGENT_MAX_TOOL_CALLS_PER_TURN: '30', AGENT_REVIEW_MIN_GAP_S: '0' })).toMatchObject({
      dailyBudgetUsd: 12.5,
      maxToolCallsPerTurn: 30,
      observationGapMs: 0,
    })
    expect(() => limitsFromEnv({ AGENT_MAX_REQUESTS_PER_TURN: '2.5' })).toThrow(/AGENT_MAX_REQUESTS_PER_TURN/)
    expect(() => limitsFromEnv({ AGENT_MAX_TURN_USD: 'lots' })).toThrow(/AGENT_MAX_TURN_USD/)
  })
})

describe('spend ledger in the runtime', () => {
  it('records every response in usage.json, logs its tokens and cost, and reports live status', async () => {
    const { client } = scriptedClient([
      { ...toolSteps(1, 1)[0]!, usage: { input: 2000, output: 500, cacheRead: 10_000, cacheWrite: 1000 } },
      reply('Eight rows.', { input: 100, output: 200, cacheRead: 12_000 }),
    ])
    const log = { info: vi.fn() }
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir, log })
    const rec = recorder(rt)
    rt.handleChat('how many rows?')
    await rec.idleAfter(1)

    // 2000×4 + 500×20 + 10000×0.2 + 1000×5 = 25 000 µ$; 100×4 + 200×20 + 12000×0.2 = 6 800 µ$
    const first = 0.025
    const second = 0.0068
    expect(rt.status()).toMatchObject({ running: false, turnUsd: expect.closeTo(first + second, 10), todayUsd: expect.closeTo(first + second, 10) })
    expect(rt.status()).toMatchObject({ dailyBudgetUsd: 5, budgetSpent: false, autoReview: true })
    const saved = JSON.parse(readFileSync(join(dataDir, 'usage.json'), 'utf8'))
    expect(Object.values(saved.days)).toEqual([
      { requests: 2, input: 2100, output: 700, cacheWrite: 1000, cacheRead: 22_000, usd: expect.closeTo(first + second, 10) },
    ])
    expect(log.info).toHaveBeenCalledTimes(2)
    expect(log.info).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ input: 2000, output: 500, cacheRead: 10_000, cacheWrite: 1000, usd: expect.closeTo(first, 10) }),
      'Claude API request',
    )
    // The status goes running before the first response and shows the turn's cost while it runs.
    expect(rec.statuses[0]).toMatchObject({ running: true, turnUsd: 0 })
    expect(rec.statuses.some((s) => s.running && s.turnUsd > 0)).toBe(true)
  })
})

describe('per-turn caps', () => {
  it('stops after the request cap with a plain message and every tool call answered', async () => {
    const { client, requests } = scriptedClient([...toolSteps(5, 1), reply('Continuing.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir, limits: limits({ maxRequestsPerTurn: 3 }) })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.idleAfter(1)
    expect(requests).toHaveLength(3)
    expect(rec.notices()).toEqual(['I stopped after 3 model requests to save your API budget. Say continue to keep going.'])
    expect(rec.events.at(-1)?.kind).toBe('messageEnd')

    rt.handleChat('continue')
    await rec.idleAfter(2)
    const sent = requests[3]!.messages
    expectCompleteToolResults(sent)
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'continue' })
    expectEveryUserTurnInThread(rt, sent)
  })

  it('runs only the tool calls that fit under the tool-call cap and answers the rest as not run', async () => {
    const plan = countingTool('get_plan')
    const { client, requests } = scriptedClient([...toolSteps(2, 2), reply('Done.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [plan], client, dataDir, limits: limits({ maxToolCallsPerTurn: 3 }) })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.idleAfter(1)
    expect(plan.calls).toBe(3)
    expect(requests).toHaveLength(2)
    expect(rec.notices()).toEqual(['I stopped after 3 tool calls to save your API budget. Say continue to keep going.'])

    rt.handleChat('continue')
    await rec.idleAfter(2)
    const sent = requests.at(-1)!.messages
    expectCompleteToolResults(sent)
    const lastResults = sent.at(-2)!.content as { type: string; is_error?: boolean; content?: unknown }[]
    expect(lastResults.map((r) => r.is_error ?? false)).toEqual([false, true])
    expect(lastResults[1]!.content).toMatch(/not run/i)
  })

  it('does not start a request that could take the turn over its USD cap', async () => {
    // 5000 output tokens = $0.10 per response, so the next one is estimated at $0.10 too.
    const { client, requests } = scriptedClient(toolSteps(4, 1, { input: 0, output: 5000 }))
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir, limits: limits({ maxTurnUsd: 0.15 }) })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.idleAfter(1)
    expect(requests).toHaveLength(1)
    expect(rec.notices()).toEqual([
      'I stopped because the next request could take this turn over its $0.15 limit ($0.10 spent so far), to save your API budget. Say continue to keep going.',
    ])
    expect(rt.status()!.turnUsd).toBeLessThanOrEqual(0.15)
  })

  it('does not start a request that alone could cost more than the turn cap, and says how to make it smaller', async () => {
    // 40 000 characters of prompt are estimated at 20 000 tokens, written to the cache at $5 per million: $0.10.
    const { client, requests } = scriptedClient([reply('Never sent.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, limits: limits({ maxTurnUsd: 0.1 }) })
    const rec = recorder(rt)
    rt.handleChat('x'.repeat(40_000))
    await vi.waitFor(() => expect(rec.notices()).toHaveLength(1))
    expect(requests).toHaveLength(0)
    expect(rec.notices()[0]).toMatch(
      /^The next request alone could cost about \$0\.1\d, more than this turn's \$0\.10 limit\. Start a new conversation to make requests smaller, or raise AGENT_MAX_TURN_USD\.$/,
    )
  })

  it('answers a tool result over the size limit as an error instead of sending it', async () => {
    const big: AgentTool = {
      name: 'get_hourly',
      description: 'Hourly series.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ ok: true, content: 'x'.repeat(64_002), summary: 'Read pue for hours 0 to 8759' }),
    }
    const { client, requests } = scriptedClient([{ content: [toolUse('t0', 'get_hourly')] }, reply('Asked for less.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [big], client, dataDir, limits: limits({ maxToolResultChars: 30_000 }) })
    const rec = recorder(rt)
    rt.handleChat('hourly pue')
    await rec.idleAfter(1)
    const result = (requests[1]!.messages.at(-1)!.content as { is_error?: boolean; content: string }[])[0]!
    expect(result.is_error).toBe(true)
    expect(result.content).toBe(
      'Not sent: the result is 64,002 characters, over the 30,000-character limit for one tool result. Ask for less: a shorter range, a larger step, fewer series, or the summary detail.',
    )
    expect(rec.events).toContainEqual({ kind: 'toolResult', callId: 't0', ok: false, summary: 'Result too large to send (64,002 characters)', numbers: [] })
  })
})

describe('daily budget', () => {
  const today = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const spent = (usd: number) =>
    writeFileSync(
      join(dataDir, 'usage.json'),
      JSON.stringify({ version: 1, days: { [today()]: { requests: 1, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd } } }),
    )
  const BUDGET_MESSAGE =
    "The agent is paused until tomorrow: today's API spend is $5.02 of the $5.00 daily budget. To raise it, set AGENT_DAILY_BUDGET_USD in .env and restart the server."

  it('when spent, chat gets the budget message and no request, and the status says so', async () => {
    spent(5.02)
    const { client, requests } = scriptedClient([reply('Never sent.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
    const rec = recorder(rt)
    expect(rt.status()).toMatchObject({ budgetSpent: true, todayUsd: 5.02 })
    rt.handleChat('hello')
    await new Promise((r) => setTimeout(r, 10))
    expect(requests).toHaveLength(0)
    expect(rec.events.map((e) => e.kind)).toEqual(['userMessage', 'notice'])
    expect(rec.notices()).toEqual([BUDGET_MESSAGE])
  })

  it('a turn does not start a request that could take the day over its budget', async () => {
    // Each response costs $0.03; the next is estimated at the 2000-token output floor ($0.04) plus its prompt.
    spent(4.8)
    const { client, requests } = scriptedClient(toolSteps(10, 1, { input: 0, output: 1500 }))
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.idleAfter(1)
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.length).toBeLessThan(7)
    expect(rec.notices()).toHaveLength(1)
    expect(rec.notices()[0]).toMatch(
      /^I stopped because the next request could take today's API spend over the \$5\.00 daily budget \(\$4\.9\d spent so far\)\. To raise it, set AGENT_DAILY_BUDGET_USD in \.env and restart the server\.$/,
    )
    expect(rt.status()!.todayUsd).toBeLessThanOrEqual(5)
  })
})

describe('new conversation while a turn runs', () => {
  it('stops the running turn, so it spends nothing more out of sight, and drops chat queued behind it', async () => {
    const { client, requests } = scriptedClient([
      { content: [text('never finished')], hangAfter: 'Looking ', usage: { input: 1000, output: 0 } },
      reply('Fresh start.'),
    ])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('first')
    rt.handleChat('second, sent while the first runs')
    await vi.waitFor(() => expect(rec.events.some((e) => e.kind === 'textDelta')).toBe(true))
    rt.resetConversation()
    await vi.waitFor(() => expect(rt.status()?.running).toBe(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(requests).toHaveLength(1)

    rt.handleChat('third')
    await rec.idleAfter(2)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.messages).toEqual([{ role: 'user', content: 'third' }])
    expectEveryUserTurnInThread(rt, requests[1]!.messages)
  })
})

describe('stop', () => {
  it('aborts the running stream, keeps the partial text, shows Stopped and leaves a valid history', async () => {
    const { client, requests } = scriptedClient([
      ...toolSteps(1, 1),
      { content: [text('never finished')], hangAfter: 'The rear doors ', usage: { input: 1000, output: 0 } },
      reply('Fresh answer.'),
    ])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [countingTool('get_plan')], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await vi.waitFor(() => expect(rec.events.some((e) => e.kind === 'textDelta')).toBe(true))
    rt.stopTurn()
    await rec.idleAfter(1)

    const tail = rec.events.slice(-3)
    expect(tail).toMatchObject([{ kind: 'textDelta', text: 'The rear doors ' }, { kind: 'notice', message: 'Stopped' }, { kind: 'messageEnd' }])
    // The aborted request's input tokens are still counted (plus the one output token each message_start reports).
    expect(rt.status()?.todayUsd).toBeCloseTo(0.004, 4)

    rt.handleChat('try again')
    await rec.idleAfter(2)
    const sent = requests.at(-1)!.messages
    expectCompleteToolResults(sent)
    expect(sent.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'try again' })
    expectEveryUserTurnInThread(rt, sent)
  })

  it('does nothing when no turn runs', () => {
    const { client } = scriptedClient([])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
    const rec = recorder(rt)
    rt.stopTurn()
    expect(rec.events).toEqual([])
  })
})

describe('automatic review', () => {
  const settle = () => vi.advanceTimersByTimeAsync(1600)

  it('waits at least the minimum gap between reviews, merging the edits made meanwhile', async () => {
    vi.useFakeTimers()
    const { client, requests } = scriptedClient([reply('First.'), reply('Second.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
    rt.handleChange(userEdit('edit 1'))
    await settle()
    expect(requests).toHaveLength(1)

    rt.handleChange(userEdit('edit 2'))
    await settle()
    await vi.advanceTimersByTimeAsync(30_000)
    rt.handleChange(userEdit('edit 3'))
    await settle()
    expect(requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(requests).toHaveLength(2)
    const event = requests[1]!.messages.at(-1)!.content as string
    expect(event).toContain('edit 2')
    expect(event).toContain('edit 3')
  })

  it('makes at most the hourly number of reviews', async () => {
    vi.useFakeTimers()
    const { client, requests } = scriptedClient(Array.from({ length: 5 }, (_, i) => reply(`Review ${i}.`)))
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff, limits: limits({ observationGapMs: 0, observationsPerHour: 2 }) })
    for (let i = 0; i < 4; i++) {
      rt.handleChange(userEdit(`edit ${i}`))
      await settle()
    }
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3_600_000)
    rt.handleChange(userEdit('an hour later'))
    await settle()
    expect(requests).toHaveLength(3)
  })

  it('skips reviews when less than the reserve share of the daily budget is left', async () => {
    vi.useFakeTimers()
    const { client, requests } = scriptedClient([reply('Done.', { input: 0, output: 210_000 }), reply('Review.')])
    // One chat turn spends $4.20 of $5.00, leaving 16 %.
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
    rt.handleChat('expensive')
    await vi.advanceTimersByTimeAsync(10)
    expect(requests).toHaveLength(1)
    rt.handleChange(userEdit('edit'))
    await settle()
    expect(requests).toHaveLength(1)
    expect(rt.status()?.budgetSpent).toBe(false)
  })

  it('can be turned off; the setting is saved and reported in the status', async () => {
    vi.useFakeTimers()
    const { client, requests } = scriptedClient([reply('Review.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
    const rec = recorder(rt)
    rt.setAutoReview(false)
    expect(rec.statuses.at(-1)).toMatchObject({ autoReview: false })
    rt.handleChange(userEdit('edit'))
    await settle()
    expect(requests).toHaveLength(0)

    const again = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
    expect(again.status()).toMatchObject({ autoReview: false })
    again.setAutoReview(true)
    again.handleChange(userEdit('edit'))
    await settle()
    expect(requests).toHaveLength(1)
  })
})
