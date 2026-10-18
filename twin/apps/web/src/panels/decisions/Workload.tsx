import type { Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useCatalog } from '../fields/CatalogPicker'
import { Field } from '../fields/Field'
import { fmtValue } from '../../format'
import { NumberInput } from '../fields/Number'
import { Select } from '../fields/Select'

export function WorkloadDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const catalog = useCatalog()
  let placed = 0
  for (const p of plan.placements) {
    const group = plan.rackGroups.find((g) => g.id === p.groupId)
    placed += (group && catalog.get(group.rackTypeId, 'rack')?.fp8Pflops.value) ?? 0
  }
  return (
    <>
      <Field
        label="Purpose"
        target="decision:workload.purpose"
        hint="Training swings power in step across racks; busways need more headroom for it."
      >
        <Select
          value={plan.workload.purpose}
          options={[
            { value: 'training', label: 'Training' },
            { value: 'inference', label: 'Inference' },
            { value: 'mixed', label: 'Mixed' },
          ]}
          onChange={(purpose) => send({ type: 'setWorkload', payload: { purpose } })}
        />
      </Field>
      <Field
        label="Target compute"
        target="decision:workload.targetPflops"
        hint={plan.placements.length > 0 ? `Racks placed now give ${fmtValue(placed, 'PFLOPS')} FP8.` : 'No racks placed yet.'}
      >
        <NumberInput
          value={plan.workload.targetPflops}
          unit="PFLOPS FP8"
          min={0}
          onCommit={(targetPflops) => send({ type: 'setWorkload', payload: { targetPflops } })}
        />
      </Field>
    </>
  )
}
