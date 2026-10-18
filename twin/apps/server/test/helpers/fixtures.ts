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

/** A registry with one real-shaped command, so server tests do not depend on the full command set. */
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
  ])
}

export const rename = (name: string) => ({ type: 'renamePlan', payload: { name } })
