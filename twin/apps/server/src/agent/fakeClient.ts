import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { HEAT_REJECTION, RACK_COOLING, type Check, type CommandPayloads, type CommandType, type ToolInputs } from '@twin/schema'
import type { PlanStore } from '../contracts'
import type { AnthropicLike, FinalMessage } from './client'

/** One reply of the scripted model: what it says, then the tools it calls (none ends the turn). */
interface Reply {
  text: string
  tools?: { name: string; input: object }[]
}

const kw = (watts: number) => `${Math.round(watts / 1000)} kW`

function blocksOf(message: BetaMessageParam | undefined) {
  if (!message) return []
  return typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
}

function textOf(message: BetaMessageParam | undefined): string {
  return blocksOf(message)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n')
}

/** Names of the tools the previous assistant message called. */
function calledTools(messages: BetaMessageParam[]): string[] {
  const assistant = messages.findLast((m) => m.role === 'assistant')
  return blocksOf(assistant).flatMap((b) => (b.type === 'tool_use' ? [b.name] : []))
}

const cmd = <T extends CommandType>(type: T, payload: CommandPayloads[T]) => ({
  name: `cmd_${type}`,
  input: payload,
})

/**
 * After the person puts racks on air cooling that can't carry them: a red revision cloud on those racks
 * and a proposal for direct-to-chip liquid cooling with dry coolers, which respects the notes on heat rejection.
 */
function airLimitReply(store: PlanStore): Reply {
  const { plan, evaluation } = store.state()
  const check = evaluation.checks.find((c) => c.kind === 'cooling.rackHeatLimit' && c.status === 'fail')
  const group = check && plan.rackGroups.find((g) => g.id === check.subject.id)
  if (!check || !group) return { text: 'Noted the change. Nothing here needs a decision from you.' }
  const rackW = evaluation.racks.find((r) => r.groupId === group.id)?.powerW ?? check.value ?? 0
  const notes = plan.notes.filter((n) => n.target === 'decision:cooling.heatRejectionId').map((n) => n.id)
  const proposal: ToolInputs['propose_change'] = {
    title: `Cool the ${group.name.toLowerCase()} with direct-to-chip liquid`,
    rationale: `Air can't carry ${kw(rackW)} per rack. Cold plates take most of the heat to warm water through auto-sized CDUs, and dry coolers reject it without using water.`,
    commands: [
      { type: 'setCoolingMethod', payload: { groupId: group.id, coolingMethodId: RACK_COOLING.DLC_1P } },
      { type: 'setHeatRejection', payload: { heatRejectionId: HEAT_REJECTION.DRY_COOLER } },
    ],
    respectsNotes: notes,
    violatesNotes: [],
  }
  const cloud: ToolInputs['annotate'] = { objectIds: check.subject.objectIds, label: `Air can't carry ${kw(rackW)}`, severity: 'problem' }
  return {
    text: `Air can't carry ${kw(rackW)} per rack in the ${group.name.toLowerCase()}. I marked the racks and propose direct-to-chip liquid cooling.`,
    tools: [
      { name: 'annotate', input: cloud },
      { name: 'propose_change', input: proposal },
    ],
  }
}

/**
 * Rates the floor for its most loaded bay: the smallest whole rating that brings that bay back under the
 * warning threshold, in one command (one undo step), then points the camera at that bay.
 */
function floorReply(store: PlanStore): Reply {
  const warnAt = store.builtins().rules.warnThreshold.value
  const { plan, evaluation } = store.state()
  const bays = evaluation.checks
    .filter((c): c is Check & { value: number } => c.kind === 'layout.floorBay' && c.status !== 'pass' && c.value !== null)
    .sort((a, b) => b.value - a.value)
  const worst = bays[0]
  if (!worst || warnAt === null) return { text: 'Every floor bay carries its load within the warning threshold already.' }
  const ratingKnM2 = Math.ceil(worst.value / warnAt)
  return {
    text: `${bays.length} floor ${bays.length === 1 ? 'bay is' : 'bays are'} over the warning threshold, ${worst.subject.id} most of all. Rating the floor ${ratingKnM2} kN/m² covers them.`,
    tools: [
      cmd('setFloor', { type: plan.hall.floor.type, ratingKnM2 }),
      { name: 'focus', input: { kind: 'bay', id: worst.subject.id, shot: 'row' } satisfies ToolInputs['focus'] },
    ],
  }
}

