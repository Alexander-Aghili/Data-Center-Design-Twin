import { defineCommand, type AnyCommandDef } from '../define'
import { formatNumber } from '../format'

const DISTRIBUTION_LABEL = { ac54: '54 V AC', dc800: '800 V DC' } as const

const setRedundancy = defineCommand({
  type: 'setRedundancy',
  layer: 'power',
  title: 'Set power redundancy',
  description:
    'Sets electrical and mechanical redundancy: N (no spare), N+1 (one spare unit per group) or 2N (fully duplicated). The engine sizes UPS, transformers, CDUs, CRAHs and plant with it and checks the worst single failure.',
  apply(draft, payload) {
    draft.power.redundancy = payload.redundancy
  },
  summarize: (payload, plan) => `Power redundancy set to ${payload.redundancy} (was ${plan.power.redundancy})`,
})

const setDistribution = defineCommand({
  type: 'setDistribution',
  layer: 'power',
  title: 'Set power distribution',
  description:
    'Sets rack power distribution: ac54 (54 V AC busbar) or dc800 (800 V DC). Each rack type lists the distributions it accepts in supportedPower.',
  apply(draft, payload) {
    draft.power.distribution = payload.distribution
  },
  summarize: (payload) => `Power distribution set to ${DISTRIBUTION_LABEL[payload.distribution]}`,
})

const setOversubscription = defineCommand({
  type: 'setOversubscription',
  layer: 'power',
  title: 'Set power oversubscription',
  description:
    'Sets the power oversubscription factor: the ratio of summed rack peak power to provisioned power. 1 means none; 1.2 provisions for 1/1.2 of the peak and relies on racks not peaking together. Must be between 1 and 2.',
  apply(draft, payload) {
    draft.power.oversubscription = payload.factor
  },
  summarize: (payload, plan) =>
    `Power oversubscription set to ${formatNumber(payload.factor)} (was ${formatNumber(plan.power.oversubscription)})`,
})

export const commands: AnyCommandDef[] = [setRedundancy, setDistribution, setOversubscription]
