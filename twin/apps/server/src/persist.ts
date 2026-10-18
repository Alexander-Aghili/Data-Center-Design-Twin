import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlanSchema, type Plan } from '@twin/schema'

const PLAN_FILE = 'plan.json'

/** Reads `dataDir/plan.json`. Returns null when it is missing, unreadable or not a valid plan. */
export function loadPlan(dataDir: string): Plan | null {
  let raw: string
  try {
    raw = readFileSync(join(dataDir, PLAN_FILE), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = PlanSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
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
  /** Writes a queued plan now. */
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
    const plan = pending
    pending = null
    writePlan(dataDir, plan)
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
