import { placementId, type CatalogIndex, type Plan, type RackGroup } from '@twin/schema'
import { useId, useState } from 'react'
import { useTwinStore } from '../state/store'
import { ErrorLine, PopoverHeader, Section, useCommandResult } from './Popover'
import { freeStarts } from './rackFacts'
import s from './racks.module.css'

/**
 * Places racks of a group in one row with `fillRow`: pick a row that has room, say how many, place.
 * The count starts at what the row holds, and the camera flies to the first new rack.
 */
export function PlaceRacks(props: {
  plan: Plan
  catalog: CatalogIndex
  group: RackGroup
  titleId: string
  onClose(): void
  onPlaced(): void
}) {
  const { plan, catalog, group } = props
  const send = useTwinStore((st) => st.send)
  const dispatchView = useTwinStore((st) => st.dispatchView)
  const { error, setError, run } = useCommandResult()
  const id = useId()
  const width = catalog.get(group.rackTypeId, 'rack')?.slotsWide ?? 1
  const rows = plan.hall.rows.flatMap((row) => {
    const starts = freeStarts(plan, catalog, row, width)
    return starts.length > 0 ? [{ row, starts }] : []
  })
  const [rowId, setRowId] = useState<string | null>(null)
  // null follows the picked row's room.
  const [countDraft, setCount] = useState<string | null>(null)
  // Until one is picked, the row with the most room (the first of equals).
  const roomiest = rows.reduce<(typeof rows)[number] | undefined>((best, r) => (!best || r.starts.length > best.starts.length ? r : best), undefined)
  const picked = rows.find((r) => r.row.id === rowId) ?? roomiest
  const room = picked?.starts.length ?? 0
  const count = countDraft ?? String(room)

  const place = async () => {
    if (!picked) return
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > room) return setError(`Enter a number from 1 to ${room}`)
    const ok = await run(send({ type: 'fillRow', payload: { groupId: group.id, rowId: picked.row.id, from: 0, count: n } }))
    if (!ok) return
    dispatchView({ type: 'focus', target: { kind: 'rack', id: placementId(picked.row.id, picked.starts[0]!) } })
    props.onPlaced()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void place()
      }}
    >
      <PopoverHeader onClose={props.onClose}>
        <h2 id={props.titleId} className={s.titleText}>
          Place {group.name} racks
        </h2>
        <p className={s.meta}>{width > 1 ? `Each rack takes ${width} slots.` : 'Racks fill the first free slots from the west end.'}</p>
      </PopoverHeader>

      {picked ? (
        <>
          <Section label="Row" id={`${id}-rows`}>
            <div role="group" aria-labelledby={`${id}-rows`} className={s.pills}>
              {rows.map(({ row, starts }) => (
                <button
                  key={row.id}
                  type="button"
                  className={s.pill}
                  aria-pressed={row.id === picked.row.id}
                  onClick={() => {
                    setRowId(row.id)
                    setCount(null)
                    setError(null)
                  }}
                >
                  <span className={s.pillStrong}>{row.id}</span>
                  <span className="visually-hidden">, </span>
                  <span>{starts.length} free</span>
                </button>
              ))}
            </div>
          </Section>
          <div className={s.countRow}>
            <label htmlFor={`${id}-count`} className={s.sectionLabel}>
              Racks
            </label>
            <input
              id={`${id}-count`}
              name="rackCount"
              autoComplete="off"
              className={`input ${s.count}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={room}
              value={count}
              onChange={(e) => setCount(e.currentTarget.value)}
            />
            <span className={s.hint}>of {room} that fit</span>
          </div>
        </>
      ) : (
        <p className={s.hint}>Every row is full. Clear a row in Layout to make room.</p>
      )}

      <ErrorLine error={error} />

      <footer className={s.foot}>
        <button type="submit" className={`btn ${s.primary}`} disabled={!picked}>
          Place racks
        </button>
        <button type="button" className="btn btn--quiet" onClick={props.onPlaced}>
          Not now
        </button>
      </footer>
    </form>
  )
}
