import { CommandError } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { withUnit } from '../format'

const setWorkload = defineCommand({
  type: 'setWorkload',
  layer: 'workload',
  title: 'Set workload',
  description:
    'Sets what the hall is for: purpose (training, inference or mixed, which sets the peak-to-average power profile) and/or targetPflops (the dense FP8 compute the hall should deliver). Send at least one of the two.',
  apply(draft, payload) {
    if (payload.purpose === undefined && payload.targetPflops === undefined) {
      throw new CommandError('setWorkload needs purpose, targetPflops or both', 'payload')
    }
    if (payload.purpose !== undefined) draft.workload.purpose = payload.purpose
    if (payload.targetPflops !== undefined) draft.workload.targetPflops = payload.targetPflops
  },
  summarize: ({ purpose, targetPflops }) => {
    const target = targetPflops !== undefined ? withUnit(targetPflops, 'PFLOPS') : ''
    if (purpose === undefined) return `Workload target set to ${target}`
    return `Workload set to ${purpose}${target ? `, target ${target}` : ''}`
  },
})

export const commands: AnyCommandDef[] = [setWorkload]
