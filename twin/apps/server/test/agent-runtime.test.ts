import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createDefaultPlan, loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { applyCommand, applyCommands } from '@twin/commands'
import { emptyEvaluation, evaluate, makeCatalogIndex } from '@twin/engine'
import type { AgentEvent, Check, Command, EvalDiff, Evaluation, Plan, Proposal, Status, ViewAction } from '@twin/schema'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicClient, type AnthropicLike, type FinalMessage } from '../src/agent/client'
import type { AgentTool, ToolOutcome } from '../src/agent/tools/index'
import { createAgentRuntime } from '../src/agent/runtime'
import { buildTools, ProposalBook } from '../src/agent/tools/index'
import type { AgentRuntime, PlanStore, StoreChange } from '../src/contracts'

// ---------- scripted fake client ----------

type Step =
  | { content: BetaContentBlock[]; stop_reason: FinalMessage['stop_reason']; stop_details?: BetaRefusalStopDetails; gate?: Promise<void> }
  | { error: Error }
  /** Streams some text, then fails mid-stream. */
  | { partial: string; error: Error }

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
          if ('partial' in step) {
            const fail = Promise.reject(step.error)
            fail.catch(() => undefined)
            return {
              async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
                yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.partial } }
                throw step.error
              },
              finalMessage: () => fail,
            }
          }
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

