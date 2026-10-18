import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { AGENT_MODEL } from './client'

/** The tokens of one API response, from its `usage` field. `input` is the uncached part of the prompt. */
export interface TokenUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** USD per million tokens. Cache writes are the 5-minute cache (1.25 × input), the only kind the agent uses. */
interface Price {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** Anthropic's list prices (claude-api skill, models table, 2026-10). */
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
}

/** What a response cost. A model missing from the table is priced as the agent's model. */
export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? PRICES[AGENT_MODEL]!
  return (
    (usage.input * price.input + usage.output * price.output + usage.cacheWrite * price.cacheWrite + usage.cacheRead * price.cacheRead) /
    1_000_000
  )
}

const DaySchema = z.object({
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  usd: z.number(),
})
type Day = z.infer<typeof DaySchema>

const SavedUsageSchema = z.object({ version: z.literal(1), days: z.record(z.string(), DaySchema) })

/** The local calendar day, so the daily budget resets at the person's midnight. */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * API spend per day: tokens and USD of every response the agent received, kept in `usage.json` so the daily
 * budget holds across restarts.
 */
export class UsageLedger {
  #days: Record<string, Day> = {}

  constructor(
    private readonly file: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (file && existsSync(file)) this.#load(file)
  }

  /** Adds one response to today and returns what it cost. */
  record(model: string, usage: TokenUsage): number {
    const usd = costUsd(model, usage)
    const key = dayKey(this.now())
    const day = this.#days[key] ?? { requests: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 }
    this.#days[key] = {
      requests: day.requests + 1,
      input: day.input + usage.input,
      output: day.output + usage.output,
      cacheWrite: day.cacheWrite + usage.cacheWrite,
      cacheRead: day.cacheRead + usage.cacheRead,
      usd: day.usd + usd,
    }
    this.#save()
    return usd
  }

  todayUsd(): number {
    return this.#days[dayKey(this.now())]?.usd ?? 0
  }

  #save(): void {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, days: this.#days }))
    renameSync(tmp, this.file)
  }

  #load(file: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return
    }
    const saved = SavedUsageSchema.safeParse(raw)
    if (saved.success) this.#days = saved.data.days
  }
}
