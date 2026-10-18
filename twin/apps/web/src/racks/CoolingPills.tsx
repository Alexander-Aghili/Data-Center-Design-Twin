import type { CatalogIndex, RackCoolingEntry, RackEntry } from '@twin/schema'
import { useId } from 'react'
import { fmtNull, fmtPower } from '../format'
import { coolingMethodsFor, methodTooSmall } from './rackFacts'
import s from './racks.module.css'

/**
 * The rack cooling methods this rack type takes, as pills; methods it does not take are not offered.
 * A method rated below the rack's load stays pickable and carries a warning.
 */
export function CoolingPills(props: {
  rack: RackEntry
  catalog: CatalogIndex
  labelledBy: string
  value: string | null
  onPick(method: RackCoolingEntry): void
}) {
  const hintId = useId()
  const methods = coolingMethodsFor(props.rack, props.catalog)
  const current = methods.find((m) => m.id === props.value)
  const small = new Set(methods.filter((m) => methodTooSmall(m, props.rack)).map((m) => m.id))
  const load = fmtNull(props.rack.nominalPowerW.value, fmtPower)
  if (methods.length === 0) return <p className={s.hint}>The catalog has no cooling method this rack takes.</p>
  return (
    <>
      <div role="group" aria-labelledby={props.labelledBy} className={s.pills}>
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            className={s.pill}
            aria-pressed={m.id === props.value}
            aria-describedby={small.has(m.id) ? hintId : undefined}
            onClick={() => props.onPick(m)}
          >
            {small.has(m.id) && (
              <span className={s.warnMark} aria-hidden="true">
                ▲
              </span>
            )}
            {m.name}
          </button>
        ))}
      </div>
      {current === undefined ? (
        <p className={s.hint}>
          <span className={s.warnMark} aria-hidden="true">
            ▲
          </span>{' '}
          Pick a cooling method this rack takes.
        </p>
      ) : null}
      {small.size > 0 && (
        <p id={hintId} className={s.hint}>
          <span className={s.warnMark} aria-hidden="true">
            ▲
          </span>{' '}
          Rated below this rack’s {load}.
        </p>
      )}
    </>
  )
}
