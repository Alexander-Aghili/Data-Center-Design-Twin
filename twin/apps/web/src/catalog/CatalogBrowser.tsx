import { CATALOG_KINDS, type CatalogEntry, type CatalogKind, type Quantity } from '@twin/schema'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtNumber } from '../format'
import { downloadJson } from '../io/ImportExport'
import { useCatalog } from '../panels/fields/CatalogPicker'
import { useTwinStore } from '../state/store'
import { EntryForm, type EntryIntent } from './EntryForm'
import { fieldLabel, formFields, isFormKind, KIND_NAMES, optionLabel, unitText, type FieldSpec } from './schemaForm'

type Pane = { type: 'detail' } | { type: 'form'; intent: EntryIntent }

/** Remounts the form whenever it starts from something else. */
function formKey(intent: EntryIntent): string {
  return intent.type === 'update' ? `update:${intent.entry.id}` : `add:${intent.kind}:${intent.from?.id ?? ''}`
}

/** Top-bar button that opens the catalog: built-in and custom entries by kind, with forms for custom entries. */
export function CatalogBrowser({ kind = 'gpu' }: { kind?: CatalogKind }) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) dialogRef.current?.showModal()
  }, [open])

  return (
    <>
      <style href="twin-catalog-browser" precedence="twin">
        {CSS}
      </style>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Catalog
      </button>
      {open && (
        <dialog ref={dialogRef} className="cb" aria-labelledby="cb-title" onClose={() => setOpen(false)}>
          <CatalogPanel initialKind={kind} onClose={() => dialogRef.current?.close()} />
        </dialog>
      )}
    </>
  )
}

