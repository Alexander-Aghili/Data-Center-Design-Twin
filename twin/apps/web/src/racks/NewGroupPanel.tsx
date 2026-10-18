import type { CatalogIndex, Plan, RackEntry } from '@twin/schema'
import { useId, useState } from 'react'
import { useTwinStore } from '../state/store'
import { CoolingPills } from './CoolingPills'
import { ErrorLine, PopoverHeader, Section, useCommandResult } from './Popover'
import { RackPicker } from './RackPicker'
import { defaultMethod, suggestedName } from './rackFacts'
import s from './racks.module.css'

/** Step one of a new group: name it, pick its rack type from the cards and its cooling, then create it. */
export function NewGroupPanel(props: { plan: Plan; catalog: CatalogIndex; titleId: string; onClose(): void; onCreated(name: string): void }) {
  const { catalog } = props
  const send = useTwinStore((st) => st.send)
  const { error, setError, run } = useCommandResult()
  const id = useId()
  const [name, setName] = useState(() => suggestedName(props.plan))
  const [rack, setRack] = useState<RackEntry | null>(null)
  const [methodId, setMethodId] = useState<string | null>(null)

  const pickRack = (r: RackEntry) => {
    setRack(r)
    setMethodId(defaultMethod(r, catalog)?.id ?? null)
    setError(null)
  }

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return setError('Name the group first')
    if (!rack) return setError('Pick a rack type')
    if (!methodId) return setError('Pick a cooling method')
    const ok = await run(send({ type: 'createRackGroup', payload: { name: trimmed, rackTypeId: rack.id, coolingMethodId: methodId } }))
    if (ok) props.onCreated(trimmed)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <PopoverHeader onClose={props.onClose}>
        <h2 id={props.titleId} className={s.titleText}>
          New rack group
        </h2>
      </PopoverHeader>

      <div className={s.nameRow}>
        <label htmlFor={`${id}-name`} className={s.sectionLabel}>
          Name
        </label>
        <input id={`${id}-name`} className={`input ${s.nameInput}`} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </div>

      <Section label="Rack type" id={`${id}-racks`}>
        <RackPicker catalog={catalog} labelledBy={`${id}-racks`} value={rack?.id ?? null} mark="Picked" onPick={pickRack} />
      </Section>

      {rack && (
        <Section label="Cooling" id={`${id}-cooling`}>
          <CoolingPills rack={rack} catalog={catalog} labelledBy={`${id}-cooling`} value={methodId} onPick={(m) => setMethodId(m.id)} />
        </Section>
      )}

      <ErrorLine error={error} />

      <footer className={s.foot}>
        <button type="submit" className={`btn ${s.primary}`}>
          Create group
        </button>
        <span className={s.hint}>You place its racks next.</span>
      </footer>
    </form>
  )
}
