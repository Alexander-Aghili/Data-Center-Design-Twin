import type { Plan } from '@twin/schema'

/** Most undo steps kept; older snapshots are dropped. */
const MAX_STEPS = 200

interface Step {
  plan: Plan
  summary: string
}

/**
 * Undo/redo over immutable plan snapshots. Each `push` records the plan it replaces together with
 * the summary of the change, so `last` names the change `undo` would revert.
 */
export class History {
  current: Plan
  private past: Step[] = []
  private future: Step[] = []

  constructor(initial: Plan) {
    this.current = initial
  }

  push(next: Plan, summary: string): void {
    this.past.push({ plan: this.current, summary })
    if (this.past.length > MAX_STEPS) this.past.shift()
    this.future = []
    this.current = next
  }

  undo(): Plan | null {
    const step = this.past.pop()
    if (!step) return null
    this.future.push({ plan: this.current, summary: step.summary })
    this.current = step.plan
    return this.current
  }

  redo(): Plan | null {
    const step = this.future.pop()
    if (!step) return null
    this.past.push({ plan: this.current, summary: step.summary })
    this.current = step.plan
    return this.current
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Summary of the change `undo` would revert. */
  get last(): string | undefined {
    return this.past.at(-1)?.summary
  }
}
