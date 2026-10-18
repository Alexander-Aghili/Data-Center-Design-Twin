import { z } from 'zod'
import { CatalogKindSchema } from './catalog'
import { CommandSchema } from './commands'
import { HourlySeriesSchema } from './evaluation'
import { LayerIdSchema, PlanSchema } from './plan'
import { FocusKindSchema, OverlaySchema, SeveritySchema, ShotIdSchema } from './view'

const HOURS = 8760
const hour = z.number().int().min(0).max(HOURS - 1)
const commands = z.array(CommandSchema).min(1)

/**
 * Input schemas of the non-command agent tools. Command tools are generated from the registry as `cmd_<type>`.
 * Every tool input is an object, as the Messages API requires.
 */
export const ToolInputSchemas = {
  // read
  get_plan: z.object({ section: PlanSchema.keyof().optional() }),
  get_evaluation: z.object({ detail: z.enum(['summary', 'full']) }),
  explain_check: z.object({ checkId: z.string().min(1) }),
  get_hourly: z.object({
    series: z.array(HourlySeriesSchema.keyof()).min(1),
    fromHour: hour.optional(),
    toHour: hour.optional(),
    step: z.number().int().positive().optional(),
  }),
  list_catalog: z.object({ kind: CatalogKindSchema.optional(), query: z.string().optional() }),
  get_catalog_entry: z.object({ id: z.string().min(1) }),
  get_notes: z.object({ target: z.string().optional() }),
  search_knowledge: z.object({ query: z.string().min(1), limit: z.number().int().positive().max(20).optional() }),
  read_knowledge: z.object({ slug: z.string().min(1) }),
  // act
  undo: z.object({}),
  redo: z.object({}),
  // propose
  propose_change: z.object({
    title: z.string().min(1),
    rationale: z.string().min(1),
    commands,
    respectsNotes: z.array(z.string()),
    violatesNotes: z.array(z.string()),
    annotate: z.object({ objectIds: z.array(z.string()).min(1), label: z.string().min(1) }).optional(),
  }),
  what_if: z.object({ commands }),
  // view
  set_layer: z.object({ layer: LayerIdSchema }),
  focus: z.object({ kind: FocusKindSchema, id: z.string().min(1), shot: ShotIdSchema.optional() }),
  set_overlay: z.object({ overlay: OverlaySchema }),
  annotate: z.object({ objectIds: z.array(z.string()).min(1), label: z.string().min(1), severity: SeveritySchema }),
  clear_annotations: z.object({}),
  // documents
  generate_simulation_brief: z.object({ target: z.literal('openfoam'), agentNotes: z.string() }),
  export_plan: z.object({}),
} as const

export type ToolName = keyof typeof ToolInputSchemas
export type ToolInputs = { [K in ToolName]: z.infer<(typeof ToolInputSchemas)[K]> }

export const TOOL_GROUPS: Record<'read' | 'act' | 'propose' | 'view' | 'documents', readonly ToolName[]> = {
  read: ['get_plan', 'get_evaluation', 'explain_check', 'get_hourly', 'list_catalog', 'get_catalog_entry', 'get_notes', 'search_knowledge', 'read_knowledge'],
  act: ['undo', 'redo'],
  propose: ['propose_change', 'what_if'],
  view: ['set_layer', 'focus', 'set_overlay', 'annotate', 'clear_annotations'],
  documents: ['generate_simulation_brief', 'export_plan'],
}

/** Prefix of the agent tools generated from the command registry. */
export const COMMAND_TOOL_PREFIX = 'cmd_'
