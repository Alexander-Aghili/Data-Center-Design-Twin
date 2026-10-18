import { EventEmitter } from 'node:events'
import type { AgentEvent, AgentStatus, ServerMsg, ViewAction } from '@twin/schema'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { createApp } from '../src/app'
import type { AgentRuntime, StoreChange } from '../src/contracts'
import { createPlanStore } from '../src/store'
import { createHub, STATE_PUSH_DELAY_MS, STATE_PUSH_MAX_WAIT_MS } from '../src/ws'
import { rename, setClimate, tempDataDir, testBuiltins, testRegistry } from './helpers/fixtures'

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

function fakeAgent(thread: AgentEvent[] = [], status: AgentStatus | null = null) {
  const eventListeners = new Set<(e: AgentEvent) => void>()
  const statusListeners = new Set<(s: AgentStatus) => void>()
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
    stopTurn: () => calls.push('stop'),
    setAutoReview: (on) => calls.push(`autoReview:${on}`),
    status: () => status,
    onStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
  }
  return {
    runtime,
    calls,
    changes,
    setStatus: (s: AgentStatus) => statusListeners.forEach((cb) => cb(s)),
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

  it('a ws command replies to the sender with commandResult, after the state it produced', async () => {
    const { port } = await start()
    const client = await (await connect(port)).ready()
    client.send({ t: 'command', id: 'c1', command: rename('Over ws') })
    expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Over ws' } })
    expect(await client.next()).toEqual({ t: 'commandResult', id: 'c1', ok: true })

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

  it('sends the agent status after the thread, broadcasts its changes, and routes stop and settings to the agent', async () => {
    const idle: AgentStatus = { running: false, turnUsd: 0, todayUsd: 0.42, dailyBudgetUsd: 5, budgetSpent: false, autoReview: true }
    const agent = fakeAgent([], idle)
    const { port } = await start(agent.runtime)
    const a = await (await connect(port)).ready()
    expect(await a.next()).toEqual({ t: 'agentStatus', status: idle })
    const b = await (await connect(port)).ready()
    expect(await b.next()).toEqual({ t: 'agentStatus', status: idle })

    const working = { ...idle, running: true, turnUsd: 0.03 }
    agent.setStatus(working)
    for (const client of [a, b]) expect(await client.next()).toEqual({ t: 'agentStatus', status: working })

    a.send({ t: 'stopTurn' })
    a.send({ t: 'agentSettings', autoReview: false })
    a.send({ t: 'hello' })
    expect((await a.next()).t).toBe('state')
    expect((await a.next()).t).toBe('thread')
    expect(await a.next()).toEqual({ t: 'agentStatus', status: idle })
    expect(agent.calls).toEqual(['stop', 'autoReview:false'])
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

  it('sends the hourly series in a client\'s first state, then only when it changes', async () => {
    const { app, port } = await start()
    const a = await connect(port)
    const first = await a.next()
    if (first.t !== 'state') throw new Error('expected state first')
    expect(first.hourlyVersion).toBe(1)
    expect(first.evaluation.hourly?.outdoorC).toHaveLength(8760)
    await a.next()

    await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Same weather') } })
    const renamed = await a.next()
    expect(renamed).toMatchObject({ t: 'state', plan: { name: 'Same weather' }, hourlyVersion: 1 })
    expect(renamed.t === 'state' && 'hourly' in renamed.evaluation).toBe(false)
    expect(JSON.stringify(renamed).length).toBeLessThan(JSON.stringify(first).length / 3)

    const b = await connect(port)
    const late = await b.next()
    expect(late).toMatchObject({ t: 'state', plan: { name: 'Same weather' }, hourlyVersion: 1 })
    expect(late.t === 'state' && late.evaluation.hourly).toEqual(first.evaluation.hourly)
    await b.next()

    await app.inject({ method: 'POST', url: '/api/command', payload: { command: setClimate('climate.phoenix') } })
    for (const client of [a, b]) {
      const hotter = await client.next()
      expect(hotter).toMatchObject({ t: 'state', hourlyVersion: 2 })
      expect(hotter.t === 'state' && hotter.evaluation.hourly?.outdoorC).not.toEqual(first.evaluation.hourly?.outdoorC)
    }

    a.send({ t: 'hello' })
    const again = await a.next()
    expect(again.t === 'state' && again.hourlyVersion === 2 && again.evaluation.hourly?.outdoorC.length).toBe(8760)
  })

  it('a burst of changes goes out as one state push', async () => {
    const { app, port } = await start()
    const client = await (await connect(port)).ready()
    for (const name of ['A', 'B', 'C']) await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename(name) } })
    const pushed = await client.quiet()
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ t: 'state', plan: { name: 'C' }, history: { canUndo: true, last: 'Plan renamed to C' } })
  })

  it('a pending state push goes out before a view action or a proposal status, so they never refer to a plan the client lacks', async () => {
    const agent = fakeAgent()
    const { app, port } = await start(agent.runtime)
    const client = await (await connect(port)).ready()
    await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Focused') } })
    agent.view({ type: 'focus', target: { kind: 'rack', id: 'R1-01' } })
    expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Focused' } })
    expect(await client.next()).toMatchObject({ t: 'view' })

    await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Applied') } })
    agent.emit({ kind: 'toolResult', callId: 't1', ok: true, summary: 'Renamed', numbers: [] })
    agent.emit({ kind: 'proposalStatus', proposalId: 'p1', status: 'applied' })
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'toolResult' } })
    expect(await client.next()).toMatchObject({ t: 'state', plan: { name: 'Applied' } })
    expect(await client.next()).toMatchObject({ t: 'agent', event: { kind: 'proposalStatus' } })
    expect(await client.quiet()).toEqual([])
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

