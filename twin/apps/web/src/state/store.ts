import {
  LAYER_DEFAULTS,
  type AgentEvent,
  type Annotation,
  type Command,
  type Evaluation,
  type HistoryInfo,
  type LayerId,
  type Overlay,
  type Plan,
  type Proposal,
  type ServerMsg,
  type ShotId,
  type ViewAction,
} from '@twin/schema'
import { registry } from '@twin/commands'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { SocketBackend, type Backend, type BackendStatus } from './backend'
import { LocalBackend } from './localBackend'

export interface TwinState {
  connection: BackendStatus
  plan: Plan | null
  evaluation: Evaluation | null
  history: HistoryInfo
  activeLayer: LayerId
  overlay: Overlay
  shot: ShotId
  selection: { kind: string; id: string } | null
  annotations: Annotation[]
  thread: AgentEvent[]
  proposals: Record<string, Proposal>
  previewProposalId: string | null
  /** Counts applied cooling changes; the scene refills the liquid network from the plant each time it rises. */
  pipeFill: number
  lastError: string | null
  /** Resolves when the command is applied; rejects with the reason (also stored in `lastError`). */
  send(cmd: Command): Promise<void>
  /** All or nothing, as one undo step (catalog packs). Rejects with the reason, also stored in `lastError`. */
  sendAll(commands: Command[]): Promise<void>
  undo(): void
  redo(): void
  chat(text: string): void
  applyProposal(id: string): void
  dismissProposal(id: string): void
  /** Starts a new agent conversation (offered after importing or starting a new plan). */
  resetChat(): void
  /** Local view change; also used for server-pushed view actions. */
  dispatchView(a: ViewAction): void
}

const FOCUS_SHOT: Record<'rack' | 'row' | 'equipment' | 'gpu' | 'bay', ShotId> = {
  rack: 'rack',
  row: 'row',
  equipment: 'hall',
  gpu: 'gpu',
  bay: 'row',
}

const CLOSE_UPS = new Set<ShotId>(['rack', 'tray', 'gpu'])

/** Pure view reducer shared by local and server-pushed view actions. */
export function reduceView(s: TwinState, a: ViewAction): Partial<TwinState> {
  switch (a.type) {
    case 'setLayer':
      return { activeLayer: a.layer, ...LAYER_DEFAULTS[a.layer] }
    case 'setOverlay':
      return { overlay: a.overlay }
    case 'focus':
      return { selection: a.target, shot: a.shot ?? FOCUS_SHOT[a.target.kind] }
    case 'select':
      return { selection: a.target }
    case 'annotate': {
      const annotations = [...s.annotations.filter((x) => x.tag !== a.annotation.tag), a.annotation]
      // From inside a rack the hall-scale cloud cannot be seen, so a problem pulls the camera back out.
      return a.annotation.severity === 'problem' && CLOSE_UPS.has(s.shot) ? { annotations, shot: 'hall' } : { annotations }
    }
    case 'clearAnnotations':
      return { annotations: [] }
    case 'previewProposal':
      // The ghost and the proposal's clouds need the whole hall in view.
      return a.proposalId === null ? { previewProposalId: null } : { previewProposalId: a.proposalId, shot: 'hall' }
  }
}

function withProposalEvent(proposals: Record<string, Proposal>, e: AgentEvent): Record<string, Proposal> {
  if (e.kind === 'proposal') return { ...proposals, [e.proposal.id]: e.proposal }
  const proposal = e.kind === 'proposalStatus' ? proposals[e.proposalId] : undefined
  if (e.kind === 'proposalStatus' && proposal) return { ...proposals, [proposal.id]: { ...proposal, status: e.status } }
  return proposals
}

const changesCooling = (p: Proposal | undefined) => p?.commands.some((c) => registry.get(c.type)?.layer === 'cooling') === true

/**
 * A settled proposal is no longer previewed, and its revision cloud goes. An applied one sends the camera back to the hall to show the result;
 * a cooling change also opens the cooling layer and fills the pipes from the plant outward.
 */
