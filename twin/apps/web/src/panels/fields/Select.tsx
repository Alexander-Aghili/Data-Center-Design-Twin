import { useId } from 'react'
import { useField } from './Field'
import s from './Select.module.css'

export interface Option<T extends string> {
  value: T
  label: string
}

/** Segmented choice between a few options; every option stays visible. Arrow keys move between them. */
export function Select<T extends string>(props: {
  value: T
  options: readonly Option<T>[]
  onChange(value: T): void | Promise<void>
  /** Label element id when used outside a `Field`. */
  labelledBy?: string
}) {
  const { labelId, run } = useField()
  const name = useId()
  return (
    <div role="radiogroup" aria-labelledby={props.labelledBy ?? labelId} className={s.segments}>
      {props.options.map((o) => (
        <label key={o.value} className={s.segment}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === props.value}
            onChange={() => run(props.onChange(o.value))}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
