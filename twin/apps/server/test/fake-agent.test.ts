import { HEAT_REJECTION, RACK, RACK_COOLING, type AgentEvent, type ViewAction } from '@twin/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateBrief } from '../src/brief/openfoam'
import { createScriptedClient } from '../src/agent/fakeClient'
import { createAgentRuntime } from '../src/agent/runtime'
import { buildTools, ProposalBook } from '../src/agent/tools/index'
import type { AgentRuntime } from '../src/contracts'
import { createPlanStore, type ServerPlanStore } from '../src/store'

// The scripted client behind TWIN_FAKE_AGENT=1, run through the real runtime, tools, store and engine.

let dataDir: string
let store: ServerPlanStore
let runtime: AgentRuntime
let events: AgentEvent[]
let views: ViewAction[]

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'fake-agent-'))
  store = createPlanStore({ dataDir })
  const listeners = new Set<(a: ViewAction) => void>()
  const proposals = new ProposalBook(store)
  const tools = buildTools({ store, emitView: (a) => listeners.forEach((cb) => cb(a)), proposals, brief: generateBrief, dataDir })
  const viewSource = {
    subscribe(cb: (a: ViewAction) => void) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
  }
  runtime = createAgentRuntime({ store, tools, dataDir, proposals, views: viewSource, client: createScriptedClient(store) })
  store.onChange((c) => runtime.handleChange(c))
  events = []
  views = []
  runtime.onEvent((e) => events.push(e))
  runtime.onView((a) => views.push(a))
})

afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

/** Resolves with the id of the next message that ends. */
function nextMessageEnd(ms = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no message ended within ${ms} ms: ${JSON.stringify(events)}`)), ms)
    const off = runtime.onEvent((e) => {
      if (e.kind !== 'messageEnd') return
      clearTimeout(timer)
      off()
      resolve(e.messageId)
    })
  })
}

const textOf = (messageId: string) =>
  events.flatMap((e) => (e.kind === 'textDelta' && e.messageId === messageId ? [e.text] : [])).join('')

const errors = () => events.filter((e) => e.kind === 'error')

describe('scripted fake client', () => {
  it('flags the GB300 swap with a problem message and proposes liquid cooling that respects the water note', { timeout: 15_000 }, async () => {
    const ended = nextMessageEnd()
    store.dispatch({ type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } }, 'user')
    const id = await ended

    expect(events.find((e) => e.kind === 'messageStart' && e.messageId === id)).toMatchObject({ trigger: 'observation', severity: 'problem' })
    expect(textOf(id)).toMatch(/air can.t carry 132 kW per rack/i)
    const proposal = events.flatMap((e) => (e.kind === 'proposal' ? [e.proposal] : []))[0]
    expect(proposal?.commands).toEqual([
      { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P } },
      { type: 'setHeatRejection', payload: { heatRejectionId: HEAT_REJECTION.DRY_COOLER } },
    ])
    expect(proposal?.respectsNotes).toEqual(['note-1'])
    expect(views).toContainEqual({
      type: 'annotate',
      annotation: expect.objectContaining({ tag: 1, severity: 'problem', objectIds: expect.arrayContaining(['rack:R3-00', 'rack:R5-15']) }),
    })
    expect(errors()).toEqual([])
  })

  it('rates the floor so every bay is under the warning threshold, in one undo step, and focuses the worst bay', { timeout: 15_000 }, async () => {
    store.dispatchAll(
      [
        { type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } },
        { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P } },
      ],
      'agent',
    )
    const floorIssues = () => store.state().evaluation.checks.filter((c) => c.kind === 'layout.floorBay' && c.status !== 'pass')
    expect(floorIssues().length).toBeGreaterThan(0)

    const ended = nextMessageEnd()
    runtime.handleChat('Fix the floor')
    const id = await ended

    expect(floorIssues()).toEqual([])
    expect(views).toContainEqual({ type: 'focus', target: { kind: 'bay', id: 'B4-4' }, shot: 'row' })
    expect(textOf(id)).toMatch(/B4-4/)
    expect(store.undo()).toBe(true)
    expect(floorIssues().length).toBeGreaterThan(0)
    expect(errors()).toEqual([])
  })

  it('writes the OpenFOAM brief and links it', { timeout: 15_000 }, async () => {
    const ended = nextMessageEnd()
    runtime.handleChat('Write the simulation brief')
    await ended
    expect(events).toContainEqual(expect.objectContaining({ kind: 'link', label: 'OpenFOAM simulation brief' }))
    expect(errors()).toEqual([])
  })

  it('answers other questions from get_evaluation', { timeout: 15_000 }, async () => {
    const ended = nextMessageEnd()
    runtime.handleChat('What is the PUE at the worst hour?')
    const id = await ended
    const { pueWorst } = store.state().evaluation.headline
    expect(textOf(id)).toContain(pueWorst === null ? 'no PUE' : pueWorst.toFixed(2))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'toolCall', name: 'get_evaluation' }))
  })

  it('stays quiet on an observation it has no script for', { timeout: 15_000 }, async () => {
    const ended = nextMessageEnd()
    store.dispatch({ type: 'setSiteInput', payload: { field: 'gridCapacityW', value: 1_000_000 } }, 'user')
    const id = await ended
    expect(events.filter((e) => e.kind === 'toolCall')).toEqual([])
    expect(textOf(id)).not.toBe('')
  })

  it('paces its words when given a delay, and stops when aborted (TWIN_FAKE_AGENT_CHUNK_MS, for the Stop end-to-end test)', async () => {
    const client = createScriptedClient(store, { chunkMs: 20 })
    const abort = new AbortController()
    const stream = client.beta.messages.stream(
      { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'What is the PUE?' }] },
      { signal: abort.signal },
    )
    const started = Date.now()
    const words: string[] = []
    await expect(
      (async () => {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') words.push(event.delta.text)
          if (words.length === 2) abort.abort()
        }
      })(),
    ).rejects.toThrow(/abort/i)
    expect(words).toEqual(['Reading ', 'the '])
    expect(Date.now() - started).toBeGreaterThanOrEqual(30)
  })
})
