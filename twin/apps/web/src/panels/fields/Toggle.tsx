import { useField } from './Field'
import s from './Toggle.module.css'

/** On/off switch that names its state in text. */
export function Toggle(props: { checked: boolean; onChange(checked: boolean): void | Promise<void>; on: string; off: string }) {
  const { controlId, run } = useField()
  return (
    <span className={s.toggle}>
      <input
        id={controlId}
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => run(props.onChange(e.currentTarget.checked))}
      />
      <span className={s.track} aria-hidden="true" />
      <span className={s.state}>{props.checked ? props.on : props.off}</span>
    </span>
  )
}
