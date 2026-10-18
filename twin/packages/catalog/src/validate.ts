import { CatalogEntrySchema, type CatalogEntry, type CatalogKind } from '@twin/schema'

export interface CatalogValidation {
  ok: boolean
  errors: string[]
}

export interface ValidateOptions {
  /** Knowledge-base slugs (the server's KNOWLEDGE_SLUGS). Without it, `risks` are not checked. */
  knowledgeSlugs?: readonly string[]
}

interface ParsedCatalog {
  entries: CatalogEntry[]
  errors: string[]
}

function formatPath(base: string, path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => (typeof key === 'number' ? `${out}[${key}]` : `${out}.${String(key)}`), base)
}

function labelOf(raw: unknown, index: number): string {
  const id = typeof raw === 'object' && raw !== null && 'id' in raw ? raw.id : undefined
  return typeof id === 'string' && id.length > 0 ? id : `entries[${index}]`
}

/** Schema-checks every entry and reports duplicate ids. Errors read `path: problem`. */
export function parseCatalog(raw: readonly unknown[]): ParsedCatalog {
  const entries: CatalogEntry[] = []
  const errors: string[] = []
  const firstIndex = new Map<string, number>()
  raw.forEach((item, index) => {
    const label = labelOf(item, index)
    const result = CatalogEntrySchema.safeParse(item)
    if (!result.success) {
      for (const issue of result.error.issues) errors.push(`${formatPath(label, issue.path)}: ${issue.message}`)
      return
    }
    const { id } = result.data
    const first = firstIndex.get(id)
    if (first !== undefined) {
      errors.push(`${id}: duplicate id (entries[${first}] and entries[${index}])`)
      return
    }
    firstIndex.set(id, index)
    entries.push(result.data)
  })
  return { entries, errors }
}

/** R-slug: a bare risk slug matches the part of a folder-qualified knowledge slug after the last "/". */
function slugResolver(knowledgeSlugs: readonly string[]): (slug: string) => boolean {
  const known = new Set(knowledgeSlugs.flatMap((s) => [s, s.slice(s.lastIndexOf('/') + 1)]))
  return (slug) => known.has(slug)
}

function referenceErrors(entries: readonly CatalogEntry[], options: ValidateOptions): string[] {
  const kindOf = new Map(entries.map((e) => [e.id, e.kind]))
  const errors: string[] = []
  const expect = (owner: string, field: string, id: string | undefined, kind: CatalogKind) => {
    if (id !== undefined && kindOf.get(id) !== kind) errors.push(`${owner}.${field}: unknown ${kind} "${id}"`)
  }
  const resolves = options.knowledgeSlugs ? slugResolver(options.knowledgeSlugs) : undefined
  for (const entry of entries) {
    if (entry.kind === 'rack') expect(entry.id, 'gpuId', entry.gpuId, 'gpu')
    if (entry.kind !== 'rackCooling') continue
    expect(entry.id, 'coolantId', entry.coolantId, 'coolant')
    if (!resolves) continue
    entry.risks.forEach((slug, i) => {
      if (!resolves(slug)) errors.push(`${entry.id}.risks[${i}]: unknown knowledge slug "${slug}"`)
    })
  }
  return errors
}

/** Schema, unique ids, and cross-references (`gpuId`, `coolantId`, `risks` slugs when a slug list is given). */
export function validateCatalog(entries: readonly unknown[], options: ValidateOptions = {}): CatalogValidation {
  const parsed = parseCatalog(entries)
  const errors = [...parsed.errors, ...referenceErrors(parsed.entries, options)]
  return { ok: errors.length === 0, errors }
}
