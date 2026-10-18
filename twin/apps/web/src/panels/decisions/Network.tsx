import type { Plan } from '@twin/schema'
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
        hint={'Downlink to uplink bandwidth at each leaf. 1\u00a0:\u00a01 is non-blocking.'}
      >
        <NumberInput
          value={plan.network.oversubscription}
          unit={':\u00a01'}
          above={0}
          onCommit={(ratio) => send({ type: 'setNetworkOversubscription', payload: { ratio } })}
        />
      </Field>
      <Field label="Leaf placement" target="decision:hall.positions.leaf" hint="Rows each leaf position serves. Distance sets copper or optics.">
        <ZoneEditor plan={plan} kinds={['leaf']} />
      </Field>
    </>
  )
}
