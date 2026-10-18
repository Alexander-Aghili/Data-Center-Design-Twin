import { createDefaultPlan } from '@twin/catalog'
import { CommandError, PlanSchema, placementId, type CatalogIndex, type Plan } from '@twin/schema'
import { current } from 'immer'
import type { z } from 'zod'
import { defineCommand, type AnyCommandDef } from '../define'
import { findEntry, layoutProblems, widthResolver } from '../lookup'

const SCHEMA_VERSION = 1

/** Zod issues as `path: problem` lines, with paths relative to the plan document. */
function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
}

/** Reference and geometry problems a schema-valid plan can still have, as `path: problem` lines. */
function integrityProblems(plan: Plan, catalog: CatalogIndex): string[] {
  const lines: string[] = []
  const groupIds = new Set(plan.rackGroups.map((g) => g.id))
  const rowIds = new Set(plan.hall.rows.map((r) => r.id))
  plan.rackGroups.forEach((g, i) => {
    if (!findEntry(plan, catalog, g.rackTypeId, 'rack')) lines.push(`rackGroups.${i}.rackTypeId: unknown rack type "${g.rackTypeId}"`)
    if (!findEntry(plan, catalog, g.coolingMethodId, 'rackCooling')) {
      lines.push(`rackGroups.${i}.coolingMethodId: unknown rack cooling method "${g.coolingMethodId}"`)
    }
  })
  plan.placements.forEach((p, i) => {
    if (!groupIds.has(p.groupId)) lines.push(`placements.${i}.groupId: unknown rack group "${p.groupId}"`)
    if (!rowIds.has(p.rowId)) lines.push(`placements.${i}.rowId: unknown row "${p.rowId}"`)
    else if (p.id !== placementId(p.rowId, p.slot)) {
      lines.push(`placements.${i}.id: must be "${placementId(p.rowId, p.slot)}" for row ${p.rowId} slot ${p.slot}`)
    }
  })
  for (const { index, message } of layoutProblems(plan, widthResolver(plan, catalog))) lines.push(`placements.${index}: ${message}`)
  return lines
}

/** A plain message for a plan written by another schema version. */
function versionProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) return null
  if (value.schemaVersion === SCHEMA_VERSION) return null
  return `schemaVersion: this app reads schemaVersion ${SCHEMA_VERSION}; the file has ${JSON.stringify(value.schemaVersion)}`
}

function parsePlan(value: unknown, catalog: CatalogIndex): Plan {
  const version = versionProblem(value)
  const parsed = PlanSchema.safeParse(value)
  const lines = parsed.success
    ? integrityProblems(parsed.data, catalog)
    : issueLines(parsed.error).filter((line) => !(version && line.startsWith('schemaVersion:')))
  if (version) lines.unshift(version)
  if (!parsed.success || lines.length > 0) {
    throw new CommandError(['The file is not a valid plan:', ...lines].join('\n'), 'payload.plan')
  }
  return parsed.data
}

function importedName(value: unknown): string {
  return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' ? value.name : 'plan'
}

const newPlan = defineCommand({
  type: 'newPlan',
  layer: 'plan',
  title: 'New plan',
  description:
    'Replaces the whole plan with the default starting hall (8 rows, air-cooled racks, Dallas climate). Custom catalog entries are kept; every other decision, placement and note is reset. Use only when the person asks to start over.',
  apply(draft) {
    const custom = Object.fromEntries(Object.entries(current(draft.catalog)).filter(([, entry]) => entry.custom === true))
    Object.assign(draft, createDefaultPlan(), { catalog: custom })
  },
  summarize: () => 'Started a new plan from the default hall',
})

const importPlan = defineCommand({
  type: 'importPlan',
  layer: 'plan',
  title: 'Import plan',
  description:
    'Replaces the whole plan with a plan JSON document (schemaVersion 1), such as a file exported earlier. The document is checked first: schema, references between rack groups, rows and racks, and rack overlaps. On any problem nothing changes and the error lists each one as "path: problem".',
  apply(draft, payload, ctx) {
    Object.assign(draft, parsePlan(payload.plan, ctx.catalog))
  },
  summarize: (payload) => `Imported plan "${importedName(payload.plan)}"`,
})

const renamePlan = defineCommand({
  type: 'renamePlan',
  layer: 'plan',
  title: 'Rename plan',
  description: 'Renames the plan. Leading and trailing spaces are trimmed; the name cannot be blank.',
  apply(draft, payload) {
    const name = payload.name.trim()
    if (!name) throw new CommandError('The plan name cannot be blank', 'payload.name')
    draft.name = name
  },
  summarize: (payload) => `Plan renamed to "${payload.name.trim()}"`,
})

export const commands: AnyCommandDef[] = [newPlan, importPlan, renamePlan]
