import { createDefaultPlan } from '@twin/catalog'
import { applyCommand } from '@twin/commands'
import { evaluate, makeCatalogIndex } from '@twin/engine'
import { CommandError, type AgentEvent, type Builtins, type ClientMsg, type Plan, type ServerMsg } from '@twin/schema'
import type { Backend, BackendStatus } from './backend'

export const AGENT_NEEDS_SERVER = 'The design agent needs the server. Start it with npm run dev.'

interface Entry {
  plan: Plan
  summary?: string
}

/** Runs commands and evaluation in the browser when the server is unreachable or `?local=1` is set. Chat is disabled. */
export class LocalBackend implements Backend {
  private builtins: Builtins | null = null
  private past: Entry[] = []
  private present: Entry
  private future: Entry[] = []
  private emit: (m: ServerMsg) => void = () => {}
  private readonly loadBuiltins: () => Promise<Builtins>

  constructor(loadBuiltins: () => Promise<Builtins>, initialPlan: Plan = createDefaultPlan()) {
    this.loadBuiltins = loadBuiltins
    this.present = { plan: initialPlan }
  }

  connect(onMsg: (m: ServerMsg) => void, onStatus?: (s: BackendStatus) => void): void {
    this.emit = onMsg
    onStatus?.('connecting')
    this.loadBuiltins().then(
      (builtins) => {
        this.builtins = builtins
        onStatus?.('local')
        this.pushState()
        this.emit({ t: 'thread', events: [this.agentError()] })
      },
      () => onStatus?.('offline'),
    )
  }

  send(m: ClientMsg): void {
    switch (m.t) {
      case 'hello':
        this.pushState()
        return
      case 'command':
        this.runCommand(m.id, m.command)
        return
      case 'undo':
        this.step(this.past, this.future)
        return
      case 'redo':
        this.step(this.future, this.past)
        return
      case 'chat':
      case 'proposal':
        this.emit({ t: 'agent', event: this.agentError() })
        return
      case 'resetChat':
        this.emit({ t: 'thread', events: [this.agentError()] })
        return
      case 'view':
        return
    }
  }

  private runCommand(id: string, command: { type: string; payload: unknown }): void {
    if (!this.builtins) return this.emit({ t: 'commandResult', id, ok: false, error: 'The catalog is still loading' })
    const catalog = makeCatalogIndex([...this.builtins.entries, ...Object.values(this.present.plan.catalog)])
    try {
      const result = applyCommand(this.present.plan, command, catalog)
      this.past.push(this.present)
      this.present = { plan: result.plan, summary: result.summary }
      this.future = []
      this.emit({ t: 'commandResult', id, ok: true })
      this.pushState()
    } catch (error) {
      if (!(error instanceof CommandError)) throw error
      this.emit({ t: 'commandResult', id, ok: false, error: error.message })
    }
  }

  private step(from: Entry[], to: Entry[]): void {
    const next = from.pop()
    if (!next) return
    to.push(this.present)
    this.present = next
    this.pushState()
  }

  private pushState(): void {
    if (!this.builtins) return
    const { plan, summary } = this.present
    this.emit({
      t: 'state',
      plan,
      evaluation: evaluate(plan, this.builtins),
      history: { canUndo: this.past.length > 0, canRedo: this.future.length > 0, last: summary },
    })
  }

  private agentError(): AgentEvent {
    return { kind: 'error', message: AGENT_NEEDS_SERVER }
  }
}
