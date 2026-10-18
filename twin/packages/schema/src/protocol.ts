import { z } from 'zod'
import { AgentEventSchema } from './agent'
import { CommandSchema } from './commands'
import { EvaluationSchema } from './evaluation'
import { PlanSchema } from './plan'
import { ViewActionSchema } from './view'

/** Default port of the local server (HTTP and the `/ws` WebSocket). */
export const SERVER_PORT = 4317

export const HistoryInfoSchema = z.object({ canUndo: z.boolean(), canRedo: z.boolean(), last: z.string().optional() })
export type HistoryInfo = z.infer<typeof HistoryInfoSchema>

/** Messages from the browser to the server over `/ws` (JSON). */
export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello') }),
  z.object({ t: z.literal('command'), id: z.string(), command: CommandSchema }),
  z.object({ t: z.literal('undo') }),
  z.object({ t: z.literal('redo') }),
  z.object({ t: z.literal('chat'), text: z.string().min(1) }),
  z.object({ t: z.literal('resetChat') }),
  z.object({ t: z.literal('proposal'), proposalId: z.string(), action: z.enum(['apply', 'dismiss']) }),
  z.object({ t: z.literal('view'), action: ViewActionSchema }),
])
export type ClientMsg = z.infer<typeof ClientMsgSchema>

/** Messages from the server to the browser over `/ws` (JSON). */
export const ServerMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('state'), plan: PlanSchema, evaluation: EvaluationSchema, history: HistoryInfoSchema }),
  z.object({ t: z.literal('commandResult'), id: z.string(), ok: z.boolean(), error: z.string().optional() }),
  z.object({ t: z.literal('agent'), event: AgentEventSchema }),
  z.object({ t: z.literal('view'), action: ViewActionSchema }),
  z.object({ t: z.literal('thread'), events: z.array(AgentEventSchema) }), // replay on connect
])
export type ServerMsg = z.infer<typeof ServerMsgSchema>

/** Result of `POST /api/tools/:name`. */
export type ToolCallResponse = { ok: true; result: string } | { ok: false; error: string }
