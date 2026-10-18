import { formatIssues } from '@twin/commands'
import { ClientMsgSchema, type ClientMsg, type ServerMsg } from '@twin/schema'
import type { FastifyBaseLogger } from 'fastify'
import WebSocket from 'ws'
import type { AgentRuntime, PlanStore } from './contracts'

/** Fans plan state, agent events and view actions out to every browser on `/ws`. */
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

  const stateMsg = (): ServerMsg => ({ t: 'state', ...store.state() })
  const threadMsg = (): ServerMsg => ({ t: 'thread', events: agent.threadEvents() })

  const unsubscribe = [
    store.onChange(() => broadcast(stateMsg())),
    agent.onEvent((event) => broadcast({ t: 'agent', event })),
    agent.onView((action) => broadcast({ t: 'view', action })),
  ]

  function handle(socket: WebSocket, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        send(socket, stateMsg())
        send(socket, threadMsg())
        return
      case 'command': {
        const result = store.dispatch(msg.command, 'user')
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
      send(socket, stateMsg())
      send(socket, threadMsg())
    },
    close() {
      unsubscribe.forEach((off) => off())
      for (const socket of sockets) socket.close(1001, 'Server shutting down')
      sockets.clear()
    },
  }
}
