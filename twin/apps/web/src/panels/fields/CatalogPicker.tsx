import { useId, useMemo, useState } from 'react'
import { loadBuiltins } from '@twin/catalog'
import { makeCatalogIndex } from '@twin/engine'
import type {
  Basis,
  CatalogEntryOfKind,
  CatalogIndex,
  ClimateEntry,
  HeatRejectionEntry,
  Quantity,
  RackCoolingEntry,
  RackEntry,
} from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useField } from './Field'
import { fmtMass, fmtMoney, fmtPct, fmtPower, fmtValue, fmtWeeks } from '../../format'
import s from './CatalogPicker.module.css'

/** Built-in entries merged with the plan's own catalog (plan entries, including custom ones, win). */
export function useCatalog(): CatalogIndex {
  const planCatalog = useTwinStore((st) => st.plan?.catalog)
  return useMemo(() => makeCatalogIndex([...loadBuiltins().entries, ...Object.values(planCatalog ?? {})]), [planCatalog])
}

type PickerKind = 'rack' | 'rackCooling' | 'heatRejection' | 'climate'

interface Fact {
  text: string
  basis?: Basis
  title?: string
}

const BASIS_LABEL: Record<Basis, string> = {
  vendor: 'vendor',
  oem: 'OEM',
  press: 'press',
  textbook: 'textbook',
  estimate: 'estimate',
  user: 'user',
  calculated: 'calculated',
}

/** A fact from one quantity; null values are left out (the inspector shows the full entry). */
function fact(q: Quantity | undefined, text: (v: number) => string): Fact[] {
  if (!q || q.value === null) return []
  return [{ text: text(q.value), basis: q.basis, title: q.note }]
}

const leadTime = (q: Quantity) => fact(q, (v) => `${fmtWeeks(v)} lead time`)

function rackCoolingFacts(e: RackCoolingEntry): Fact[] {
  return [
    ...fact(e.maxRackW, (v) => `Max ${fmtPower(v)} per rack`),
    ...fact(e.toTechnicalLoop, (v) => (v === 0 ? 'All heat to air' : `${fmtPct(v)} of heat to liquid`)),
    ...fact(e.addedWeightKgPerRack, (v) => `Adds ${fmtMass(v)} per rack`),
    ...fact(e.capexUsdPerKw, (v) => `${fmtMoney(v)} per kW`),
    ...leadTime(e.leadTimeWeeks),
    ...(e.requiresCdu ? [{ text: 'Needs CDUs' }] : []),
  ]
}

function heatRejectionFacts(e: HeatRejectionEntry): Fact[] {
  const cop = e.copRef.value !== null && e.copRefOutdoorC.value !== null
  return [
    ...(cop ? fact(e.copRef, (v) => `COP ${v} at ${fmtValue(e.copRefOutdoorC.value, '°C')} outdoor`) : []),
    ...fact(e.approachK, (v) => `Approach ${fmtValue(v, 'K')} to ${e.basis === 'wetBulb' ? 'wet bulb' : 'dry bulb'}`),
    ...fact(e.waterLPerKwh, (v) => (v === 0 ? 'No water' : `${fmtValue(v, 'L')} of water per kWh of heat`)),
    ...(e.economizer ? [{ text: 'Free cooling in cold hours' }] : []),
    ...fact(e.capexUsdPerKw, (v) => `${fmtMoney(v)} per kW`),
    ...leadTime(e.leadTimeWeeks),
  ]
}

function rackFacts(e: RackEntry): Fact[] {
  return [
    ...fact(e.nominalPowerW, (v) => `${fmtPower(v)} per rack`),
    ...(e.gpuCount > 0 ? [{ text: `${e.gpuCount} GPUs` }] : []),
    ...fact(e.fp8Pflops, (v) => (v > 0 ? `${fmtValue(v, 'PFLOPS')} FP8` : 'No GPU compute')),
    ...fact(e.weightKg, (v) => fmtMass(v)),
    ...fact(e.capexUsd, (v) => fmtMoney(v)),
    ...leadTime(e.leadTimeWeeks),
    ...(e.slotsWide > 1 ? [{ text: `${e.slotsWide} slots wide` }] : []),
  ]
}

function climateFacts(e: ClimateEntry): Fact[] {
  return [
    ...fact(e.designDryBulbC, (v) => `Design dry bulb ${fmtValue(v, '°C')}`),
    { text: `Peak wet bulb ${fmtValue(Math.max(...e.wetBulbC), '°C')}`, basis: 'calculated', title: 'Hottest hour of the typical year' },
  ]
}

type PickerEntry = CatalogEntryOfKind<PickerKind>

function factsOf(e: PickerEntry): Fact[] {
  switch (e.kind) {
    case 'rackCooling':
      return rackCoolingFacts(e)
    case 'rack':
      return rackFacts(e)
    case 'heatRejection':
      return heatRejectionFacts(e)
    case 'climate':
      return climateFacts(e)
  }
}

