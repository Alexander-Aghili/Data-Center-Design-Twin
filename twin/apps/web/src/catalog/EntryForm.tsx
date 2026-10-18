import { EQUIPMENT_CATEGORIES, type CatalogEntry, type EquipmentCategory, type Quantity } from '@twin/schema'
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTwinStore } from '../state/store'
import {
  buildEntry,
  fieldForPath,
  formFields,
  initialValues,
  KIND_NAMES,
  optionLabel,
  unitText,
  type FieldSpec,
  type FormKind,
  type FormValues,
} from './schemaForm'

/** What the form does on submit: add a new custom entry (optionally starting from another entry), or update one. */
export type EntryIntent =
  | { type: 'add'; kind: FormKind; from?: CatalogEntry }
  | { type: 'update'; kind: FormKind; entry: CatalogEntry }

interface EntryFormProps {
  intent: EntryIntent
  /** IDs already in use (built-in and plan catalog); a new entry must not reuse one. */
  existingIds: ReadonlySet<string>
  /** Entries that reference fields (GPU, coolant) can point at. */
  references: CatalogEntry[]
  onDone(entry: CatalogEntry): void
  onCancel(): void
}

const IDENTITY = new Set(['id', 'name', 'vendor', 'asOf', 'summary'])

/** Splits a command rejection into per-field messages; registry errors read `payload.entry.<path>: <problem>`. */
function serverErrors(message: string, fields: FieldSpec[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const line of message.split('\n').filter(Boolean)) {
    const m = /^payload\.entry\.([\w.]+): (.+)$/.exec(line)
    const key = m ? fieldForPath(fields, m[1]) : undefined
    if (key && m) errors[key] ??= m[2]
    else errors[''] = errors[''] ? `${errors['']}\n${line}` : line
  }
  return errors
}

function heading(intent: EntryIntent): string {
  if (intent.type === 'update') return `Edit ${intent.entry.name}`
  if (intent.from) return `New ${KIND_NAMES[intent.kind].noun} from ${intent.from.name}`
  return `New ${KIND_NAMES[intent.kind].noun}`
}

/** Groups consecutive fields that share a group label (nested objects, equipment params). */
function sections(fields: FieldSpec[]): { group?: string; fields: FieldSpec[] }[] {
  const out: { group?: string; fields: FieldSpec[] }[] = []
  for (const f of fields) {
    const last = out[out.length - 1]
    if (last && last.group === f.group) last.fields.push(f)
    else out.push({ group: f.group, fields: [f] })
  }
  return out
}

/** A custom catalog entry form generated from the entry schema. */
export function EntryForm({ intent, existingIds, references, onDone, onCancel }: EntryFormProps) {
  const send = useTwinStore((s) => s.send)
  const base = intent.type === 'update' ? intent.entry : intent.from
  const baseCategory = base?.kind === 'equipment' ? base.category : undefined
  const [values, setValues] = useState<FormValues>(() => {
    const start = initialValues(formFields(intent.kind, baseCategory), base)
    return intent.type === 'add' && intent.from ? { ...start, id: `${intent.from.id}-custom` } : start
  })
  const category = intent.kind === 'equipment' ? (values.category as EquipmentCategory) : undefined
  const fields = useMemo(() => formFields(intent.kind, category ?? EQUIPMENT_CATEGORIES[0]), [intent.kind, category])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const idBase = useId()

  const set = (key: string, value: FormValues[string]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors(({ [key]: _, ...rest }) => rest)
  }

  const showErrors = (next: Record<string, string>) => {
    setErrors(next)
    const first = fields.find((f) => next[f.key])
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first.key}"]`)?.focus()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const built = buildEntry(intent.kind, fields, values, base)
    if (!built.ok) return showErrors(built.errors)
    if (intent.type === 'add' && existingIds.has(built.entry.id)) {
      return showErrors({ id: `An entry with ID ${built.entry.id} already exists. Pick another ID.` })
    }
    setBusy(true)
    try {
      await send({ type: intent.type === 'add' ? 'addCatalogEntry' : 'updateCatalogEntry', payload: { entry: built.entry } })
      onDone(built.entry)
    } catch (error) {
      showErrors(serverErrors(error instanceof Error ? error.message : String(error), fields))
    } finally {
      setBusy(false)
    }
  }

  const identity = fields.filter((f) => IDENTITY.has(f.key))
  const rest = fields.filter((f) => !IDENTITY.has(f.key))

  return (
    <form ref={formRef} className="ef" onSubmit={submit} noValidate>
      <style href="twin-entry-form" precedence="twin">
        {CSS}
      </style>
      <header className="ef-head">
        <h3>{heading(intent)}</h3>
        <p>Numbers you type are saved with basis user. Leave a number empty when it is unknown.</p>
      </header>
      <div className="ef-body">
        <fieldset className="ef-section">
          <legend className="section-title">Identity</legend>
          {identity.map((f) => (
            <Field key={f.key} spec={f} idBase={idBase} value={values[f.key]} error={errors[f.key]} onChange={set}
              readOnly={intent.type === 'update' && f.key === 'id'} references={references} base={base} />
          ))}
        </fieldset>
        {sections(rest).map((s, i) => (
          <fieldset className="ef-section" key={s.group ?? `s${i}`}>
            <legend className="section-title ef-legend">
              <span>{s.group ?? 'Specification'}</span>
              {s.fields.some((f) => f.type === 'quantity') && <span className="ef-basis-head">Basis</span>}
            </legend>
            {s.fields.map((f) => (
              <Field key={f.key} spec={f} idBase={idBase} value={values[f.key]} error={errors[f.key]} onChange={set}
                readOnly={false} references={references} base={base} />
            ))}
          </fieldset>
        ))}
      </div>
      <footer className="ef-foot">
        {errors[''] && (
          <p className="ef-form-error" role="alert">
            {errors['']}
          </p>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {intent.type === 'add' ? 'Add entry' : 'Save changes'}
        </button>
      </footer>
    </form>
  )
}

interface FieldProps {
  spec: FieldSpec
  idBase: string
  value: FormValues[string] | undefined
  error: string | undefined
  readOnly: boolean
  references: CatalogEntry[]
  base: CatalogEntry | undefined
  onChange(key: string, value: FormValues[string]): void
}

function getQuantity(entry: CatalogEntry | undefined, key: string): Quantity | undefined {
  const q = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), entry)
  return q && typeof q === 'object' && 'basis' in q ? (q as Quantity) : undefined
}

