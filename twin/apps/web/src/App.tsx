import './theme/global.css'
import type { LayerId } from '@twin/schema'
import { useEffect, useState, type ReactNode } from 'react'
import { Thread } from './agent/Thread'
import { CatalogBrowser } from './catalog/CatalogBrowser'
import { ImportExport } from './io/ImportExport'
import { AllVariables } from './panels/AllVariables'
import { DecisionPanel } from './panels/decisions'
import { Inspector } from './panels/Inspector'
import { LayerHeader } from './panels/LayerHeader'
import { LayerList } from './panels/LayerList'
import { Totals } from './panels/Totals'
import { RevisionClouds } from './scene/annotations/RevisionClouds'
import { Scene } from './scene/Scene'
import { useTwinStore } from './state/store'
import { Strip } from './strips/Strip'

const CONNECTION_NOTE = {
  connecting: 'Connecting…',
  online: null,
  local: 'Local mode. The design agent needs the server.',
  offline: 'Offline. Start the server with npm run dev.',
} as const

function revisedAt(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/** ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes, except while typing in a field. */
function useUndoShortcuts() {
  const undo = useTwinStore((s) => s.undo)
  const redo = useTwinStore((s) => s.redo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' || key === 'y') {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}

function TopBar() {
  const name = useTwinStore((s) => s.plan?.name)
  const updatedAt = useTwinStore((s) => s.plan?.updatedAt)
  const connection = useTwinStore((s) => s.connection)
  const history = useTwinStore((s) => s.history)
  const undo = useTwinStore((s) => s.undo)
  const redo = useTwinStore((s) => s.redo)
  const note = CONNECTION_NOTE[connection]
  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1 className="topbar__plan">{name ?? 'Data center design twin'}</h1>
        {updatedAt && <span className="topbar__meta">Revised {revisedAt(updatedAt)}</span>}
        {note && (
          <span className="topbar__meta" role="status">
            {note}
          </span>
        )}
      </div>
      <div className="topbar__actions">
        <button type="button" className="btn btn--quiet" disabled={!history.canUndo} onClick={undo} aria-keyshortcuts="Meta+Z Control+Z">
          Undo
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={!history.canRedo}
          onClick={redo}
          aria-keyshortcuts="Meta+Shift+Z Control+Y"
        >
          Redo
        </button>
        <span className="topbar__divider" aria-hidden="true" />
        <CatalogBrowser />
        <ImportExport />
      </div>
    </header>
  )
}

function LayerColumn({ children }: { children: ReactNode }) {
  return (
    <aside className="layer-column" aria-label="Layers and decisions">
      {children}
    </aside>
  )
}

/** Center column: overlay switcher, the 3D scene with its annotations and inspector, then the layer strip. */
function SceneRegion({ layer, children }: { layer: LayerId; children?: ReactNode }) {
  return (
    <main className="center" aria-label="Plan view">
      <LayerHeader />
      <div className="scene-stage">
        <Scene />
        <div className="scene-stage__annotations">
          <RevisionClouds />
        </div>
        <Inspector />
      </div>
      <div className="strip-slot">
        <Strip layer={layer} />
      </div>
      {children}
    </main>
  )
}

function TotalsRegion({ children }: { children: ReactNode }) {
  return (
    <section className="totals-region" aria-label="Plan totals">
      {children}
    </section>
  )
}

function AgentRegion({ children }: { children: ReactNode }) {
  return (
    <section className="agent-region" aria-label="Design agent">
      {children}
    </section>
  )
}

export function App() {
  const activeLayer = useTwinStore((s) => s.activeLayer)
  const [allVariablesOpen, setAllVariablesOpen] = useState(false)
  useUndoShortcuts()

  return (
    <div className="shell">
      <TopBar />
      <LayerColumn>
        <LayerList />
        <DecisionPanel layer={activeLayer} />
      </LayerColumn>
      <SceneRegion layer={activeLayer}>
        {allVariablesOpen && <AllVariables onClose={() => setAllVariablesOpen(false)} />}
      </SceneRegion>
      <div className="side">
        <TotalsRegion>
          <Totals allOpen={allVariablesOpen} onToggleAll={() => setAllVariablesOpen((open) => !open)} />
        </TotalsRegion>
        <AgentRegion>
          <Thread />
        </AgentRegion>
      </div>
    </div>
  )
}
