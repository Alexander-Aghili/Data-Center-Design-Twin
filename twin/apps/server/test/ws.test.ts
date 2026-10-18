import type { AgentEvent, ServerMsg, ViewAction } from '@twin/schema'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createApp } from '../src/app'
import type { AgentRuntime, StoreChange } from '../src/contracts'
import { rename, tempDataDir, testBuiltins, testRegistry } from './helpers/fixtures'

/** A WebSocket client that queues server messages so tests can await them in order. */
class Client {
  private readonly queue: ServerMsg[] = []
  private waiter: (() => void) | null = null

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.queue.push(JSON.parse(String(data)) as ServerMsg)
      this.waiter?.()
    })
  }

  static async open(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const client = new Client(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    return client
  }

  send(msg: object): void {
    this.socket.send(JSON.stringify(msg))
  }

  async next(): Promise<ServerMsg> {
    const deadline = Date.now() + 2000
    while (this.queue.length === 0) {
      if (Date.now() > deadline) throw new Error('No message from the server within 2 s')
      await new Promise<void>((resolve) => {
        this.waiter = resolve
        setTimeout(resolve, 50)
      })
    }
    return this.queue.shift()!
  }

  /** Skips the state and thread replay every new connection receives. */
  async ready(): Promise<this> {
    expect((await this.next()).t).toBe('state')
    expect((await this.next()).t).toBe('thread')
    return this
  }

  /** Resolves when no message arrives for a short while. */
  async quiet(): Promise<ServerMsg[]> {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return this.queue.splice(0)
  }
}

function fakeAgent(thread: AgentEvent[] = []) {
  const eventListeners = new Set<(e: AgentEvent) => void>()
  const viewListeners = new Set<(a: ViewAction) => void>()
  const calls: string[] = []
  const changes: StoreChange[] = []
  const runtime: AgentRuntime = {
    handleChat: (text) => calls.push(`chat:${text}`),
    handleChange: (change) => changes.push(change),
    resetConversation: () => {
      calls.push('reset')
      thread.length = 0
    },
    applyProposal: (id) => calls.push(`apply:${id}`),
    dismissProposal: (id) => calls.push(`dismiss:${id}`),
    onEvent(cb) {
      eventListeners.add(cb)
      return () => eventListeners.delete(cb)
    },
    onView(cb) {
      viewListeners.add(cb)
      return () => viewListeners.delete(cb)
    },
    threadEvents: () => [...thread],
    runTool: async () => ({ ok: false, error: 'unused' }),
    listTools: () => [],
  }
  return {
    runtime,
    calls,
    changes,
    emit: (e: AgentEvent) => eventListeners.forEach((cb) => cb(e)),
    view: (a: ViewAction) => viewListeners.forEach((cb) => cb(a)),
  }
}

const apps: FastifyInstance[] = []
const clients: Client[] = []

async function start(agent?: AgentRuntime): Promise<{ app: FastifyInstance; port: number }> {
  const app = await createApp({
    dataDir: tempDataDir(),
    builtins: testBuiltins(),
    registry: testRegistry(),
    agentFactory: agent ? () => agent : undefined,
  })
  apps.push(app)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Server has no port')
  return { app, port: address.port }
}