/** The basis the value will carry: the original one while the value matches it, otherwise `user`. */
function liveBasis(spec: FieldSpec, value: string, base: CatalogEntry | undefined): string {
  const prior = getQuantity(base, spec.key)
  const typed = value.trim() === '' ? null : Number(value.replace(/,/g, ''))
  return prior && prior.value === typed ? prior.basis : 'user'
}

function Field({ spec, idBase, value, error, readOnly, references, base, onChange }: FieldProps) {
  const id = `${idBase}-${spec.key}`
  const errorId = `${id}-error`
  const unitId = `${id}-unit`
  const unit = spec.type === 'quantity' || spec.type === 'number' ? unitText(spec.unit ?? '') : ''
  const describedBy = [unit ? unitId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined
  const common = { id, name: spec.key, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy }
  const text = typeof value === 'string' ? value : ''

  let control
  switch (spec.type) {
    case 'boolean':
      control = (
        <span className="ef-check">
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(spec.key, e.target.checked)} />
        </span>
      )
      break
    case 'choice':
      control = (
        <select {...common} className="input ef-input" value={text} onChange={(e) => onChange(spec.key, e.target.value)}>
          {!spec.required && <option value="">None</option>}
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      )
      break
    case 'reference':
      control = (
        <select {...common} className="input ef-input" value={text} onChange={(e) => onChange(spec.key, e.target.value)}>
          {!spec.required && <option value="">None</option>}
          {text && !references.some((r) => r.id === text) && <option value={text}>{text}</option>}
          {references
            .filter((r) => r.kind === spec.refKind)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
      )
      break
    case 'choices': {
      const picked = Array.isArray(value) ? value : []
      return (
        <div className="ef-field" data-field={spec.key}>
          <span className="ef-name">
            <span className="ef-label" id={`${id}-label`}>
              {spec.label}
            </span>
            {!spec.required && <span className="ef-optional">optional</span>}
          </span>
          <div className="ef-choices" role="group" aria-labelledby={`${id}-label`}>
            {spec.options.map((o) => (
              <label key={o} className="ef-choice">
                <input
                  type="checkbox"
                  name={spec.key}
                  checked={picked.includes(o)}
                  onChange={(e) => onChange(spec.key, e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))}
                />
                {optionLabel(o)}
              </label>
            ))}
          </div>
          {error && <FieldError id={errorId} text={error} />}
        </div>
      )
    }
    case 'text':
      control = spec.multiline ? (
        <textarea {...common} className="input ef-input ef-area" rows={3} value={text} onChange={(e) => onChange(spec.key, e.target.value)} />
      ) : (
        <input {...common} className="input ef-input" type="text" value={text} readOnly={readOnly} spellCheck={false}
          onChange={(e) => onChange(spec.key, e.target.value)} />
      )
      break
    case 'list':
      control = (
        <input {...common} className="input ef-input" type="text" value={text} placeholder="Comma-separated" spellCheck={false}
          onChange={(e) => onChange(spec.key, e.target.value)} />
      )
      break
    default:
      control = (
        <span className="ef-num">
          <input {...common} className="input ef-input" type="text" inputMode="decimal" autoComplete="off" value={text}
            placeholder={spec.type === 'quantity' ? 'unknown' : undefined} onChange={(e) => onChange(spec.key, e.target.value)} />
          {unit && (
            <span className="ef-unit" id={unitId}>
              {unit}
            </span>
          )}
        </span>
      )
  }

  return (
    <div className="ef-field" data-field={spec.key}>
      <span className="ef-name">
        <label className="ef-label" htmlFor={id}>
          {spec.label}
        </label>
        {!spec.required && <span className="ef-optional">optional</span>}
      </span>
      <div className="ef-control">{control}</div>
      <span className="ef-basis">{spec.type === 'quantity' && (spec.required || text.trim()) ? liveBasis(spec, text, base) : ''}</span>
      {error && <FieldError id={errorId} text={error} />}
    </div>
  )
}

