import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry, defineCommand } from '@twin/commands'
import { RulesSchema, type Builtins } from '@twin/schema'

/** A temporary data directory per test. */
export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'twin-server-'))
}

/** Built-ins with the real rules and no entries: the engine evaluates to an empty result quickly. */
export function testBuiltins(): Builtins {
  const rulesPath = new URL('../../../../packages/catalog/data/rules.json', import.meta.url)
  return { entries: [], rules: RulesSchema.parse(JSON.parse(readFileSync(rulesPath, 'utf8'))) }
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
