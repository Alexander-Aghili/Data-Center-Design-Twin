import { CommandError, type CatalogIndex, type Command, type Plan } from '@twin/schema'
import { produce } from 'immer'
import { z } from 'zod'
import { commands as catalogCommands } from './commands/catalog'
import { commands as computeCommands } from './commands/compute'
import { commands as coolingCommands } from './commands/cooling'
import { commands as equipmentCommands } from './commands/equipment'
import { commands as layoutCommands } from './commands/layout'
import { commands as networkCommands } from './commands/network'
import { commands as notesCommands } from './commands/notes'
import { commands as planCommands } from './commands/plan'
import { commands as powerCommands } from './commands/power'
import { commands as siteCommands } from './commands/site'
import { commands as workloadCommands } from './commands/workload'
import type { AnyCommandDef } from './define'

export interface CommandInfo {
  type: string
  layer: string
  title: string
  description: string
  jsonSchema: object
}

export interface Registry {
  readonly registry: ReadonlyMap<string, AnyCommandDef>
  applyCommand(plan: Plan, cmd: Command, catalog: CatalogIndex): { plan: Plan; summary: string }
  applyCommands(plan: Plan, cmds: Command[], catalog: CatalogIndex): { plan: Plan; summaries: string[] }
  listCommands(): CommandInfo[]
}

/** Formats zod issues as `path: problem` lines. */
export function formatIssues(error: z.ZodError, prefix = ''): string {
  return error.issues
    .map((issue) => {
      const path = [prefix, ...issue.path.map(String)].filter(Boolean).join('.')
      return `${path || '(root)'}: ${issue.message}`
    })
    .join('\n')
}

/**
 * The plan as `summarize` reads it: catalog entries the plan holds no copy of yet resolve from the catalog index,
 * so change records name them ("GB300 NVL72") instead of showing their ids.
 */
export function withCatalogNames(plan: Plan, catalog: CatalogIndex): Plan {
  return { ...plan, catalog: { ...Object.fromEntries(catalog.all().map((e) => [e.id, e])), ...plan.catalog } }
}

export function createRegistry(defs: AnyCommandDef[]): Registry {
  const registry = new Map<string, AnyCommandDef>()
  for (const def of defs) {
    if (registry.has(def.type)) throw new Error(`Command "${def.type}" is defined twice`)
    registry.set(def.type, def)
  }

  /**
   * Validates the payload, applies the command on an immer draft and stamps `updatedAt`.
   * `summarize` sees the plan as it was before the command.
   */
  function applyCommand(plan: Plan, cmd: Command, catalog: CatalogIndex): { plan: Plan; summary: string } {
    const def = registry.get(cmd.type)
    if (!def) throw new CommandError(`Unknown command "${cmd.type}"`, 'type')
    const parsed = def.payload.safeParse(cmd.payload)
    if (!parsed.success) throw new CommandError(formatIssues(parsed.error, 'payload'), 'payload')
    const payload = parsed.data
    const next = produce(plan, (draft) => {
      def.apply(draft, payload, { catalog })
      draft.updatedAt = new Date().toISOString()
    })
    return { plan: next, summary: def.summarize(payload, withCatalogNames(plan, catalog)) }
  }

  /** Applies commands in order; if any throws, nothing is applied. */
  function applyCommands(plan: Plan, cmds: Command[], catalog: CatalogIndex): { plan: Plan; summaries: string[] } {
    const summaries: string[] = []
    let current = plan
    for (const cmd of cmds) {
      const result = applyCommand(current, cmd, catalog)
      current = result.plan
      summaries.push(result.summary)
    }
    return { plan: current, summaries }
  }

  function listCommands(): CommandInfo[] {
    return [...registry.values()].map((def) => ({
      type: def.type,
      layer: def.layer,
      title: def.title,
      description: def.description,
      jsonSchema: z.toJSONSchema(def.payload, { io: 'input' }),
    }))
  }

  return { registry, applyCommand, applyCommands, listCommands }
}

const builtin = createRegistry([
  ...planCommands,
  ...siteCommands,
  ...workloadCommands,
  ...computeCommands,
  ...layoutCommands,
  ...coolingCommands,
  ...powerCommands,
  ...networkCommands,
  ...equipmentCommands,
  ...notesCommands,
  ...catalogCommands,
])

export const registry: ReadonlyMap<string, AnyCommandDef> = builtin.registry
export const applyCommand = builtin.applyCommand
export const applyCommands = builtin.applyCommands
export const listCommands = builtin.listCommands
