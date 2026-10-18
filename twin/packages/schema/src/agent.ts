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
  // a plain line from the app, not the model: a turn stopped by the person or by a spending cap
  z.object({ kind: z.literal('notice'), messageId: z.string().optional(), message: z.string() }),
])
export type AgentEvent = z.infer<typeof AgentEventSchema>

/** What the agent is doing and what it has spent on the Claude API, in USD. */
export const AgentStatusSchema = z.object({
  running: z.boolean(),
  /** The running turn so far, or the last turn when none runs. */
  turnUsd: z.number().nonnegative(),
  todayUsd: z.number().nonnegative(),
  dailyBudgetUsd: z.number().nonnegative(),
  /** Today's budget is used up: chat and automatic reviews are off until midnight. */
  budgetSpent: z.boolean(),
  /** Whether the agent reviews the person's edits on its own. */
  autoReview: z.boolean(),
})
export type AgentStatus = z.infer<typeof AgentStatusSchema>
export type { Severity } from './view'