function briefReply(): Reply {
  const input: ToolInputs['generate_simulation_brief'] = {
    target: 'openfoam',
    agentNotes: 'Check the hot aisle over the liquid-cooled rows at the design dry bulb.',
  }
  return { text: 'Writing the OpenFOAM brief from the current plan.', tools: [{ name: 'generate_simulation_brief', input }] }
}

/** The closing message after the tools ran, read from the plan as it is now. */
function closingReply(store: PlanStore, tools: string[]): Reply {
  if (tools.includes('propose_change')) return { text: 'Preview it to see the CDUs and piping, then apply it if it fits.' }
  if (tools.includes('generate_simulation_brief')) return { text: 'The brief is ready to download.' }
  if (tools.includes('cmd_setFloor')) return { text: 'Every floor bay is back under the warning threshold.' }
  if (tools.includes('get_evaluation')) {
    const { pueWorst } = store.state().evaluation.headline
    return { text: pueWorst === null ? 'The plan has no PUE yet: nothing draws power.' : `PUE at the worst hour is ${pueWorst.toFixed(2)}.` }
  }
  return { text: 'Done.' }
}

function replyTo(store: PlanStore, messages: BetaMessageParam[]): Reply {
  const last = messages.findLast((m) => m.role === 'user')
  if (blocksOf(last).some((b) => b.type === 'tool_result')) return closingReply(store, calledTools(messages))
  const text = textOf(last)
  if (text.includes('<app_event>')) return airLimitReply(store)
  if (/floor/i.test(text)) return floorReply(store)
  if (/brief|simulation|openfoam/i.test(text)) return briefReply()
  return { text: 'Reading the evaluation.', tools: [{ name: 'get_evaluation', input: { detail: 'summary' } }] }
}

/** Waits `ms`, or rejects as the SDK does when `signal` aborts first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      reject(new Anthropic.APIUserAbortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    if (signal?.aborted) aborted()
    else signal?.addEventListener('abort', aborted, { once: true })
  })
}

/**
 * A scripted stand-in for the Claude API, selected with `TWIN_FAKE_AGENT=1` (end-to-end tests and demos
 * without a key). It answers the demo script from the plan store with real tool calls, so everything after
 * the model (tools, proposals, view actions, the thread) runs for real. `chunkMs` paces the streamed words
 * like a real model, so a test can watch a turn while it runs and stop it.
 */
export function createScriptedClient(store: PlanStore, opts: { chunkMs?: number } = {}): AnthropicLike {
  const chunkMs = opts.chunkMs ?? 0
  let calls = 0
  return {
    beta: {
      messages: {
        stream(params, options) {
          const signal = options?.signal
          const reply = replyTo(store, params.messages)
          const content: BetaContentBlock[] = [
            { type: 'text', text: reply.text, citations: null },
            ...(reply.tools ?? []).map((t): BetaContentBlock => ({ type: 'tool_use', id: `toolu_fake_${++calls}`, name: t.name, input: t.input })),
          ]
          const final: FinalMessage = { content, stop_reason: reply.tools?.length ? 'tool_use' : 'end_turn', stop_details: null }
          return {
            async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
              for (const chunk of reply.text.match(/\S+\s*/g) ?? []) {
                if (chunkMs > 0) await pause(chunkMs, signal)
                yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }
              }
            },
            finalMessage: async () => final,
          }
        },
      },
    },
  }
}
