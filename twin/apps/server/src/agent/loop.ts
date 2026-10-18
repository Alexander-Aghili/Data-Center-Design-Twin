import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessageStreamParams,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AgentEvent, Severity } from '@twin/schema'
import type { AnthropicLike, FinalMessage } from './client'
import { BASE_EFFORT, type Conversation } from './conversation'
import { SYSTEM_PROMPT } from './prompt/system'
import { toolResultNumbers, type AgentTool, type ToolOutcome } from './tools/index'

const MAX_TOKENS = 16000
/** Model calls allowed in one turn before the loop gives up, so a confused turn cannot run up cost. */
const MAX_STEPS = 20
/** Visible retries for a 429 that outlasted the SDK's own retries (only before anything streamed). */
const RATE_LIMIT_RETRIES = 2
const BETAS = [
  'server-side-fallback-2026-07-01', // fallbacks: 'default'
  'mid-conversation-output-config-2026-07-01', // per-message effort
  'thinking-display-updates-2026-08-18', // progress notes between tool calls
] as const

const MESSAGES = {
  refusal: 'Claude declined this request. Rephrase it, or start a new conversation if it keeps happening.',
  tooManySteps: `The agent stopped after ${MAX_STEPS} steps in one turn. Ask again to continue.`,
  truncatedInput: 'This tool input was cut off at max_tokens and was not run. Send a shorter input.',
}

/**
 * Tool definitions as sent to the API: fixed order, a cache breakpoint on the last one, and no `$schema`
 * key (zod's JSON Schema output adds it; the API's input_schema has no use for it). Eager input streaming
 * stays off: tool inputs here are short command payloads that the UI never renders while they stream, and
 * buffered input is validated by the API, so the SDK never fails on unparseable JSON and no request has
 * to be re-issued after text was already shown.
 */
export function toolParams(tools: AgentTool[]): BetaTool[] {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...withoutSchemaKey(t.inputSchema), type: 'object' as const },
    ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}

function withoutSchemaKey(schema: object): object {
  const { $schema: _, ...rest } = schema as { $schema?: unknown }
  return rest
}

