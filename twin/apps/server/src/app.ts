import { randomUUID } from 'node:crypto'
import websocket from '@fastify/websocket'
import type { AgentEvent, Builtins } from '@twin/schema'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentRuntime, PlanStore } from './contracts'
import { registerRoutes } from './routes'
import { createPlanStore, type CommandApplier } from './store'
import { createHub } from './ws'

export interface AppOptions {
  dataDir: string
  /** Builds the design agent. Without it the server runs with a stand-in that explains the missing key. */
  agentFactory?: (store: PlanStore) => AgentRuntime
  /** Test seams; default to the built-in catalog and command registry. */
  builtins?: Builtins
  registry?: CommandApplier
  logger?: boolean
}

const NO_AGENT_MESSAGE = 'The agent needs an API key in .env'

/**
 * The agent runtime used when no API key is configured: chat messages land in the thread followed by
 * a plain error, and tools are unavailable.
 */
function createOfflineAgent(): AgentRuntime {
  const thread: AgentEvent[] = []
  const listeners = new Set<(e: AgentEvent) => void>()
  const emit = (event: AgentEvent) => {
    thread.push(event)
    for (const cb of [...listeners]) cb(event)
  }
  return {
    handleChat(text) {
      const messageId = randomUUID()
      emit({ kind: 'userMessage', messageId, text })
      emit({ kind: 'error', messageId, message: NO_AGENT_MESSAGE })
    },
    handleChange() {},
    resetConversation() {
      thread.length = 0
    },
    applyProposal() {},
    dismissProposal() {},
    onEvent(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onView: () => () => {},
    threadEvents: () => [...thread],
    runTool: async () => ({ ok: false, error: NO_AGENT_MESSAGE }),
    listTools: () => [],
  }
}

export async function createApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false })
  const store = createPlanStore({
    dataDir: opts.dataDir,
    builtins: opts.builtins,
    registry: opts.registry,
    onError: (err, context) => app.log.error({ err }, context),
    onWarning: (text) => app.log.warn(text),
  })
  const agent = opts.agentFactory?.(store) ?? createOfflineAgent()
  const stopFeedingAgent = store.onChange((change) => agent.handleChange(change))
  const hub = createHub({ store, agent, log: app.log })

  app.setErrorHandler((err: { statusCode?: number; message: string }, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) request.log.error({ err }, 'Request failed')
    return reply.code(status).send({ ok: false, error: err.message })
  })

  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => hub.connect(socket))
  registerRoutes(app, { store, agent, dataDir: opts.dataDir })

  app.addHook('preClose', async () => {
    hub.close()
    stopFeedingAgent()
  })
  app.addHook('onClose', async () => {
    try {
      store.flush()
    } catch (err) {
      app.log.error({ err }, 'Could not write plan.json on shutdown')
    }
  })
  return app
}
