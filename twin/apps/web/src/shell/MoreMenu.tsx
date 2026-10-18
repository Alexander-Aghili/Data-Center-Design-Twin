import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { CatalogBrowser } from '../catalog/CatalogBrowser'
import { ImportExport } from '../io/ImportExport'

/**
 * The top bar's ⋯ button: a disclosure holding Catalog, Import and Export plan. The panel stays mounted while
 * closed (only hidden), so the catalog dialog and the import report that its buttons open outlive the panel.
 */
export function MoreMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Runs after the chosen button's own handler. Focus goes back to ⋯ first, so a dialog that opens next
  // remembers ⋯ as the place to return focus to when it closes.
  const onPanelClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!open || !(e.target instanceof Element) || !e.target.closest('button')) return
    trigger.current?.focus()
    setOpen(false)
  }

  return (
    <div
      ref={root}
      className="more-menu"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        setOpen(false)
        trigger.current?.focus()
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn btn--quiet btn--icon"
        aria-label="More actions"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="13" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>
      <div
        id={panelId}
        className="more-menu__panel"
        role="group"
        aria-label="More actions"
        style={open ? undefined : { visibility: 'hidden' }}
        onClick={onPanelClick}
      >
        <CatalogBrowser />
        <ImportExport />
      </div>
    </div>
  )
}
