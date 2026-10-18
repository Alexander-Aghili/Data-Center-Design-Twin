import { createContext, use, useId, useMemo, useState, type ReactNode } from 'react'
import type { Note } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { NoteBadge } from '../notes/NoteBadge'
import { NoteEditor, NoteList } from '../notes/NoteEditor'
import { useTrackTarget } from './MoreSettings'
import s from './Field.module.css'

/** Props that name a control by the field's label and tie it to the field's error. */
export interface ControlA11y {
  'aria-labelledby': string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

interface FieldContextValue {
  /** Id for the field's main control element. */
  controlId: string
  /** Id of the visible label. */
  labelId: string
  /** Spread on the control (input, select, radiogroup). */
  a11y: ControlA11y
  /** Tracks a command's result; a rejection shows under the field. */
  run(result: void | Promise<void>): void
  /** Shows a local validation message, or clears it with null. */
  setError(message: string | null): void
}

const FieldContext = createContext<FieldContextValue | null>(null)

/** Ids and error reporting of the enclosing field; controls also work outside one. */
export function useField(): FieldContextValue {
  const fallbackId = useId()
  return (
    use(FieldContext) ?? {
      controlId: fallbackId,
      labelId: `${fallbackId}-label`,
      a11y: { 'aria-labelledby': `${fallbackId}-label` },
      run: () => {},
      setError: () => {},
    }
  )
}

/** The message of a rejection, whatever was thrown. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function useNotes(target: string): Note[] {
  const notes = useTwinStore((st) => st.plan?.notes)
  return useMemo(() => (notes ?? []).filter((n) => n.target === target), [notes, target])
}

/** Note badge, the notes themselves and the editor, for one note target. */
export function useNoted(target: string, subject: string) {
  useTrackTarget(target)
  const notes = useNotes(target)
  const [editing, setEditing] = useState(false)
  const editorId = useId()
  const badge = (
    <NoteBadge notes={notes} subject={subject} expanded={editing} controls={editorId} onToggle={() => setEditing((v) => !v)} />
  )
  const body = (
    <>
      {notes.length > 0 && <NoteList notes={notes} />}
      {editing && (
        <div id={editorId}>
          <NoteEditor target={target} onAdded={() => setEditing(false)} />
        </div>
      )}
    </>
  )
  return { badge, body }
}

/**
 * One decision: label, note badge, the control, an optional hint, errors and notes.
 * Without a `target` it is a plain labelled control with no notes of its own.
 */
export function Field(props: { label: string; target?: string; hint?: ReactNode; children?: ReactNode }) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const { badge, body } = useNoted(props.target ?? '', props.label)
  const errorId = `${id}-error`
  const ctx = useMemo<FieldContextValue>(
    () => ({
      controlId: `${id}-control`,
      labelId: `${id}-label`,
      a11y: error ? { 'aria-labelledby': `${id}-label`, 'aria-invalid': true, 'aria-describedby': errorId } : { 'aria-labelledby': `${id}-label` },
      setError,
      run: (result) => {
        setError(null)
        result?.catch((e: unknown) => setError(errorMessage(e)))
      },
    }),
    [id, error, errorId],
  )
  return (
    <div className={s.field} data-note-target={props.target}>
      <div className={s.head}>
        <span id={ctx.labelId} className={s.label}>
          {props.label}
        </span>
        {props.target && badge}
      </div>
      <FieldContext value={ctx}>{props.children}</FieldContext>
      {props.hint && <div className={s.hint}>{props.hint}</div>}
      {error && (
        <p id={errorId} role="alert" className={s.error}>
          ✕ {error}
        </p>
      )}
      {props.target && body}
    </div>
  )
}

/** A titled set of fields that carries its own notes, e.g. a rack group. */
export function FieldGroup(props: { title: ReactNode; subject: string; target: string; meta?: ReactNode; children: ReactNode }) {
  const titleId = useId()
  const { badge, body } = useNoted(props.target, props.subject)
  return (
    <section className={s.group} aria-labelledby={titleId} data-note-target={props.target}>
      <div className={s.groupHead}>
        <h3 id={titleId} className={s.groupTitle}>
          {props.title}
        </h3>
        {badge}
      </div>
      {props.meta && <div className={s.groupMeta}>{props.meta}</div>}
      {body}
      {props.children}
    </section>
  )
}

/** A fixed or derived value shown beside the decisions, not editable here. */
export function ReadOnly(props: { label: string; children: ReactNode }) {
  return (
    <div className={s.readOnly}>
      <span className={s.label}>{props.label}</span>
      <span className={s.value}>{props.children}</span>
    </div>
  )
}
