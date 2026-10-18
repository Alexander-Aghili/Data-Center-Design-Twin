/**
 * Live behavior evals for the design agent's system prompt. Each scenario drives the real runtime, tools,
 * registry and engine against the Claude API on a fresh default plan, then asserts on the tool calls, view
 * actions and text. Runs only with RUN_LIVE_AGENT=1 and a key in the repo-root .env, and prints its spend.
 */
import { diffEvaluations } from '@twin/engine'
import { HEAT_REJECTION, RACK, RACK_COOLING, type AgentEvent, type Command, type Proposal, type ViewAction } from '@twin/schema'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AGENT_MODEL, createAnthropicClient, type AnthropicLike } from '../src/agent/client'
import { Conversation } from '../src/agent/conversation'
import { DEFAULT_LIMITS } from '../src/agent/limits'
import { runTurn, toolParams } from '../src/agent/loop'
import { TurnMeter } from '../src/agent/meter'
import { formatAppEvent } from '../src/agent/observe'
import { createAgentRuntime } from '../src/agent/runtime'
import { buildTools, ProposalBook, type AgentTool } from '../src/agent/tools/index'
import { UsageLedger } from '../src/agent/usage'
import { generateBrief } from '../src/brief/openfoam'
import type { PlanStore } from '../src/contracts'
import { createPlanStore } from '../src/store'

const ENV_FILE = '/Users/linushabetha/Data-Center-Design-Twin/.env'
const LIVE = process.env.RUN_LIVE_AGENT === '1' && existsSync(ENV_FILE)

/** Transcripts and spend also go to this file when set (vitest hides the console output of passing tests). */
const LOG_FILE = process.env.AGENT_EVAL_LOG
const log = (line: string) => {
  console.log(line)
  if (LOG_FILE) appendFileSync(LOG_FILE, `${line}\n`)
}

const TURN_TIMEOUT_MS = 180_000
/** Longer than the runtime's 1.5 s observation debounce plus a model round trip. */
const QUIET_WAIT_MS = 15_000

const LIQUID_METHODS: string[] = [RACK_COOLING.DLC_1P, RACK_COOLING.DLC_2P, RACK_COOLING.IMMERSION_1P, RACK_COOLING.IMMERSION_2P]
const TRAINING_ROWS = ['R3', 'R4', 'R5']
const WATER_NOTE = 'note-1'

const SWAP_TO_GB300: Command = { type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } }
const TRAINING_TO_DLC: Command = { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P } }
const RENAME: Command = { type: 'renameRackGroup', payload: { groupId: 'g1', name: 'Inference A' } }

// claude-opus-5-5 prices in USD per million tokens (claude-api skill, cached 2026-10-06).
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }
const spend = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
const spendUsd = () =>
  (spend.input * PRICE.input + spend.output * PRICE.output + spend.cacheWrite * PRICE.cacheWrite + spend.cacheRead * PRICE.cacheRead) / 1e6

/** The real SDK client, with each finished message's usage added to `spend`. */
function meteredClient(): AnthropicLike {
  const client = createAnthropicClient()
  return {
    beta: {
      messages: {
        stream(params, options) {
          const stream = client.beta.messages.stream(params, options)
          stream.on('finalMessage', ({ usage }) => {
            spend.input += usage.input_tokens
            spend.output += usage.output_tokens
            spend.cacheWrite += usage.cache_creation_input_tokens ?? 0
            spend.cacheRead += usage.cache_read_input_tokens ?? 0
          })
          return stream
        },
      },
    },
  }
}

interface Session {
  store: PlanStore
  tools: AgentTool[]
  events: AgentEvent[]
  views: ViewAction[]
  /** Sends a chat message and resolves when the agent's reply has ended. */
  chat(text: string): Promise<void>
  /** Applies a command as the person, then waits for an observation turn to end (or `quietMs` without one). */
  edit(cmd: Command, quietMs?: number): Promise<void>
}

