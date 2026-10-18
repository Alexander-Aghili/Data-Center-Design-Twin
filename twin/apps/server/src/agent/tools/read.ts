import { makeCatalogIndex } from '@twin/engine'
import type { CatalogEntry, CatalogKind, Check, Evaluation, Plan, Status } from '@twin/schema'
import type { PlanStore } from '../../contracts.js'
import { KNOWLEDGE_SLUGS, readKnowledge, searchKnowledge } from '../../knowledge/index.js'
import { compactCheck, defineTool, failure, success, type AgentTool } from './schema.js'

const STATUS_ORDER: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 }
const MAX_PROBLEMS = 10
const MAX_CATALOG_ROWS = 60
// get_hourly's default step keeps a range near one week of hourly points.
const DEFAULT_POINTS = 168
const LAST_HOUR = 8759

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Headline, check counts and the worst problems: small enough to read every turn. */
function summarizeEvaluation(e: Evaluation) {
  const counts: Record<Status, number> = { fail: 0, warn: 0, unknown: 0, pass: 0 }
  const byKind: Record<string, Partial<Record<Status, number>>> = {}
  for (const c of e.checks) {
    counts[c.status]++
    if (c.status === 'fail' || c.status === 'warn') {
      const kind = (byKind[c.kind] ??= {})
      kind[c.status] = (kind[c.status] ?? 0) + 1
    }
  }
  const problems = e.checks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.utilization ?? 0) - (a.utilization ?? 0))
  return {
    headline: e.headline,
    checks: { counts, problemsByKind: byKind, problems: problems.slice(0, MAX_PROBLEMS).map(compactCheck), moreProblems: Math.max(0, problems.length - MAX_PROBLEMS) },
    racks: {
      count: e.racks.length,
      itW: sum(e.racks.map((r) => r.powerW)),
      heatW: sum(e.racks.map((r) => r.heatW)),
      liquidW: sum(e.racks.map((r) => r.liquidW)),
      airW: sum(e.racks.map((r) => r.airW)),
    },
    cost: { capexUsd: e.cost.capexUsd, buildWeeks: e.cost.buildWeeks, criticalPath: e.cost.criticalPath, delayCostUsd: e.cost.delayCostUsd },
    network: { oversubscription: e.network.oversubscription, baseLatencyNs: e.network.baseLatencyNs, opticsW: e.network.opticsW, cableM: e.network.cableM },
  }
}

function suggestChecks(checks: Check[], wanted: string): string[] {
  const parts = wanted.split(/[:.]/).filter((p) => p.length > 2)
  const similar = checks.filter((c) => parts.some((p) => c.id.includes(p)))
  const pool = similar.length ? similar : checks.filter((c) => c.status !== 'pass')
  return pool.slice(0, 10).map((c) => c.id)
}

function stats(values: (number | null)[], from: number) {
  let min: number | null = null
  let max: number | null = null
  let maxAtHour: number | null = null
  let total = 0
  let n = 0
  values.forEach((v, i) => {
    if (v === null) return
    if (min === null || v < min) min = v
    if (max === null || v > max) {
      max = v
      maxAtHour = from + i
    }
    total += v
    n++
  })
  return { min, max, maxAtHour, mean: n ? total / n : null }
}

/** Climate entries carry 8760-hour arrays; the agent gets their range instead. */
function entryForAgent(entry: CatalogEntry) {
  if (entry.kind !== 'climate') return entry
  const { dryBulbC, wetBulbC, ...rest } = entry
  return { ...rest, dryBulbC: stats(dryBulbC, 0), wetBulbC: stats(wetBulbC, 0), hourly: 'Use get_hourly with outdoorC or wetBulbC for the series.' }
}

function catalogRow(entry: CatalogEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    ...(entry.vendor ? { vendor: entry.vendor } : {}),
    ...(entry.custom ? { custom: true } : {}),
    ...('category' in entry ? { category: entry.category } : {}),
    ...('status' in entry ? { status: entry.status } : {}),
    summary: entry.summary,
  }
}

/** The plan's own catalog (snapshotted and custom entries) as rows; the numbers come from get_catalog_entry. */
function catalogSection(catalog: Plan['catalog']) {
  return { entries: Object.values(catalog).map(catalogRow), numbers: 'Use get_catalog_entry with an id for every number.' }
}

const range = (values: number[]) => (values.length ? { min: Math.min(...values), max: Math.max(...values) } : null)

