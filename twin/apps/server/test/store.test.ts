import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StoreChange } from '../src/contracts'
import { loadApiKey } from '../src/env'
import { createPlanStore } from '../src/store'
import { rename, tempDataDir, testBuiltins, testRegistry } from './helpers/fixtures'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeStore(dataDir = tempDataDir()) {
  return createPlanStore({ dataDir, builtins: testBuiltins(), registry: testRegistry() })
}

describe('PlanStore', () => {
  it('starts from the default plan with an evaluation and empty history', () => {
    const store = makeStore()
    const { plan, evaluation, history } = store.state()
    expect(plan.name).toBe('Default hall')
    expect(evaluation.headline).toBeDefined()
    expect(history).toEqual({ canUndo: false, canRedo: false })
  })

  it('dispatch applies a command, records history and notifies listeners', () => {
    const store = makeStore()
    const changes: StoreChange[] = []
    store.onChange((c) => changes.push(c))
    const result = store.dispatch(rename('Hall B'), 'user')
    expect(result).toEqual({ ok: true, summary: 'Plan renamed to Hall B' })
    expect(store.state().plan.name).toBe('Hall B')
    expect(store.state().history).toEqual({ canUndo: true, canRedo: false, last: 'Plan renamed to Hall B' })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ author: 'user', kind: 'command', summary: 'Plan renamed to Hall B' })
  })

  it('a rejected command returns the error and changes nothing', () => {
    const store = makeStore()
    const before = store.state()
    const changes: StoreChange[] = []
    store.onChange((c) => changes.push(c))
    const result = store.dispatch(rename(''), 'agent')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/^payload\.name: /)
    expect(store.state().plan).toBe(before.plan)
    expect(store.state().history.canUndo).toBe(false)
    expect(changes).toHaveLength(0)
  })

  it('an unknown command type is rejected with a plain message', () => {
    const result = makeStore().dispatch({ type: 'launchRocket', payload: {} }, 'user')
    expect(result).toEqual({ ok: false, error: 'Unknown command "launchRocket"' })
  })

  it('dispatchAll is all-or-nothing and makes one history entry', () => {
    const store = makeStore()
    const failed = store.dispatchAll([rename('A'), rename('')], 'agent')
    expect(failed.ok).toBe(false)
    expect(store.state().plan.name).toBe('Default hall')

    const ok = store.dispatchAll([rename('A'), rename('B')], 'agent')
    expect(ok).toEqual({ ok: true, summaries: ['Plan renamed to A', 'Plan renamed to B'] })
    expect(store.state().plan.name).toBe('B')
    expect(store.undo()).toBe(true)
    expect(store.state().plan.name).toBe('Default hall')
    expect(store.state().history.canUndo).toBe(false)
  })

  it('undo and redo move through history and report kind', () => {
    const store = makeStore()
    const kinds: string[] = []
    store.onChange((c) => kinds.push(`${c.kind}:${c.summary}`))
    expect(store.undo()).toBe(false)
    store.dispatch(rename('One'), 'user')
    store.dispatch(rename('Two'), 'user')
    expect(store.undo()).toBe(true)
    expect(store.state().plan.name).toBe('One')
    expect(store.redo()).toBe(true)
    expect(store.state().plan.name).toBe('Two')
    expect(store.redo()).toBe(false)
    expect(kinds).toEqual([
      'command:Plan renamed to One',
      'command:Plan renamed to Two',
      'undo:Plan renamed to Two',
      'redo:Plan renamed to Two',
    ])
  })

  it('replace swaps the plan as one undoable step', () => {
    const store = makeStore()
    const imported = { ...store.state().plan, name: 'Imported hall' }
    store.replace(imported)
    expect(store.state().plan.name).toBe('Imported hall')
    expect(store.state().history.last).toBe('Imported plan "Imported hall"')
    store.undo()
    expect(store.state().plan.name).toBe('Default hall')
  })

  it('onChange returns an unsubscribe function', () => {
    const store = makeStore()
    let calls = 0
    const off = store.onChange(() => calls++)
    off()
    store.dispatch(rename('X'), 'user')
    expect(calls).toBe(0)
  })

  it('persists plan.json debounced by 300 ms', async () => {
    const dataDir = tempDataDir()
    const store = makeStore(dataDir)
    const file = join(dataDir, 'plan.json')
    store.dispatch(rename('First'), 'user')
    store.dispatch(rename('Second'), 'user')
    expect(existsSync(file)).toBe(false)
    await sleep(450)
    expect(JSON.parse(readFileSync(file, 'utf8')).name).toBe('Second')
  })

  it('loads a persisted plan at start', () => {
    const dataDir = tempDataDir()
    const first = makeStore(dataDir)
    first.dispatch(rename('Persisted'), 'user')
    first.flush()
    expect(makeStore(dataDir).state().plan.name).toBe('Persisted')
  })

  it('falls back to the default plan when plan.json is invalid', () => {
    const dataDir = tempDataDir()
    writeFileSync(join(dataDir, 'plan.json'), JSON.stringify({ schemaVersion: 2, name: 'From the future' }))
    expect(makeStore(dataDir).state().plan.name).toBe('Default hall')
    writeFileSync(join(dataDir, 'plan.json'), '{ not json')
    expect(makeStore(dataDir).state().plan.name).toBe('Default hall')
  })
})

describe('loadApiKey', () => {
  it('reports false when the file is missing and no key is set', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      expect(loadApiKey(join(tempDataDir(), 'missing.env'))).toBe(false)
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })

  it('loads the key from the given file and reports true', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const file = join(tempDataDir(), '.env')
    writeFileSync(file, 'ANTHROPIC_API_KEY=test-not-a-real-key\n')
    try {
      expect(loadApiKey(file)).toBe(true)
    } finally {
      delete process.env.ANTHROPIC_API_KEY
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })
})
