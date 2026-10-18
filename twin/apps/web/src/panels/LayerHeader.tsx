import type { LayerId, Overlay } from '@twin/schema'
import { useRef, type KeyboardEvent } from 'react'
import { WorkloadLegend } from '../scene/overlays/WorkloadTint'
import { useTwinStore } from '../state/store'

const OVERLAY_NAMES: Record<Overlay, string> = {
  liquid: 'Liquid',
  air: 'Air',
  temperature: 'Temperature',
  floorLoad: 'Floor load',
  power: 'Busway load',
  network: 'Cables',
  none: 'Off',
}

/**
 * Overlays that answer each layer's questions, the layer's default first. Site and Workload have no overlay
 * to choose: the scene shows site labels and the workload tint instead.
 */
const LAYER_OVERLAYS: Record<LayerId, readonly Overlay[]> = {
  site: [],
  workload: [],
  compute: ['temperature', 'liquid', 'none'],
  layout: ['floorLoad', 'air', 'none'],
  cooling: ['liquid', 'air', 'temperature', 'floorLoad', 'none'],
  power: ['power', 'none'],
  network: ['network', 'none'],
}

const FLOW_CAPTION = 'Illustrative flow, scaled from computed values'

const OVERLAY_HINTS: Record<Overlay, string | null> = {
  liquid: FLOW_CAPTION,
  air: FLOW_CAPTION,
  temperature: 'Racks colored by computed inlet and outlet temperature',
  floorLoad: 'Floor bays shaded by load against their rating',
  power: 'Busways colored by load against their rating',
  network: 'Cable runs from racks to leaf switches, copper and optical',
  none: null,
}

const SITE_HINT = 'Each site input at the place it enters the site'

/** The layer's overlays, plus the active one (and a way to turn it off) when the agent picked an overlay from another layer. */
function overlayChoices(layer: LayerId, active: Overlay): readonly Overlay[] {
  const choices = LAYER_OVERLAYS[layer]
  if (active === 'none' || choices.includes(active)) return choices
  return choices.length === 0 ? [active, 'none'] : [...choices, active]
}

const css = `
.layer-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: none;
  min-height: 48px;
  padding: var(--space-3) var(--space-4) var(--space-2);
}
.overlay-switch {
  display: inline-flex;
  flex: none;
  border: var(--rule);
  border-radius: var(--radius-control);
  background: var(--panel);
  overflow: hidden;
}
.overlay-switch__option {
  height: 28px;
  padding: 0 var(--space-3);
  border: 0;
  border-right: var(--rule);
  background: transparent;
  color: var(--graphite);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.overlay-switch__option:last-child {
  border-right: 0;
}
.overlay-switch__option:hover {
  background: var(--hover);
  color: var(--ink);
}
.overlay-switch__option[aria-checked='true'] {
  background: var(--ink);
  color: var(--ink-inverse);
}
.overlay-switch__option:focus-visible {
  outline-offset: -3px;
}
.overlay-switch__option[aria-checked='true']:focus-visible {
  outline-color: var(--ink-inverse);
}
.layer-header__hint {
  margin-left: auto;
  color: var(--graphite);
  font-size: var(--text-sm);
  font-stretch: var(--stretch-label);
  text-align: right;
}
`

function OverlaySwitch({ choices, active }: { choices: readonly Overlay[]; active: Overlay }) {
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const group = useRef<HTMLDivElement>(null)
  const choose = (overlay: Overlay) => dispatchView({ type: 'setOverlay', overlay })

  // Radio-group keys: arrows move the choice (wrapping), Home and End jump to the ends.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = choices.length - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    choose(choices[next]!)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div ref={group} className="overlay-switch" role="radiogroup" aria-label="Overlay">
      {choices.map((overlay, i) => {
        const checked = overlay === active
        return (
          <button
            key={overlay}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="overlay-switch__option"
            onClick={() => choose(overlay)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {OVERLAY_NAMES[overlay]}
          </button>
        )
      })}
    </div>
  )
}

/** Bar above the scene: the overlay switcher for the active layer and a line on what the scene shows. */
export function LayerHeader() {
  const layer = useTwinStore((s) => s.activeLayer)
  const overlay = useTwinStore((s) => s.overlay)
  const choices = overlayChoices(layer, overlay)
  const hint = OVERLAY_HINTS[overlay] ?? (layer === 'site' ? SITE_HINT : null)

  return (
    <div className="layer-header">
      <style href="twin-layer-header" precedence="twin">
        {css}
      </style>
      {choices.length > 0 && <OverlaySwitch choices={choices} active={overlay} />}
      {layer === 'workload' && overlay === 'none' ? <WorkloadLegend /> : hint && <p className="layer-header__hint">{hint}</p>}
    </div>
  )
}
