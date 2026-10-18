import type { CatalogIndex, Plan } from '@twin/schema'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { useCatalog } from '../panels/fields/CatalogPicker'
import { workloadGroups } from '../scene/overlays/WorkloadTint'
import { useTwinStore } from '../state/store'
import { GroupPanel } from './GroupPanel'
import { NewGroupPanel } from './NewGroupPanel'
import { PlaceRacks } from './PlaceRacks'
import { Popover } from './Popover'
import { groupRacks, rackCarries, selectedGroupId } from './rackFacts'
import s from './racks.module.css'

/** What the panel above the bar shows: a group (its settings, or placing its racks), or a new group being made. */
type Open =
  | { kind: 'group'; id: string; placing: boolean }
  | { kind: 'new' }
  /** Created; waiting for the plan that holds it (found by its unique name) to place its racks. */
  | { kind: 'created'; name: string }
  | null

const NEW_KEY = 'new'

const STEP_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'])

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={s.plus}>
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Rack groups as chips along the bottom of the scene: one per group (its workload tint, name, rack count and
 * GPU) and one to make a new group. A chip flies the camera to the group's first rack and opens the group's
 * panel above the bar. Arrow keys, Home and End move between chips; Escape closes the panel.
 */
export function RackBar() {
  const plan = useTwinStore((st) => st.plan)
  return plan ? <Bar plan={plan} /> : null
}

function Bar({ plan }: { plan: Plan }) {
  const catalog = useCatalog()
  const selection = useTwinStore((st) => st.selection)
  const dispatchView = useTwinStore((st) => st.dispatchView)
  const [open, setOpen] = useState<Open>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const chips = useRef(new Map<string, HTMLButtonElement>())
  const titleId = useId()
  const panelId = useId()

  const groups = workloadGroups(plan)
  const keys = [...groups.map((g) => g.id), NEW_KEY]
  const current = open?.kind === 'group' ? open.id : selectedGroupId(plan, selection)
  // The chip that owns the panel, and the one chip Tab enters the bar on.
  const owner = open === null ? null : open.kind === 'group' ? open.id : NEW_KEY
  const tabStop = focusKey !== null && keys.includes(focusKey) ? focusKey : (current ?? keys[0]!)

  const focusChip = (key: string) => {
    setFocusKey(key)
    chips.current.get(key)?.focus()
  }

  const close = () => {
    setOpen(null)
    if (owner) focusChip(chips.current.has(owner) ? owner : NEW_KEY)
  }

  const pickGroup = (groupId: string) => {
    setFocusKey(groupId)
    if (open?.kind === 'group' && open.id === groupId) return setOpen(null)
    setOpen({ kind: 'group', id: groupId, placing: false })
    const first = groupRacks(plan, groupId)[0]
    dispatchView(first ? { type: 'focus', target: { kind: 'rack', id: first.id } } : { type: 'select', target: { kind: 'group', id: groupId } })
  }

  const pickNew = () => {
    setFocusKey(NEW_KEY)
    setOpen(owner === NEW_KEY ? null : { kind: 'new' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open !== null) {
      e.preventDefault()
      return close()
    }
    if (!STEP_KEYS.has(e.key)) return
    e.preventDefault()
    const at = keys.indexOf(tabStop)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
    focusChip(keys[(next + keys.length) % keys.length]!)
  }

  const chipRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) chips.current.set(key, el)
    else chips.current.delete(key)
  }

  const chipProps = (key: string) => ({
    ref: chipRef(key),
    type: 'button' as const,
    tabIndex: tabStop === key ? 0 : -1,
    'aria-expanded': owner === key,
    'aria-controls': owner === key ? panelId : undefined,
    'aria-haspopup': 'dialog' as const,
    onFocus: () => setFocusKey(key),
  })

  return (
    <div className={s.root}>
      {open && (
        <div id={panelId} className={s.anchor}>
          <Popover labelledBy={titleId} onClose={close}>
            <Panel
              plan={plan}
              catalog={catalog}
              open={open}
              colorOf={(groupId) => groups.find((g) => g.id === groupId)?.color ?? 'currentColor'}
              titleId={titleId}
              setOpen={setOpen}
              onClose={close}
              onDeleted={() => {
                setOpen(null)
                focusChip(NEW_KEY)
              }}
            />
          </Popover>
        </div>
      )}
      <div role="toolbar" aria-label="Rack groups" className={s.bar} onKeyDown={onKeyDown}>
        {/* The group chips scroll when they outgrow the scene; New group stays in reach at the end. */}
        <div className={s.chips}>
          {groups.map((g) => {
            const rackTypeId = plan.rackGroups.find((x) => x.id === g.id)?.rackTypeId ?? ''
            return (
              <button key={g.id} {...chipProps(g.id)} className={s.chip} aria-current={current === g.id ? 'true' : undefined} onClick={() => pickGroup(g.id)}>
                <span className={s.swatch} style={{ background: g.color }} aria-hidden="true" />
                <span className={s.chipName} title={g.name}>
                  {g.name}
                </span>
                <span className={s.chipCount}>{g.racks}</span>
                <span className="visually-hidden"> racks, </span>
                <span className={s.chipGpu} translate="no">
                  {rackCarries(catalog.get(rackTypeId, 'rack'), catalog)}
                </span>
              </button>
            )
          })}
        </div>
        <button {...chipProps(NEW_KEY)} className={`${s.chip} ${s.chipNew}`} onClick={pickNew}>
          <PlusIcon />
          New group
        </button>
      </div>
    </div>
  )
}

function Panel(props: {
  plan: Plan
  catalog: CatalogIndex
  open: NonNullable<Open>
  colorOf(groupId: string): string
  titleId: string
  setOpen(open: Open): void
  onClose(): void
  onDeleted(): void
}) {
  const { plan, catalog, open, titleId, setOpen, onClose } = props
  if (open.kind === 'new') {
    return <NewGroupPanel plan={plan} catalog={catalog} titleId={titleId} onClose={onClose} onCreated={(name) => setOpen({ kind: 'created', name })} />
  }
  const group =
    open.kind === 'group'
      ? plan.rackGroups.find((g) => g.id === open.id)
      : plan.rackGroups.find((g) => g.name.toLowerCase() === open.name.toLowerCase())
  if (!group) {
    return (
      <p id={titleId} className={s.hint} role="status">
        {open.kind === 'created' ? `Creating ${open.name}…` : 'This group was deleted.'}
      </p>
    )
  }
  const showGroup = () => setOpen({ kind: 'group', id: group.id, placing: false })
  if (open.kind === 'created' || open.placing) {
    return <PlaceRacks plan={plan} catalog={catalog} group={group} titleId={titleId} onClose={onClose} onPlaced={showGroup} />
  }
  return (
    <GroupPanel
      plan={plan}
      catalog={catalog}
      group={group}
      color={props.colorOf(group.id)}
      titleId={titleId}
      onClose={onClose}
      onPlace={() => setOpen({ kind: 'group', id: group.id, placing: true })}
      onDeleted={props.onDeleted}
    />
  )
}
