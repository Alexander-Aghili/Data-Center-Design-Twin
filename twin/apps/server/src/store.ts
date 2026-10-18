import { createDefaultPlan, loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { applyCommands, History, type Registry } from '@twin/commands'
import { evaluate, makeCatalogIndex } from '@twin/engine'
import type { Builtins, Command, Evaluation, Plan } from '@twin/schema'
import type { DispatchAllResult, DispatchResult, PlanStore, StoreChange } from './contracts'
import { createPlanWriter, loadPlan } from './persist'

/** Debounce for writing `dataDir/plan.json`. */
const PERSIST_DELAY_MS = 300

export type CommandApplier = Pick<Registry, 'applyCommands'>

export interface PlanStoreOptions {
  dataDir: string
  /** Defaults to the built-in catalog. */
  builtins?: Builtins
  /** Defaults to the built-in command registry. */
  registry?: CommandApplier
  /** Receives failures that must not crash the server: plan writes and change listeners. */
  onError?: (err: unknown, context: string) => void
}

export interface ServerPlanStore extends PlanStore {
  /** Writes a pending plan to disk now (on shutdown). */
  flush(): void
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createPlanStore(opts: PlanStoreOptions): ServerPlanStore {
  const builtins = opts.builtins ?? loadBuiltins()
  const registry = opts.registry ?? { applyCommands }
  const onError = opts.onError ?? ((err, context) => console.error(context, err))
  const writer = createPlanWriter(opts.dataDir, PERSIST_DELAY_MS, (err) => onError(err, 'Could not write plan.json'))
  const listeners = new Set<(change: StoreChange) => void>()

  const history = new History(loadPlan(opts.dataDir) ?? snapshotCatalog(createDefaultPlan(), builtins.entries))
  let evaluation = evaluate(history.current, builtins)

  const catalogFor = (plan: Plan) => makeCatalogIndex([...builtins.entries, ...Object.values(plan.catalog)])

  function emit(change: StoreChange): void {
    for (const listener of [...listeners]) {
      try {
        listener(change)
      } catch (err) {
        onError(err, 'A plan change listener failed')
      }
    }
  }

  /** Makes `history.current` the live plan and tells listeners. */
  function settle(nextEvaluation: Evaluation, author: StoreChange['author'], summary: string, kind: StoreChange['kind']) {
    const prev = evaluation
    evaluation = nextEvaluation
    writer.schedule(history.current)
    emit({ prev, next: nextEvaluation, author, summary, kind })
  }

  /** Applies commands as one history step; nothing changes if a command or the evaluation throws. */
  function apply(cmds: Command[], author: StoreChange['author']): DispatchAllResult {
    let next: Plan
    let summaries: string[]
    let nextEvaluation: Evaluation
    try {
      ;({ plan: next, summaries } = registry.applyCommands(history.current, cmds, catalogFor(history.current)))
      nextEvaluation = evaluate(next, builtins)
    } catch (err) {
      return { ok: false, error: message(err) }
    }
    const summary = summaries.join('; ')
    history.push(next, summary)
    settle(nextEvaluation, author, summary, 'command')
    return { ok: true, summaries }
  }

  return {
    state() {
      const info = { canUndo: history.canUndo, canRedo: history.canRedo }
      return {
        plan: history.current,
        evaluation,
        history: history.last === undefined ? info : { ...info, last: history.last },
      }
    },

    dispatch(cmd: Command, author): DispatchResult {
      const result = apply([cmd], author)
      return result.ok ? { ok: true, summary: result.summaries[0] ?? '' } : result
    },

    dispatchAll(cmds: Command[], author): DispatchAllResult {
      return cmds.length === 0 ? { ok: true, summaries: [] } : apply(cmds, author)
    },

    undo() {
      const summary = history.last ?? ''
      if (!history.undo()) return false
      settle(evaluate(history.current, builtins), 'user', summary, 'undo')
      return true
    },

    redo() {
      if (!history.redo()) return false
      settle(evaluate(history.current, builtins), 'user', history.last ?? '', 'redo')
      return true
    },

    replace(plan: Plan) {
      const next = { ...plan, updatedAt: new Date().toISOString() }
      const nextEvaluation = evaluate(next, builtins)
      const summary = `Imported plan "${next.name}"`
      history.push(next, summary)
      settle(nextEvaluation, 'user', summary, 'replace')
    },

    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    builtins: () => builtins,

    flush: () => writer.flush(),
  }
}
