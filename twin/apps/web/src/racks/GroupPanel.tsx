import type { CatalogIndex, Plan, RackEntry, RackGroup } from '@twin/schema'
import { useId, useRef, useState } from 'react'
import { useTwinStore } from '../state/store'
import { CoolingPills } from './CoolingPills'
import { ErrorLine, PopoverHeader, Section, useCommandResult } from './Popover'
import { RackPicker } from './RackPicker'
import { coolingTaken, groupRacks } from './rackFacts'
import s from './racks.module.css'

/** "48 racks in R3, R4, R5" or "No racks placed yet". */
function placedLine(plan: Plan, groupId: string): string {
  const racks = groupRacks(plan, groupId)
  if (racks.length === 0) return 'No racks placed yet'
  const rows = [...new Set(racks.map((p) => p.rowId))]
  return `${racks.length} ${racks.length === 1 ? 'rack' : 'racks'} in ${rows.join(', ')}`
}

function GroupTitle(props: { group: RackGroup; color: string; titleId: string; onRename(name: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  // Escape cancels; the blur that follows when the input goes away must not commit.
  const cancelled = useRef(false)
  const commit = () => {
    const name = draft?.trim()
    setDraft(null)
    if (!cancelled.current && name && name !== props.group.name) props.onRename(name)
  }
  const edit = () => {
    cancelled.current = false
    setDraft(props.group.name)
  }
  return (
    <div className={s.title}>
      <span className={s.swatch} style={{ background: props.color }} aria-hidden="true" />
      {draft === null ? (
        <>
          <h2 id={props.titleId} className={s.titleText}>
            {props.group.name}
          </h2>
          <button type="button" className={`btn btn--quiet ${s.small}`} onClick={edit}>
            Rename
          </button>
        </>
      ) : (
        <>
          <span id={props.titleId} className="visually-hidden">
            {props.group.name}
          </span>
          <input
            className={`input ${s.titleInput}`}
            aria-label="Group name"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                // Cancels the rename only; the panel stays open.
                e.preventDefault()
                e.stopPropagation()
                cancelled.current = true
                setDraft(null)
              }
            }}
          />
        </>
      )}
    </div>
  )
}

/** The selected group: its rack type as cards, its cooling as pills, rename, add racks and delete. */
export function GroupPanel(props: {
  plan: Plan
  catalog: CatalogIndex
  group: RackGroup
  color: string
  titleId: string
  onClose(): void
  onPlace(): void
  onDeleted(): void
}) {
  const { plan, catalog, group } = props
  const send = useTwinStore((st) => st.send)
  const { error, run } = useCommandResult()
  const id = useId()
  const rack = catalog.get(group.rackTypeId, 'rack')
  const method = catalog.get(group.coolingMethodId, 'rackCooling')
  const placed = groupRacks(plan, group.id).length

  const cautionFor = (r: RackEntry) =>
    r.id !== group.rackTypeId && method && !r.supportedCooling.includes(method.category) ? `Needs other cooling. ${coolingTaken(r)}.` : undefined

  return (
    <>
      <PopoverHeader onClose={props.onClose}>
        <GroupTitle
          group={group}
          color={props.color}
          titleId={props.titleId}
          onRename={(name) => void run(send({ type: 'renameRackGroup', payload: { groupId: group.id, name } }))}
        />
        <p className={s.meta}>{placedLine(plan, group.id)}</p>
      </PopoverHeader>

      <Section label="Rack type" id={`${id}-racks`}>
        <RackPicker
          catalog={catalog}
          labelledBy={`${id}-racks`}
          value={group.rackTypeId}
          mark="Current"
          caution={cautionFor}
          onPick={(r) => {
            if (r.id !== group.rackTypeId) void run(send({ type: 'setRackType', payload: { groupId: group.id, rackTypeId: r.id } }))
          }}
        />
      </Section>

      <Section label="Cooling" id={`${id}-cooling`}>
        {rack ? (
          <CoolingPills
            rack={rack}
            catalog={catalog}
            labelledBy={`${id}-cooling`}
            value={group.coolingMethodId}
            onPick={(m) => {
              if (m.id !== group.coolingMethodId) void run(send({ type: 'setCoolingMethod', payload: { groupId: group.id, coolingMethodId: m.id } }))
            }}
          />
        ) : (
          <p className={s.hint}>This rack type is not in the catalog.</p>
        )}
      </Section>

      <ErrorLine error={error} />

      <footer className={s.foot}>
        <button type="button" className={`btn ${s.secondary}`} onClick={props.onPlace}>
          Add racks
        </button>
        <span className={s.footEnd}>
          {placed > 0 && (
            <span id={`${id}-delete`} className={s.hint}>
              Remove its {placed} {placed === 1 ? 'rack' : 'racks'} first.
            </span>
          )}
          <button
            type="button"
            className="btn btn--quiet"
            disabled={placed > 0}
            aria-describedby={placed > 0 ? `${id}-delete` : undefined}
            onClick={async () => {
              if (await run(send({ type: 'deleteRackGroup', payload: { groupId: group.id } }))) props.onDeleted()
            }}
          >
            Delete group
          </button>
        </span>
      </footer>
    </>
  )
}
