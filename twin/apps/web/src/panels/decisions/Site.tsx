import { useState } from 'react'
import type { Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { CatalogPicker } from '../fields/CatalogPicker'
import { Field, ReadOnly } from '../fields/Field'
import { MoreSettings } from '../fields/MoreSettings'
import { fmtValue } from '../../format'
import { NumberInput } from '../fields/Number'
import { Select } from '../fields/Select'
import s from './decisions.module.css'

type SiteField = 'gridCapacityW' | 'waterAllowanceM3PerDay' | 'valueOfComputeUsdPerGpuHour'

/** One bay's rating; the bay follows the scene selection when a bay is picked there. */
function BayRating({ plan, bayId, onBay }: { plan: Plan; bayId: string; onBay(id: string): void }) {
  const send = useTwinStore((st) => st.send)
  const bay = plan.hall.bays.find((b) => b.id === bayId)
  return (
    <div className={s.pair}>
      <select aria-label="Bay" className="input" value={bayId} onChange={(e) => onBay(e.currentTarget.value)}>
        {plan.hall.bays.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id}
          </option>
        ))}
      </select>
      {bay && (
        <NumberInput
          key={bay.id}
          value={bay.ratingKnM2}
          unit="kN/m²"
          above={0}
          onCommit={(ratingKnM2) => send({ type: 'setBayRating', payload: { bayId: bay.id, ratingKnM2 } })}
        />
      )}
    </div>
  )
}

export function SiteDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const selection = useTwinStore((st) => st.selection)
  const [pickedBay, setPickedBay] = useState(plan.hall.bays[0]?.id ?? '')
  const bayId = selection?.kind === 'bay' ? selection.id : pickedBay
  const ratings = plan.hall.bays.map((b) => b.ratingKnM2)
  const low = ratings.length ? Math.min(...ratings) : 0
  const high = ratings.length ? Math.max(...ratings) : 0
  const setSite = (field: SiteField) => (value: number) => send({ type: 'setSiteInput', payload: { field, value } })
  const { hall } = plan

  return (
    <>
      <Field label="Climate" target="decision:site.climateId">
        <CatalogPicker
          kind="climate"
          value={plan.site.climateId}
          onChange={(value) => send({ type: 'setSiteInput', payload: { field: 'climateId', value } })}
        />
      </Field>
      <Field label="Grid power available" target="decision:site.gridCapacityW">
        <NumberInput value={plan.site.gridCapacityW} unit="MW" scale={1e6} above={0} onCommit={setSite('gridCapacityW')} />
      </Field>
      <Field label="Water allowance" target="decision:site.waterAllowanceM3PerDay">
        <NumberInput value={plan.site.waterAllowanceM3PerDay} unit="m³ per day" min={0} onCommit={setSite('waterAllowanceM3PerDay')} />
      </Field>
      <MoreSettings>
        <Field label="Value of compute" target="decision:site.valueOfComputeUsdPerGpuHour" hint="Puts a price on each week of build-out, as lost GPU hours.">
          <NumberInput
            value={plan.site.valueOfComputeUsdPerGpuHour}
            unit="USD per GPU hour"
            min={0}
            onCommit={setSite('valueOfComputeUsdPerGpuHour')}
          />
        </Field>
        <ReadOnly label="Hall">
          {fmtValue(hall.widthM, 'm')} × {fmtValue(hall.depthM, 'm')}, ceiling {fmtValue(hall.ceilingM, 'm')}
        </ReadOnly>
        <Field label="Floor type" target="decision:hall.floor.type">
          <Select
            value={hall.floor.type}
            options={[
              { value: 'raised', label: 'Raised floor' },
              { value: 'slab', label: 'Slab' },
            ]}
            onChange={(type) => send({ type: 'setFloor', payload: { type } })}
          />
        </Field>
        <Field
          label="Floor rating, all bays"
          target="decision:hall.bays.ratingKnM2"
          hint={low === high ? undefined : `Bays range from ${fmtValue(low, 'kN/m²')} to ${fmtValue(high, 'kN/m²')}. A new value sets every bay.`}
        >
          <NumberInput
            value={low}
            unit="kN/m²"
            above={0}
            onCommit={(ratingKnM2) => send({ type: 'setFloor', payload: { type: hall.floor.type, ratingKnM2 } })}
          />
        </Field>
        <Field label="Floor rating, one bay" target={`decision:hall.bays.${bayId}.ratingKnM2`} hint="Pick a bay here or in the scene.">
          <BayRating plan={plan} bayId={bayId} onBay={setPickedBay} />
        </Field>
      </MoreSettings>
    </>
  )
}
