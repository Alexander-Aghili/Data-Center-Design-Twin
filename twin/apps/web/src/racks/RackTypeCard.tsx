import type { CatalogIndex, RackEntry } from '@twin/schema'
import { fmtMass, fmtNull, fmtPower } from '../format'
import { coolingTaken, gpuName, ROLE_LABEL } from './rackFacts'
import s from './racks.module.css'

const NBSP = '\u00a0'

/** One rack type as a pickable card: the GPU, the numbers that decide (GPUs, kW, weight) and the cooling it takes. */
export function RackTypeCard(props: {
  rack: RackEntry
  catalog: CatalogIndex
  picked: boolean
  /** Shown on the picked card: "Current" for a group's rack type, "Picked" while creating one. */
  mark: string
  /** Why this rack would need another change first, e.g. a cooling method it does not take. */
  caution?: string
  onPick(rack: RackEntry): void
}) {
  const { rack, picked } = props
  const gpu = gpuName(rack, props.catalog)
  return (
    <button type="button" className={s.card} aria-pressed={picked} onClick={() => props.onPick(rack)}>
      <span className={s.cardTop}>
        <span className={s.cardName} title={rack.name}>
          {rack.name}
        </span>
        {picked && <span className={s.mark}>✓ {props.mark}</span>}
      </span>
      <span className={s.cardGpu}>{gpu ?? `${ROLE_LABEL[rack.role]} rack, no GPUs`}</span>
      <span className={s.facts}>
        {rack.gpuCount > 0 && <span>{`${rack.gpuCount}${NBSP}GPUs`}</span>}
        <span>{fmtNull(rack.nominalPowerW.value, fmtPower)}</span>
        <span>{fmtNull(rack.weightKg.value, fmtMass)}</span>
        {rack.slotsWide > 1 && <span>{`${rack.slotsWide}${NBSP}slots wide`}</span>}
      </span>
      <span className={s.cardCooling}>{coolingTaken(rack)}</span>
      {props.caution && (
        <span className={s.caution}>
          <span className={s.warnMark} aria-hidden="true">
            ▲
          </span>{' '}
          {props.caution}
        </span>
      )}
    </button>
  )
}
