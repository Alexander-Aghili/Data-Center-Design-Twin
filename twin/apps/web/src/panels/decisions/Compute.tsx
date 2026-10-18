import { useId, useState } from 'react'
import type { CatalogIndex, Plan, RackEntry, RackGroup } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { CatalogPicker, useCatalog, type Assessment } from '../fields/CatalogPicker'
import { errorMessage, Field, FieldGroup } from '../fields/Field'
import { MoreSettings } from '../fields/MoreSettings'
import { fmtPower } from '../../format'
import { coolingAccepted } from './Cooling'
import s from './decisions.module.css'

/** "40 racks in R1, R2" or "No racks placed". */
export function placedSummary(plan: Plan, groupId: string): string {
  const placed = plan.placements.filter((p) => p.groupId === groupId)
  if (placed.length === 0) return 'No racks placed'
  const rows = [...new Set(placed.map((p) => p.rowId))]
  return `${placed.length} ${placed.length === 1 ? 'rack' : 'racks'} in ${rows.join(', ')}`
}

const DISTRIBUTION_LABEL = { ac54: '54 V AC', dc800: '800 V DC' } as const

function assessRack(rack: RackEntry, group: RackGroup, plan: Plan, catalog: CatalogIndex): Assessment {
  const method = catalog.get(group.coolingMethodId, 'rackCooling')
  if (method && !rack.supportedCooling.includes(method.category)) {
    return { caution: `Not with ${method.name.toLowerCase()}: it ${coolingAccepted(rack)}` }
  }
  if (!rack.supportedPower.includes(plan.power.distribution)) {
    return { caution: `No ${DISTRIBUTION_LABEL[plan.power.distribution]} input` }
  }
  return {}
}

