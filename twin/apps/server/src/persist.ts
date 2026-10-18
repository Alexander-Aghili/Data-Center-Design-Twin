import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@twin/schema'

const PLAN_FILE = 'plan.json'

export type LoadedPlan = { ok: true; plan: Plan } | { ok: false; problem: string } | null

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Reads `dataDir/plan.json` and checks it with `parse` (which throws on an invalid plan).
 * Returns null when there is no file, and the problem when it cannot be read, is not JSON or fails `parse`.
 */
export function loadPlan(dataDir: string, parse: (value: unknown) => Plan): LoadedPlan {
  let raw: string
  try {
    raw = readFileSync(join(dataDir, PLAN_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { ok: false, problem: message(err) }
  }
  try {
    return { ok: true, plan: parse(JSON.parse(raw)) }
  } catch (err) {
    return { ok: false, problem: message(err) }
  }
}

/** Writes the plan atomically: a temp file, then a rename over `plan.json`. */
function writePlan(dataDir: string, plan: Plan): void {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, PLAN_FILE)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`)
  renameSync(tmp, file)
}

export interface PlanWriter {
  /** Queues a write; bursts within the delay collapse into one write of the latest plan. */
  schedule(plan: Plan): void
  /** Writes a queued plan now; on failure it stays queued and the error is thrown. */
  flush(): void
}

/** `onError` receives write failures from timer-driven writes, so a full disk never crashes the server. */
export function createPlanWriter(dataDir: string, delayMs: number, onError: (err: unknown) => void): PlanWriter {
  let pending: Plan | null = null
  let timer: NodeJS.Timeout | null = null

  function flush(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    writePlan(dataDir, pending)
    pending = null
  }

  function schedule(plan: Plan): void {
    pending = plan
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        flush()
      } catch (err) {
        onError(err)
      }
    }, delayMs)
    timer.unref()
  }

  return { schedule, flush }
}
