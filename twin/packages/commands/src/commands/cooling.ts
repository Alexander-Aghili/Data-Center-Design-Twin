import { CommandError } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { withUnit } from '../format'
import { entryName, groupLabel, requireEntry, requireGroup } from '../lookup'
import { assertSupports } from './compute'

// Water-based facility loops run between freezing and boiling at atmospheric pressure.
const WATER_FREEZE_C = 0
const WATER_BOIL_C = 100

const setCoolingMethod = defineCommand({
  type: 'setCoolingMethod',
  layer: 'cooling',
  title: 'Set cooling method',
  description:
    'Sets the rack cooling method (catalog kind rackCooling, e.g. rackCooling.dlc-1p for single-phase direct-to-chip) for every rack in a group. The method category must be in the rack type\'s supportedCooling list, otherwise the command is rejected with the supported categories. The engine then sizes CDUs and CRAHs.',
  apply(draft, payload, ctx) {
    const group = requireGroup(draft, payload.groupId)
    const method = requireEntry(draft, ctx.catalog, payload.coolingMethodId, 'rackCooling', 'payload.coolingMethodId')
    const rack = requireEntry(draft, ctx.catalog, group.rackTypeId, 'rack', 'payload.groupId')
    assertSupports(rack, method, 'payload.coolingMethodId')
    group.coolingMethodId = method.id
  },
  summarize: (payload, plan) => `${groupLabel(plan, payload.groupId)} cooled by ${entryName(plan, payload.coolingMethodId)}`,
})

const setHeatRejection = defineCommand({
  type: 'setHeatRejection',
  layer: 'cooling',
  title: 'Set heat rejection',
  description:
    'Sets how the facility rejects heat to outdoors (catalog kind heatRejection: air-cooled chiller, dry cooler, adiabatic dry cooler or cooling tower). Check notes about water first: towers and adiabatic coolers use water.',
  apply(draft, payload, ctx) {
    draft.cooling.heatRejectionId = requireEntry(draft, ctx.catalog, payload.heatRejectionId, 'heatRejection', 'payload.heatRejectionId').id
  },
  summarize: (payload, plan) => `Heat rejection set to ${entryName(plan, payload.heatRejectionId)}`,
})

const setFacilitySupplyTemp = defineCommand({
  type: 'setFacilitySupplyTemp',
  layer: 'cooling',
  title: 'Set facility supply temperature',
  description:
    'Sets the facility water supply temperature in °C. Warmer water gives more free-cooling hours and lets dry coolers work, but must stay below what the racks accept after the CDU approach. Must be between 0 and 100 °C.',
  apply(draft, payload) {
    if (payload.celsius <= WATER_FREEZE_C || payload.celsius >= WATER_BOIL_C) {
      throw new CommandError(`Facility supply temperature must be between ${WATER_FREEZE_C} and ${WATER_BOIL_C}\u00a0°C (liquid water)`, 'payload.celsius')
    }
    draft.cooling.facilitySupplyC = payload.celsius
  },
  summarize: (payload, plan) => `Facility supply temperature set to ${withUnit(payload.celsius, '°C')} (was ${withUnit(plan.cooling.facilitySupplyC, '°C')})`,
})

const setPipingRoute = defineCommand({
  type: 'setPipingRoute',
  layer: 'cooling',
  title: 'Set piping route',
  description:
    'Routes liquid-cooling pipes under the raised floor (raisedFloor) or overhead. Overhead piping costs more and has no under-floor leak containment.',
  apply(draft, payload) {
    draft.cooling.pipingRoute = payload.route
  },
  summarize: (payload) => (payload.route === 'overhead' ? 'Piping routed overhead' : 'Piping routed under the raised floor'),
})

const setFlowBalancing = defineCommand({
  type: 'setFlowBalancing',
  layer: 'cooling',
  title: 'Set flow balancing',
  description:
    'Turns balancing valves on the liquid manifolds on or off. On, every rack in a row gets an equal coolant share at the cost of extra pump power; off, racks far from the CDU get less flow.',
  apply(draft, payload) {
    draft.cooling.flowBalancing = payload.enabled
  },
  summarize: (payload) => `Flow balancing valves turned ${payload.enabled ? 'on' : 'off'}`,
})

const setBufferTank = defineCommand({
  type: 'setBufferTank',
  layer: 'cooling',
  title: 'Set buffer tank',
  description:
    'Sets the chilled-water buffer tank volume in m³ (0 removes it). The tank stores cold water so the liquid loop rides through a chiller restart; ride-through time grows with volume.',
  apply(draft, payload) {
    draft.cooling.bufferTankM3 = payload.m3
  },
  summarize: (payload) => (payload.m3 === 0 ? 'Buffer tank removed' : `Buffer tank set to ${withUnit(payload.m3, 'm³')}`),
})

export const commands: AnyCommandDef[] = [setCoolingMethod, setHeatRejection, setFacilitySupplyTemp, setPipingRoute, setFlowBalancing, setBufferTank]