/** Stands in for a `ws` socket so state push timing can run on fake timers. */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN
  readonly sent: ServerMsg[] = []
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMsg)
  }
  close() {
    this.readyState = WebSocket.CLOSED
  }
}

describe('state push timing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function hubWithSocket() {
    vi.useFakeTimers()
    const store = createPlanStore({ dataDir: tempDataDir(), builtins: testBuiltins(), registry: testRegistry(), onWarning: () => {} })
    const hub = createHub({ store, agent: fakeAgent().runtime, log: Fastify().log })
    const socket = new FakeSocket()
    hub.connect(socket as unknown as WebSocket)
    socket.sent.length = 0
    const states = () => socket.sent.filter((m): m is Extract<ServerMsg, { t: 'state' }> => m.t === 'state')
    return { store, hub, states }
  }

  it('waits for a pause in the changes, then pushes the latest state once', () => {
    const { store, hub, states } = hubWithSocket()
    for (let i = 1; i <= 9; i++) store.dispatch(rename(`Step ${i}`), 'agent')
    vi.advanceTimersByTime(STATE_PUSH_DELAY_MS - 1)
    store.dispatch(rename('Step 10'), 'agent')
    vi.advanceTimersByTime(STATE_PUSH_DELAY_MS - 1)
    expect(states()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(states().map((m) => m.plan.name)).toEqual(['Step 10'])
    hub.close()
  })

  it('a steady stream of changes still pushes state at least every max wait', () => {
    const { store, hub, states } = hubWithSocket()
    const stepMs = STATE_PUSH_DELAY_MS / 2
    const steps = Math.ceil((3 * STATE_PUSH_MAX_WAIT_MS) / stepMs)
    for (let i = 1; i <= steps; i++) {
      store.dispatch(rename(`Step ${i}`), 'agent')
      vi.advanceTimersByTime(stepMs)
    }
    expect(states().length).toBeGreaterThanOrEqual(3)
    vi.advanceTimersByTime(STATE_PUSH_DELAY_MS)
    expect(states().at(-1)?.plan.name).toBe(`Step ${steps}`)
    hub.close()
  })

  it('close cancels a pending push', () => {
    const { store, hub, states } = hubWithSocket()
    store.dispatch(rename('Late'), 'user')
    hub.close()
    vi.advanceTimersByTime(STATE_PUSH_MAX_WAIT_MS)
    expect(states()).toEqual([])
  })
})