async function connect(port: number): Promise<Client> {
  const client = await Client.open(port)
  clients.push(client)
  return client
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.socket.close())
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('WebSocket hub', () => {
  it('new ws client receives state then thread replay', async () => {
    const thread: AgentEvent[] = [{ kind: 'userMessage', messageId: 'm1', text: 'Hello' }]
    const { port } = await start(fakeAgent(thread).runtime)
    const client = await connect(port)
    const state = await client.next()
    expect(state).toMatchObject({ t: 'state', plan: { name: 'Default hall' }, history: { canUndo: false } })
    expect(await client.next()).toEqual({ t: 'thread', events: thread })

    client.send({ t: 'hello' })
    expect((await client.next()).t).toBe('state')
    expect(await client.next()).toEqual({ t: 'thread', events: thread })
  })

  it('POST /api/command applies and broadcasts state to all ws clients', async () => {
    const { app, port } = await start()
    const a = await (await connect(port)).ready()
    const b = await (await connect(port)).ready()
    const res = await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Hall B') } })
    expect(res.statusCode).toBe(200)
    for (const client of [a, b]) {
      expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Hall B' }, history: { canUndo: true } })
    }
  })

  it('a ws command replies to the sender with commandResult', async () => {
    const { port } = await start()
    const client = await (await connect(port)).ready()
    client.send({ t: 'command', id: 'c1', command: rename('Over ws') })
    const messages = [await client.next(), await client.next()]
    expect(messages).toContainEqual({ t: 'commandResult', id: 'c1', ok: true })
    expect(messages).toContainEqual(expect.objectContaining({ t: 'state', plan: expect.objectContaining({ name: 'Over ws' }) }))

    client.send({ t: 'command', id: 'c2', command: rename('') })
    expect(await client.next()).toMatchObject({ t: 'commandResult', id: 'c2', ok: false, error: expect.stringMatching(/^payload\.name/) })
    expect(await client.quiet()).toEqual([])
  })

  it('undo/redo over ws', async () => {
    const { port } = await start()
    const client = await (await connect(port)).ready()
    client.send({ t: 'command', id: 'c1', command: rename('Renamed') })
    await client.next()
    await client.next()
    client.send({ t: 'undo' })
    expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Default hall' }, history: { canUndo: false, canRedo: true } })
    client.send({ t: 'redo' })
    expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Renamed' }, history: { canRedo: false } })
    client.send({ t: 'redo' })
    expect(await client.quiet()).toEqual([])
  })

  it('chat without agent returns a thread error event "The agent needs an API key in .env"', async () => {
    const { app, port } = await start()
    const client = await (await connect(port)).ready()
    client.send({ t: 'chat', text: 'What is the PUE?' })
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'userMessage', text: 'What is the PUE?' } })
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'error', message: 'The agent needs an API key in .env' } })

    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { text: 'Still there?' } })
    expect(res.statusCode).toBe(202)
    expect((await client.next()).t).toBe('agent')
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'error' } })

    const late = await connect(port)
    await late.next()
    const replay = await late.next()
    expect(replay.t === 'thread' && replay.events.map((e) => e.kind)).toEqual(['userMessage', 'error', 'userMessage', 'error'])
  })

  it('routes chat, resetChat and proposal actions to the agent', async () => {
    const agent = fakeAgent([{ kind: 'userMessage', messageId: 'm1', text: 'Old' }])
    const { port } = await start(agent.runtime)
    const a = await (await connect(port)).ready()
    const b = await (await connect(port)).ready()
    a.send({ t: 'chat', text: 'Cool row 3' })
    a.send({ t: 'proposal', proposalId: 'p1', action: 'apply' })
    a.send({ t: 'proposal', proposalId: 'p2', action: 'dismiss' })
    a.send({ t: 'resetChat' })
    for (const client of [a, b]) expect(await client.next()).toEqual({ t: 'thread', events: [] })
    expect(agent.calls).toEqual(['chat:Cool row 3', 'apply:p1', 'dismiss:p2', 'reset'])
  })

  it('broadcasts agent events and view actions, forwards client view actions, and feeds store changes to the agent', async () => {
    const agent = fakeAgent()
    const { app, port } = await start(agent.runtime)
    const a = await (await connect(port)).ready()
    const b = await (await connect(port)).ready()

    agent.emit({ kind: 'textDelta', messageId: 'm1', text: 'Row 3 is hot.' })
    agent.view({ type: 'setLayer', layer: 'cooling' })
    for (const client of [a, b]) {
      expect(await client.next()).toEqual({ t: 'agent', event: { kind: 'textDelta', messageId: 'm1', text: 'Row 3 is hot.' } })
      expect(await client.next()).toEqual({ t: 'view', action: { type: 'setLayer', layer: 'cooling' } })
    }

    a.send({ t: 'view', action: { type: 'setOverlay', overlay: 'air' } })
    expect(await b.next()).toEqual({ t: 'view', action: { type: 'setOverlay', overlay: 'air' } })
    expect(await a.quiet()).toEqual([])

    await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Watched') } })
    expect(agent.changes).toHaveLength(1)
    expect(agent.changes[0]).toMatchObject({ kind: 'command', author: 'user', summary: 'Plan renamed to Watched' })
  })

  it('a malformed message gets a plain reply and the connection stays usable', async () => {
    const { port } = await start()
    const client = await (await connect(port)).ready()
    client.socket.send('not json')
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'error', message: expect.stringContaining('could not read') } })
    client.send({ t: 'command', id: 'c9', command: { payload: {} } })
    expect(await client.next()).toMatchObject({ t: 'commandResult', id: 'c9', ok: false })
    client.send({ t: 'undo' })
    expect(await client.quiet()).toEqual([])
    client.send({ t: 'hello' })
    expect((await client.next()).t).toBe('state')
  })
})