function CatalogPanel({ initialKind, onClose }: { initialKind: CatalogKind; onClose(): void }) {
  const plan = useTwinStore((s) => s.plan)
  const [kind, setKind] = useState<CatalogKind>(initialKind)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>({ type: 'detail' })

  const catalog = useCatalog()
  const all = useMemo(() => catalog.all(), [catalog])

  const counts = useMemo(() => {
    const c = Object.fromEntries(CATALOG_KINDS.map((k) => [k, 0])) as Record<CatalogKind, number>
    for (const e of all) c[e.kind] += 1
    return c
  }, [all])

  const q = query.trim().toLowerCase()
  const list = all
    .filter((e) => e.kind === kind && (!q || `${e.name} ${e.id} ${e.vendor ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.custom === true) - Number(b.custom === true) || a.name.localeCompare(b.name))
  const selected = list.find((e) => e.id === selectedId) ?? list[0]
  const selectedFormKind = selected && isFormKind(selected.kind) ? selected.kind : null
  const customs = all.filter((e) => e.custom)
  const ids = useMemo(() => new Set(all.map((e) => e.id)), [all])

  const pickKind = (k: CatalogKind) => {
    setKind(k)
    setSelectedId(null)
    setPane({ type: 'detail' })
  }

  return (
    <div className="cb-frame">
      <header className="cb-head">
        <h2 id="cb-title" className="cb-title">
          Catalog
        </h2>
        <p className="cb-sub">
          Built-in entries and the custom entries saved in this plan. To add many at once, use Import in the top bar with a catalog pack, a
          JSON array of entries.
        </p>
        <div className="cb-head-actions">
          <button
            type="button"
            className="btn"
            disabled={customs.length === 0}
            onClick={() => downloadJson(`${plan?.name ?? 'Plan'} custom catalog`, customs)}
          >
            Export custom entries
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <nav className="cb-kinds" aria-label="Entry kinds">
        {CATALOG_KINDS.map((k) => (
          <button key={k} type="button" className="cb-kind" aria-current={k === kind ? 'true' : undefined} onClick={() => pickKind(k)}>
            <span>{KIND_NAMES[k].plural}</span>
            <span className="cb-count">{counts[k]}</span>
          </button>
        ))}
      </nav>

      <section className="cb-list" aria-label={`${KIND_NAMES[kind].plural} entries`}>
        <div className="cb-list-tools">
          <input
            className="input cb-search"
            type="search"
            placeholder="Filter"
            aria-label="Filter entries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isFormKind(kind) && (
            <button type="button" className="btn" onClick={() => setPane({ type: 'form', intent: { type: 'add', kind } })}>
              New entry
            </button>
          )}
        </div>
        <ul className="cb-entries">
          {list.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="cb-entry"
                aria-current={e.id === selected?.id ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(e.id)
                  setPane({ type: 'detail' })
                }}
              >
                <span className="cb-entry-name">{e.name}</span>
                <span className="cb-entry-id">
                  {e.id}
                  {e.custom && <span className="cb-tag">custom</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {list.length === 0 && <p className="cb-note">{q ? 'No entries match this filter.' : 'No entries of this kind yet.'}</p>}
      </section>

      <section className="cb-pane" aria-label="Entry">
        {pane.type === 'form' ? (
          <EntryForm
            key={formKey(pane.intent)}
            intent={pane.intent}
            existingIds={ids}
            references={all}
            onCancel={() => setPane({ type: 'detail' })}
            onDone={(entry) => {
              setSelectedId(entry.id)
              setPane({ type: 'detail' })
            }}
          />
        ) : selected ? (
          <EntryDetail
            entry={selected}
            all={all}
            onCopy={selectedFormKind ? () => setPane({ type: 'form', intent: { type: 'add', kind: selectedFormKind, from: selected } }) : undefined}
            onEdit={
              selectedFormKind && selected.custom
                ? () => setPane({ type: 'form', intent: { type: 'update', kind: selectedFormKind, entry: selected } })
                : undefined
            }
          />
        ) : null}
      </section>
    </div>
  )
}

function isQuantity(v: unknown): v is Quantity {
  return Boolean(v && typeof v === 'object' && 'unit' in v && 'basis' in v)
}

/** Catalog numbers: small coefficients (viscosity, fractions of a percent) keep their significant digits. */
function catalogNumber(n: number): string {
  return n !== 0 && Math.abs(n) < 1 ? fmtNumber(n, 5) : fmtNumber(n)
}


function QuantityValue({ q }: { q: Quantity }) {
  // Fractions read as percentages; everything else keeps its catalog unit.
  const percent = q.unit === 'fraction'
  const fmt = (n: number) => (percent ? `${catalogNumber(n * 100)}%` : catalogNumber(n))
  const unit = percent ? '' : unitText(q.unit)
  const range = q.low !== undefined && q.high !== undefined ? `${fmt(q.low)}–${fmt(q.high)}` : null
  return (
    <>
      <span className="cb-num">{q.value === null ? '—' : fmt(q.value)}</span>
      {unit && q.value !== null && <span className="cb-unit">{` ${unit}`}</span>}
      {range && <span className="cb-range">{`range ${range}`}</span>}
    </>
  )
}

interface Row {
  key: string
  label: string
  value: unknown
  /** Enum values get written labels; free text (IDs, risk slugs) shows as stored. */
  enumerated: boolean
}

const HEADER_KEYS = new Set(['id', 'kind', 'name', 'vendor', 'asOf', 'custom', 'sources', 'summary'])

/** Flattens an entry into labelled rows: nested objects (supply range, trays, params) become one row per leaf. */
function rows(entry: CatalogEntry): Row[] {
  const out: Row[] = []
  const types = new Map<string, FieldSpec['type']>(
    isFormKind(entry.kind) ? formFields(entry.kind, entry.kind === 'equipment' ? entry.category : undefined).map((f) => [f.key, f.type]) : [],
  )
  const visit = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (!prefix && HEADER_KEYS.has(k)) continue
      if (v && typeof v === 'object' && !Array.isArray(v) && !isQuantity(v)) visit(v as Record<string, unknown>, key)
      else out.push({ key, label: fieldLabel(key), value: v, enumerated: types.get(key) === 'choice' || types.get(key) === 'choices' })
    }
  }
  visit(entry as unknown as Record<string, unknown>, '')
  return out
}

function PlainValue({ row, all }: { row: Row; all: CatalogEntry[] }) {
  const { value } = row
  const text = (v: unknown) => (row.enumerated ? optionLabel(String(v)) : String(v))
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'number') return <span className="cb-num">{catalogNumber(value)}</span>
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => typeof v === 'number')) return <>{`${fmtNumber(value.length)} hourly values`}</>
    return <>{value.length === 0 ? 'None' : value.map(text).join(', ')}</>
  }
  if (typeof value === 'string' && row.key.endsWith('Id')) return <>{all.find((e) => e.id === value)?.name ?? value}</>
  return <>{text(value)}</>
}

function Basis({ q }: { q: Quantity }) {
  return q.source ? (
    <a href={q.source} target="_blank" rel="noreferrer">
      {q.basis}
    </a>
  ) : (
    <>{q.basis}</>
  )
}

interface EntryDetailProps {
  entry: CatalogEntry
  all: CatalogEntry[]
  onCopy?: () => void
  onEdit?: () => void
}

function EntryDetail({ entry, all, onCopy, onEdit }: EntryDetailProps) {
  const sources = entry.sources ?? []
  return (
    <article className="cb-detail">
      <header className="cb-detail-head">
        <div>
          <h3>{entry.name}</h3>
          <p className="cb-meta">
            <span>{entry.id}</span>
            {entry.vendor && <span>{entry.vendor}</span>}
            <span>{`As of ${entry.asOf}`}</span>
            {entry.custom && <span className="cb-tag">custom</span>}
          </p>
        </div>
        <div className="cb-detail-actions">
          {onEdit && (
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
          )}
          {onCopy && (
            <button type="button" className="btn" onClick={onCopy}>
              Copy as custom entry
            </button>
          )}
        </div>
      </header>
      {entry.summary && <p className="cb-summary">{entry.summary}</p>}
      {entry.kind === 'climate' && <p className="cb-note">Climate presets carry 8,760 hourly values, so they are added through a catalog pack, not a form.</p>}
      <table className="data-table cb-params">
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Value</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows(entry).map((r) => (
            <tr key={r.key} title={isQuantity(r.value) ? r.value.note : undefined}>
              <th scope="row">{r.label}</th>
              <td>{isQuantity(r.value) ? <QuantityValue q={r.value} /> : <PlainValue row={r} all={all} />}</td>
              <td className="data-table__basis cb-basis">{isQuantity(r.value) ? <Basis q={r.value} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sources.length > 0 && (
        <section className="cb-sources">
          <h4 className="section-title">Sources</h4>
          <ol>
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  )
}

const CSS = `
.cb {
  width: min(1180px, calc(100vw - 48px)); height: min(780px, calc(100vh - 48px));
  max-width: none; max-height: none; padding: 0;
  color: var(--ink); background: var(--panel);
  border: 1px solid var(--graphite); border-radius: var(--radius);
  box-shadow: 0 18px 48px rgb(23 32 38 / 0.22);
}
.cb::backdrop { background: rgb(23 32 38 / 0.32); }
.cb-frame {
  display: grid; height: 100%;
  grid-template-columns: 172px 300px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: "head head head" "kinds list pane";
}
.cb-head {
  grid-area: head; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--space-5);
  align-items: end; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--graphite);
}
.cb-title { font-size: var(--text-xl); font-weight: var(--weight-semibold); font-stretch: var(--stretch-display); line-height: var(--leading-tight); }
.cb-sub { grid-column: 1; margin-top: var(--space-1); color: var(--graphite); font-size: var(--text-sm); max-width: 78ch; }
.cb-head-actions { grid-column: 2; grid-row: 1 / 3; display: flex; gap: var(--space-2); }
.cb-kinds { grid-area: kinds; display: flex; flex-direction: column; padding: var(--space-3) 0; border-right: var(--rule); background: var(--paper); overflow: auto; }
.cb-kind {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 7px var(--space-4); text-align: left; color: var(--graphite);
  background: none; border: 0; border-left: 3px solid transparent; cursor: pointer;
}
.cb-kind:hover { color: var(--ink); background: var(--hover); }
.cb-kind[aria-current="true"] { color: var(--ink); font-weight: var(--weight-semibold); border-left-color: var(--ink); background: var(--panel); }
.cb-count { font-stretch: var(--stretch-label); font-size: var(--text-sm); color: var(--graphite); font-weight: var(--weight-regular); }
.cb-list { grid-area: list; display: flex; flex-direction: column; min-height: 0; border-right: var(--rule); }
.cb-list-tools { display: flex; gap: var(--space-2); padding: var(--space-3); border-bottom: var(--rule); }
.cb-search { flex: 1; min-width: 0; }
.cb-entries { overflow: auto; flex: 1; }
.cb-entry {
  display: grid; gap: 2px; width: 100%; padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  text-align: left; background: none;
  border: 0; border-bottom: var(--rule); border-left: 3px solid transparent; cursor: pointer;
}
.cb-entry:hover { background: var(--hover); }
.cb-entry[aria-current="true"] { background: var(--panel-raised); border-left-color: var(--ink); }
.cb-entry-name { font-weight: var(--weight-medium); }
.cb-entry-id { display: flex; gap: var(--space-2); align-items: baseline; font-stretch: var(--stretch-label); font-size: var(--text-sm); color: var(--graphite); overflow-wrap: anywhere; }
.cb-tag {
  font-stretch: var(--stretch-label); font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--ink);
  padding: 0 5px; border: 1px solid currentColor; border-radius: var(--radius); line-height: 16px;
}
.cb-note { margin: var(--space-3); color: var(--graphite); font-size: var(--text-sm); }
.cb-pane { grid-area: pane; min-height: 0; min-width: 0; overflow: hidden; background: var(--canvas); }
.cb-detail { height: 100%; overflow: auto; padding: var(--space-4) var(--space-5) var(--space-5); }
.cb-detail-head { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
.cb-detail-head h3 { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.cb-meta { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: var(--space-1); font-stretch: var(--stretch-label); font-size: var(--text-sm); color: var(--graphite); }
.cb-detail-actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
.cb-summary { margin-top: var(--space-3); max-width: 72ch; }
.cb-params { margin-top: var(--space-4); }
.cb-params tbody th { width: 42%; font-stretch: var(--stretch-label); }
.cb-num { font-weight: var(--weight-medium); }
.cb-unit { color: var(--graphite); }
.cb-range { margin-left: var(--space-2); font-size: var(--text-sm); color: var(--graphite); }
.cb-basis { width: 84px; }
.cb-basis a, .cb-sources a { color: var(--ink); text-underline-offset: 2px; text-decoration-color: var(--graphite); }
.cb-sources { margin-top: var(--space-5); }
.cb-sources h4 { margin: 0 0 var(--space-2); }
.cb-sources ol { margin: 0; padding-left: var(--space-5); font-size: var(--text-sm); line-height: 1.6; }
@media (max-width: 860px) {
  .cb-frame { grid-template-columns: 1fr; grid-template-rows: auto auto minmax(160px, 30%) minmax(0, 1fr); grid-template-areas: "head" "kinds" "list" "pane"; }
  .cb-kinds { flex-direction: row; overflow-x: auto; padding: 0; border-right: 0; border-bottom: var(--rule); }
  .cb-kind { border-left: 0; border-bottom: 3px solid transparent; white-space: nowrap; gap: var(--space-2); }
  .cb-kind[aria-current="true"] { border-bottom-color: var(--ink); }
}
`
