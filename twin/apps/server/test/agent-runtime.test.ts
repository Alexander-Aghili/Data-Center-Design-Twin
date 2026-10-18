import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createDefaultPlan } from '@twin/catalog'
import { emptyEvaluation } from '@twin/engine'
import type { AgentEvent, Check, EvalDiff, Evaluation, Plan, Proposal, Status } from '@twin/schema'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicClient, type AnthropicLike, type FinalMessage } from '../src/agent/client'
import type { RuntimeTool, ToolOutcome } from '../src/agent/loop'
import { createAgentRuntime } from '../src/agent/runtime'
import type { AgentRuntime, PlanStore, StoreChange } from '../src/contracts'

// ---------- scripted fake client ----------

type Step =
  | { content: BetaContentBlock[]; stop_reason: FinalMessage['stop_reason']; stop_details?: BetaRefusalStopDetails; gate?: Promise<void> }
  | { error: Error }

const text = (t: string): BetaContentBlock => ({ type: 'text', text: t, citations: null })
const toolUse = (id: string, name: string, input: unknown): BetaContentBlock => ({ type: 'tool_use', id, name, input })
const reply = (t: string): Step => ({ content: [text(t)], stop_reason: 'end_turn' })

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

function fakeClient(script: Step[]) {
  const requests: BetaMessageStreamParams[] = []
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(params) {
          // Freeze every message the runtime sends: any later mutation of history throws.
          for (const m of params.messages) deepFreeze(m)
          requests.push({ ...params, messages: [...params.messages] })
          const step = script.shift()
          if (!step) throw new Error('fake client: script exhausted')
          const run = async (): Promise<FinalMessage> => {
            if ('error' in step) throw step.error
            await step.gate
            return { content: step.content, stop_reason: step.stop_reason, stop_details: step.stop_details ?? null }
          }
          const final = run()
          final.catch(() => undefined)
          return {
            async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
              const message = await final
              for (const [index, block] of message.content.entries()) {
                if (block.type !== 'text') continue
                for (const chunk of block.text.match(/\S+\s*/g) ?? []) {
                  yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: chunk } }
                }
              }
            },
            finalMessage: () => final,
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

function evaluation(checks: Check[], pueAnnual: number | null = 1.3): Evaluation {
  const e = emptyEvaluation()
  return { ...e, checks, headline: { ...e.headline, pueAnnual } }
}

const ORDER: Status[] = ['pass', 'unknown', 'warn', 'fail']
/** A small stand-in for the engine diff: worsened = status order rose; headline = pueAnnual. */
function testDiff(prev: Evaluation, next: Evaluation): EvalDiff {
  const before = new Map(prev.checks.map((c) => [c.id, c]))
  const worsened = next.checks.filter((c) => {
    const p = before.get(c.id)
    return p !== undefined && ORDER.indexOf(c.status) > ORDER.indexOf(p.status)
  })
  const newChecks = next.checks.filter((c) => !before.has(c.id))
  const headline: EvalDiff['headline'] =
    prev.headline.pueAnnual === next.headline.pueAnnual ? {} : { pueAnnual: { from: prev.headline.pueAnnual, to: next.headline.pueAnnual } }
  return { headline, worsened, improved: [], resolved: [], newChecks, capexDeltaUsd: 0, buildWeeksDelta: 0, waterDeltaM3PerDay: 0 }
}

function fakeStore(): PlanStore & { setPlan(p: Plan): void } {
  let plan = createDefaultPlan()
  const evaluationNow = evaluation([])
  return {
    setPlan: (p) => {
      plan = p
    },
    state: () => ({ plan, evaluation: evaluationNow, history: { canUndo: false, canRedo: false } }),
    dispatch: () => ({ ok: true, summary: '' }),
    dispatchAll: () => ({ ok: true, summaries: [] }),
    undo: () => false,
    redo: () => false,
    replace: () => undefined,
    onChange: () => () => undefined,
    builtins: () => {
      throw new Error('builtins are not used by the runtime')
    },
  }
}

function tool(name: string, run: (input: unknown) => Promise<ToolOutcome>): RuntimeTool & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: {} },
    calls,
    run: (input) => {
      calls.push(input)
      return run(input)
    },
  }
}

const okTool = (name: string, content = '{"value":1.32}') =>
  tool(name, async () => ({ ok: true, content, summary: `${name} done` }))

