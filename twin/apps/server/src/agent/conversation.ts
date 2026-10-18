import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { AgentEventSchema, type AgentEvent } from '@twin/schema'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

export type Effort = 'low' | 'high'

/** The top-level effort of every request; per-turn changes are appended as effort-only system messages. */
export const BASE_EFFORT: Effort = 'high'

const isMessageParam = (v: unknown): v is BetaMessageParam => {
  if (typeof v !== 'object' || v === null) return false
  const { role, content } = v as { role?: unknown; content?: unknown }
  return (role === 'user' || role === 'assistant' || role === 'system') && (typeof content === 'string' || Array.isArray(content))
}

const SavedConversationSchema = z.object({
  version: z.literal(1),
  messages: z.array(z.custom<BetaMessageParam>(isMessageParam)),
  thread: z.array(AgentEventSchema),
})

function effortOf(message: BetaMessageParam): Effort | null {
  const effort = message.role === 'system' ? message.output_config?.effort : null
  return effort === 'low' || effort === 'high' ? effort : null
}

/**
 * One persistent conversation: the append-only message history sent to the API, and the
 * thread of agent events the UI replays. Messages are only ever appended, never edited,
 * so the prompt cache and earlier thinking blocks stay valid.
 */
export class Conversation {
  #messages: BetaMessageParam[] = []
  #thread: AgentEvent[] = []

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) this.#load(file)
  }

  messages(): BetaMessageParam[] {
    return [...this.#messages]
  }

  thread(): AgentEvent[] {
    return [...this.#thread]
  }

  append(message: BetaMessageParam): void {
    this.#messages.push(message)
  }

  /** Appends a user turn, preceded by an effort-only system message when the turn needs a different effort. */
  appendUserTurn(content: string, effort: Effort): void {
    if (this.#currentEffort() !== effort) this.append({ role: 'system', content: [], output_config: { effort } })
    this.append({ role: 'user', content })
  }

  /** Adds an event to the replayable thread, folding consecutive text deltas of one message together. */
  record(event: AgentEvent): void {
    const last = this.#thread.at(-1)
    if (event.kind === 'textDelta' && last?.kind === 'textDelta' && last.messageId === event.messageId) {
      this.#thread[this.#thread.length - 1] = { ...last, text: last.text + event.text }
      return
    }
    this.#thread.push(event)
  }

  reset(): void {
    this.#messages = []
    this.#thread = []
    this.save()
  }

  save(): void {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, messages: this.#messages, thread: this.#thread }))
    renameSync(tmp, this.file)
  }

  #currentEffort(): Effort {
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const effort = effortOf(this.#messages[i]!)
      if (effort) return effort
    }
    return BASE_EFFORT
  }

  #load(file: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return
    }
    const saved = SavedConversationSchema.safeParse(raw)
    if (!saved.success) return
    this.#messages = saved.data.messages
    this.#thread = saved.data.thread
  }
}