function tool(name: string, run: (input: unknown) => Promise<ToolOutcome>): AgentTool & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    name,
    description: `The ${name} tool.`,
    inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {} },
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
    // zod's JSON Schema output carries $schema; the API tool definition leaves it out
    expect(params.tools?.map((t) => ('input_schema' in t ? t.input_schema : null))).toEqual([
      { type: 'object', properties: {} },
      { type: 'object', properties: {} },
    ])
    // tool input is small JSON; the API buffers and validates it, so the SDK never meets unparseable input
    expect(params.tools?.some((t) => 'eager_input_streaming' in t)).toBe(false)
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
    // The call line is a plain phrase, never the raw input JSON.
    expect(rec.events.flatMap((e) => (e.kind === 'toolCall' ? [e.summary] : []))).toEqual(['Reading the plan', 'Reading the evaluation'])
    const results = rec.events.filter((e) => e.kind === 'toolResult')
    expect(results).toContainEqual({ kind: 'toolResult', callId: 't2', ok: true, summary: 'get_evaluation done', numbers: [1.32, 1.41] })
  })

  it('annotate view actions from a turn carry that turn\'s messageId, so the thread can show the cloud\'s tag', async () => {
    const viewListeners = new Set<(a: ViewAction) => void>()
    const emitView = (a: ViewAction) => viewListeners.forEach((cb) => cb(a))
    const annotation = { tag: 1, objectIds: ['rack:R3-00'], label: 'Air limit', severity: 'problem' as const }
    const annotate = tool('annotate', async () => {
      emitView({ type: 'annotate', annotation })
      emitView({ type: 'setOverlay', overlay: 'temperature' })
      return { ok: true, content: '{"tag":1}', summary: 'Marked' }
    })
    const step1: Step = { content: [toolUse('t1', 'annotate', {})], stop_reason: 'tool_use' }
    const { client } = fakeClient([step1, reply('See tag 1.')])
    const rt = createAgentRuntime({
      store: fakeStore(),
      tools: [annotate],
      client,
      dataDir,
      views: { subscribe: (cb) => (viewListeners.add(cb), () => viewListeners.delete(cb)) },
    })
    const views: ViewAction[] = []
    rt.onView((a) => views.push(a))
    const rec = recorder(rt)
    rt.handleChat('mark it')
    await rec.turnsDone(1)
    const start = rec.events.find((e) => e.kind === 'messageStart')
    expect(views).toEqual([
      { type: 'annotate', annotation: { ...annotation, messageId: start?.kind === 'messageStart' && start.messageId } },
      { type: 'setOverlay', overlay: 'temperature' },
    ])
    // After the turn has settled, a view action belongs to no message.
    await new Promise((resolve) => setTimeout(resolve, 0))
    emitView({ type: 'annotate', annotation })
    expect(views.at(-1)).toEqual({ type: 'annotate', annotation })
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
      // the agent's own edits (tools, applied proposals) never trigger an observation
      rt.handleChange(change(base, evaluation([check('cooling.rackHeatLimit:g2', 'fail')], 1.6), 'applied proposal', 'agent'))
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

    it('a burst of user edits is diffed without the agent edits made inside the window', async () => {
      vi.useFakeTimers()
      const { client, requests } = fakeClient([reply('Rack heat got worse.'), reply('UPS got worse.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      const a = evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'pass'), check('layout.floorBay:B4-4', 'pass')])
      const b = evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'pass'), check('layout.floorBay:B4-4', 'fail')])
      const c = evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'fail'), check('layout.floorBay:B4-4', 'fail')])
      rt.handleChange(change(base, a, 'user edit 1'))
      await vi.advanceTimersByTimeAsync(300)
      rt.handleChange(change(a, b, 'agent edit', 'agent'))
      await vi.advanceTimersByTimeAsync(300)
      rt.handleChange(change(b, c, 'user edit 2'))
      await vi.advanceTimersByTimeAsync(1600)
      await rec.turnsDone(2)
      const sent = requests.map(lastUserText).join('\n')
      expect(sent).toContain('cooling.rackHeatLimit:g2')
      expect(sent).toContain('power.ups:site')
      expect(sent).not.toContain('layout.floorBay:B4-4')
      expect(sent).not.toContain('agent edit')
    })

    it('edit bursts during a running turn coalesce into one observation after it, diffed from the first to the last', async () => {
      vi.useFakeTimers()
      let open = () => undefined as void
      const gate = new Promise<void>((resolve) => {
        open = resolve
      })
      const { client, requests } = fakeClient([{ ...(reply('Thinking about it.') as Extract<Step, { content: unknown }>), gate }, reply('Both edits made things worse.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      const a = evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'pass')])
      const b = evaluation([check('cooling.rackHeatLimit:g2', 'warn'), check('power.ups:site', 'fail')])
      rt.handleChat('long question')
      await vi.advanceTimersByTimeAsync(10)
      expect(requests).toHaveLength(1)
      // Two separate bursts, each closed by the debounce while the chat turn is still running.
      rt.handleChange(change(base, a, 'burst one'))
      await vi.advanceTimersByTimeAsync(1600)
      rt.handleChange(change(a, b, 'burst two'))
      await vi.advanceTimersByTimeAsync(1600)
      expect(requests).toHaveLength(1)
      open()
      await rec.turnsDone(2)
      await vi.advanceTimersByTimeAsync(3000)
      expect(requests).toHaveLength(2)
      const event = lastUserText(requests[1]!)
      expect(event).toContain('burst one; burst two')
      expect(event).toContain('cooling.rackHeatLimit:g2')
      expect(event).toContain('power.ups:site')
      expect(rec.events.filter((e) => e.kind === 'messageStart').map((e) => e.kind === 'messageStart' && e.trigger)).toEqual(['chat', 'observation'])
    })

    it('a queued observation whose merged edits cancel out is dropped', async () => {
      vi.useFakeTimers()
      let open = () => undefined as void
      const gate = new Promise<void>((resolve) => {
        open = resolve
      })
      const { client, requests } = fakeClient([{ ...(reply('Thinking about it.') as Extract<Step, { content: unknown }>), gate }])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir, diff: testDiff })
      const rec = recorder(rt)
      const worse = evaluation([check('cooling.rackHeatLimit:g2', 'fail'), check('power.ups:site', 'pass')])
      rt.handleChat('long question')
      await vi.advanceTimersByTimeAsync(10)
      rt.handleChange(change(base, worse, 'swap racks'))
      await vi.advanceTimersByTimeAsync(1600)
      rt.handleChange({ ...change(worse, base, 'Undo'), kind: 'undo' })
      await vi.advanceTimersByTimeAsync(1600)
      open()
      await rec.turnsDone(1)
      await vi.advanceTimersByTimeAsync(3000)
      expect(requests).toHaveLength(1)
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
      expect(rec.events.flatMap((e) => (e.kind === 'textDelta' ? [e.text] : [])).join('')).toBe('Done.')
    })

    it('text streamed before a mid-stream failure is never repeated by a retry', async () => {
      const limited = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers({ 'retry-after': '1' }))
      const { client, requests } = fakeClient([{ partial: 'The worst-hour PUE ', error: limited }, reply('Back.')])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
      const rec = recorder(rt)
      rt.handleChat('pue?')
      await rec.turnsDone(1)
      expect(requests).toHaveLength(1)
      const messageId = rec.events.find((e) => e.kind === 'messageStart')?.messageId
      const shown = rec.events.flatMap((e) => (e.kind === 'textDelta' && e.messageId === messageId ? [e.text] : [])).join('')
      expect(shown).toBe('The worst-hour PUE ')
      expect(rec.events).toContainEqual({ kind: 'error', messageId, message: 'Rate limited by the Claude API. Try again in a minute.' })
      expect(rt.threadEvents()).toContainEqual({ kind: 'textDelta', messageId, text: 'The worst-hour PUE ' })
      rt.handleChat('again')
      await rec.turnsDone(2)
      expect(requests).toHaveLength(2)
    })

    it('a missing API key surfaces at once, without calling the API', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', undefined)
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', undefined)
      try {
        const rt = createAgentRuntime({ store: fakeStore(), tools: [], dataDir })
        const rec = recorder(rt)
        rt.handleChat('hi')
        await rec.waitFor((e) => e.kind === 'error')
        expect(rec.events.map((e) => e.kind)).toEqual(['userMessage', 'error'])
        expect(rec.events[1]).toEqual({ kind: 'error', message: 'The agent needs an API key in .env' })
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('an SDK error that is not an API error is reported once, not re-issued', async () => {
      const { client, requests } = fakeClient([{ error: new Anthropic.AnthropicError('Could not resolve authentication method.') }])
      const rt = createAgentRuntime({ store: fakeStore(), tools: [], client, dataDir })
      const rec = recorder(rt)
      rt.handleChat('hi')
      await rec.waitFor((e) => e.kind === 'error')
      await new Promise((r) => setTimeout(r, 20))
      expect(requests).toHaveLength(1)
      expect(rec.events.filter((e) => e.kind === 'error')).toHaveLength(1)
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

  it('tool events become proposal and link events; applyProposal and dismissProposal emit statuses', async () => {
    const proposal: Proposal = {
      id: 'p1',
      title: 'Liquid-cool rows 3 to 5',
      rationale: 'Air cannot carry 132 kW per rack.',
      commands: [{ type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: 'cooling.dlc-single' } }],
      respectsNotes: ['note-1'],
      violatesNotes: [],
      diff: testDiff(evaluation([]), evaluation([])),
      status: 'open',
      basePlanUpdatedAt: '2026-10-18T10:00:00.000Z',
    }
    const propose = tool('propose_change', async () => ({
      ok: true,
      content: '{"proposalId":"p1"}',
      summary: 'Proposed liquid cooling',
      events: [{ kind: 'proposal', proposal }],
    }))
    const brief = tool('generate_simulation_brief', async () => ({
      ok: true,
      content: 'Brief written.',
      summary: 'Wrote the OpenFOAM brief',
      events: [{ kind: 'link', label: 'OpenFOAM brief', href: '/api/brief/file/x-openfoam.md' }],
    }))
    const { client } = fakeClient([
      { content: [toolUse('t1', 'propose_change', {}), toolUse('t2', 'generate_simulation_brief', {})], stop_reason: 'tool_use' },
      reply('Proposed.'),
    ])
    const proposals = {
      apply: vi.fn((id: string) => ({ proposal: { ...proposal, id, status: 'stale' as const }, summary: 'Not applied: row R9 does not exist.' })),
      dismiss: vi.fn((id: string) => ({ ...proposal, id, status: 'dismissed' as const })),
    }
    const rt = createAgentRuntime({ store: fakeStore(), tools: [propose, brief], client, dataDir, proposals })
    const rec = recorder(rt)
    rt.handleChat('fix it')
    await rec.turnsDone(1)
    const messageId = rec.events.find((e) => e.kind === 'messageStart')?.messageId
    expect(rec.events).toContainEqual({ kind: 'proposal', messageId, proposal })
    expect(rec.events).toContainEqual({ kind: 'link', messageId, label: 'OpenFOAM brief', href: '/api/brief/file/x-openfoam.md' })

    rt.applyProposal('p1')
    expect(proposals.apply).toHaveBeenCalledWith('p1')
    expect(rec.events.slice(-2)).toEqual([
      { kind: 'proposalStatus', proposalId: 'p1', status: 'stale' },
      { kind: 'error', message: 'Not applied: row R9 does not exist.' },
    ])
    rt.dismissProposal('p2')
    expect(rec.events.at(-1)).toEqual({ kind: 'proposalStatus', proposalId: 'p2', status: 'dismissed' })
  })
})

// ---------- with the real tools, registry and engine (scripted model) ----------

/** A minimal store over the real registry and engine (the server's store is Task 12). */
function createStore(): PlanStore {
  const builtins = loadBuiltins()
  let plan: Plan = snapshotCatalog(createDefaultPlan(), builtins.entries)
  let evaluation = evaluate(plan, builtins)
  const listeners = new Set<(c: StoreChange) => void>()
  const catalog = () => makeCatalogIndex([...builtins.entries, ...Object.values(plan.catalog)])
  const commit = (next: Plan, author: 'user' | 'agent', summary: string) => {
    const prev = evaluation
    plan = next
    evaluation = evaluate(plan, builtins)
    for (const cb of listeners) cb({ prev, next: evaluation, author, summary, kind: 'command' })
  }
  return {
    state: () => ({ plan, evaluation, history: { canUndo: false, canRedo: false } }),
    dispatch(cmd: Command, author) {
      try {
        const r = applyCommand(plan, cmd, catalog())
        commit(r.plan, author, r.summary)
        return { ok: true, summary: r.summary }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    dispatchAll(cmds: Command[], author) {
      try {
        const r = applyCommands(plan, cmds, catalog())
        commit(r.plan, author, r.summaries.join('; '))
        return { ok: true, summaries: r.summaries }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    undo: () => false,
    redo: () => false,
    replace: () => undefined,
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    builtins: () => builtins,
  }
}

const swap: Command = { type: 'setRackType', payload: { groupId: 'g2', rackTypeId: 'rack.gb300-nvl72' } }

function setup(script: Step[]) {
  const store = createStore()
  const proposals = new ProposalBook(store)
  const tools = buildTools({ store, emitView: () => undefined, proposals, brief: () => '# Brief', dataDir })
  const { client, requests } = fakeClient(script)
  const runtime = createAgentRuntime({ store, tools, client, dataDir, proposals })
  store.onChange((c) => runtime.handleChange(c))
  const events: AgentEvent[] = []
  runtime.onEvent((e) => events.push(e))
  const turnsDone = (n: number) =>
    new Promise<void>((resolve) => {
      const check = () => events.filter((e) => e.kind === 'messageEnd').length >= n && resolve()
      check()
      runtime.onEvent(check)
    })
  return { store, tools, runtime, requests, events, turnsDone }
}

describe('agent runtime with the real tools, registry and engine', () => {
  it('sends every tool without $schema, returns invalid input as is_error, and does not observe its own edits', async () => {
    const { store, tools, runtime, requests, events, turnsDone } = setup([
      { content: [toolUse('t1', 'get_evaluation', { detail: 'summary' }), toolUse('t2', 'cmd_setRackType', { groupId: 5 })], stop_reason: 'tool_use' },
      { content: [toolUse('t3', 'cmd_setRackType', swap.payload)], stop_reason: 'tool_use' },
      reply('Swapped g2 to GB300.'),
    ])
    runtime.handleChat('Swap group g2 to GB300 racks.')
    await turnsDone(1)

    const sent = requests[0]!.tools ?? []
    expect(sent).toHaveLength(tools.length)
    for (const t of sent) {
      expect(t).toMatchObject({ input_schema: { type: 'object' } })
      expect('input_schema' in t && '$schema' in t.input_schema).toBe(false)
    }

    const results = requests[1]!.messages.at(-1)?.content
    expect(Array.isArray(results) && results.map((r) => r.type === 'tool_result' && r.is_error === true)).toEqual([false, true])
    const evalResult = events.find((e) => e.kind === 'toolResult' && e.callId === 't1')
    expect(evalResult).toMatchObject({ ok: true })
    expect(evalResult?.kind === 'toolResult' && evalResult.numbers.length).toBeGreaterThan(0)
    expect(store.state().plan.rackGroups.find((g) => g.id === 'g2')?.rackTypeId).toBe('rack.gb300-nvl72')

    await new Promise((r) => setTimeout(r, 1700))
    expect(requests).toHaveLength(3)
    expect(events.filter((e) => e.kind === 'messageStart')).toHaveLength(1)
  })

  it('the same swap made by the person starts one problem observation turn from the real engine diff', async () => {
    const { store, requests, events, turnsDone } = setup([reply('The GB300 swap overloads the floor bays under rows 3 to 5.')])
    expect(store.dispatch(swap, 'user')).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 1600))
    await turnsDone(1)
    expect(requests).toHaveLength(1)
    const event = requests[0]!.messages.at(-1)?.content
    expect(typeof event === 'string' && event).toMatch(/^<app_event>\nThe person changed the plan: .*gb300[\s\S]*Worsened checks:[\s\S]*is now fail[\s\S]*<\/app_event>$/i)
    expect(events.find((e) => e.kind === 'messageStart')).toMatchObject({ trigger: 'observation', severity: 'problem' })
  })
})