/**
 * The plan small enough to read every turn: decisions in full; placements as slots per row and group;
 * floor bays as a count with rating ranges; notes as counts; the catalog as rows. Sections come in full.
 */
function compactPlan(plan: Plan) {
  const { hall, placements, notes, catalog, ...decisions } = plan
  const byRow: Record<string, Record<string, number[]>> = {}
  for (const p of placements) ((byRow[p.rowId] ??= {})[p.groupId] ??= []).push(p.slot)
  const importance: Record<string, number> = {}
  for (const n of notes) importance[n.importance] = (importance[n.importance] ?? 0) + 1
  return {
    ...decisions,
    hall: {
      ...hall,
      bays: {
        count: hall.bays.length,
        ratingKnM2: range(hall.bays.map((b) => b.ratingKnM2)),
        pointLimitKn: range(hall.bays.map((b) => b.pointLimitKn)),
        detail: 'get_plan with section "hall" lists every bay.',
      },
    },
    placements: { count: placements.length, byRow, ids: 'A rack in row R3 at slot 7 has id "R3-07".' },
    notes: { count: notes.length, byImportance: importance, detail: 'get_notes returns the text.' },
    catalog: catalogSection(catalog),
  }
}

/** R-slug: catalog risks use bare slugs ("air-containment"); knowledge slugs carry the folder. */
function resolveSlug(slug: string): string | null {
  if (KNOWLEDGE_SLUGS.includes(slug)) return slug
  const matches = KNOWLEDGE_SLUGS.filter((s) => s.slice(s.lastIndexOf('/') + 1) === slug)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** Singular and plural nouns for result lines ("Listed 7 rack cooling methods"). */
const KIND_NOUNS: Record<CatalogKind, [string, string]> = {
  gpu: ['GPU', 'GPUs'],
  rack: ['rack type', 'rack types'],
  rackCooling: ['rack cooling method', 'rack cooling methods'],
  heatRejection: ['heat rejection option', 'heat rejection options'],
  coolant: ['coolant', 'coolants'],
  equipment: ['equipment model', 'equipment models'],
  climate: ['climate', 'climates'],
}

export function readTools(store: PlanStore): AgentTool[] {
  const catalog = () => {
    const { plan } = store.state()
    return makeCatalogIndex([...store.builtins().entries, ...Object.values(plan.catalog)])
  }
  return [
    defineTool(
      'get_plan',
      'Returns the current plan as compact JSON: site inputs, rack groups, cooling, power and network decisions, equipment overrides, hall rows and positions in full; placements as slots per row and group; floor bays, notes and catalog entries summarized. Pass a section, such as "hall", "placements" or "cooling", to get that part in full (the catalog section lists entries; get_catalog_entry gives the numbers). Use it before changing or proposing anything, so ids and current values come from the plan.',
      (input) => {
        const { plan } = store.state()
        if (!input.section) return success(compactPlan(plan), 'Read the plan')
        const part = input.section === 'catalog' ? catalogSection(plan.catalog) : plan[input.section]
        return success(part, `Read the plan's ${input.section}`)
      },
    ),
    defineTool(
      'get_evaluation',
      'Returns the engine\'s evaluation of the current plan. "summary" gives the headline (usable compute, PUE, water, buildable), check counts, the worst failing or warning checks, rack totals and cost; use it first. "full" adds every metric, check, rack, sized equipment item, row and bay; hourly series come from get_hourly.',
      (input) => {
        const { evaluation } = store.state()
        if (input.detail === 'summary') {
          const summary = summarizeEvaluation(evaluation)
          const { fail, warn } = summary.checks.counts
          return success(summary, `Evaluation: ${fail} failing, ${warn} warning`)
        }
        const { hourly, ...rest } = evaluation
        return success({ ...rest, hourly: `${Object.keys(hourly).length} series of 8760 hours; use get_hourly.` }, 'Read the full evaluation')
      },
    ),
    defineTool(
      'explain_check',
      'Returns one check in full: value against limit, status, the worst failure scenario, the explanation, the cause chain back to the decisions that drive it across layers, and advice. Use it before explaining a problem or proposing a fix, so the cause you name comes from the engine. Fails with similar check ids when the id is unknown.',
      (input) => {
        const { checks } = store.state().evaluation
        const found = checks.find((c) => c.id === input.checkId)
        if (!found) return failure(`No check "${input.checkId}". Similar ids: ${suggestChecks(checks, input.checkId).join(', ') || 'none'}`)
        return success(found, `Explained ${found.title}`)
      },
    ),
    defineTool(
      'get_hourly',
      'Returns hourly series from the year-long model (outdoorC, wetBulbC, itW, coolingW, facilityW, pue, waterM3, trimW) for an hour range, sampled every step hours, with min, max, the hour of the max and the mean over the whole range. Value i is hour fromHour + i × step. Use it for questions about hot days, the worst hour or seasonal swings.',
      (input) => {
        const from = input.fromHour ?? 0
        const to = input.toHour ?? LAST_HOUR
        if (from > to) return failure(`fromHour (${from}) is after toHour (${to}).`)
        const step = input.step ?? Math.max(1, Math.ceil((to - from + 1) / DEFAULT_POINTS))
        const { hourly } = store.state().evaluation
        const series = Object.fromEntries(
          input.series.map((key) => {
            const range = (hourly[key] as (number | null)[]).slice(from, to + 1)
            return [key, { ...stats(range, from), values: range.filter((_, i) => i % step === 0) }]
          }),
        )
        return success({ fromHour: from, toHour: to, step, series }, `Read ${input.series.join(', ')} for hours ${from} to ${to}`)
      },
    ),
    defineTool(
      'list_catalog',
      'Lists catalog entries (GPUs, racks, rack cooling methods, heat rejection, coolants, equipment, climates), built-in and custom, with id, name, category, status and a one-line summary. Filter by kind and a text query. Use it to find ids for commands, then get_catalog_entry for the numbers.',
      (input) => {
        const query = input.query?.toLowerCase()
        const rows = catalog()
          .all()
          .filter((e) => !input.kind || e.kind === input.kind)
          .filter((e) => !query || [e.id, e.name, e.vendor ?? '', e.summary].some((field) => field.toLowerCase().includes(query)))
        return success(
          { entries: rows.slice(0, MAX_CATALOG_ROWS).map(catalogRow), more: Math.max(0, rows.length - MAX_CATALOG_ROWS) },
          `Listed ${rows.length} ${input.kind ? KIND_NOUNS[input.kind][rows.length === 1 ? 0 : 1] : rows.length === 1 ? 'catalog entry' : 'catalog entries'}`,
        )
      },
    ),
    defineTool(
      'get_catalog_entry',
      'Returns one catalog entry with every number, each with its unit, basis (vendor, press, estimate, calculated or user) and source. Use it before quoting a rack\'s power or weight, a cooling method\'s limits, a cost or a lead time. Climate entries come with their temperature range instead of 8760 values.',
      (input) => {
        const entry = catalog().get(input.id)
        if (!entry) return failure(`No catalog entry "${input.id}". Use list_catalog to find ids.`)
        return success(entryForAgent(entry), `Read ${entry.name}`)
      },
    ),
    defineTool(
      'get_notes',
      'Returns the notes the team left on decisions, rack groups, layers or racks, with importance (must, prefer, fyi), author role and text. Read them before proposing anything: a proposal must list the notes it respects or violates, and a must note is never broken silently. Filter by a target or target prefix.',
      (input) => {
        const target = input.target
        const notes = store
          .state()
          .plan.notes.filter((n) => !target || n.target === target || n.target.startsWith(`${target}.`) || n.target.startsWith(`${target}:`))
        return success({ notes }, `Read ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)
      },
    ),
    defineTool(
      'search_knowledge',
      'Searches the knowledge base: sourced files on cooling methods, heat rejection, coolants, each layer, GPU and rack families, layout, power, network and cost. Returns the best matching files with a snippet each. Use it for textbook numbers, ranges and failure modes, then read_knowledge for the whole file.',
      (input) => {
        const hits = searchKnowledge(input.query, input.limit)
        return success({ hits }, `Searched the knowledge base: ${hits.length} ${hits.length === 1 ? 'hit' : 'hits'}`)
      },
    ),
    defineTool(
      'read_knowledge',
      'Returns one knowledge file as Markdown: how the thing works, when to use it, textbook numbers with sources, interactions with other layers, what to watch for and failure modes. Use it when you need sourced numbers or advice beyond the engine. Accepts a folder slug ("cooling/air-containment") or a catalog risk slug ("air-containment").',
      (input) => {
        const slug = resolveSlug(input.slug)
        if (!slug) return failure(`No knowledge file "${input.slug}". Use search_knowledge to find a slug.`)
        return success(readKnowledge(slug), `Read ${slug}`)
      },
    ),
  ]
}
