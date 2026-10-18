import { LAYER_IDS, type LayerId } from '@twin/schema'
import { useRef, type KeyboardEvent } from 'react'
import { StatusMark } from '../panels/StatusMark'
import { useTwinStore } from '../state/store'
import { issuesByLayer, LAYER_NAMES, tabLabels } from './layers'

const NO_CHECKS = [] as const
const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 }

export const tabId = (layer: LayerId) => `layer-tab-${layer}`

/**
 * The seven planning layers as a segmented tab control. Each tab shows its open issues by shape and count;
 * its accessible name adds the layer's owner. Arrow keys move and activate (wrapping), Home and End jump.
 */
export function LayerTabs({ panelId }: { panelId: string }) {
  const owners = useTwinStore((s) => s.plan?.owners)
  const checks = useTwinStore((s) => s.evaluation?.checks) ?? NO_CHECKS
  const activeLayer = useTwinStore((s) => s.activeLayer)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const list = useRef<HTMLDivElement>(null)
  const labels = tabLabels(owners, checks)
  const issues = issuesByLayer(checks)

  const choose = (layer: LayerId) => dispatchView({ type: 'setLayer', layer })

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = LAYER_IDS.length
    const step = ARROW_STEPS[e.key]
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step === undefined ? null : (index + step + n) % n
    if (next === null) return
    e.preventDefault()
    choose(LAYER_IDS[next]!)
    list.current?.querySelector<HTMLButtonElement>(`#${tabId(LAYER_IDS[next]!)}`)?.focus()
  }

  return (
    <div ref={list} className="layer-tabs" role="tablist" aria-label="Layers">
      {LAYER_IDS.map((id, i) => {
        const selected = id === activeLayer
        const { fail, warn } = issues[id]
        return (
          <button
            key={id}
            id={tabId(id)}
            type="button"
            role="tab"
            className="layer-tab"
            aria-label={labels[id]}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            title={owners?.[id]?.name}
            onClick={() => choose(id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="layer-tab__name">{LAYER_NAMES[id]}</span>
            {fail > 0 && <StatusMark status="fail" label={String(fail)} />}
            {warn > 0 && <StatusMark status="warn" label={String(warn)} />}
          </button>
        )
      })}
    </div>
  )
}