function GroupName({ group, onResult }: { group: RackGroup; onResult(result: Promise<void>): void }) {
  const send = useTwinStore((st) => st.send)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const name = draft?.trim()
    setDraft(null)
    if (name && name !== group.name) onResult(send({ type: 'renameRackGroup', payload: { groupId: group.id, name } }))
  }
  return (
    <input
      className={s.titleInput}
      aria-label="Group name"
      value={draft ?? group.name}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

/** Opens the group's middle rack and pushes in on a GPU, so a new rack type is seen right away. */
function showRack(plan: Plan, groupId: string) {
  const racks = plan.placements.filter((p) => p.groupId === groupId)
  const rack = racks[Math.floor(racks.length / 2)]
  if (rack) useTwinStore.getState().dispatchView({ type: 'focus', target: { kind: 'rack', id: rack.id }, shot: 'gpu' })
}

function GroupCompute(props: { plan: Plan; group: RackGroup; catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const { plan, group, catalog } = props
  const placed = plan.placements.some((p) => p.groupId === group.id)
  const [error, setError] = useState<string | null>(null)
  const track = (result: Promise<void>) =>
    result.then(
      () => setError(null),
      (e: unknown) => setError(errorMessage(e)),
    )
  return (
    <FieldGroup title={<GroupName group={group} onResult={track} />} subject={group.name} target={`group:${group.id}`} meta={placedSummary(plan, group.id)}>
      <Field label="Rack type" target={`decision:rackGroups.${group.id}.rackTypeId`}>
        <CatalogPicker
          kind="rack"
          value={group.rackTypeId}
          assess={(rack) => assessRack(rack, group, plan, catalog)}
          onChange={(rackTypeId) => send({ type: 'setRackType', payload: { groupId: group.id, rackTypeId } }).then(() => showRack(plan, group.id))}
        />
      </Field>
      <div className={s.actions}>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={placed}
          onClick={() => track(send({ type: 'deleteRackGroup', payload: { groupId: group.id } }))}
        >
          Delete group
        </button>
        {placed && <span className={s.aside}>Remove its racks in Layout first.</span>}
      </div>
      {error && (
        <p role="alert" className={s.error}>
          ✕ {error}
        </p>
      )}
    </FieldGroup>
  )
}

/** The method a new group starts on: the lightest one the rack accepts that carries its heat. */
function defaultMethod(rack: RackEntry, catalog: CatalogIndex): string | undefined {
  const fits = catalog
    .all()
    .flatMap((e) => (e.kind === 'rackCooling' && rack.supportedCooling.includes(e.category) && e.status === 'mainstream' ? [e] : []))
    .sort((a, b) => (a.maxRackW.value ?? Infinity) - (b.maxRackW.value ?? Infinity))
  const load = rack.nominalPowerW.value ?? 0
  return (fits.find((m) => (m.maxRackW.value ?? 0) >= load) ?? fits.at(-1))?.id
}

function NewGroup({ catalog }: { catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const id = useId()
  const racks = catalog.all().filter((e): e is RackEntry => e.kind === 'rack')
  const [name, setName] = useState('')
  const [rackTypeId, setRackTypeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rack = catalog.get(rackTypeId || racks[0]?.id || '', 'rack')
  const method = rack ? defaultMethod(rack, catalog) : undefined
  const methodName = method ? catalog.get(method, 'rackCooling')?.name : undefined

  return (
    <form
      className={s.form}
      aria-label="New rack group"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return setError('Name the group first')
        if (!rack || !method) return setError('Pick a rack type the catalog can cool')
        send({ type: 'createRackGroup', payload: { name: name.trim(), rackTypeId: rack.id, coolingMethodId: method } }).then(
          () => {
            setName('')
            setError(null)
          },
          (err: unknown) => setError(errorMessage(err)),
        )
      }}
    >
      <h3 className={s.formTitle}>New rack group</h3>
      <label className={s.inline}>
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label className={s.inline} htmlFor={`${id}-rack`}>
        <span>Rack type</span>
        <select id={`${id}-rack`} className="input" value={rack?.id ?? ''} onChange={(e) => setRackTypeId(e.currentTarget.value)}>
          {racks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {methodName && <p className={s.aside}>Starts on {methodName.toLowerCase()}. Change it in Cooling.</p>}
      {error && (
        <p role="alert" className={s.error}>
          ✕ {error}
        </p>
      )}
      <div className={s.actions}>
        <button type="submit" className="btn btn--primary">
          Create group
        </button>
      </div>
    </form>
  )
}

/** One group at a glance: what rack it runs, how it is cooled and where it stands. */
function GroupSummary({ plan, group, catalog }: { plan: Plan; group: RackGroup; catalog: CatalogIndex }) {
  const rack = catalog.get(group.rackTypeId, 'rack')
  const method = catalog.get(group.coolingMethodId, 'rackCooling')
  const load = rack?.nominalPowerW.value
  const spec = [rack && rack.gpuCount > 0 ? `${rack.gpuCount} GPUs` : null, load ? `${fmtPower(load)} per rack` : null, method?.name]
  return (
    <li className={s.groupCard}>
      <span className={s.groupName}>{group.name}</span>
      <span className={s.groupLine}>{rack?.name ?? group.rackTypeId}</span>
      <span className={s.groupLine}>{spec.filter(Boolean).join(' · ')}</span>
      <span className={s.groupLine}>{placedSummary(plan, group.id)}</span>
    </li>
  )
}

export function ComputeDecisions({ plan }: { plan: Plan }) {
  const catalog = useCatalog()
  return (
    <>
      <p className={s.lede}>
        Swap racks and GPUs in the rack bar at the bottom of the scene. Click a group there to pick its rack type and cooling.
      </p>
      {plan.rackGroups.length > 0 ? (
        <ul className={s.groups} aria-label="Rack groups">
          {plan.rackGroups.map((g) => (
            <GroupSummary key={g.id} plan={plan} group={g} catalog={catalog} />
          ))}
        </ul>
      ) : (
        <p className={s.lede}>No rack groups yet.</p>
      )}
      <MoreSettings>
        {plan.rackGroups.map((g) => (
          <GroupCompute key={g.id} plan={plan} group={g} catalog={catalog} />
        ))}
        <NewGroup catalog={catalog} />
      </MoreSettings>
    </>
  )
}
