import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'

export const AGENT_MODEL = 'claude-opus-5-5'

/**
 * SDK-level retries for 429, 5xx and connection errors, with the SDK's exponential backoff
 * (honouring `retry-after`). The runtime adds its own visible retry on top for 429s that outlast these.
 */
const SDK_MAX_RETRIES = 4

/** The part of a finished message the loop reads. */
export type FinalMessage = Pick<BetaMessage, 'content' | 'stop_reason' | 'stop_details'>

interface MessageStreamLike extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<FinalMessage>
}

/** The slice of `@anthropic-ai/sdk` the agent uses, so tests can inject a scripted fake. */
export interface AnthropicLike {
  beta: { messages: { stream(params: BetaMessageStreamParams): MessageStreamLike } }
}

/** The only host the key goes to. Explicit, so an `ANTHROPIC_BASE_URL` in the shell never redirects it. */
const API_BASE_URL = 'https://api.anthropic.com'

/** Reads `ANTHROPIC_API_KEY` from the environment unless a key is passed. */
export function createAnthropicClient(opts: { apiKey?: string } = {}): Anthropic {
  return new Anthropic({ ...opts, baseURL: API_BASE_URL, maxRetries: SDK_MAX_RETRIES })
}
