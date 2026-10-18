import { useId, useState } from 'react'
import type { CatalogIndex, EquipmentPosition, Plan, Row } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useCatalog } from '../fields/CatalogPicker'
import { Field, useField } from '../fields/Field'
import { MoreSettings } from '../fields/MoreSettings'
import { Select } from '../fields/Select'
import s from './decisions.module.css'

function slotsWide(plan: Plan, catalog: CatalogIndex, groupId: string): number {
  const group = plan.rackGroups.find((g) => g.id === groupId)
  return (group && catalog.get(group.rackTypeId, 'rack')?.slotsWide) || 1
}

/** Which placement occupies each slot of a row, or null when the slot is free. */
function occupancy(plan: Plan, catalog: CatalogIndex, row: Row): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: row.slotCount }, () => null)
  for (const p of plan.placements) {
    if (p.rowId !== row.id) continue
    const w = slotsWide(plan, catalog, p.groupId)
    for (let k = p.slot; k < p.slot + w && k < row.slotCount; k++) slots[k] = p.id
  }
  return slots
}

/** Why `count` racks `w` slots wide can't go in at `from`, or null when they fit. */
function fillProblem(slots: (string | null)[], rowId: string, fromText: string, countText: string, w: number): string | null {
  if (fromText.trim() === '') return 'Enter a slot to start from'
  if (countText.trim() === '') return 'Enter how many racks to place'
  const from = Number(fromText)
  const count = Number(countText)
  if (!Number.isInteger(from) || from < 0 || from >= slots.length) return `${rowId} has slots 0 to ${slots.length - 1}`
  if (!Number.isInteger(count) || count < 1) return 'Enter a count of 1 or more'
  if (slots[from] !== null) return `Slot ${from} in ${rowId} is taken`
  let run = 0
  while (from + run < slots.length && slots[from + run] === null) run++
  const fit = Math.floor(run / w)
  if (count <= fit) return null
  const each = w > 1 ? ` (${w} slots each)` : ''
  if (fit === 0) return `No room for a ${w}-slot rack at slot ${from}`
  return `Only ${fit} ${fit === 1 ? 'rack fits' : 'racks fit'} from slot ${from}${each}`
}

const firstFree = (slots: (string | null)[]) => Math.max(0, slots.indexOf(null))

/** The longest free run of a row, as where it starts and how many `w`-slot racks fit in it. */
function roomIn(slots: (string | null)[], w: number): { from: number; count: number } {
  let best = { from: 0, count: 0 }
  for (let k = 0; k < slots.length; ) {
    if (slots[k] !== null) {
      k++
      continue
    }
    let run = 0
    while (k + run < slots.length && slots[k + run] === null) run++
    const count = Math.floor(run / w)
    if (count > best.count) best = { from: k, count }
    k += run
  }
  return best
}

