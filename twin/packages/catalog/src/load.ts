import { RulesSchema, type Builtins } from '@twin/schema'
import index from '../data/index.json' with { type: 'json' }
import { parseCatalog } from './validate'

let builtins: Builtins | undefined

function parseIndex(raw: { rules: unknown; entries: readonly unknown[] }): Builtins {
  const { entries, errors } = parseCatalog(raw.entries)
  const rules = RulesSchema.safeParse(raw.rules)
  if (!rules.success) errors.push(...rules.error.issues.map((i) => `rules.${i.path.join('.')}: ${i.message}`))
  if (errors.length > 0 || !rules.success) throw new Error(`The built-in catalog is invalid:\n${errors.join('\n')}`)
  return { entries, rules: rules.data }
}

/**
 * The built-in catalog from data/index.json, schema-checked once and cached.
 * The static JSON import works in Node and in Vite alike. Treat the result as read-only;
 * `snapshotCatalog` copies entries before they go into a plan.
 */
export function loadBuiltins(): Builtins {
  builtins ??= parseIndex(index)
  return builtins
}
