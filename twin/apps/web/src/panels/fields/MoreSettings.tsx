import { createContext, use, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { Note } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { IMPORTANCE_LABEL, IMPORTANCE_ORDER } from '../notes/NoteBadge'
import s from './MoreSettings.module.css'

/** Lets fields inside a closed disclosure report their note targets, so the toggle can count their notes. */
const TargetsContext = createContext<((target: string) => () => void) | null>(null)

/** Registers a note target with the enclosing "More settings", if any. */
export function useTrackTarget(target: string): void {
  const track = use(TargetsContext)
  useEffect(() => (target ? track?.(target) : undefined), [track, target])
}

/**
 * The secondary decisions of a layer, kept mounted (drafts and errors survive) but hidden until opened.
 * When fields inside carry notes, the toggle says so, so a closed section never hides a "must".
 */
export function MoreSettings(props: { children: ReactNode; label?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<ReadonlyMap<string, number>>(new Map())
  const track = useCallback((target: string) => {
    setTargets((m) => new Map(m).set(target, (m.get(target) ?? 0) + 1))
    return () =>
      setTargets((m) => {
        const next = new Map(m)
        const n = (next.get(target) ?? 1) - 1
        if (n > 0) next.set(target, n)
        else next.delete(target)
        return next
      })
  }, [])
  const notes = useTwinStore((st) => st.plan?.notes)
  const inside = useMemo<Note[]>(() => (notes ?? []).filter((n) => targets.has(n.target)), [notes, targets])
  const top = IMPORTANCE_ORDER.find((i) => inside.some((n) => n.importance === i))
  const label = props.label ?? 'More settings'

  return (
    <div className={s.more} data-open={open || undefined}>
      <button type="button" className={s.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <svg className={s.chevron} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3 1.5 L6.5 5 L3 8.5" />
        </svg>
        <span className={s.label}>{label}</span>
        {top && (
          <span className={s.notes} data-importance={top}>
            {inside.length} {inside.length === 1 ? 'note' : 'notes'}
            <span className="visually-hidden">, {IMPORTANCE_LABEL[top].toLowerCase()}</span>
          </span>
        )}
      </button>
      <div id={id} className={s.body} hidden={!open}>
        <TargetsContext value={track}>{props.children}</TargetsContext>
      </div>
    </div>
  )
}
