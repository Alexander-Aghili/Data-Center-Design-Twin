import type { Command, Plan } from '@twin/schema'
import { useRef, useState, type ChangeEvent } from 'react'
import { StatusMark } from '../panels/StatusMark'
import { useTwinStore } from '../state/store'

interface ImportReport {
  ok: boolean
  title: string
  /** `path: problem` lines, one per issue. */
  lines: string[]
}

/** Saves `data` as a pretty-printed JSON file in the browser's downloads. */
export function downloadJson(fileBase: string, data: unknown) {
  const safe = fileBase.replace(/[\\/:*?"<>|]/g, '-').trim() || 'export'
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lines(message: string): string[] {
  return message.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** A catalog pack is a JSON array of entries, or an object holding one under `entries` (the shape of `GET /api/catalog`). */
function packEntries(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object' && !('schemaVersion' in json) && Array.isArray((json as { entries?: unknown }).entries)) {
    return (json as { entries: unknown[] }).entries
  }
  return null
}

function entryId(item: unknown, index: number): string {
  const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined
  return typeof id === 'string' && id ? id : `Entry ${index + 1}`
}

/** Adds each pack entry; one already in the plan as a custom entry is updated instead. Entries are independent. */
async function importPack(items: unknown[], file: string, plan: Plan | null, send: (c: Command) => Promise<void>): Promise<ImportReport> {
  let added = 0
  let updated = 0
  const failures: string[] = []
  for (const [i, item] of items.entries()) {
    const id = entryId(item, i)
    const update = plan?.catalog[id]?.custom === true
    try {
      await send({ type: update ? 'updateCatalogEntry' : 'addCatalogEntry', payload: { entry: item } })
      if (update) updated += 1
      else added += 1
    } catch (error) {
      failures.push(...lines(messageOf(error)).map((l) => `${id}: ${l.replace(/^payload\.entry\./, '')}`))
    }
  }
  const done = added + updated
  const verb = updated === 0 ? 'Added' : added === 0 ? 'Updated' : 'Added or updated'
  const counted = done === items.length ? `${done}` : `${done} of ${items.length}`
  const noun = items.length === 1 ? 'entry' : 'entries'
  return { ok: failures.length === 0, title: `${verb} ${counted} ${noun} from ${file}.`, lines: failures }
}

async function importPlan(json: unknown, file: string, send: (c: Command) => Promise<void>): Promise<ImportReport> {
  try {
    await send({ type: 'importPlan', payload: { plan: json } })
    const name = json && typeof json === 'object' ? (json as { name?: unknown }).name : undefined
    return { ok: true, title: typeof name === 'string' ? `Imported the plan ${name}.` : `Imported ${file}.`, lines: [] }
  } catch (error) {
    return { ok: false, title: `${file} was not imported. Your current plan is unchanged.`, lines: lines(messageOf(error)) }
  }
}

/** Top-bar plan import and export. Import also takes catalog packs. */
export function ImportExport() {
  const plan = useTwinStore((s) => s.plan)
  const send = useTwinStore((s) => s.send)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReport(null)
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch (error) {
      setReport({ ok: false, title: `${file.name} is not valid JSON. Nothing was imported.`, lines: [messageOf(error)] })
      return
    }
    setBusy(true)
    const pack = packEntries(json)
    // Read the plan now, not from the render that opened the file picker.
    const current = useTwinStore.getState().plan
    setReport(pack ? await importPack(pack, file.name, current, send) : await importPlan(json, file.name, send))
    setBusy(false)
  }

  return (
    <div className="io" onKeyDown={(e) => e.key === 'Escape' && setReport(null)}>
      <style href="twin-import-export" precedence="twin">
        {CSS}
      </style>
      <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}
        title="Import a plan, or a catalog pack (a JSON array of entries)">
        {busy ? 'Importing…' : 'Import'}
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" aria-label="Import file" hidden onChange={onFile} />
      <button type="button" className="btn" disabled={!plan} onClick={() => plan && downloadJson(plan.name, plan)}>
        Export plan
      </button>
      {report && (
        <div className={report.ok ? 'io-report' : 'io-report io-problem'} role={report.ok ? 'status' : 'alert'}>
          <p className="io-title">
            <StatusMark status={report.ok ? 'pass' : 'fail'} label={report.title} />
          </p>
          {report.lines.length > 0 && (
            <ul className="io-lines">
              {report.lines.map((l, i) => {
                const at = l.indexOf(': ')
                return (
                  <li key={i}>
                    {at > 0 ? (
                      <>
                        <span className="io-path">{l.slice(0, at)}</span>: {l.slice(at + 2)}
                      </>
                    ) : (
                      l
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" className="btn btn--quiet io-close" onClick={() => setReport(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}

const CSS = `
.io { position: relative; display: inline-flex; gap: var(--space-2); align-items: center; }
.io-report {
  position: absolute; top: calc(100% + var(--space-2)); right: 0; z-index: var(--z-drawer);
  width: min(460px, calc(100vw - 32px)); max-height: 60vh; overflow: auto;
  padding: var(--space-3) var(--space-4);
  background: var(--panel-raised); border: var(--rule); border-top: 3px solid var(--ok);
  box-shadow: 0 6px 18px rgb(23 32 38 / 0.12);
}
.io-problem { border-top-color: var(--heat); }
.io-title { font-weight: var(--weight-medium); line-height: var(--leading); }
.io-lines { margin-top: var(--space-3); border-top: var(--rule); }
.io-lines li { padding: 6px 0; border-bottom: var(--rule); font-size: var(--text-sm); overflow-wrap: anywhere; }
.io-path { font-stretch: var(--stretch-label); font-weight: var(--weight-semibold); }
.io-close { margin-top: var(--space-2); margin-left: calc(-1 * var(--space-3)); }
`