function settleView(s: TwinState, proposalId: string, status: Proposal['status']): Partial<TwinState> {
  if (status === 'open') return {}
  const tag = s.proposals[proposalId]?.annotationTag
  const preview = {
    ...(s.previewProposalId === proposalId ? { previewProposalId: null } : {}),
    ...(tag === undefined ? {} : { annotations: s.annotations.filter((a) => a.tag !== tag) }),
  }
  if (status !== 'applied') return preview
  if (!changesCooling(s.proposals[proposalId])) return { ...preview, shot: 'hall' }
  // The hall-wide pipe fill is the point of this moment, so a rack close-up and its inspector close.
  return { ...preview, activeLayer: 'cooling', ...LAYER_DEFAULTS.cooling, shot: 'hall', selection: null, pipeFill: s.pipeFill + 1 }
}

export interface TwinStoreOptions {
  backend: Backend
  /** Backend to switch to when the primary one goes offline before ever connecting. */
  fallback?: () => Backend
}

export function createTwinStore({ backend, fallback }: TwinStoreOptions): UseBoundStore<StoreApi<TwinState>> {
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()
  let active = backend
  let everOnline = false

  const store = create<TwinState>()((set, get) => {
    const post = (m: Parameters<Backend['send']>[0]) => {
      try {
        active.send(m)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    }
    return {
      connection: 'connecting',
      plan: null,
      evaluation: null,
      history: { canUndo: false, canRedo: false },
      activeLayer: 'cooling',
      ...LAYER_DEFAULTS.cooling,
      selection: null,
      annotations: [],
      thread: [],
      proposals: {},
      previewProposalId: null,
      pipeFill: 0,
      lastError: null,
      send(command) {
        const id = globalThis.crypto.randomUUID()
        return new Promise<void>((resolve, reject) => {
          pending.set(id, { resolve, reject })
          try {
            active.send({ t: 'command', id, command })
          } catch (error) {
            pending.delete(id)
            const message = error instanceof Error ? error.message : String(error)
            set({ lastError: message })
            reject(new Error(message))
          }
        })
      },
      async sendAll(commands) {
        try {
          await active.sendAll(commands)
          set({ lastError: null })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          set({ lastError: message })
          throw new Error(message)
        }
      },
      undo: () => post({ t: 'undo' }),
      redo: () => post({ t: 'redo' }),
      chat: (text) => post({ t: 'chat', text }),
      applyProposal: (proposalId) => post({ t: 'proposal', proposalId, action: 'apply' }),
      dismissProposal: (proposalId) => post({ t: 'proposal', proposalId, action: 'dismiss' }),
      resetChat: () => post({ t: 'resetChat' }),
      dispatchView: (a) => set(reduceView(get(), a)),
    }
  })

  const onMsg = (m: ServerMsg) => {
    const s = store.getState()
    switch (m.t) {
      case 'state':
        store.setState({ plan: m.plan, evaluation: m.evaluation, history: m.history })
        return
      case 'commandResult': {
        const waiter = pending.get(m.id)
        pending.delete(m.id)
        if (m.ok) {
          store.setState({ lastError: null })
          waiter?.resolve()
        } else {
          const message = m.error ?? 'The command was rejected'
          store.setState({ lastError: message })
          waiter?.reject(new Error(message))
        }
        return
      }
      case 'agent': {
        const e = m.event
        store.setState({
          thread: [...s.thread, e],
          proposals: withProposalEvent(s.proposals, e),
          ...(e.kind === 'proposalStatus' ? settleView(s, e.proposalId, e.status) : {}),
        })
        return
      }
      case 'thread':
        store.setState({ thread: m.events, proposals: m.events.reduce(withProposalEvent, {}) })
        return
      case 'view':
        s.dispatchView(m.action)
        return
    }
  }

  // Messages and status from a backend that is no longer active are ignored.
  const attach = (b: Backend) => {
    active = b
    b.connect(
      (m) => {
        if (active === b) onMsg(m)
      },
      (status) => {
        if (active !== b) return
        if (status === 'online' || status === 'local') everOnline = true
        if (status === 'offline' && !everOnline && fallback) {
          const next = fallback()
          fallback = undefined
          attach(next)
          return
        }
        store.setState({ connection: status })
      },
    )
  }

  attach(backend)
  return store
}

const localOnly = new URLSearchParams(location.search).get('local') === '1'

export const useTwinStore = createTwinStore(
  localOnly
    ? { backend: new LocalBackend() }
    : { backend: new SocketBackend(), fallback: () => new LocalBackend() },
)
