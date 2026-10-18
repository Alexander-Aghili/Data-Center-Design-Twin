import { ServerMsgSchema, type ClientMsg, type Command, type ServerMsg } from '@twin/schema'

export type BackendStatus = 'connecting' | 'online' | 'local' | 'offline'

/** Transport between the store and the plan state (the server, or the in-browser LocalBackend). */
export interface Backend {
  connect(onMsg: (m: ServerMsg) => void, onStatus?: (s: BackendStatus) => void): void
  send(m: ClientMsg): void
  /** Applies every command or none, as one undo step; rejects with the reason. */
  sendAll(commands: Command[]): Promise<void>
}

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 5000

/** WebSocket client for the server at `/ws`. Reconnects with backoff and says hello on every open. */
export class SocketBackend implements Backend {
  private socket: WebSocket | null = null
  private retryMs = RECONNECT_MIN_MS
  private readonly url: string

  constructor(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.url = url
  }

  connect(onMsg: (m: ServerMsg) => void, onStatus?: (s: BackendStatus) => void): void {
    onStatus?.('connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onopen = () => {
      this.retryMs = RECONNECT_MIN_MS
      onStatus?.('online')
      socket.send(JSON.stringify({ t: 'hello' } satisfies ClientMsg))
    }
    socket.onmessage = (event) => {
      const parsed = ServerMsgSchema.safeParse(JSON.parse(String(event.data)))
      if (parsed.success) onMsg(parsed.data)
    }
    socket.onclose = () => {
      this.socket = null
      onStatus?.('offline')
      setTimeout(() => this.connect(onMsg, onStatus), this.retryMs)
      this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS)
    }
  }

  send(m: ClientMsg): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Not connected to the server')
    this.socket.send(JSON.stringify(m))
  }

  /** Over HTTP (`POST /api/commands`); the new state still arrives on the socket. */
  async sendAll(commands: Command[]): Promise<void> {
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !body.ok) throw new Error(body.error ?? `The server answered ${res.status}`)
  }
}