function request(model: string, tools: BetaTool[], conversation: Conversation): BetaMessageStreamParams {
  return {
    model,
    max_tokens: MAX_TOKENS,
    betas: [...BETAS],
    fallbacks: 'default',
    thinking: { type: 'adaptive', display: 'updates' },
    output_config: { effort: BASE_EFFORT },
    cache_control: { type: 'ephemeral' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: conversation.messages(),
  }
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A plain-language message for an API or runtime failure. */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Claude API rejected the key. Check .env.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'The API key in .env has no access to this model. Check its workspace in the Claude Console.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API. Try again in a minute.'
  if (err instanceof Anthropic.APIConnectionError) return "Can't reach the Claude API. Check the network connection."
  if (err instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${err.message}`
  if (err instanceof Anthropic.APIError) {
    return err.status !== undefined && err.status >= 500
      ? 'The Claude API is having trouble right now. Try again shortly.'
      : `The Claude API returned an error (${err.status ?? 'no status'}).`
  }
  return `The agent stopped on an error: ${errorText(err)}`
}

function retryAfterSeconds(err: InstanceType<typeof Anthropic.RateLimitError>, attempt: number): number {
  const header = Number(err.headers?.get('retry-after'))
  const seconds = Number.isFinite(header) && header > 0 ? header : 10 * 2 ** attempt
  return Math.min(60, Math.max(1, Math.ceil(seconds)))
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The content blocks to keep in history. After a mid-output server-side fallback, thinking and
 * tool-use blocks before the last `fallback` boundary belong to the declined attempt and are dropped.
 */
function echoable(content: BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.findLastIndex((b) => b.type === 'fallback')
  if (boundary < 0) return content
  const declined = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'])
  return content.filter((b, i) => i >= boundary || !declined.has(b.type))
}

/** What a running tool call is doing, in words; the result line then says what it found. */
const CALL_LABELS: Record<string, string> = {
  get_plan: 'Reading the plan',
  get_evaluation: 'Reading the evaluation',
  explain_check: 'Tracing the cause of a check',
  get_hourly: 'Reading hourly results',
  list_catalog: 'Searching the catalog',
  get_catalog_entry: 'Reading a catalog entry',
  get_notes: 'Reading the notes',
  search_knowledge: 'Searching the knowledge base',
  read_knowledge: 'Reading a knowledge article',
  undo: 'Undoing the last change',
  redo: 'Redoing the last change',
  propose_change: 'Drafting a proposal',
  what_if: 'Trying a change',
  set_layer: 'Switching the layer',
  focus: 'Moving the camera',
  set_overlay: 'Switching the overlay',
  annotate: 'Marking the drawing',
  clear_annotations: 'Clearing the marks',
  generate_simulation_brief: 'Writing the simulation brief',
  export_plan: 'Exporting the plan',
}

/** "cmd_setRackType" → "Set rack type"; other tools use their label. */
function callSummary(name: string): string {
  const label = CALL_LABELS[name]
  if (label) return label
  const words = name.replace(/^cmd_/, '').replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').toLowerCase().trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface TurnContext {
  client: AnthropicLike
  model: string
  tools: AgentTool[]
  toolParams: BetaTool[]
  conversation: Conversation
  messageId: string
  trigger: 'chat' | 'observation'
  severity: Severity
  emit: (e: AgentEvent) => void
}

/** Streams one assistant message into thread events; it opens only once there is something to show. */
class TurnOutput {
  #started = false
  #wroteText = false
  #lastIndex = -1
  #streamedThisRequest = false

  constructor(private readonly ctx: TurnContext) {}

  get messageId(): string | undefined {
    return this.#started ? this.ctx.messageId : undefined
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    this.ctx.emit({ kind: 'messageStart', messageId: this.ctx.messageId, trigger: this.ctx.trigger, severity: this.ctx.severity })
  }

  newRequest(): void {
    this.#lastIndex = -1
    this.#streamedThisRequest = false
  }

  /** A request that already showed text cannot be retried without repeating that text. */
  get streamedThisRequest(): boolean {
    return this.#streamedThisRequest
  }

  text(index: number, text: string): void {
    if (!text) return
    this.start()
    const separated = this.#wroteText && index !== this.#lastIndex ? `\n\n${text}` : text
    this.#lastIndex = index
    this.#wroteText = true
    this.#streamedThisRequest = true
    this.ctx.emit({ kind: 'textDelta', messageId: this.ctx.messageId, text: separated })
  }

  error(message: string): void {
    const messageId = this.messageId
    this.ctx.emit({ kind: 'error', ...(messageId ? { messageId } : {}), message })
  }

  end(): void {
    if (this.#started) this.ctx.emit({ kind: 'messageEnd', messageId: this.ctx.messageId })
  }
}

async function callModel(ctx: TurnContext, out: TurnOutput): Promise<FinalMessage> {
  let rateLimited = 0
  for (;;) {
    out.newRequest()
    try {
      const stream = ctx.client.beta.messages.stream(request(ctx.model, ctx.toolParams, ctx.conversation))
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue
        // With display "updates", a non-empty thinking block is a progress note between tool calls.
        if (event.delta.type === 'text_delta') out.text(event.index, event.delta.text)
        else if (event.delta.type === 'thinking_delta') out.text(event.index, event.delta.thinking)
      }
      return await stream.finalMessage()
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError && rateLimited < RATE_LIMIT_RETRIES && !out.streamedThisRequest) {
        const seconds = retryAfterSeconds(err, rateLimited++)
        out.error(`Rate limited, retrying in ${seconds}s`)
        await sleep(seconds * 1000)
        continue
      }
      throw err
    }
  }
}

async function runTool(ctx: TurnContext, out: TurnOutput, block: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
  out.start()
  ctx.emit({ kind: 'toolCall', messageId: ctx.messageId, callId: block.id, name: block.name, summary: callSummary(block.name) })
  const tool = ctx.tools.find((t) => t.name === block.name)
  let outcome: ToolOutcome
  try {
    outcome = tool ? await tool.run(block.input) : { ok: false, error: `Unknown tool "${block.name}".` }
  } catch (err) {
    outcome = { ok: false, error: errorText(err) }
  }
  if (!outcome.ok) {
    ctx.emit({ kind: 'toolResult', callId: block.id, ok: false, summary: outcome.error, numbers: [] })
    return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: outcome.error }
  }
  ctx.emit({ kind: 'toolResult', callId: block.id, ok: true, summary: outcome.summary, numbers: toolResultNumbers(outcome.content) })
  for (const e of outcome.events ?? []) ctx.emit({ ...e, messageId: ctx.messageId })
  return { type: 'tool_result', tool_use_id: block.id, content: outcome.content }
}

/**
 * Runs one agent turn: stream a reply, run every requested tool, send all results back in one
 * user message, and repeat until the model stops asking for tools. History is append-only.
 */
export async function runTurn(ctx: TurnContext): Promise<void> {
  const out = new TurnOutput(ctx)
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await callModel(ctx, out)
      // A refusal can cut a tool call off mid-input: never run its tools, and keep the partial out of history.
      if (message.stop_reason === 'refusal') return out.error(MESSAGES.refusal)
      const content = echoable(message.content)
      ctx.conversation.append({ role: 'assistant', content })
      const toolUses = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
      if (toolUses.length === 0) return
      const truncated = message.stop_reason === 'max_tokens'
      const results = await Promise.all(
        toolUses.map(
          (b): Promise<BetaToolResultBlockParam> =>
            truncated
              ? Promise.resolve({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: MESSAGES.truncatedInput })
              : runTool(ctx, out, b),
        ),
      )
      ctx.conversation.append({ role: 'user', content: results })
    }
    out.error(MESSAGES.tooManySteps)
  } catch (err) {
    out.error(describeError(err))
  } finally {
    out.end()
  }
}
