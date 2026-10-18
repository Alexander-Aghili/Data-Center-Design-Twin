import { z } from 'zod'
import { CommandSchema } from './commands'
import { EvalDiffSchema } from './evaluation'
import { SeveritySchema } from './view'

export const ProposalStatusSchema = z.enum(['open', 'applied', 'dismissed', 'stale'])
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>

export const ProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  commands: z.array(CommandSchema),
  respectsNotes: z.array(z.string()),
  violatesNotes: z.array(z.string()),
  diff: EvalDiffSchema,
  status: ProposalStatusSchema,
  annotationTag: z.number().int().positive().optional(),
  basePlanUpdatedAt: z.string(),
})
export type Proposal = z.infer<typeof ProposalSchema>

export const AgentEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('messageStart'), messageId: z.string(), trigger: z.enum(['chat', 'observation']), severity: SeveritySchema }),
  z.object({ kind: z.literal('textDelta'), messageId: z.string(), text: z.string() }),
  z.object({ kind: z.literal('toolCall'), messageId: z.string(), callId: z.string(), name: z.string(), summary: z.string() }),
  // numbers: numeric values found in the result, for grounding marks
  z.object({ kind: z.literal('toolResult'), callId: z.string(), ok: z.boolean(), summary: z.string(), numbers: z.array(z.number()) }),
  // e.g. a generated simulation brief
  z.object({ kind: z.literal('link'), messageId: z.string(), label: z.string(), href: z.string() }),
  z.object({ kind: z.literal('proposal'), messageId: z.string(), proposal: ProposalSchema }),
  z.object({ kind: z.literal('proposalStatus'), proposalId: z.string(), status: ProposalStatusSchema }),
  z.object({ kind: z.literal('messageEnd'), messageId: z.string() }),
  z.object({ kind: z.literal('error'), messageId: z.string().optional(), message: z.string() }),
  z.object({ kind: z.literal('userMessage'), messageId: z.string(), text: z.string() }),
])
export type AgentEvent = z.infer<typeof AgentEventSchema>
export type { Severity } from './view'
