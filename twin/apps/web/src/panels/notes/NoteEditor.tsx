import { useId, useState } from 'react'
import type { Note } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { errorMessage } from '../fields/Field'
import { Select } from '../fields/Select'
import { IMPORTANCE_LABEL, IMPORTANCE_ORDER } from './NoteBadge'
import s from './NoteEditor.module.css'

const IMPORTANCE_OPTIONS = IMPORTANCE_ORDER.map((value) => ({ value, label: IMPORTANCE_LABEL[value] }))

/** Notes on one target, most binding first; each can be removed. */
export function NoteList(props: { notes: Note[] }) {
  const owners = useTwinStore((st) => st.plan?.owners)
  const send = useTwinStore((st) => st.send)
  const [error, setError] = useState<string | null>(null)
  const sorted = [...props.notes].sort(
    (a, b) => IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance) || a.createdAt.localeCompare(b.createdAt),
  )
  return (
    <>
      <ul className={s.list}>
        {sorted.map((note) => (
          <li key={note.id} className={s.note} data-importance={note.importance}>
            <p className={s.meta}>
              <span className={s.importance}>{IMPORTANCE_LABEL[note.importance]}</span>
              <span>from {owners?.[note.authorRole]?.initials ?? note.authorRole}</span>
              <button
                type="button"
                className={`btn btn--quiet ${s.remove}`}
                aria-label={`Remove note: ${note.text}`}
                onClick={() =>
                  send({ type: 'removeNote', payload: { id: note.id } }).then(
                    () => setError(null),
                    (e: unknown) => setError(errorMessage(e)),
                  )
                }
              >
                Remove
              </button>
            </p>
            <p className={s.text}>{note.text}</p>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={s.error}>
          ✕ {error}
        </p>
      )}
    </>
  )
}

/** Adds a note to a target, written as the owner of the active layer. */
export function NoteEditor(props: { target: string; onAdded?: () => void }) {
  const send = useTwinStore((st) => st.send)
  const layer = useTwinStore((st) => st.activeLayer)
  const owner = useTwinStore((st) => st.plan?.owners[layer])
  const [text, setText] = useState('')
  const [importance, setImportance] = useState<Note['importance']>('prefer')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('Write the note first')
      return
    }
    send({ type: 'addNote', payload: { target: props.target, importance, authorRole: layer, text: trimmed } }).then(
      () => {
        setText('')
        setError(null)
        props.onAdded?.()
      },
      (e: unknown) => setError(errorMessage(e)),
    )
  }

  return (
    <form
      className={s.editor}
      aria-label="New note"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={`${id}-text`} className={s.label}>
        Note
      </label>
      <textarea
        id={`${id}-text`}
        rows={2}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <span id={`${id}-importance`} className={s.label}>
        Importance
      </span>
      <Select<Note['importance']> value={importance} options={IMPORTANCE_OPTIONS} onChange={setImportance} labelledBy={`${id}-importance`} />
      {error && (
        <p role="alert" className={s.error}>
          ✕ {error}
        </p>
      )}
      <div className={s.actions}>
        <span className={s.author}>
          As {owner?.initials ?? layer}, {owner?.name.toLowerCase() ?? layer}
        </span>
        <button type="submit" className="btn btn--primary">
          Add note
        </button>
      </div>
    </form>
  )
}
