import type { Note } from '@twin/schema'
import s from './NoteBadge.module.css'

type NoteImportance = Note['importance']

export const IMPORTANCE_ORDER: readonly NoteImportance[] = ['must', 'prefer', 'fyi']

export const IMPORTANCE_LABEL: Record<NoteImportance, string> = { must: 'Must', prefer: 'Prefer', fyi: 'FYI' }

/** The most binding importance among the notes. */
function strongest(notes: Note[]): NoteImportance | null {
  return IMPORTANCE_ORDER.find((i) => notes.some((n) => n.importance === i)) ?? null
}

/**
 * Flag note marker, as on a drawing: the count of notes on a decision, drawn filled for "must",
 * outlined for "prefer" and dashed for "fyi". With no notes it is a faint flag that opens the editor.
 */
export function NoteBadge(props: {
  notes: Note[]
  subject: string
  expanded: boolean
  controls: string
  onToggle(): void
}) {
  const top = strongest(props.notes)
  const n = props.notes.length
  const name = top
    ? `${n} ${n === 1 ? 'note' : 'notes'}, ${IMPORTANCE_LABEL[top].toLowerCase()}. Add a note to ${props.subject}`
    : `Add a note to ${props.subject}`
  return (
    <button
      type="button"
      className={s.badge}
      data-importance={top ?? 'none'}
      aria-label={name}
      aria-expanded={props.expanded}
      aria-controls={props.expanded ? props.controls : undefined}
      title={name}
      onClick={props.onToggle}
    >
      <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true">
        <path className={s.flag} d="M1.5 1.5 H17 L22.5 7 L17 12.5 H1.5 Z" />
        {top ? (
          <text x="10" y="10.5" textAnchor="middle" className={s.count}>
            {n}
          </text>
        ) : (
          <path className={s.plus} d="M10 4.5 V9.5 M7.5 7 H12.5" />
        )}
      </svg>
    </button>
  )
}