/** Options run from the lightest duty to the heaviest, by the number that decides each kind. */
function orderOf(e: PickerEntry): number {
  switch (e.kind) {
    case 'rackCooling':
      return e.maxRackW.value ?? Infinity
    case 'rack':
      return e.nominalPowerW.value ?? Infinity
    case 'heatRejection':
      return e.capexUsdPerKw.value ?? Infinity
    case 'climate':
      return e.designDryBulbC.value ?? Infinity
  }
}

const STATUS: Record<RackCoolingEntry['status'], string | null> = {
  mainstream: null,
  emerging: 'Emerging',
  stalled: '▲ Stalled',
  research: '▲ Research only',
}

/** Why an option can't be picked here (`blocked`), or what to watch for (`caution`). */
export interface Assessment {
  blocked?: string
  caution?: string
}

function Facts(props: { id: string; facts: Fact[] }) {
  return (
    <span id={props.id} className={s.facts}>
      {props.facts.map((f) => (
        <span key={f.text} className={s.fact} data-basis={f.basis} title={f.title}>
          <span>{f.text}</span>
          {f.basis && <span className={s.basis}>{BASIS_LABEL[f.basis]}</span>}
        </span>
      ))}
    </span>
  )
}

function Verdict(props: { id: string; assessment: Assessment }) {
  const { blocked, caution } = props.assessment
  if (!blocked && !caution) return null
  return (
    <span id={props.id} className={blocked ? s.blocked : s.caution}>
      {blocked ? `✕ ${blocked}` : `▲ ${caution}`}
    </span>
  )
}

/** `assess` receives entries of the picked kind. */
type PickerProps = { [K in PickerKind]: { kind: K; assess?: (entry: CatalogEntryOfKind<K>) => Assessment } }[PickerKind] & {
  value: string
  onChange(id: string): void | Promise<void>
  /** Label element id when used outside a `Field`. */
  labelledBy?: string
}

/**
 * Chooses a catalog entry. Each option lists the numbers that decide the choice, each with its basis,
 * and options this context can't take are disabled with the reason.
 */
export function CatalogPicker(props: PickerProps) {
  const catalog = useCatalog()
  const { labelId, run } = useField()
  const id = useId()
  const [open, setOpen] = useState(false)
  const options = useMemo(
    () =>
      catalog
        .all()
        .filter((e): e is PickerEntry => e.kind === props.kind)
        .sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name)),
    [catalog, props.kind],
  )
  const current: PickerEntry | undefined = catalog.get(props.value, props.kind)
  const listId = `${id}-list`
  // Every option has props.kind, so it matches the kind `assess` was written for.
  const assessKind = props.assess as ((e: PickerEntry) => Assessment) | undefined
  const assess = (e: PickerEntry): Assessment => assessKind?.(e) ?? {}

  return (
    <div className={s.picker}>
      <div className={s.current}>
        <div className={s.currentText}>
          <span className={s.name}>{current?.name ?? `Unknown entry ${props.value}`}</span>
          {current && !open && <Facts id={`${id}-current`} facts={factsOf(current)} />}
          {current && <Verdict id={`${id}-current-verdict`} assessment={assess(current)} />}
        </div>
        <button
          type="button"
          className={s.change}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : 'Change'}
        </button>
      </div>
      {open && (
        <div id={listId} role="radiogroup" aria-labelledby={props.labelledBy ?? labelId} className={s.options}>
          {options.map((e) => {
            const verdict = assess(e)
            const status = e.kind === 'rackCooling' ? STATUS[e.status] : null
            const optionId = `${id}-${e.id}`
            return (
              <label key={e.id} className={s.option} data-blocked={verdict.blocked ? '' : undefined}>
                <input
                  type="radio"
                  name={id}
                  checked={e.id === props.value}
                  disabled={Boolean(verdict.blocked)}
                  aria-labelledby={`${optionId}-name`}
                  aria-describedby={verdict.blocked || verdict.caution ? `${optionId}-facts ${optionId}-verdict` : `${optionId}-facts`}
                  onChange={() => {
                    run(props.onChange(e.id))
                    setOpen(false)
                  }}
                />
                <span className={s.mark} aria-hidden="true" />
                <span className={s.optionBody}>
                  <span className={s.optionHead}>
                    <span id={`${optionId}-name`} className={s.name} title={e.summary}>
                      {e.name}
                    </span>
                    {status && <span className={status.startsWith('▲') ? s.caution : s.status}>{status}</span>}
                  </span>
                  <Facts id={`${optionId}-facts`} facts={factsOf(e)} />
                  <Verdict id={`${optionId}-verdict`} assessment={verdict} />
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
