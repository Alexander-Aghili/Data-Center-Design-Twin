import { formatIssues } from '@twin/commands'
import { sameHourly } from '@twin/engine'
import { ClientMsgSchema, type ClientMsg, type HourlySeries, type ServerMsg } from '@twin/schema'
import type { FastifyBaseLogger } from 'fastify'
import WebSocket from 'ws'
import type { AgentRuntime, PlanStore } from './contracts'

/**
 * Plan changes are pushed once this long after the last of a burst (an agent's tool batch, a run of MCP calls), so the
 * browser renders the result once instead of once per command.
 */
export const STATE_PUSH_DELAY_MS = 40
/** A steady stream of changes still reaches the browser at least this often. */
export const STATE_PUSH_MAX_WAIT_MS = 200

/**
 * Fans plan state, agent events and view actions out to every browser on `/ws`. A state push carries the 8760-hour
 * series only to clients that do not have that version yet; they are most of the bytes and rarely change.
 */
export interface Hub {
  connect(socket: WebSocket): void
  /** Detaches from the store and the agent. */
  close(): void
}

export function createHub(deps: { store: PlanStore; agent: AgentRuntime; log: FastifyBaseLogger }): Hub {
  const { store, agent, log } = deps
  const sockets = new Set<WebSocket>()

  function send(socket: WebSocket, msg: ServerMsg): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  function broadcast(msg: ServerMsg, except?: WebSocket): void {
    const data = JSON.stringify(msg)
    for (const socket of sockets) if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(data)
  }

  const threadMsg = (): ServerMsg => ({ t: 'thread', events: agent.threadEvents() })

  let hourly: { version: number; series: HourlySeries } = { version: 1, series: store.state().evaluation.hourly }
  /** The hourly version each client has. */
  const hourlySent = new WeakMap<WebSocket, number>()

  /** The version of the store's hourly series: it rises only when the values change, not with every evaluation. */
  function hourlyVersion(series: HourlySeries): number {
    if (series !== hourly.series) hourly = { version: sameHourly(series, hourly.series) ? hourly.version : hourly.version + 1, series }
    return hourly.version
  }

  /** Sends the current state to each socket, with the hourly series only where that socket lacks this version. */
  function pushState(targets: Iterable<WebSocket>): void {
    const state = store.state()
    const version = hourlyVersion(state.evaluation.hourly)
    // Serialized at most once per variant, however many clients there are.
    let full: string | undefined
    let lean: string | undefined
    const leanState = () => {
      const { hourly: _unchanged, ...evaluation } = state.evaluation
      return JSON.stringify({ t: 'state', ...state, evaluation, hourlyVersion: version } satisfies ServerMsg)
    }
    for (const socket of targets) {
      if (socket.readyState !== WebSocket.OPEN) continue
      if (hourlySent.get(socket) === version) {
        socket.send((lean ??= leanState()))
      } else {
        socket.send((full ??= JSON.stringify({ t: 'state', ...state, hourlyVersion: version } satisfies ServerMsg)))
        hourlySent.set(socket, version)
      }
    }
  }

  let pending: { timer: ReturnType<typeof setTimeout>; since: number } | null = null

  function schedulePush(): void {
    const since = pending?.since ?? Date.now()
    if (pending) clearTimeout(pending.timer)
    const delay = Math.min(STATE_PUSH_DELAY_MS, since + STATE_PUSH_MAX_WAIT_MS - Date.now())
    pending = { since, timer: setTimeout(flushState, Math.max(0, delay)) }
  }

  /** Sends a pending state push now, so a message that follows it never refers to a plan the client has not seen. */
  function flushState(): void {
    if (!pending) return
    clearTimeout(pending.timer)
    pending = null
    pushState(sockets)
  }

  function sendFreshState(socket: WebSocket): void {
    hourlySent.delete(socket)
    pushState([socket])
  }

  const unsubscribe = [
    store.onChange(schedulePush),
    agent.onEvent((event) => {
      if (event.kind === 'proposalStatus') flushState()
      broadcast({ t: 'agent', event })
    }),
    agent.onView((action) => {
      flushState()
      broadcast({ t: 'view', action })
    }),
  ]

  function handle(socket: WebSocket, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        sendFreshState(socket)
        send(socket, threadMsg())
        return
      case 'command': {
        const result = store.dispatch(msg.command, 'user')
        if (result.ok) flushState()
        send(socket, result.ok ? { t: 'commandResult', id: msg.id, ok: true } : { t: 'commandResult', id: msg.id, ok: false, error: result.error })
        return
      }
      case 'undo':
        store.undo()
        return
      case 'redo':
        store.redo()
        return
      case 'chat':
        agent.handleChat(msg.text)
        return
      case 'resetChat':
        agent.resetConversation()
        broadcast(threadMsg())
        return
      case 'proposal':
        if (msg.action === 'apply') agent.applyProposal(msg.proposalId)
        else agent.dismissProposal(msg.proposalId)
        return
      case 'view':
        broadcast({ t: 'view', action: msg.action }, socket)
        return
    }
  }

  /** Replies to a message that is not valid JSON or not a known client message. */
  function reject(socket: WebSocket, raw: unknown, problem: string): void {
    log.warn({ problem }, 'Rejected WebSocket message')
    const id = typeof raw === 'object' && raw !== null && 't' in raw && raw.t === 'command' && 'id' in raw ? raw.id : undefined
    if (typeof id === 'string') send(socket, { t: 'commandResult', id, ok: false, error: problem })
    else send(socket, { t: 'agent', event: { kind: 'error', message: `The server could not read that message. ${problem}` } })
  }

  function onMessage(socket: WebSocket, data: WebSocket.RawData): void {
    let raw: unknown
    try {
      raw = JSON.parse(String(data))
    } catch {
      reject(socket, undefined, 'It is not JSON.')
      return
    }
    const parsed = ClientMsgSchema.safeParse(raw)
    if (!parsed.success) {
      reject(socket, raw, formatIssues(parsed.error))
      return
    }
    try {
      handle(socket, parsed.data)
    } catch (err) {
      log.error({ err }, 'WebSocket message handler failed')
    }
  }

  return {
    connect(socket) {
      sockets.add(socket)
      socket.on('message', (data) => onMessage(socket, data))
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', (err) => log.warn({ err }, 'WebSocket error'))
      sendFreshState(socket)
      send(socket, threadMsg())
    },
    close() {
      if (pending) clearTimeout(pending.timer)
      pending = null
      unsubscribe.forEach((off) => off())
      for (const socket of sockets) socket.close(1001, 'Server shutting down')
      sockets.clear()
    },
  }
}
