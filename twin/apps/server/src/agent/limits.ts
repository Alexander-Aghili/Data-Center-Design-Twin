/** Caps on what the agent may spend. Every one has an environment variable (see twin/README.md). */
export interface AgentLimits {
  /** USD per local calendar day; at this spend chat and automatic reviews stop until midnight. */
  dailyBudgetUsd: number
  /** Model requests in one turn. */
  maxRequestsPerTurn: number
  /** Tool calls in one turn. */
  maxToolCallsPerTurn: number
  /** USD one turn may spend; checked before each model request. */
  maxTurnUsd: number
  /** Shortest time between two automatic reviews; edits in between wait and merge into the next one. */
  observationGapMs: number
  /** Automatic reviews in any 60 minutes; edits beyond that get no review. */
  observationsPerHour: number
  /** Automatic reviews stop when less than this share of the daily budget is left, keeping it for chat. */
  observationReserve: number
}

/** The product owner's defaults (2026-10-18): about $5 a day, with no single turn above $0.75. */
export const DEFAULT_LIMITS: AgentLimits = {
  dailyBudgetUsd: 5,
  maxRequestsPerTurn: 8,
  maxToolCallsPerTurn: 16,
  maxTurnUsd: 0.75,
  observationGapMs: 120_000,
  observationsPerHour: 10,
  observationReserve: 0.2,
}

const ENV: Record<keyof AgentLimits, { name: string; scale: number; integer: boolean }> = {
  dailyBudgetUsd: { name: 'AGENT_DAILY_BUDGET_USD', scale: 1, integer: false },
  maxRequestsPerTurn: { name: 'AGENT_MAX_REQUESTS_PER_TURN', scale: 1, integer: true },
  maxToolCallsPerTurn: { name: 'AGENT_MAX_TOOL_CALLS_PER_TURN', scale: 1, integer: true },
  maxTurnUsd: { name: 'AGENT_MAX_TURN_USD', scale: 1, integer: false },
  observationGapMs: { name: 'AGENT_REVIEW_MIN_GAP_S', scale: 1000, integer: false },
  observationsPerHour: { name: 'AGENT_REVIEWS_PER_HOUR', scale: 1, integer: true },
  observationReserve: { name: 'AGENT_REVIEW_BUDGET_RESERVE', scale: 1, integer: false },
}

/** The limits with any `AGENT_*` overrides from the environment. A malformed value stops the server with its name. */
export function limitsFromEnv(env: NodeJS.ProcessEnv): AgentLimits {
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(ENV) as (keyof AgentLimits)[]) {
    const { name, scale, integer } = ENV[key]
    const raw = env[name]?.trim()
    if (!raw) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
      throw new Error(`${name} must be a ${integer ? 'whole number' : 'number'} of 0 or more, not "${raw}"`)
    }
    limits[key] = value * scale
  }
  return limits
}