/** One-click placement: fills the largest free stretch of a row with racks of one group. */
function FillRow({ plan, catalog }: { plan: Plan; catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const { run } = useField()
  const id = useId()
  const [groupId, setGroupId] = useState(plan.rackGroups[0]?.id ?? '')
  const w = slotsWide(plan, catalog, groupId)
  const rooms = plan.hall.rows.map((r) => ({ row: r, room: roomIn(occupancy(plan, catalog, r), w) }))
  // null follows the first row with room, also after a row fills up.
  const [picked, setRowId] = useState<string | null>(null)
  const rowId = picked ?? (rooms.find((r) => r.room.count > 0) ?? rooms[0])?.row.id ?? ''
  const room = rooms.find((r) => r.row.id === rowId)?.room ?? { from: 0, count: 0 }
  const group = plan.rackGroups.find((g) => g.id === groupId)
  const ready = Boolean(group) && room.count > 0
  const label = !group ? 'Create a rack group first' : room.count === 0 ? `${rowId} is full` : `Fill ${rowId} with ${room.count} ${room.count === 1 ? 'rack' : 'racks'}`

  return (
    <form
      className={s.quick}
      aria-label="Fill a row"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        const placed = send({ type: 'fillRow', payload: { groupId, rowId, from: room.from, count: room.count } })
        run(placed)
        placed.then(() => setRowId(null), () => {})
      }}
    >
      <div className={s.quickField}>
        <label htmlFor={`${id}-group`}>Group</label>
        <select id={`${id}-group`} className="input" value={groupId} onChange={(e) => setGroupId(e.currentTarget.value)}>
          {plan.rackGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className={s.quickField}>
        <label htmlFor={`${id}-row`}>Row</label>
        <select id={`${id}-row`} className="input" value={rowId} onChange={(e) => setRowId(e.currentTarget.value)}>
          {rooms.map(({ row, room: r }) => (
            <option key={row.id} value={row.id}>
              {row.id}, {r.count === 0 ? 'full' : `${r.count} free`}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn--primary" disabled={!ready}>
        {label}
      </button>
    </form>
  )
}

function SlotStrip(props: { slots: (string | null)[]; selected?: string }) {
  return (
    <span className={s.strip} aria-hidden="true">
      {props.slots.map((p, k) => (
        <span key={k} className={s.slot} data-state={p === null ? 'free' : p === props.selected ? 'selected' : 'taken'} />
      ))}
    </span>
  )
}

function Rows({ plan, catalog }: { plan: Plan; catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const selection = useTwinStore((st) => st.selection)
  const { run } = useField()
  const selected = selection?.kind === 'rack' ? selection.id : undefined
  return (
    <ul className={s.rows}>
      {plan.hall.rows.map((row) => {
        const slots = occupancy(plan, catalog, row)
        const ids = plan.placements.filter((p) => p.rowId === row.id).map((p) => p.id)
        const taken = slots.filter((p) => p !== null).length
        return (
          <li key={row.id} className={s.row}>
            <span className={s.rowId}>{row.id}</span>
            <SlotStrip slots={slots} selected={selected} />
            <span className={s.rowCount}>
              {taken}/{row.slotCount}
            </span>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={ids.length === 0}
              aria-label={`Remove all racks in ${row.id}`}
              onClick={() => run(send({ type: 'removeRacks', payload: { placementIds: ids } }))}
            >
              Clear
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PlaceRacks({ plan, catalog }: { plan: Plan; catalog: CatalogIndex }) {
  const send = useTwinStore((st) => st.send)
  const { run } = useField()
  const id = useId()
  const [groupId, setGroupId] = useState(plan.rackGroups[0]?.id ?? '')
  const [rowId, setRowId] = useState(plan.hall.rows[0]?.id ?? '')
  // null follows the row's first free slot, also after racks land.
  const [fromDraft, setFrom] = useState<string | null>(null)
  const [count, setCount] = useState('1')
  const row = plan.hall.rows.find((r) => r.id === rowId)
  const slots = row ? occupancy(plan, catalog, row) : []
  const from = fromDraft ?? String(firstFree(slots))
  const w = slotsWide(plan, catalog, groupId)
  const problem = row && groupId ? fillProblem(slots, row.id, from, count, w) : 'Create a rack group first'

  return (
    <form
      className={s.form}
      aria-label="Place racks"
      onSubmit={(e) => {
        e.preventDefault()
        if (problem || !row) return
        const placed = send({ type: 'fillRow', payload: { groupId, rowId: row.id, from: Number(from), count: Number(count) } })
        run(placed)
        placed.then(() => setFrom(null), () => {})
      }}
    >
      <h3 className={s.formTitle}>Place racks</h3>
      <div className={s.formGrid}>
        <label htmlFor={`${id}-group`}>Group</label>
        <select id={`${id}-group`} className="input" value={groupId} onChange={(e) => setGroupId(e.currentTarget.value)}>
          {plan.rackGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-row`}>Row</label>
        <select
          id={`${id}-row`}
          className="input"
          value={rowId}
          onChange={(e) => {
            setRowId(e.currentTarget.value)
            setFrom(null)
          }}
        >
          {plan.hall.rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-from`}>From slot</label>
        <input id={`${id}-from`} className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <label htmlFor={`${id}-count`}>Count</label>
        <input id={`${id}-count`} className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.currentTarget.value)} />
      </div>
      {problem && (
        <p role="alert" className={s.error}>
          ✕ {problem}
        </p>
      )}
      <div className={s.actions}>
        <button type="submit" className="btn btn--primary" disabled={problem !== null}>
          Place racks
        </button>
      </div>
    </form>
  )
}

function MoveRack({ plan, placementId }: { plan: Plan; placementId: string }) {
  const send = useTwinStore((st) => st.send)
  const { run } = useField()
  const id = useId()
  const placement = plan.placements.find((p) => p.id === placementId)
  const [rowId, setRowId] = useState(placement?.rowId ?? '')
  const [slot, setSlot] = useState(String(placement?.slot ?? 0))
  if (!placement) return null
  return (
    <form
      className={s.form}
      aria-label={`Move rack ${placement.id}`}
      onSubmit={(e) => {
        e.preventDefault()
        run(send({ type: 'moveRack', payload: { placementId: placement.id, rowId, slot: Number(slot) } }))
      }}
    >
      <h3 className={s.formTitle}>Rack {placement.id}</h3>
      <div className={s.formGrid}>
        <label htmlFor={`${id}-row`}>Row</label>
        <select id={`${id}-row`} className="input" value={rowId} onChange={(e) => setRowId(e.currentTarget.value)}>
          {plan.hall.rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-slot`}>Slot</label>
        <input id={`${id}-slot`} className="input" inputMode="numeric" value={slot} onChange={(e) => setSlot(e.currentTarget.value)} />
      </div>
      <div className={s.actions}>
        <button type="submit" className="btn btn--primary">
          Move
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => run(send({ type: 'removeRacks', payload: { placementIds: [placement.id] } }))}
        >
          Remove rack
        </button>
      </div>
    </form>
  )
}

const POSITION_KIND = { cdu: 'CDU', crah: 'CRAH', plant: 'Plant', electrical: 'Electrical room', leaf: 'Leaf' } as const

function positionName(p: EquipmentPosition): string {
  return `${POSITION_KIND[p.kind]} ${p.id.replace(`${p.kind}-`, '')}`
}

/** Which rows each equipment position serves (cooling zones, leaf reach). */
export function ZoneEditor({ plan, kinds }: { plan: Plan; kinds: readonly EquipmentPosition['kind'][] }) {
  const send = useTwinStore((st) => st.send)
  const { run, controlId, a11y } = useField()
  const positions = plan.hall.positions.filter((p) => kinds.includes(p.kind))
  const [positionId, setPositionId] = useState(positions[0]?.id ?? '')
  const position = positions.find((p) => p.id === positionId)
  const toggle = (rowId: string, on: boolean) => {
    if (!position) return
    const rowIds = plan.hall.rows.map((r) => r.id).filter((r) => (r === rowId ? on : position.servesRows.includes(r)))
    run(send({ type: 'assignZone', payload: { positionId: position.id, rowIds } }))
  }
  return (
    <div className={s.zones}>
      <select id={controlId} {...a11y} className="input" value={positionId} onChange={(e) => setPositionId(e.currentTarget.value)}>
        {positions.map((p) => (
          <option key={p.id} value={p.id}>
            {positionName(p)}, serves {p.servesRows.length ? p.servesRows.join(', ') : 'no rows'}
          </option>
        ))}
      </select>
      {position && (
        <fieldset className={s.chips}>
          <legend className="visually-hidden">Rows {positionName(position)} serves</legend>
          {plan.hall.rows.map((r) => (
            <label key={r.id} className={s.chip}>
              <input type="checkbox" checked={position.servesRows.includes(r.id)} onChange={(e) => toggle(r.id, e.currentTarget.checked)} />
              <span>{r.id}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

export function LayoutDecisions({ plan }: { plan: Plan }) {
  const send = useTwinStore((st) => st.send)
  const selection = useTwinStore((st) => st.selection)
  const catalog = useCatalog()
  return (
    <>
      <Field label="Aisle containment" target="decision:cooling.containment">
        <Select
          value={plan.cooling.containment}
          options={[
            { value: 'hotAisle', label: 'Hot aisle' },
            { value: 'coldAisle', label: 'Cold aisle' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(containment) => send({ type: 'setContainment', payload: { containment } })}
        />
      </Field>
      <Field
        label="Racks on the floor"
        target="decision:placements"
        hint={selection?.kind === 'rack' ? undefined : 'Select a rack in the scene to move or remove it.'}
      >
        <FillRow plan={plan} catalog={catalog} />
        {selection?.kind === 'rack' && <MoveRack key={selection.id} plan={plan} placementId={selection.id} />}
      </Field>
      <MoreSettings>
        <Field label="Rows and slots">
          <Rows plan={plan} catalog={catalog} />
          <PlaceRacks plan={plan} catalog={catalog} />
        </Field>
        <Field label="Cooling zones" target="decision:hall.positions.cooling" hint="Rows each CDU or CRAH position serves.">
          <ZoneEditor plan={plan} kinds={['cdu', 'crah']} />
        </Field>
      </MoreSettings>
    </>
  )
}