/** A fresh agent on the default plan, with `setup` applied before the agent starts watching. */
function startSession(setup: Command[] = []): Session {
  const dataDir = mkdtempSync(join(tmpdir(), 'twin-eval-'))
  const store = createPlanStore({ dataDir })
  for (const cmd of setup) {
    const r = store.dispatch(cmd, 'user')
    if (!r.ok) throw new Error(`setup ${cmd.type}: ${r.error}`)
  }
  const views: ViewAction[] = []
  const events: AgentEvent[] = []
  const proposals = new ProposalBook(store)
  const tools = buildTools({ store, emitView: (a) => views.push(a), proposals, brief: generateBrief, dataDir })
  const runtime = createAgentRuntime({ store, tools, client: meteredClient(), model: AGENT_MODEL, proposals })
  store.onChange((c) => runtime.handleChange(c))
  runtime.onEvent((e) => events.push(e))

  /** Resolves on the first messageEnd or final error after `from`, or after `quietMs` if nothing happened. */
  const turnEnd = (from: number, quietMs?: number) =>
    new Promise<void>((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const turn = events.slice(from)
        const ended = turn.some((e) => e.kind === 'messageEnd' || (e.kind === 'error' && !e.message.startsWith('Rate limited')))
        if (ended || (quietMs !== undefined && turn.length === 0 && Date.now() - started > quietMs)) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > TURN_TIMEOUT_MS) {
          clearInterval(timer)
          reject(new Error(`turn did not end within ${TURN_TIMEOUT_MS} ms`))
        }
      }, 200)
    })

  return {
    store,
    tools,
    events,
    views,
    async chat(text) {
      const from = events.length
      runtime.handleChat(text)
      await turnEnd(from)
    },
    async edit(cmd, quietMs) {
      const from = events.length
      const r = store.dispatch(cmd, 'user')
      if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`)
      await turnEnd(from, quietMs)
    },
  }
}

const textOf = (events: AgentEvent[]) => events.flatMap((e) => (e.kind === 'textDelta' ? [e.text] : [])).join('')
const toolNames = (events: AgentEvent[]) => events.flatMap((e) => (e.kind === 'toolCall' ? [e.name] : []))
const proposalsOf = (events: AgentEvent[]): Proposal[] => events.flatMap((e) => (e.kind === 'proposal' ? [e.proposal] : []))
const errorsOf = (events: AgentEvent[]) => events.flatMap((e) => (e.kind === 'error' ? [e.message] : []))
const payloadOf = (cmd: Command) => cmd.payload as Record<string, unknown>

/** Logs the thread's tool calls and text, so a failing run can be read, and returns the text. */
function transcript(name: string, events: AgentEvent[]): string {
  const text = textOf(events)
  log(`--- ${name}\ntools: ${toolNames(events).join(', ') || '(none)'}\n${text || '(no text)'}\n`)
  return text
}

/** Style rules from the system prompt that a string check can catch. */
function expectHouseStyle(text: string): void {
  expect(text).not.toMatch(/[—!]/)
  expect(text).not.toMatch(/\b(great question|certainly|i apologi[sz]e|sorry|let me know|hope this helps|happy to)\b/i)
}

describe.skipIf(!LIVE)('design agent behavior (live)', () => {
  if (LIVE) process.loadEnvFile(ENV_FILE)

  afterAll(() => {
    log(
      `agent evals spend: $${spendUsd().toFixed(2)} (input ${spend.input}, output ${spend.output}, cache write ${spend.cacheWrite}, cache read ${spend.cacheRead})`,
    )
  })

  it('swap to GB300: one problem message and a liquid-cooling proposal that respects the water note', async () => {
    const s = startSession()
    await s.edit(SWAP_TO_GB300)
    const text = transcript('swap to GB300', s.events)

    expect(errorsOf(s.events)).toEqual([])
    const starts = s.events.filter((e) => e.kind === 'messageStart')
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ trigger: 'observation', severity: 'problem' })
    expect(text).toMatch(/air/i)
    expect(text).toMatch(/\d\s?kW/)
    expectHouseStyle(text)

    // A proposal, never a direct change: the person's racks are still air cooled.
    expect(toolNames(s.events).filter((n) => n.startsWith('cmd_'))).toEqual([])
    expect(s.store.state().plan.rackGroups.find((g) => g.id === 'g2')?.coolingMethodId).toBe(RACK_COOLING.AIR_CONTAINED)

    const [proposal] = proposalsOf(s.events)
    expect(proposal).toBeDefined()
    const method = proposal!.commands.find((c) => c.type === 'setCoolingMethod' && payloadOf(c).groupId === 'g2')
    expect(LIQUID_METHODS).toContain(method && payloadOf(method).coolingMethodId)
    const tower = proposal!.commands.some((c) => c.type === 'setHeatRejection' && payloadOf(c).heatRejectionId === HEAT_REJECTION.COOLING_TOWER)
    expect(tower).toBe(false)
    expect(proposal!.respectsNotes).toContain(WATER_NOTE)
    expect(proposal!.violatesNotes).not.toContain(WATER_NOTE)

    // The problem racks carry a revision cloud.
    expect(s.views.some((v) => v.type === 'annotate')).toBe(true)
  }, TURN_TIMEOUT_MS + 30_000)

  it('user asks "make rows 3–5 liquid cooled": applies commands directly, no proposal', async () => {
    const s = startSession([SWAP_TO_GB300])
    await s.chat('Make rows 3–5 liquid cooled.')
    const text = transcript('make rows 3–5 liquid cooled', s.events)

    expect(errorsOf(s.events)).toEqual([])
    // The request itself is applied, not proposed. A proposal for a new problem the change caused is fine.
    expect(toolNames(s.events)).toContain('cmd_setCoolingMethod')
    const coolingProposals = proposalsOf(s.events).filter((p) => p.commands.some((c) => c.type === 'setCoolingMethod'))
    expect(coolingProposals).toEqual([])
    const { plan } = s.store.state()
    const inRows = plan.placements.filter((p) => TRAINING_ROWS.includes(p.rowId))
    expect(inRows.length).toBeGreaterThan(0)
    for (const p of inRows) expect(LIQUID_METHODS).toContain(plan.rackGroups.find((g) => g.id === p.groupId)?.coolingMethodId)
    expect(text.length).toBeGreaterThan(0)
    expectHouseStyle(text)
  }, TURN_TIMEOUT_MS + 30_000)

  it('asks a number not in tools: says it does not have it', async () => {
    const s = startSession()
    await s.chat('What will this hall cost us in electricity per year?')
    const text = transcript('electricity cost', s.events)

    expect(errorsOf(s.events)).toEqual([])
    expect(text).toMatch(/(don't|do not|doesn't|does not) (have|model|include|know|carry|hold)|no (electricity )?(price|tariff|rate)|isn't (in|modeled)|not modeled/i)
    // No dollar figure for a tariff the plan does not contain.
    expect(text).not.toMatch(/\$\s?\d|\d[\d,.]*\s?(USD|dollars)\b/i)
    expectHouseStyle(text)
  }, TURN_TIMEOUT_MS + 30_000)

  it('asks to show the worst floor bay: focus and annotate on that bay', async () => {
    const s = startSession([SWAP_TO_GB300, TRAINING_TO_DLC])
    const bays = s.store.state().evaluation.checks.filter((c) => c.kind === 'layout.floorBay')
    const worstUtilization = Math.max(...bays.map((c) => c.utilization ?? 0))
    const worstIds = bays.filter((c) => c.utilization === worstUtilization).map((c) => c.subject.id)
    await s.chat('Show me the worst floor bay.')
    const text = transcript('worst floor bay', s.events)

    expect(errorsOf(s.events)).toEqual([])
    const focus = s.views.find((v): v is Extract<ViewAction, { type: 'focus' }> => v.type === 'focus')
    expect(focus?.target.kind).toBe('bay')
    expect(worstIds).toContain(focus?.target.id)
    const cloud = s.views.find((v): v is Extract<ViewAction, { type: 'annotate' }> => v.type === 'annotate')
    expect(cloud?.annotation.objectIds.length).toBeGreaterThan(0)
    expect(text).toMatch(/\d\s?(%|kN)/)
    expectHouseStyle(text)
  }, TURN_TIMEOUT_MS + 30_000)

  it('asks for a simulation brief: calls generate_simulation_brief', async () => {
    const s = startSession()
    await s.chat('I want to check the air side properly in CFD. Write me a simulation brief.')
    const text = transcript('simulation brief', s.events)

    expect(errorsOf(s.events)).toEqual([])
    expect(toolNames(s.events)).toContain('generate_simulation_brief')
    expect(s.events.some((e) => e.kind === 'link')).toBe(true)
    expectHouseStyle(text)
  }, TURN_TIMEOUT_MS + 30_000)

  it('quiet on a harmless rename', async () => {
    const s = startSession()
    await s.edit(RENAME, QUIET_WAIT_MS)
    expect(s.events).toEqual([])
  }, TURN_TIMEOUT_MS)

  it('quiet on a harmless rename even when the model sees the app event', async () => {
    // The runtime filters harmless edits before the model sees them. This checks the prompt's own judgment:
    // the observation turn the runtime would run, built from the rename's real evaluation diff.
    const s = startSession()
    const prev = s.store.state().evaluation
    const r = s.store.dispatch(RENAME, 'user')
    if (!r.ok) throw new Error(r.error)
    const conversation = new Conversation(null)
    conversation.appendUserTurn(formatAppEvent(diffEvaluations(prev, s.store.state().evaluation), [r.summary]), 'low')
    const events: AgentEvent[] = []
    await runTurn({
      client: meteredClient(),
      model: AGENT_MODEL,
      tools: s.tools,
      toolParams: toolParams(s.tools),
      conversation,
      messageId: randomUUID(),
      trigger: 'observation',
      severity: 'info',
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      meter: new TurnMeter({ model: AGENT_MODEL, limits: DEFAULT_LIMITS, ledger: new UsageLedger(null), onChange: () => {} }),
    })
    transcript('rename app event', events)
    expect(textOf(events)).toBe('')
    expect(errorsOf(events)).toEqual([])
    expect(toolNames(events).filter((n) => n.startsWith('cmd_') || n === 'propose_change' || n === 'annotate')).toEqual([])
  }, TURN_TIMEOUT_MS)
})
