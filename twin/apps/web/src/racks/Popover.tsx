import { useEffect, useRef, useState, type ReactNode } from 'react'
import s from './racks.module.css'

/**
 * Non-modal panel above the rack bar. Takes focus when it opens so the next Tab lands on its first control;
 * Escape closes it (and is marked handled, so the inspector drawer stays open).
 */
export function Popover(props: { labelledBy: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={props.labelledBy}
      tabIndex={-1}
      className={s.popover}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        props.onClose()
      }}
    >
      {props.children}
    </div>
  )
}

export function PopoverHeader(props: { children: ReactNode; onClose(): void }) {
  return (
    <header className={s.head}>
      <div className={s.headMain}>{props.children}</div>
      <button type="button" className={`btn btn--quiet ${s.close}`} onClick={props.onClose}>
        Close
      </button>
    </header>
  )
}

export function Section(props: { label: string; id: string; children: ReactNode }) {
  return (
    <section className={s.section} aria-labelledby={props.id}>
      <h3 id={props.id} className={s.sectionLabel}>
        {props.label}
      </h3>
      {props.children}
    </section>
  )
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs a command promise and keeps its rejection reason for the panel to show. */
export function useCommandResult() {
  const [error, setError] = useState<string | null>(null)
  const run = (result: Promise<void>): Promise<boolean> =>
    result.then(
      () => {
        setError(null)
        return true
      },
      (e: unknown) => {
        setError(messageOf(e))
        return false
      },
    )
  return { error, setError, run }
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className={s.error}>
      ✕ {error}
    </p>
  ) : null
}
