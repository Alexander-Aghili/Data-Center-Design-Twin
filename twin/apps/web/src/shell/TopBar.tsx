import { useTwinStore } from '../state/store'
import { LayerTabs } from './LayerTabs'
import { MoreMenu } from './MoreMenu'

/** Visible note per connection state, plus the rest of the sentence for screen readers and the tooltip. */
const CONNECTION_NOTE = {
  connecting: { shown: 'Connecting…', more: '' },
  online: null,
  local: { shown: 'Local mode', more: '. The design agent needs the server.' },
  offline: { shown: 'Offline', more: '' },
} as const

function revisedAt(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const UNDO_ICON = 'M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7'
const REDO_ICON = 'M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9'
const CARD_ICON = 'M2.5 3.5h11v9h-11zM6.5 3.5v9'

interface TopBarProps {
  /** Id of the element the layer tabs control (the layer card's tab panel). */
  panelId: string
  /** Id of the collapsible layer card. */
  cardId: string
  cardOpen: boolean
  onToggleCard(): void
}

/** Plan name and status, the layer tabs, undo and redo, and the ⋯ menu. */
export function TopBar({ panelId, cardId, cardOpen, onToggleCard }: TopBarProps) {
  const name = useTwinStore((s) => s.plan?.name)
  const updatedAt = useTwinStore((s) => s.plan?.updatedAt)
  const connection = useTwinStore((s) => s.connection)
  const canUndo = useTwinStore((s) => s.history.canUndo)
  const canRedo = useTwinStore((s) => s.history.canRedo)
  const undo = useTwinStore((s) => s.undo)
  const redo = useTwinStore((s) => s.redo)
  const note = CONNECTION_NOTE[connection]

  return (
    <header className="topbar">
      <button
        type="button"
        className="btn btn--quiet btn--icon"
        aria-label={cardOpen ? 'Hide layer card' : 'Show layer card'}
        aria-expanded={cardOpen}
        aria-controls={cardId}
        title={cardOpen ? 'Hide layer card' : 'Show layer card'}
        onClick={onToggleCard}
      >
        <Icon d={CARD_ICON} />
      </button>
      <div className="topbar__title">
        <h1 className="topbar__plan">{name ?? 'Data center design twin'}</h1>
        {updatedAt && <span className="topbar__meta">Revised {revisedAt(updatedAt)}</span>}
        {note && (
          <span className="topbar__meta topbar__status" role="status" title={`${note.shown}${note.more}`}>
            {note.shown}
            {note.more && <span className="visually-hidden">{note.more}</span>}
          </span>
        )}
      </div>
      <LayerTabs panelId={panelId} />
      <div className="topbar__actions">
        <button
          type="button"
          className="btn btn--quiet btn--icon"
          aria-label="Undo"
          title="Undo (⌘Z or Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
          aria-keyshortcuts="Meta+Z Control+Z"
        >
          <Icon d={UNDO_ICON} />
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--icon"
          aria-label="Redo"
          title="Redo (⇧⌘Z or Ctrl+Y)"
          disabled={!canRedo}
          onClick={redo}
          aria-keyshortcuts="Meta+Shift+Z Control+Y"
        >
          <Icon d={REDO_ICON} />
        </button>
        <MoreMenu />
      </div>
    </header>
  )
}
