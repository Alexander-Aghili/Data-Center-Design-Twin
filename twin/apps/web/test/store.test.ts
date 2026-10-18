import type { ClientMsg, Proposal, ServerMsg } from '@twin/schema'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Backend, BackendStatus } from '../src/state/backend'
import type { createTwinStore as CreateTwinStore } from '../src/state/store'

class FakeBackend implements Backend {
  sent: ClientMsg[] = []
  onMsg: (m: ServerMsg) => void = () => {}
  onStatus: (s: BackendStatus) => void = () => {}
  connect(onMsg: (m: ServerMsg) => void, onStatus?: (s: BackendStatus) => void) {
    this.onMsg = onMsg
    if (onStatus) this.onStatus = onStatus
  }
  send(m: ClientMsg) {
    this.sent.push(m)
  }
}

let createTwinStore: typeof CreateTwinStore

beforeAll(async () => {
  // The module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ createTwinStore } = await import('../src/state/store'))
})

const proposal: Proposal = {
  id: 'p1',
  title: 'Liquid cooling for rows 3–5',
  rationale: 'Air cannot carry the heat.',
  commands: [],
  respectsNotes: [],
  violatesNotes: [],
  diff: { headline: {}, worsened: [], improved: [], resolved: [], newChecks: [], capexDeltaUsd: 0, buildWeeksDelta: 0, waterDeltaM3PerDay: 0 },
  status: 'open',
  basePlanUpdatedAt: '2026-10-18T00:00:00.000Z',
}

describe('twin store', () => {
  it('send resolves on an ok commandResult and rejects with the error otherwise', async () => {
    const backend = new FakeBackend()
    const store = createTwinStore({ backend })
    const cmd = { type: 'renamePlan', payload: { name: 'B' } }

    const ok = store.getState().send(cmd)
    const first = backend.sent[0]
    if (first?.t !== 'command') throw new Error('expected a command message')
    backend.onMsg({ t: 'commandResult', id: first.id, ok: true })
    await expect(ok).resolves.toBeUndefined()

    const bad = store.getState().send(cmd)
    const second = backend.sent[1]
    if (second?.t !== 'command') throw new Error('expected a command message')
    backend.onMsg({ t: 'commandResult', id: second.id, ok: false, error: 'Slot R3-07 is taken by R3-07' })
    await expect(bad).rejects.toThrow('Slot R3-07 is taken')
    expect(store.getState().lastError).toBe('Slot R3-07 is taken by R3-07')
  })

  it('setLayer applies the layer defaults; focus selects and picks a shot', () => {
    const store = createTwinStore({ backend: new FakeBackend() })
    store.getState().dispatchView({ type: 'setLayer', layer: 'compute' })
    expect(store.getState()).toMatchObject({ activeLayer: 'compute', shot: 'gpu', overlay: 'temperature' })
    store.getState().dispatchView({ type: 'focus', target: { kind: 'rack', id: 'R3-07' } })
    expect(store.getState()).toMatchObject({ selection: { kind: 'rack', id: 'R3-07' }, shot: 'rack' })
  })

  it('tracks state, proposals and server view actions', () => {
    const backend = new FakeBackend()
    const store = createTwinStore({ backend })
    backend.onStatus('online')
    backend.onMsg({ t: 'agent', event: { kind: 'proposal', messageId: 'm1', proposal } })
    backend.onMsg({ t: 'agent', event: { kind: 'proposalStatus', proposalId: 'p1', status: 'applied' } })
    backend.onMsg({ t: 'view', action: { type: 'setOverlay', overlay: 'air' } })
    expect(store.getState().connection).toBe('online')
    expect(store.getState().proposals.p1?.status).toBe('applied')
    expect(store.getState().thread).toHaveLength(2)
    expect(store.getState().overlay).toBe('air')
    backend.onMsg({ t: 'thread', events: [{ kind: 'proposal', messageId: 'm1', proposal }] })
    expect(store.getState().proposals.p1?.status).toBe('open')
  })

  it('settling the previewed proposal ends the preview; applying it returns the camera to the hall', () => {
    const backend = new FakeBackend()
    const store = createTwinStore({ backend })
    backend.onMsg({ t: 'agent', event: { kind: 'proposal', messageId: 'm1', proposal } })
    backend.onMsg({ t: 'agent', event: { kind: 'proposal', messageId: 'm1', proposal: { ...proposal, id: 'p2' } } })
    store.getState().dispatchView({ type: 'setLayer', layer: 'compute' })
    store.getState().dispatchView({ type: 'previewProposal', proposalId: 'p1' })
    backend.onMsg({ t: 'agent', event: { kind: 'proposalStatus', proposalId: 'p2', status: 'dismissed' } })
    expect(store.getState()).toMatchObject({ previewProposalId: 'p1', shot: 'gpu' })
    backend.onMsg({ t: 'agent', event: { kind: 'proposalStatus', proposalId: 'p1', status: 'applied' } })
    expect(store.getState()).toMatchObject({ previewProposalId: null, shot: 'hall' })
  })

  it('resetChat asks the server for a new conversation', () => {
    const backend = new FakeBackend()
    const store = createTwinStore({ backend })
    store.getState().resetChat()
    expect(backend.sent).toEqual([{ t: 'resetChat' }])
  })

  it('switches to the fallback backend when the first never connects', () => {
    const primary = new FakeBackend()
    const local = new FakeBackend()
    const store = createTwinStore({ backend: primary, fallback: () => local })
    primary.onStatus('offline')
    local.onStatus('local')
    primary.onStatus('offline')
    expect(store.getState().connection).toBe('local')
  })
})

describe('LocalBackend', () => {
  it('runs offline on the bundled catalog, without fetching it from the server', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no server')))
    vi.stubGlobal('fetch', fetchSpy)
    const { LocalBackend } = await import('../src/state/localBackend')
    const statuses: BackendStatus[] = []
    const msgs: ServerMsg[] = []
    new LocalBackend().connect((m) => msgs.push(m), (s) => statuses.push(s))
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('local'))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(msgs.find((m) => m.t === 'state')).toBeDefined()
  })
})
