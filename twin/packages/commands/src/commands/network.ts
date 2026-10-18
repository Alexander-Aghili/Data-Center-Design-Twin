import { CommandError } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { formatNumber } from '../format'

const FABRIC_LABEL = { railOptimized: 'rail-optimized', fatTree: 'fat tree' } as const

const setFabric = defineCommand({
  type: 'setFabric',
  layer: 'network',
  title: 'Set network fabric',
  description:
    'Sets the scale-out network topology: railOptimized (each GPU rail goes to its own leaf, common for training) or fatTree (any-to-any leaves). It drives leaf count, cable lengths and optics.',
  apply(draft, payload) {
    draft.network.fabric = payload.fabric
  },
  summarize: (payload) => `Network fabric set to ${FABRIC_LABEL[payload.fabric]}`,
})

const setNetworkOversubscription = defineCommand({
  type: 'setNetworkOversubscription',
  layer: 'network',
  title: 'Set network oversubscription',
  description:
    'Sets the leaf uplink oversubscription ratio, as the number before ":1" (1 = 1:1 non-blocking, 2 = 2:1). Higher ratios need fewer spine ports and optics but slow all-to-all traffic. Must be at least 1.',
  apply(draft, payload) {
    if (payload.ratio < 1) throw new CommandError('Network oversubscription must be at least 1 (1 means 1:1, non-blocking)', 'payload.ratio')
    draft.network.oversubscription = payload.ratio
  },
  summarize: (payload, plan) =>
    `Network oversubscription set to ${formatNumber(payload.ratio)}:1 (was ${formatNumber(plan.network.oversubscription)}:1)`,
})

export const commands: AnyCommandDef[] = [setFabric, setNetworkOversubscription]
