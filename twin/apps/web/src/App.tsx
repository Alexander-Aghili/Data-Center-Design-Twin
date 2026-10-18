import './theme/global.css'
import type { LayerId } from '@twin/schema'
import { useEffect, useState } from 'react'
import { Thread } from './agent/Thread'
import { AllVariables } from './panels/AllVariables'
import { DecisionPanel } from './panels/decisions'
import { Inspector } from './panels/Inspector'
import { LayerHeader } from './panels/LayerHeader'
import { SummaryPanel } from './panels/Summary'
import { RackBar } from './racks/RackBar'
import { RevisionClouds } from './scene/annotations/RevisionClouds'
import { Scene } from './scene/Scene'
import { tabId } from './shell/LayerTabs'
import { TopBar } from './shell/TopBar'
import { useTwinStore } from './state/store'
import { Strip } from './strips/Strip'

const CARD_ID = 'layer-card'
const PANEL_ID = 'layer-panel'
const SCHEMATIC_ID = 'layer-schematic'

/** The layers whose schematic strip can open under the scene, by the name its button uses. */
const SCHEMATICS: Partial<Record<LayerId, string>> = {
  site: 'hourly load',
  cooling: 'cooling chain',
  power: 'power one-line',
  network: 'network tiers',
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

/**
 * Two places to look: the scene in the middle, the summary and the agent on the right. The layer card on the
 * left collapses, the inspector opens over it, and the active layer's schematic opens under the scene on request.
 */
export function App() {
  const activeLayer = useTwinStore((s) => s.activeLayer)
  const [cardOpen, setCardOpen] = useState(true)
  const [schematicOpen, setSchematicOpen] = useState(false)
  const [allVariablesOpen, setAllVariablesOpen] = useState(false)
  const schematic = SCHEMATICS[activeLayer]
  useUndoShortcuts()

  return (
    <div className="shell" data-card={cardOpen ? 'open' : 'closed'}>
        <TopBar panelId={PANEL_ID} cardId={CARD_ID} cardOpen={cardOpen} onToggleCard={() => setCardOpen((open) => !open)} />
        <aside id={CARD_ID} className="layer-card" aria-label="Layer decisions" hidden={!cardOpen}>
          <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(activeLayer)}>
            <DecisionPanel layer={activeLayer} />
          </div>
        </aside>
        <main className="center" aria-label="Plan view">
          <div className="scene-stage">
            <Scene />
            <RevisionClouds />
            <div className="scene-overlays">
              <LayerHeader />
            </div>
            <div className="scene-dock">
              <RackBar />
              {schematic && (
                <button
                  type="button"
                  className="btn btn--secondary scene-dock__schematic"
                  aria-expanded={schematicOpen}
                  aria-controls={SCHEMATIC_ID}
                  onClick={() => setSchematicOpen((open) => !open)}
                >
                  {schematicOpen ? 'Hide' : 'Show'} {schematic}
                </button>
              )}
            </div>
          </div>
          {schematic && schematicOpen && (
            <div id={SCHEMATIC_ID} className="strip-slot">
              <Strip layer={activeLayer} />
            </div>
          )}
          {allVariablesOpen && <AllVariables onClose={() => setAllVariablesOpen(false)} />}
        </main>
        <div className="inspector-dock">
          <Inspector />
        </div>
        <div className="side">
          <section className="summary-region" aria-label="Plan totals">
            <SummaryPanel allOpen={allVariablesOpen} onToggleAll={() => setAllVariablesOpen((open) => !open)} />
          </section>
          <section className="agent-region" aria-label="Design agent">
            <Thread />
          </section>
        </div>
    </div>
  )
}