function recorder(rt: AgentRuntime) {
  const events: AgentEvent[] = []
  rt.onEvent((e) => events.push(e))
  const waitFor = (pred: (e: AgentEvent) => boolean) =>
    new Promise<AgentEvent>((resolve) => {
      const hit = events.find(pred)
      if (hit) return resolve(hit)
      const off = rt.onEvent((e) => {
        if (pred(e)) {
          off()
          resolve(e)
        }
      })
    })
  /** Resolves after the n-th messageEnd or error event that ends a turn. */
  const turnsDone = (n: number) =>
    new Promise<void>((resolve) => {
      const count = () => events.filter((e) => e.kind === 'messageEnd').length
      if (count() >= n) return resolve()
      const off = rt.onEvent(() => {
        if (count() >= n) {
          off()
          resolve()
        }
      })
    })
  return { events, waitFor, turnsDone }
}

const change = (prev: Evaluation, next: Evaluation, summary: string, author: 'user' | 'agent' = 'user'): StoreChange => ({
  prev,
  next,
  author,
  summary,
  kind: 'command',
})

const lastUserText = (params: BetaMessageStreamParams) => {
  const last = params.messages.at(-1)
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
}

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-runtime-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dataDir, { recursive: true, force: true })
})

// ---------- tests ----------

