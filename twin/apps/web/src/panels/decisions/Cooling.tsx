import type { CatalogIndex, Plan, RackCoolingCategory, RackCoolingEntry, RackEntry, RackGroup } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { CatalogPicker, useCatalog, type Assessment } from '../fields/CatalogPicker'
import { Field, FieldGroup, ReadOnly } from '../fields/Field'
import { fmtPower, fmtValue } from '../../format'
import { MoreSettings } from '../fields/MoreSettings'
import { NumberInput } from '../fields/Number'
import { Select } from '../fields/Select'
import { Toggle } from '../fields/Toggle'
import { placedSummary } from './Compute'

const CATEGORY_LABEL: Record<RackCoolingCategory, string> = {
  air: 'air',
  rdhx: 'rear door',
  'dlc-1p': 'single-phase direct-to-chip',
  'dlc-2p': 'two-phase direct-to-chip',
  'immersion-1p': 'single-phase immersion',
  'immersion-2p': 'two-phase immersion',
  custom: 'custom methods',
}

const either = new Intl.ListFormat('en-US', { type: 'disjunction' })

/** "takes air or rear door only": the cooling a rack type accepts, in words. */
export function coolingAccepted(rack: RackEntry): string {
  return `takes ${either.format(rack.supportedCooling.map((c) => CATEGORY_LABEL[c]))} only`
}

function assessMethod(method: RackCoolingEntry, rack: RackEntry | undefined): Assessment {
  if (!rack) return {}
  if (!rack.supportedCooling.includes(method.category)) return { blocked: `${rack.name} ${coolingAccepted(rack)}` }
  const limit = method.maxRackW.value
  const load = rack.nominalPowerW.value
  if (limit !== null && load !== null && limit < load) return { caution: `Below this rack's ${fmtPower(load)}` }
  return {}
}

/** Lowest coolant supply limit among the liquid-cooled racks in use, if any. */
function supplyLimit(plan: Plan, catalog: CatalogIndex): { celsius: number; rack: string } | null {
  let best: { celsius: number; rack: string } | null = null
  for (const g of plan.rackGroups) {
    const method = catalog.get(g.coolingMethodId, 'rackCooling')
    const rack = catalog.get(g.rackTypeId, 'rack')
    const max = rack?.maxCoolantSupplyC.value ?? null
    if (!method || !rack || max === null || (method.toTechnicalLoop.value ?? 0) === 0) continue
    if (!best || max < best.celsius) best = { celsius: max, rack: rack.name }
  }
  return best
}

function GroupCooling(props: { plan: Plan; group: RackGroup; catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const { group, catalog } = props
  const rack = catalog.get(group.rackTypeId, 'rack')
  const method = catalog.get(group.coolingMethodId, 'rackCooling')
  const coolant = method?.coolantId && method.category !== 'air' ? catalog.get(method.coolantId, 'coolant') : undefined
  return (
    <FieldGroup
      title={group.name}
      subject={group.name}
      target={`group:${group.id}`}
      meta={
        <>
          {rack?.name ?? group.rackTypeId}
          <br />
          {placedSummary(props.plan, group.id)}
        </>
      }
    >
      <Field label="Rack cooling" target={`decision:rackGroups.${group.id}.coolingMethodId`}>
        <CatalogPicker
          kind="rackCooling"
          value={group.coolingMethodId}
          assess={(m) => assessMethod(m, rack)}
          onChange={(coolingMethodId) => send({ type: 'setCoolingMethod', payload: { groupId: group.id, coolingMethodId } })}
        />
      </Field>
      {coolant && <ReadOnly label="Coolant, set by the method">{coolant.name}</ReadOnly>}
    </FieldGroup>
  )
}

export function CoolingDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const catalog = useCatalog()
  const limit = supplyLimit(plan, catalog)
  const c = plan.cooling
  return (
    <>
      <Field label="Heat rejection" target="decision:cooling.heatRejectionId">
        <CatalogPicker
          kind="heatRejection"
          value={c.heatRejectionId}
          onChange={(heatRejectionId) => send({ type: 'setHeatRejection', payload: { heatRejectionId } })}
        />
      </Field>
      <Field
        label="Supply water temperature"
        target="decision:cooling.facilitySupplyC"
        hint={limit ? `${limit.rack} accepts coolant up to ${fmtValue(limit.celsius, '°C')}.` : undefined}
      >
        <NumberInput value={c.facilitySupplyC} unit="°C" onCommit={(celsius) => send({ type: 'setFacilitySupplyTemp', payload: { celsius } })} />
      </Field>
      <Field label="Pipe route" target="decision:cooling.pipingRoute">
        <Select
          value={c.pipingRoute}
          options={[
            { value: 'raisedFloor', label: 'Under raised floor' },
            { value: 'overhead', label: 'Overhead' },
          ]}
          onChange={(route) => send({ type: 'setPipingRoute', payload: { route } })}
        />
      </Field>
      <MoreSettings>
        {plan.rackGroups.map((g) => (
          <GroupCooling key={g.id} plan={plan} group={g} catalog={catalog} />
        ))}
        <FieldGroup title="Facility plant" subject="the facility plant" target="decision:cooling">
          <Field
            label="Flow balancing"
            target="decision:cooling.flowBalancing"
            hint="Valves even out flow along each row manifold, at the cost of pump head."
          >
            <Toggle
              checked={c.flowBalancing}
              on="Balancing valves fitted"
              off="No balancing valves"
              onChange={(enabled) => send({ type: 'setFlowBalancing', payload: { enabled } })}
            />
          </Field>
          <Field label="Buffer tank" target="decision:cooling.bufferTankM3" hint="Chilled water that carries the load through a chiller restart. 0 means no tank.">
            <NumberInput value={c.bufferTankM3} unit="m³" min={0} onCommit={(m3) => send({ type: 'setBufferTank', payload: { m3 } })} />
          </Field>
        </FieldGroup>
      </MoreSettings>
    </>
  )
}
