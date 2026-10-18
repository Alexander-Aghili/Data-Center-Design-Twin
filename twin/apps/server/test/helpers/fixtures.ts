import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBuiltins } from '@twin/catalog'
import { createRegistry, defineCommand } from '@twin/commands'
import type { Builtins } from '@twin/schema'

/** A temporary data directory per test. */
export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'twin-server-'))
}

const builtins = loadBuiltins()

/** The real built-in catalog, loaded once: a persisted plan's references must resolve on reload. */
export function testBuiltins(): Builtins {
  return builtins
}

/** A registry with two real-shaped commands, so server tests do not depend on the full command set. */
export function testRegistry() {
  return createRegistry([
    defineCommand({
      type: 'renamePlan',
      layer: 'plan',
      title: 'Rename plan',
      description: 'Renames the plan. Test registry used by the server tests only.',
      apply(draft, payload) {
        draft.name = payload.name
      },
      summarize(payload) {
        return `Plan renamed to ${payload.name}`
      },
    }),
    // Changes the hourly series (renamePlan leaves them alone).
    defineCommand({
      type: 'setSiteInput',
      layer: 'site',
      title: 'Set site input',
      description: 'Sets the climate. Test registry used by the server tests only.',
      apply(draft, payload) {
        if (payload.field === 'climateId' && typeof payload.value === 'string') draft.site.climateId = payload.value
      },
      summarize(payload) {
        return `Climate set to ${String(payload.value)}`
      },
    }),
  ])
}

export const rename = (name: string) => ({ type: 'renamePlan', payload: { name } })
export const setClimate = (climateId: string) => ({ type: 'setSiteInput', payload: { field: 'climateId', value: climateId } })
