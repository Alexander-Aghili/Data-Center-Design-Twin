import { NETWORK_OVERSUBSCRIPTION_RANGE, type Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { Field } from '../fields/Field'
import { NumberInput } from '../fields/Number'
import { Select } from '../fields/Select'
import { ZoneEditor } from './Layout'

export function NetworkDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  return (
    <>
      <Field label="Fabric" target="decision:network.fabric">
        <Select
          value={plan.network.fabric}
          options={[
            { value: 'railOptimized', label: 'Rail-optimized' },
            { value: 'fatTree', label: 'Fat tree' },
          ]}
          onChange={(fabric) => send({ type: 'setFabric', payload: { fabric } })}
        />
      </Field>
      <Field
        label="Oversubscription"
        target="decision:network.oversubscription"
        hint={'Downlink to uplink bandwidth at each leaf, from 1:1 (non-blocking) to 8:1.'}
      >
        <NumberInput
          value={plan.network.oversubscription}
          unit={':\u00a01'}
          min={NETWORK_OVERSUBSCRIPTION_RANGE.min}
          max={NETWORK_OVERSUBSCRIPTION_RANGE.max}
          onCommit={(ratio) => send({ type: 'setNetworkOversubscription', payload: { ratio } })}
        />
      </Field>
      <Field label="Leaf placement" target="decision:hall.positions.leaf" hint="Rows each leaf position serves. Distance sets copper or optics.">
        <ZoneEditor plan={plan} kinds={['leaf']} />
      </Field>
    </>
  )
}
