import type { CatalogIndex, RackEntry } from '@twin/schema'
import { useMemo } from 'react'
import { rackTypes } from './rackFacts'
import { RackTypeCard } from './RackTypeCard'
import s from './racks.module.css'

/** The catalog's rack types as a grid of cards; picking one is a single click. */
export function RackPicker(props: {
  catalog: CatalogIndex
  labelledBy: string
  value: string | null
  mark: string
  caution?(rack: RackEntry): string | undefined
  onPick(rack: RackEntry): void
}) {
  const racks = useMemo(() => rackTypes(props.catalog), [props.catalog])
  return (
    <div role="group" aria-labelledby={props.labelledBy} className={s.cards}>
      {racks.map((rack) => (
        <RackTypeCard
          key={rack.id}
          rack={rack}
          catalog={props.catalog}
          picked={rack.id === props.value}
          mark={props.mark}
          caution={props.caution?.(rack)}
          onPick={props.onPick}
        />
      ))}
    </div>
  )
}