function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p className="ef-error" id={id}>
      {text}
    </p>
  )
}

const CSS = `
.ef { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.ef-head { padding: var(--space-4) var(--space-5) var(--space-3); border-bottom: var(--rule); }
.ef-head h3 { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.ef-head p { margin-top: var(--space-1); color: var(--graphite); font-size: var(--text-sm); max-width: 62ch; }
.ef-body { overflow: auto; padding: 0 var(--space-5) var(--space-4); }
.ef-section { border: 0; margin: 0; padding: var(--space-4) 0 0; min-width: 0; }
.ef-section + .ef-section { border-top: var(--rule); margin-top: var(--space-4); }
.ef-section legend { float: left; width: 100%; padding: 0 0 var(--space-2); }
.ef-legend { grid-template-areas: none; align-items: baseline; }
.ef-field, .ef-legend {
  clear: both;
  display: grid;
  grid-template-columns: minmax(150px, 210px) minmax(180px, 280px) 72px;
  grid-template-areas: "name control basis" ". error error";
  justify-content: start;
  column-gap: var(--space-4);
  align-items: center;
  padding: 3px 0;
}
.ef-legend > span:first-child { grid-column: 1 / 3; }
.ef-basis-head { grid-column: 3; font-size: var(--text-xs); font-weight: var(--weight-regular); }
.ef-name { grid-area: name; display: flex; flex-direction: column; min-width: 0; }
.ef-label { font-stretch: var(--stretch-label); font-size: var(--text-md); color: var(--ink); }
.ef-optional { font-size: var(--text-xs); color: var(--graphite); font-stretch: var(--stretch-label); }
.ef-control, .ef-choices { grid-area: control; min-width: 0; }
.ef-basis { grid-area: basis; font-size: var(--text-xs); color: var(--graphite); font-stretch: var(--stretch-label); }
.ef-field:has(.ef-area) .ef-control, .ef-field:has(.ef-choices) .ef-choices { grid-column: 2 / 4; }
.ef-input { width: 100%; font-variant-numeric: tabular-nums; }
.ef-input[readonly] { background: transparent; color: var(--graphite); }
.ef-input[aria-invalid="true"] { border-color: var(--heat); box-shadow: inset 0 0 0 1px var(--heat); }
.ef-input::placeholder { color: var(--graphite); opacity: 0.7; font-style: italic; }
.ef-input.ef-area { height: auto; padding: var(--space-1) var(--space-2); resize: vertical; line-height: 1.45; }
.ef-num { position: relative; display: block; }
.ef-num .ef-input { padding-right: 76px; text-align: right; }
.ef-unit {
  position: absolute; right: 1px; top: 1px; bottom: 1px; min-width: 64px;
  display: flex; align-items: center; padding: 0 var(--space-2);
  border-left: var(--rule); border-radius: 0 var(--radius-control) var(--radius-control) 0; background: var(--clay-mid);
  font-stretch: var(--stretch-label); font-size: var(--text-sm); color: var(--graphite);
  pointer-events: none;
}
.ef-check { display: flex; align-items: center; height: 28px; }
.ef-check input, .ef-choice input { width: 15px; height: 15px; margin: 0; accent-color: var(--supply); }
.ef-choices { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); padding: var(--space-1) 0; }
.ef-choice { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-sm); }
.ef-error { grid-area: error; margin: 2px 0 var(--space-1); color: var(--heat); font-size: var(--text-sm); }
.ef-foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-5); border-top: var(--rule); background: var(--panel); }
.ef-form-error { margin: 0 auto 0 0; color: var(--heat); font-size: var(--text-sm); white-space: pre-line; }
`
