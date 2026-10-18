import { useState } from 'react'
import { useField } from './Field'
import s from './Number.module.css'

function shown(value: number, scale: number): string {
  return String(Number((value / scale).toPrecision(6)))
}

/**
 * Number entry that commits on Enter or blur and reverts on Escape.
 * `scale` converts between the plan's SI value and the displayed unit (e.g. 1e6 for W shown as MW).
 */
export function NumberInput(props: {
  value: number
  unit: string
  onCommit(value: number): void | Promise<void>
  scale?: number
  min?: number
  max?: number
  /** Smallest value excluded, for quantities that must be positive. */
  above?: number
}) {
  const { controlId, a11y, setError, run } = useField()
  const scale = props.scale ?? 1
  const [draft, setDraft] = useState<string | null>(null)

  const problem = (text: string): string | null => {
    const n = Number(text.trim().replace(/,/g, ''))
    if (text.trim() === '' || !Number.isFinite(n)) return 'Enter a number'
    if (props.min !== undefined && n < props.min) return `Enter ${props.min} or more`
    if (props.max !== undefined && n > props.max) return `Enter ${props.max} or less`
    if (props.above !== undefined && n <= props.above) return `Enter a number above ${props.above}`
    return null
  }

  const commit = () => {
    if (draft === null) return
    const message = problem(draft)
    setError(message)
    if (message) return
    const next = Number(draft.trim().replace(/,/g, '')) * scale
    setDraft(null)
    if (next !== props.value) run(props.onCommit(next))
  }

  return (
    <span className={s.number}>
      <input
        id={controlId}
        {...a11y}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? shown(props.value, scale)}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
      />
      <span className={s.unit}>{props.unit}</span>
    </span>
  )
}
