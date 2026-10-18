import { useId } from 'react'
import type { EquipmentEntry, Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useCatalog } from '../fields/CatalogPicker'
import { Field, useField } from '../fields/Field'
import { NumberInput } from '../fields/Number'
import { Select } from '../fields/Select'
import s from './decisions.module.css'

/** Busway model per row: auto-sized by the engine unless overridden here. */
function BuswayPerRow({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const { run } = useField()
  const id = useId()
  const catalog = useCatalog()
  const models = catalog.all().filter((e): e is EquipmentEntry => e.kind === 'equipment' && e.category === 'busway')
  return (
    <ul className={s.rows}>
      {plan.hall.rows.map((row) => {
        const key = `busway:${row.id}`
        const current = plan.overrides.find((o) => o.key === key)?.modelId ?? ''
        return (
          <li key={row.id} className={s.row}>
            <label className={s.rowId} htmlFor={`${id}-${row.id}`}>
              {row.id}
            </label>
            <select
              id={`${id}-${row.id}`}
              className="input"
              value={current}
              onChange={(e) => {
                const modelId = e.currentTarget.value
                run(
                  modelId
                    ? send({ type: 'overrideEquipment', payload: { key, modelId } })
                    : send({ type: 'clearOverride', payload: { key } }),
                )
              }}
            >
              <option value="">Auto-sized</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </li>
        )
      })}
    </ul>
  )
}

export function PowerDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const catalog = useCatalog()
  const p = plan.power
  const noDc = [
    ...new Set(
      plan.rackGroups.flatMap((g) => {
        const rack = catalog.get(g.rackTypeId, 'rack')
        return rack && !rack.supportedPower.includes('dc800') ? [rack.name] : []
      }),
    ),
  ].join(', ')
  const dcHint =
    noDc === ''
      ? undefined
      : p.distribution === 'dc800'
        ? `▲ No 800 V DC input on ${noDc}.`
        : `800 V DC needs a DC input, which ${noDc} lacks.`
  return (
    <>
      <Field label="Redundancy" target="decision:power.redundancy" hint="Sets how many spare UPS modules, transformers and feeds the engine sizes.">
        <Select
          value={p.redundancy}
          options={[
            { value: 'N', label: 'N' },
            { value: 'N+1', label: 'N+1' },
            { value: '2N', label: '2N' },
          ]}
          onChange={(redundancy) => send({ type: 'setRedundancy', payload: { redundancy } })}
        />
      </Field>
      <Field
        label="Distribution"
        target="decision:power.distribution"
        hint={dcHint}
      >
        <Select
          value={p.distribution}
          options={[
            { value: 'ac54', label: '54 V AC busbar' },
            { value: 'dc800', label: '800 V DC' },
          ]}
          onChange={(distribution) => send({ type: 'setDistribution', payload: { distribution } })}
        />
      </Field>
      <Field
        label="Oversubscription allowance"
        target="decision:power.oversubscription"
        hint="How far rack load may exceed busway rating. 1.0 allows none."
      >
        <NumberInput
          value={p.oversubscription}
          unit="× rating"
          above={0}
          onCommit={(factor) => send({ type: 'setOversubscription', payload: { factor } })}
        />
      </Field>
      <Field label="Busway per row" target="decision:overrides.busway" hint="Auto-sized rows follow the load; a fixed model is checked as chosen.">
        <BuswayPerRow plan={plan} />
      </Field>
    </>
  )
}
