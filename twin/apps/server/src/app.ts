import { randomUUID } from 'node:crypto'
import websocket from '@fastify/websocket'
import { SERVER_PORT, type AgentEvent, type Builtins } from '@twin/schema'
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify'
import type { AgentRuntime, PlanStore } from './contracts'
import { registerRoutes } from './routes'
import { createPlanStore, type CommandApplier } from './store'
import { createHub } from './ws'

export interface AppOptions {
  dataDir: string
  /** Builds the design agent; it logs its API spend to `log`. Without it the server runs with a stand-in that explains the missing key. */
  agentFactory?: (store: PlanStore, log: FastifyBaseLogger) => AgentRuntime
  /** Test seams; default to the built-in catalog and command registry. */
  builtins?: Builtins
  registry?: CommandApplier
  logger?: boolean
  /**
   * Browser origins allowed to call the API and open `/ws`. Defaults to the Vite dev server and the server
   * itself on localhost and 127.0.0.1. Requests without an Origin header (the MCP server, curl) always pass.
   */
  allowedOrigins?: string[]
}

/** Vite's dev server port (`apps/web/vite.config.ts`). */
export const DEV_WEB_PORT = 5173
/** Host names a request may address; anything else is a DNS-rebinding page reaching the local server. */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** `http://localhost:<port>`, `http://127.0.0.1:<port>` and `http://[::1]:<port>` for each port. */
export function localOrigins(ports: number[]): string[] {
  return ports.flatMap((port) => [...LOCAL_HOSTNAMES].map((host) => `http://${host}:${port}`))
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/** Why a request must be refused: a Host that is not local, or an Origin that is not the app's own. */
function originProblem(request: FastifyRequest, allowedOrigins: ReadonlySet<string>): string | null {
  const host = request.headers.host ?? ''
  const hostname = hostnameOf(host)
  if (hostname === null || !LOCAL_HOSTNAMES.has(hostname)) return `Host ${host} is not allowed`
  const origin = request.headers.origin
  if (origin !== undefined && !allowedOrigins.has(origin)) return `Origin ${origin} is not allowed`
  return null
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
    stopTurn() {},
    setAutoReview() {},
    status: () => null,
    onStatus: () => () => {},
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
  const agent = opts.agentFactory?.(store, app.log) ?? createOfflineAgent()
  const stopFeedingAgent = store.onChange((change) => agent.handleChange(change))
  const hub = createHub({ store, agent, log: app.log })

  app.setErrorHandler((err: { statusCode?: number; message: string }, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) request.log.error({ err }, 'Request failed')
    return reply.code(status).send({ ok: false, error: err.message })
  })

  await app.register(websocket)
  // Browsers do not apply CORS to WebSockets, and a rebinding domain reaches localhost under its own Host, so
  // every request, the `/ws` upgrade included, is checked before routing. Added after the websocket plugin, whose
  // own onRequest hook marks upgrades so a refused one has its socket closed.
  const allowedOrigins = new Set(opts.allowedOrigins ?? localOrigins([DEV_WEB_PORT, SERVER_PORT]))
  app.addHook('onRequest', async (request, reply) => {
    const problem = originProblem(request, allowedOrigins)
    if (problem) {
      request.log.warn({ host: request.headers.host, origin: request.headers.origin }, 'Refused a request from outside the app')
      return reply.code(403).send({ ok: false, error: problem })
    }
  })

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
