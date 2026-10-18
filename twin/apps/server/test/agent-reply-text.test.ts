import type { BetaContentBlock, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createDefaultPlan } from '@twin/catalog'
import { emptyEvaluation } from '@twin/engine'
import type { AgentEvent } from '@twin/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnthropicLike, FinalMessage } from '../src/agent/client'
import { createAgentRuntime } from '../src/agent/runtime'
import type { AgentTool } from '../src/agent/tools/index'
import type { PlanStore } from '../src/contracts'

// The reply text of a turn must reach the thread whatever shape the stream has: text that arrives only in the
// final message, text carried in content_block_start, a stream cut short of the final text, progress notes.

/** One response: the raw events the stream yields, and the final message the SDK assembles. */
interface Response {
  events: BetaRawMessageStreamEvent[]
  final: BetaContentBlock[]
}

const text = (t: string): BetaContentBlock => ({ type: 'text', text: t, citations: null })
const thinking = (t: string): BetaContentBlock => ({ type: 'thinking', thinking: t, signature: 'sig' })
const toolUse = (id: string): BetaContentBlock => ({ type: 'tool_use', id, name: 'get_evaluation', input: {} })

const start = (index: number, block: BetaContentBlock): BetaRawMessageStreamEvent => ({ type: 'content_block_start', index, content_block: block })
const textDelta = (index: number, t: string): BetaRawMessageStreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })
const thinkingDelta = (index: number, t: string): BetaRawMessageStreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: t, estimated_tokens: null } })
const stop = (index: number): BetaRawMessageStreamEvent => ({ type: 'content_block_stop', index })

/** The usual stream: each block opens empty, its text arrives in deltas. */
function streamed(blocks: BetaContentBlock[]): Response {
  const events = blocks.flatMap((b, i): BetaRawMessageStreamEvent[] => {
    if (b.type === 'text') return [start(i, text('')), textDelta(i, b.text), stop(i)]
    if (b.type === 'thinking') return [start(i, thinking('')), ...(b.thinking ? [thinkingDelta(i, b.thinking)] : []), stop(i)]
    return [start(i, b), stop(i)]
  })
  return { events, final: blocks }
}

function client(responses: Response[]): AnthropicLike {
  return {
    beta: {
      messages: {
        stream() {
          const r = responses.shift()
          if (!r) throw new Error('script exhausted')
          const final: FinalMessage = { content: r.final, stop_reason: r.final.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_details: null }
          return {
            async *[Symbol.asyncIterator]() {
              yield* r.events
            },
            finalMessage: async () => final,
          }
        },
      },
    },
  }
}

const store: PlanStore = {
  state: () => ({ plan: createDefaultPlan(), evaluation: emptyEvaluation(), history: { canUndo: false, canRedo: false } }),
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

const evalTool: AgentTool = {
  name: 'get_evaluation',
  description: 'Reads the evaluation.',
  inputSchema: { type: 'object', properties: {} },
  run: async () => ({ ok: true, content: '{"pueWorst":1.43}', summary: 'Evaluation: 0 failing, 0 warning' }),
}

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-reply-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

/** Runs one chat turn and returns the text the thread shows for it. */
async function threadText(responses: Response[]): Promise<{ shown: string; events: AgentEvent[] }> {
  const rt = createAgentRuntime({ store, tools: [evalTool], client: client(responses), dataDir })
  const events: AgentEvent[] = []
  rt.onEvent((e) => events.push(e))
  rt.handleChat('What is the PUE at the worst hour?')
  await vi.waitFor(() => expect(events.at(-1)?.kind).toBe('messageEnd'))
  const shown = events.flatMap((e) => (e.kind === 'textDelta' ? [e.text] : [])).join('')
  return { shown, events }
}

const ANSWER = 'The worst-hour PUE is 1.43.'

describe('reply text reaches the thread', () => {
  it('the usual shape: tool call, then thinking and text streamed in deltas', async () => {
    const { shown } = await threadText([streamed([toolUse('t1')]), streamed([thinking(''), text(ANSWER)])])
    expect(shown).toBe(ANSWER)
  })

  it('text that arrives only in the final message, with no deltas', async () => {
    const { shown } = await threadText([streamed([toolUse('t1')]), { events: [], final: [thinking(''), text(ANSWER)] }])
    expect(shown).toBe(ANSWER)
  })

  it('text carried in content_block_start, then more in deltas', async () => {
    const final = [text(ANSWER)]
    const events = [start(0, text('The worst-hour ')), textDelta(0, 'PUE is 1.43.'), stop(0)]
    const { shown } = await threadText([streamed([toolUse('t1')]), { events, final }])
    expect(shown).toBe(ANSWER)
  })

  it('a stream that ends before the last of the text', async () => {
    const events = [start(0, text('')), textDelta(0, 'The worst-hour ')]
    const { shown } = await threadText([streamed([toolUse('t1')]), { events, final: [text(ANSWER)] }])
    expect(shown).toBe(ANSWER)
  })

  it('a progress note before the tool call and the answer after it, once each', async () => {
    const note = 'Checking the hourly results first.'
    const { shown, events } = await threadText([streamed([thinking(note), toolUse('t1')]), streamed([thinking(''), text(ANSWER)])])
    expect(shown).toBe(`${note}\n\n${ANSWER}`)
    expect(events.map((e) => e.kind)).toEqual(['userMessage', 'messageStart', 'textDelta', 'toolCall', 'toolResult', 'textDelta', 'messageEnd'])
  })

  it('text written before a tool call in the same response, then the answer', async () => {
    const first = 'Reading the evaluation.'
    const { shown } = await threadText([{ events: [], final: [text(first), toolUse('t1')] }, streamed([text(ANSWER)])])
    expect(shown).toBe(`${first}\n\n${ANSWER}`)
  })
})