describe('agent runtime', () => {
  it('chat streams textDelta events then messageEnd', async () => {
    const { client, requests } = fakeClient([reply('Hello there, the PUE is 1.32.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [okTool('get_plan'), okTool('get_evaluation')], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('hi')
    await rec.turnsDone(1)

    const kinds = rec.events.map((e) => e.kind)
    expect(kinds[0]).toBe('userMessage')
    expect(kinds[1]).toBe('messageStart')
    expect(kinds.slice(2, -1).every((k) => k === 'textDelta')).toBe(true)
    expect(kinds.at(-1)).toBe('messageEnd')
    const streamed = rec.events.flatMap((e) => (e.kind === 'textDelta' ? [e.text] : [])).join('')
    expect(streamed).toBe('Hello there, the PUE is 1.32.')
    expect(rec.events[1]).toMatchObject({ kind: 'messageStart', trigger: 'chat', severity: 'info' })

    const params = requests[0]!
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.max_tokens).toBe(16000)
    expect(params.thinking).toMatchObject({ type: 'adaptive' })
    expect(params.output_config).toEqual({ effort: 'high' })
    expect(params.fallbacks).toBe('default')
    expect(params.betas).toEqual(expect.arrayContaining(['server-side-fallback-2026-07-01', 'mid-conversation-output-config-2026-07-01']))
    expect(params.tool_choice).toBeUndefined()
    expect(Array.isArray(params.system) && params.system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    expect(params.tools?.at(-1)).toMatchObject({ name: 'get_evaluation', cache_control: { type: 'ephemeral' } })
    expect(params.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('tool_use blocks run tools and return all tool_result blocks in one user message', async () => {
    const getPlan = okTool('get_plan', '{"rows":8}')
    const getEval = okTool('get_evaluation', '{"pueAnnual":1.32,"pueWorst":1.41}')
    const step1: Step = {
      content: [text('Checking.'), toolUse('t1', 'get_plan', { section: 'rows' }), toolUse('t2', 'get_evaluation', { detail: 'summary' })],
      stop_reason: 'tool_use',
    }
    const { client, requests } = fakeClient([step1, reply('Eight rows, PUE 1.32.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [getPlan, getEval], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('how many rows?')
    await rec.turnsDone(1)

    expect(getPlan.calls).toEqual([{ section: 'rows' }])
    expect(getEval.calls).toEqual([{ detail: 'summary' }])
    expect(requests).toHaveLength(2)
    const second = requests[1]!.messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: step1.content })
    expect(second.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"rows":8}' },
        { type: 'tool_result', tool_use_id: 't2', content: '{"pueAnnual":1.32,"pueWorst":1.41}' },
      ],
    })
    expect(rec.events.filter((e) => e.kind === 'toolCall').map((e) => e.kind === 'toolCall' && e.name)).toEqual(['get_plan', 'get_evaluation'])
    const results = rec.events.filter((e) => e.kind === 'toolResult')
    expect(results).toContainEqual({ kind: 'toolResult', callId: 't2', ok: true, summary: 'get_evaluation done', numbers: [1.32, 1.41] })
  })

  it('invalid tool input yields is_error tool_result and loop continues', async () => {
    const cmd = tool('cmd_placeRacks', async () => ({ ok: false, error: 'payload.rows: expected array, received string' }))
    const { client, requests } = fakeClient([
      { content: [toolUse('t1', 'cmd_placeRacks', { rows: 'R3' })], stop_reason: 'tool_use' },
      { content: [toolUse('t2', 'no_such_tool', {})], stop_reason: 'tool_use' },
      reply('Fixed it.'),
    ])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [cmd], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('place racks')
    await rec.turnsDone(1)

    expect(requests).toHaveLength(3)
    expect(requests[1]!.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'payload.rows: expected array, received string' }],
    })
    expect(requests[2]!.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Unknown tool "no_such_tool".' }],
    })
    expect(rec.events).toContainEqual(expect.objectContaining({ kind: 'toolResult', callId: 't1', ok: false }))
    expect(rec.events.some((e) => e.kind === 'error')).toBe(false)
  })

  describe('observations', () => {
    const base = evaluation([check('cooling.rackHeatLimit:g2', 'pass'), check('power.ups:site', 'pass')])

    it('observation coalescing: 5 changes within 1.5 s make one observation turn', async () => {
      vi.useFakeTimers()
      const { client, requests } = fakeClient([reply('Rows 3 to 5 now exceed what air can carry.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [okTool('get_plan')], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      const states = [
        base,
        evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'pass')]),
        evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'pass')]),
        evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'warn')]),
        evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'warn')]),
        evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'warn')], 1.42),
      ]
      for (let i = 0; i < 5; i++) {
        rt.handleChange(change(states[i]!, states[i + 1]!, `edit ${i + 1}`))
        await vi.advanceTimersByTimeAsync(250)
      }
      expect(requests).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1500)
      await rec.turnsDone(1)

      expect(requests).toHaveLength(1)
      const params = requests[0]!
      const event = lastUserText(params)
      expect(event).toMatch(/^<app_event>[\s\S]*<\/app_event>$/)
      for (let i = 1; i <= 5; i++) expect(event).toContain(`edit ${i}`)
      expect(event).toContain('cooling.rackHeatLimit:g2')
      expect(event).toContain('power.ups:site')
      expect(event).toContain('pueAnnual')
      // effort drops to low for the observation turn without touching the top-level effort
      expect(params.messages.at(-2)).toEqual({ role: 'system', content: [], output_config: { effort: 'low' } })
      expect(params.output_config).toEqual({ effort: 'high' })
      expect(rec.events.find((e) => e.kind === 'messageStart')).toMatchObject({ trigger: 'observation', severity: 'problem' })
    })

    it('no observation turn when diff has no worsened checks and headline moved <2%', async () => {
      vi.useFakeTimers()
      const { client, requests } = fakeClient([reply('PUE rose.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      rt.handleChange(change(base, evaluation(base.checks, 1.31), 'small tweak'))
      rt.handleChange(change(base, evaluation(base.checks, 1.3), 'agent edit', 'agent'))
      await vi.advanceTimersByTimeAsync(3000)
      expect(requests).toHaveLength(0)
      expect(rec.events).toHaveLength(0)

      // a 2% or larger headline move does observe, as information
      rt.handleChange(change(base, evaluation(base.checks, 1.36), 'bigger tweak'))
      await vi.advanceTimersByTimeAsync(1600)
      await rec.turnsDone(1)
      expect(requests).toHaveLength(1)
      expect(rec.events.find((e) => e.kind === 'messageStart')).toMatchObject({ trigger: 'observation', severity: 'info' })
    })

    it('severity problem when any worsened check is fail', async () => {
      vi.useFakeTimers()
      const { client } = fakeClient([reply('UPS is close to its limit.'), reply('Rack heat now fails.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      rt.handleChange(change(base, evaluation([check('cooling.rackHeatLimit:g2', 'pass'), check('power.ups:site', 'warn')]), 'more load'))
      await vi.advanceTimersByTimeAsync(1600)
      await rec.turnsDone(1)
      rt.handleChange(change(base, evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'warn')]), 'swap racks'))
      await vi.advanceTimersByTimeAsync(1600)
      await rec.turnsDone(2)
      const starts = rec.events.filter((e) => e.kind === 'messageStart')
      expect(starts.map((e) => e.kind === 'messageStart' && e.severity)).toEqual(['warning', 'problem'])
    })
  })

  describe('api error surfaces', () => {
    it('401 gives a plain key message and the runtime stays usable', async () => {
      const auth = new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers())
      const { client, requests } = fakeClient([{ error: auth }, reply('Working now.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
      const rec = recorder(rt)
      rt.handleChat('hi')
      await rec.waitFor((e) => e.kind === 'error')
      expect(rec.events.find((e) => e.kind === 'error')).toMatchObject({ message: 'The Claude API rejected the key. Check .env.' })
      rt.handleChat('again')
      await rec.waitFor((e) => e.kind === 'textDelta')
      await rec.turnsDone(1)
      expect(requests).toHaveLength(2)
    })

    it('429 surfaces "Rate limited, retrying in Ns" and retries', async () => {
      vi.useFakeTimers()
      const limited = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers({ 'retry-after': '2' }))
      const { client, requests } = fakeClient([{ error: limited }, reply('Done.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
      const rec = recorder(rt)
      rt.handleChat('hi')
      await vi.advanceTimersByTimeAsync(10)
      expect(rec.events.find((e) => e.kind === 'error')).toMatchObject({ message: 'Rate limited, retrying in 2s' })
      expect(requests).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(2000)
      await rec.turnsDone(1)
      expect(requests).toHaveLength(2)
      expect(rec.events.some((e) => e.kind === 'textDelta')).toBe(true)
    })

    it('the real client lets the SDK retry 429s with backoff', () => {
      expect(createAnthropicClient({ apiKey: 'test-key' }).maxRetries).toBe(4)
    })

    it('a network error gives a plain message', async () => {
      const { client } = fakeClient([{ error: new Anthropic.APIConnectionError({ message: 'fetch failed' }) }, reply('Back.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
      const rec = recorder(rt)
      rt.handleChat('hi')
      await rec.waitFor((e) => e.kind === 'error')
      expect(rec.events.find((e) => e.kind === 'error')).toMatchObject({ message: "Can't reach the Claude API. Check the network connection." })
      rt.handleChat('again')
      await rec.turnsDone(1)
    })
  })

  it('refusal stop_reason produces a plain error event', async () => {
    const cmd = okTool('cmd_setRackType')
    const { client } = fakeClient([
      {
        content: [text('Sure, I'), toolUse('t1', 'cmd_setRackType', {})],
        stop_reason: 'refusal',
        stop_details: {
          type: 'refusal',
          category: null,
          explanation: null,
          fallback_credit_token: null,
          fallback_has_prefill_claim: null,
          recommended_model: null,
        },
      },
    ])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [cmd], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('do it')
    await rec.turnsDone(1)
    expect(cmd.calls).toHaveLength(0)
    expect(rec.events.find((e) => e.kind === 'error')).toMatchObject({
      message: 'Claude declined this request. Rephrase it, or start a new conversation if it keeps happening.',
    })
  })

  it('history is append-only', async () => {
    vi.useFakeTimers()
    const base = evaluation([check('cooling.rackHeatLimit:g2', 'pass')])
    const { client, requests } = fakeClient([
      { content: [toolUse('t1', 'get_plan', {})], stop_reason: 'tool_use' },
      reply('First answer.'),
      reply('Second answer.'),
      reply('Observation reply.'),
      reply('Third answer.'),
    ])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [okTool('get_plan')], client, dataDir, diff: testDiff })
    const rec = recorder(rt)
    rt.handleChat('one')
    await vi.advanceTimersByTimeAsync(0)
    await rec.turnsDone(1)
    rt.handleChat('two')
    await rec.turnsDone(2)
    rt.handleChange(change(base, evaluation([check('cooling.rackHeatLimit:g2', 'fail')]), 'swap'))
    await vi.advanceTimersByTimeAsync(1600)
    await rec.turnsDone(3)
    rt.handleChat('three')
    await rec.turnsDone(4)

    expect(requests).toHaveLength(5)
    for (let i = 1; i < requests.length; i++) {
      const prev = requests[i - 1]!.messages
      const next = requests[i]!.messages
      expect(next.slice(0, prev.length)).toEqual(prev)
      expect(next.length).toBeGreaterThan(prev.length)
    }
    // chat after an observation restores high effort with an appended system message
    const final = requests[4]!.messages
    expect(final.at(-2)).toEqual({ role: 'system', content: [], output_config: { effort: 'high' } })
  })

  it('a chat message during a running turn queues and runs after it', async () => {
    let open = () => undefined as void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const { client, requests } = fakeClient([{ ...(reply('First.') as Extract<Step, { content: unknown }>), gate }, reply('Second.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('first')
    rt.handleChat('second')
    await new Promise((r) => setTimeout(r, 20))
    expect(requests).toHaveLength(1)
    expect(rec.events.filter((e) => e.kind === 'userMessage')).toHaveLength(2)
    open()
    await rec.turnsDone(2)
    expect(requests).toHaveLength(2)
    const msgs: BetaMessageParam[] = requests[1]!.messages
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[2]).toEqual({ role: 'user', content: 'second' })
  })

  it('resetConversation clears history and thread; importPlan or newPlan emits an info message offering a fresh conversation', async () => {
    const store = fakeStore()
    const { client, requests } = fakeClient([reply('One.'), reply('Two.')])
    const rt = createAgentRuntime({ store, tools: [], client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('one')
    await rec.turnsDone(1)
    expect(rt.threadEvents().length).toBeGreaterThan(0)

    rt.resetConversation()
    expect(rt.threadEvents()).toEqual([])
    rt.handleChat('two')
    await rec.turnsDone(2)
    expect(requests[1]!.messages).toEqual([{ role: 'user', content: 'two' }])

    // newPlan: the plan id changes
    const e = evaluation([])
    store.setPlan({ ...createDefaultPlan(), id: 'another-plan' })
    rt.handleChange(change(e, e, 'New plan'))
    // importPlan: the store replaces the plan
    rt.handleChange({ prev: e, next: e, author: 'user', summary: 'Imported plan', kind: 'replace' })
    const infos = rec.events.flatMap((x) => (x.kind === 'messageStart' && x.trigger === 'observation' && x.severity === 'info' ? [x] : []))
    expect(infos).toHaveLength(2)
    const infoText = rec.events.flatMap((x) => (x.kind === 'textDelta' && x.messageId === infos[0]!.messageId ? [x.text] : [])).join('')
    expect(infoText).toMatch(/new conversation/i)
    expect(requests).toHaveLength(2)
  })

  it('persists the conversation to dataDir/conversation.json after each turn', async () => {
    const first = fakeClient([reply('Saved.')])
    const rt = createAgentRuntime({ store: fakeStore(), tools: [], client: first.client, dataDir })
    const rec = recorder(rt)
    rt.handleChat('remember this')
    await rec.turnsDone(1)
    expect(existsSync(join(dataDir, 'conversation.json'))).toBe(true)

    const second = fakeClient([reply('Still here.')])
    const restarted = createAgentRuntime({ store: fakeStore(), tools: [], client: second.client, dataDir })
    expect(restarted.threadEvents()).toEqual(rt.threadEvents())
    const rec2 = recorder(restarted)
    restarted.handleChat('and now?')
    await rec2.turnsDone(1)
    expect(second.requests[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('a proposal in a tool result emits a proposal event and applyProposal emits its status', async () => {
    const proposal: Proposal = {
      id: 'p1',
      title: 'Liquid-cool rows 3 to 5',
      rationale: 'Air cannot carry 132 kW per rack.',
      commands: [{ type: 'setCoolingMethod', payload: { groupId: 'g2', methodId: 'cooling.dlc-single' } }],
      respectsNotes: ['note-1'],
      violatesNotes: [],
      diff: testDiff(evaluation([]), evaluation([])),
      status: 'open',
      basePlanUpdatedAt: '2026-10-18T10:00:00.000Z',
    }
    const propose = okTool('propose_change', JSON.stringify({ proposal }))
    const { client } = fakeClient([{ content: [toolUse('t1', 'propose_change', {})], stop_reason: 'tool_use' }, reply('Proposed.')])
    const proposals = { apply: vi.fn(() => ({ ...proposal, status: 'applied' as const })), dismiss: vi.fn(() => ({ ...proposal, status: 'dismissed' as const })) }
    const rt = createAgentRuntime({ store: fakeStore(), tools: [propose], client, dataDir, proposals })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.turnsDone(1)
    expect(rec.events).toContainEqual(expect.objectContaining({ kind: 'proposal', proposal }))

    rt.applyProposal('p1')
    expect(proposals.apply).toHaveBeenCalledWith('p1')
    expect(rec.events.at(-1)).toEqual({ kind: 'proposalStatus', proposalId: 'p1', status: 'applied' })
  })
})
