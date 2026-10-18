import {
  num,
  type Basis,
  type CatalogEntry,
  type Check,
  type Evaluation,
  type LayerId,
  type Plan,
  type Quantity,
  type Selection,
  type SizedEquipment,
  type Status,
} from '@twin/schema'
import { useEffect } from 'react'
import { useTwinStore } from '../state/store'
import { fmtPower } from '../format'
import { fmtUnit, rowsLabel } from '../strips/parts'
import { StatusMark } from './StatusMark'

/** Where a shown number comes from: a calculation over named inputs, or a catalog or plan value with its basis. */
type Origin = { from: string[] } | { basis: Basis; of?: string; source?: string; note?: string }

interface Fact {
  label: string
  value: string[]
  origin?: Origin
}

interface View {
  kind: string
  title: string
  subtitle?: string
  status?: Status
  facts: Fact[]
  check?: Check
  related: Check[]
}

const BASIS_WORDS: Record<Basis, string> = {
  vendor: 'vendor datasheet',
  oem: 'OEM documentation',
  press: 'press report',
  textbook: 'textbook value',
  estimate: 'estimate',
  user: 'set in the plan',
  calculated: 'calculated',
}

const LAYER_NAMES: Record<LayerId, string> = {
  site: 'Site',
  workload: 'Workload',
  compute: 'Compute',
  layout: 'Layout',
  cooling: 'Cooling',
  power: 'Power',
  network: 'Network',
}

const STATUS_WORDS: Record<Status, string> = { fail: 'Fails', warn: 'Close to the limit', pass: 'Passes', unknown: 'Not enough data' }

const EQUIPMENT_NAMES: Record<string, string> = {
  cdu: 'CDU',
  crah: 'CRAH',
  heatRejection: 'Heat rejection plant',
  busway: 'Busway',
  ups: 'UPS',
  transformer: 'Transformers',
  leaf: 'Leaf switch',
  bufferTank: 'Buffer tank',
}

/** Per-unit rating param of each equipment category, as shown in "count × unit". */
const UNIT_PARAM: Record<string, { key: string; unit: string }> = {
  cdu: { key: 'capacityW', unit: 'W' },
  crah: { key: 'capacityW', unit: 'W' },
  ups: { key: 'moduleW', unit: 'W' },
  transformer: { key: 'ratingVa', unit: 'VA' },
  busway: { key: 'ratingA', unit: 'A' },
  leaf: { key: 'ports', unit: 'ports' },
}

/** "rack nominal power 132 kW (press report)": a catalog input named with its value and basis. */
function input(label: string, q: Quantity | undefined, unit = q?.unit ?? ''): string {
  const v = q ? num(q) : null
  return v === null || !q ? label : `${label} ${fmtUnit(v, unit)} (${BASIS_WORDS[q.basis]})`
}

function quantityOrigin(q: Quantity | undefined, of: string): Origin | undefined {
  return q ? { basis: q.basis, of, source: q.source, note: q.note } : undefined
}

function catalogEntry<K extends CatalogEntry['kind']>(plan: Plan | null, id: string | null | undefined, kind: K) {
  const e = plan && id ? plan.catalog[id] : undefined
  return e?.kind === kind ? (e as Extract<CatalogEntry, { kind: K }>) : undefined
}

function pctOf(part: number, whole: number): string {
  return whole > 0 ? fmtUnit(part / whole, 'fraction') : '—'
}

/** Strip a scene id ("rack:R3-07:tray:2", "eq:cdu:R3:0") down to what the evaluation is keyed by. */
function placementOf(id: string): string {
  const bare = id.startsWith('rack:') ? id.slice(5) : id
  return bare.split(':')[0]!
}

function relatedChecks(checks: Check[], match: (c: Check) => boolean): Check[] {
  return checks.filter(match)
}

function rackView(plan: Plan | null, ev: Evaluation, id: string): View | null {
  const r = ev.racks.find((x) => x.placementId === placementOf(id))
  if (!r) return null
  const group = plan?.rackGroups.find((g) => g.id === r.groupId)
  const rack = catalogEntry(plan, group?.rackTypeId, 'rack')
  const method = catalogEntry(plan, group?.coolingMethodId, 'rackCooling')
  const coolant = catalogEntry(plan, method?.coolantId, 'coolant')
  const cdu = ev.equipment.find((e) => e.key === ev.rows.find((row) => row.rowId === r.rowId)?.cduKey)
  const cduModel = catalogEntry(plan, cdu?.modelId, 'equipment')
  const bay = ev.bays.find((b) => b.bayId === r.bayId)
  const rackName = rack?.name ?? 'rack type'
  const methodName = method?.name ?? 'cooling method'
  const liquid = r.liquidW > 0

  const facts: Fact[] = [
    {
      label: 'Power',
      value: [fmtPower(r.powerW)],
      origin: quantityOrigin(rack?.nominalPowerW, `${rackName} nominal power`) ?? { from: [`${rackName} nominal power`] },
    },
    ...(rack && num(rack.peakPowerW) !== null
      ? [{ label: 'Peak power', value: [fmtUnit(num(rack.peakPowerW), 'W')], origin: quantityOrigin(rack.peakPowerW, `${rackName} peak power`) }]
      : []),
    {
      label: 'Heat split',
      value: [`${fmtPower(r.liquidW)} to liquid (${pctOf(r.liquidW, r.heatW)})`, `${fmtPower(r.airW)} to air (${pctOf(r.airW, r.heatW)})`],
      origin: {
        from: [
          `heat ${fmtPower(r.heatW)}`,
          input(`${methodName} share to liquid`, method?.toTechnicalLoop),
          input('rack liquid limit', rack?.maxLiquidFraction),
        ],
      },
    },
    ...(r.facilityWaterW > 0
      ? [{ label: 'To facility water', value: [fmtPower(r.facilityWaterW)], origin: { from: [input(`${methodName} share at the rack`, method?.toFacilityWaterAtRack)] } }]
      : []),
    {
      label: 'Flow',
      value: [liquid ? fmtUnit(r.flowLps, 'L/s') : 'none, air-cooled'],
      origin: liquid
        ? {
            from: [
              `liquid heat ${fmtPower(r.liquidW)}`,
              input(`${coolant?.name ?? 'coolant'} heat capacity`, coolant?.cpJPerKgK),
              input('density', coolant?.densityKgM3),
              input('loop temperature rise', method?.deltaTK),
            ],
          }
        : { from: [input(`${methodName} share to liquid`, method?.toTechnicalLoop)] },
    },
    {
      label: 'Temperatures',
      value: [
        ...(liquid ? [`coolant ${fmtUnit(r.supplyC, '°C')} in, ${fmtUnit(r.returnC, '°C')} out`] : []),
        `air ${fmtUnit(r.airInletC, '°C')} in, ${fmtUnit(r.airOutletC, '°C')} out`,
      ],
      origin: {
        from: [
          plan ? `facility supply ${fmtUnit(plan.cooling.facilitySupplyC, '°C')} (set in the plan)` : 'facility supply',
          ...(liquid ? [input('CDU approach', cduModel?.params.approachK), input('loop temperature rise', method?.deltaTK)] : []),
        ],
      },
    },
    {
      label: 'Weight',
      value: [fmtUnit(r.weightKg, 'kg')],
      origin: { from: [input(`${rackName} weight`, rack?.weightKg), input(`${methodName} added weight`, method?.addedWeightKgPerRack)] },
    },
    {
      label: 'Bay',
      value: [bay ? `${r.bayId}, ${fmtUnit(bay.loadKnM2, 'kN/m²')} of ${fmtUnit(bay.ratingKnM2, 'kN/m²')} (${fmtUnit(bay.utilization, 'fraction')})` : r.bayId],
      origin: { from: [`footprint center of row ${r.rowId.replace(/\D/g, '')}, slot ${r.slot + 1}`, 'the 3.6 m bay grid', 'rack weights in the bay'] },
    },
  ]

  return {
    kind: 'Rack',
    title: r.placementId,
    subtitle: [group?.name, rack?.name, method?.name].filter(Boolean).join(', '),
    facts,
    related: relatedChecks(
      ev.checks,
      (c) =>
        c.subject.objectIds.includes(r.objectId) ||
        (c.subject.kind === 'group' && c.subject.id === r.groupId) ||
        (c.subject.kind === 'row' && c.subject.id === r.rowId) ||
        (c.subject.kind === 'bay' && c.subject.id === r.bayId),
    ),
  }
}

function servedRows(plan: Plan | null, ev: Evaluation, e: SizedEquipment): string[] {
  const rowFromKey = e.key.split(':')[1]
  if (rowFromKey && ev.rows.some((r) => r.rowId === rowFromKey)) return [rowFromKey]
  const positions = plan?.hall.positions.filter((p) => e.positionIds.includes(p.id)) ?? []
  const rows = positions.flatMap((p) => p.servesRows)
  return rows.length ? rows : ev.rows.map((r) => r.rowId)
}

function equipmentView(plan: Plan | null, ev: Evaluation, id: string): View | null {
  const bare = id.startsWith('eq:') ? id.slice(3).replace(/:\d+$/, '') : id
  const e = ev.equipment.find((x) => x.key === bare || x.objectIds.includes(id))
  if (!e) return null
  const model = plan && e.modelId ? plan.catalog[e.modelId] : undefined
  const unit = UNIT_PARAM[e.category]
  const unitQ = model?.kind === 'equipment' && unit ? model.params[unit.key] : model?.kind === 'heatRejection' ? model.unitCapacityW : undefined
  const unitLabel = unit?.unit ?? 'W'
  const rows = servedRows(plan, ev, e)
  const loadOf = e.category === 'crah' ? 'air-side heat' : e.category === 'cdu' ? 'liquid heat' : e.category === 'heatRejection' ? 'heat' : 'IT load'
  const name = EQUIPMENT_NAMES[e.category] ?? e.category

  const facts: Fact[] = [
    {
      label: 'Model',
      value: [model?.name ?? 'not chosen'],
      origin: model
        ? { basis: model.custom ? 'user' : 'vendor', of: `catalog entry as of ${model.asOf}`, source: model.sources?.[0]?.url }
        : undefined,
    },
    {
      label: 'Count',
      value: [e.count === e.required ? `${e.count}` : `${e.count}, ${e.required} required`],
      origin: e.autoSized
        ? { from: [`${loadOf} ${fmtPower(e.loadW)}`, input('unit rating', unitQ, unitLabel), plan ? `${plan.power.redundancy} redundancy (set in the plan)` : 'redundancy'] }
        : { basis: 'user', of: 'equipment override' },
    },
    { label: 'Load', value: [fmtPower(e.loadW)], origin: { from: [`${loadOf} of ${rowsLabel(rows, false)}`] } },
    {
      label: 'Capacity',
      value: [fmtUnit(e.capacityW, 'W')],
      origin: { from: [`${e.count} × ${input('unit rating', unitQ, unitLabel)}`, ...(e.count > e.required ? [] : []), 'redundant units excluded'] },
    },
    ...(e.capacityW !== null
      ? [
          {
            label: 'Headroom',
            value: [`${fmtPower(e.capacityW - e.loadW)} (${fmtUnit(1 - e.loadW / e.capacityW, 'fraction')} of capacity)`],
            origin: { from: ['capacity', 'load'] },
          },
        ]
      : []),
    { label: 'Positions', value: [e.positionIds.length ? e.positionIds.join(', ') : 'none'] },
  ]

  return {
    kind: name,
    title: e.key,
    subtitle: e.autoSized ? 'Auto-sized to the load' : 'Model and count set in the plan',
    facts,
    related: relatedChecks(ev.checks, (c) => c.subject.id === e.key || c.subject.objectIds.some((o) => e.objectIds.includes(o))),
  }
}

function checkView(ev: Evaluation, id: string): View | null {
  const c = ev.checks.find((x) => x.id === id)
  if (!c) return null
  const causes = c.causes.map((k) => `${k.label.toLowerCase()} ${k.value}`)
  const facts: Fact[] = [
    { label: 'Value', value: [fmtUnit(c.value, c.unit)], origin: causes.length ? { from: causes } : { from: [c.explanation] } },
    { label: 'Limit', value: [fmtUnit(c.limit, c.unit)] },
    { label: 'Utilization', value: [fmtUnit(c.utilization, 'fraction')], origin: { from: ['value', 'limit'] } },
    ...(c.worstFailure
      ? [
          {
            label: 'Worst failure',
            value: [`${c.worstFailure.scenario}: ${fmtUnit(c.worstFailure.value, c.unit)} (${fmtUnit(c.worstFailure.utilization, 'fraction')})`],
            origin: { from: ['the same check with one unit out of service'] },
          },
        ]
      : []),
  ]
  return { kind: `${LAYER_NAMES[c.layer]} check`, title: c.title, status: c.status, facts, check: c, related: [] }
}

function bayView(ev: Evaluation, id: string): View | null {
  const b = ev.bays.find((x) => x.bayId === id)
  if (!b) return null
  return {
    kind: 'Floor bay',
    title: b.bayId,
    facts: [
      { label: 'Load', value: [fmtUnit(b.loadKnM2, 'kN/m²')], origin: { from: ['rack and equipment weights in the bay', 'bay area'] } },
      { label: 'Rating', value: [fmtUnit(b.ratingKnM2, 'kN/m²')], origin: { basis: 'user', of: 'floor rating of the hall' } },
      { label: 'Utilization', value: [fmtUnit(b.utilization, 'fraction')], origin: { from: ['load', 'rating'] } },
    ],
    related: relatedChecks(ev.checks, (c) => c.subject.kind === 'bay' && c.subject.id === b.bayId),
  }
}

function rowView(ev: Evaluation, id: string): View | null {
  const r = ev.rows.find((x) => x.rowId === id)
  if (!r) return null
  const racks = ev.racks.filter((x) => x.rowId === id)
  return {
    kind: 'Row',
    title: r.rowId,
    subtitle: `${racks.length} racks`,
    facts: [
      { label: 'Heat to liquid', value: [fmtPower(r.liquidW)], origin: { from: [`heat split of ${racks.length} racks`] } },
      { label: 'Heat to air', value: [fmtPower(r.airW)], origin: { from: [`heat split of ${racks.length} racks`] } },
      { label: 'Flow', value: [fmtUnit(r.flowLps, 'L/s')], origin: { from: ['rack flows in the row'] } },
      { label: 'Busway current', value: [fmtUnit(r.buswayLoadA, 'A')], origin: { from: ['row IT load', 'busway voltage and power factor'] } },
      { label: 'CDU', value: [r.cduKey ?? 'none'] },
    ],
    related: relatedChecks(ev.checks, (c) => c.subject.kind === 'row' && c.subject.id === r.rowId),
  }
}

function metricView(ev: Evaluation, id: string): View | null {
  const m = ev.metrics.find((x) => x.id === id)
  if (!m) return null
  return {
    kind: `${LAYER_NAMES[m.layer]} value`,
    title: m.label,
    facts: [{ label: 'Value', value: [fmtUnit(m.value, m.unit)], origin: m.inputs.length ? { from: m.inputs } : { basis: m.basis } }],
    related: [],
  }
}

function describe(sel: Selection, plan: Plan | null, ev: Evaluation): View | null {
  switch (sel.kind) {
    case 'rack':
    case 'gpu':
      return rackView(plan, ev, sel.id)
    case 'equipment':
      return equipmentView(plan, ev, sel.id)
    case 'check':
      return checkView(ev, sel.id)
    case 'bay':
      return bayView(ev, sel.id)
    case 'row':
      return rowView(ev, sel.id)
    case 'metric':
      return metricView(ev, sel.id)
    default:
      return null
  }
}

function OriginLine({ origin }: { origin: Origin }) {
  if ('from' in origin) return <p className="dt-origin">Calculated from {origin.from.join(', ')}</p>
  return (
    <p className="dt-origin" title={origin.note}>
      Basis: {BASIS_WORDS[origin.basis]}
      {origin.of ? `, ${origin.of}` : ''}
      {origin.source ? (
        <>
          {', '}
          <a href={origin.source} target="_blank" rel="noreferrer">
            source
          </a>
        </>
      ) : null}
    </p>
  )
}

function StatusLine({ status }: { status: Status }) {
  return (
    <p className="dt-status">
      <StatusMark status={status} label={STATUS_WORDS[status]} />
    </p>
  )
}

const CSS = `
.dt-inspector{position:absolute;top:var(--space-3);right:var(--space-3);bottom:var(--space-3);width:340px;max-width:calc(100% - 2 * var(--space-3));
  display:flex;flex-direction:column;background:var(--panel);border:var(--rule);border-radius:var(--radius);z-index:5;
  box-shadow:0 2px 8px rgb(23 32 38 / .08);font-variant-numeric:tabular-nums;animation:dt-drawer var(--dur) var(--ease)}
@keyframes dt-drawer{from{transform:translateX(12px);opacity:0}}
.dt-inspector header{display:grid;grid-template-columns:1fr auto;gap:2px var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:var(--rule)}
.dt-inspector .dt-kind{margin:0;font-size:var(--text-sm);font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-inspector h2{grid-column:1;margin:0;font-size:var(--text-lg);font-weight:600;line-height:1.25}
.dt-inspector .dt-sub{grid-column:1;margin:0;color:var(--graphite);font-size:var(--text-sm)}
.dt-inspector .dt-close{grid-row:1 / span 2;grid-column:2;align-self:start;font:inherit;font-size:var(--text-sm);color:var(--graphite);
  background:none;border:var(--rule);border-radius:var(--radius);padding:2px var(--space-2);cursor:pointer}
.dt-inspector .dt-close:hover{color:var(--ink);background:var(--canvas)}
.dt-inspector .dt-body{overflow:auto;padding:0 var(--space-4) var(--space-4)}
.dt-inspector .dt-status{margin:var(--space-3) 0 0;font-weight:600}
.dt-inspector .dt-fact{display:grid;grid-template-columns:96px 1fr;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:var(--rule)}
.dt-inspector .dt-fact dt{font-size:var(--text-sm);font-stretch:var(--stretch-label);color:var(--graphite);padding-top:1px}
.dt-inspector .dt-fact dd{margin:0;font-weight:500}
.dt-inspector .dt-fact dd div+div{margin-top:1px}
.dt-inspector .dt-origin{margin:2px 0 0;font-size:var(--text-xs);font-weight:400;color:var(--graphite);line-height:1.4}
.dt-inspector .dt-origin a{color:inherit}
.dt-inspector h3{margin:var(--space-4) 0 var(--space-1);font-size:var(--text-sm);font-weight:600;font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-inspector .dt-text{margin:var(--space-2) 0 0;line-height:1.45}
.dt-inspector ul{list-style:none;margin:0;padding:0}
.dt-inspector li button{display:flex;gap:var(--space-2);width:100%;text-align:left;font:inherit;color:var(--ink);background:none;border:0;
  border-bottom:var(--rule);padding:var(--space-1) 0;cursor:pointer}
.dt-inspector li button:hover .dt-link{text-decoration:underline}
.dt-inspector .dt-link{text-decoration:underline;text-decoration-color:var(--hairline);text-underline-offset:2px}
.dt-inspector .dt-meta{margin-left:auto;color:var(--graphite);font-size:var(--text-xs);white-space:nowrap}
`

/** Detail drawer for the current selection: inputs, computed values, limits, headroom and the origin of each number. */
export function Inspector() {
  const selection = useTwinStore((s) => s.selection)
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const dispatchView = useTwinStore((s) => s.dispatchView)

  useEffect(() => {
    if (!selection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchView({ type: 'select', target: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, dispatchView])

  if (!selection || !evaluation) return null
  const view = describe(selection, plan, evaluation)
  const close = () => dispatchView({ type: 'select', target: null })
  const selectCheck = (id: string) => dispatchView({ type: 'select', target: { kind: 'check', id } })

  return (
    <aside className="dt-inspector" aria-label="Inspector">
      <style href="twin-inspector" precedence="default">
        {CSS}
      </style>
      <header>
        <p className="dt-kind">{view?.kind ?? 'Selection'}</p>
        <h2>{view?.title ?? selection.id}</h2>
        {view?.subtitle ? <p className="dt-sub">{view.subtitle}</p> : null}
        <button type="button" className="dt-close" onClick={close} aria-label="Close inspector">
          Close
        </button>
      </header>
      <div className="dt-body">
        {!view ? <p className="dt-text">No computed values for this object in the current evaluation.</p> : null}
        {view?.status ? <StatusLine status={view.status} /> : null}
        {view ? (
          <dl>
            {view.facts.map((f) => (
              <div className="dt-fact" role="group" aria-label={f.label} key={f.label}>
                <dt>{f.label}</dt>
                <dd>
                  {f.value.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  {f.origin ? <OriginLine origin={f.origin} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {view?.check ? (
          <>
            <p className="dt-text">{view.check.explanation}</p>
            {view.check.advice ? <p className="dt-text">{view.check.advice}</p> : null}
            {view.check.causes.length ? (
              <>
                <h3 id="dt-causes">Causes</h3>
                <ul aria-labelledby="dt-causes">
                  {view.check.causes.map((c) => (
                    <li key={c.path}>
                      <button type="button" onClick={() => dispatchView({ type: 'setLayer', layer: c.layer })}>
                        <span className="dt-link">
                          {c.label}: {c.value}
                        </span>
                        <span className="dt-meta">{LAYER_NAMES[c.layer]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
        {view?.related.length ? (
          <>
            <h3 id="dt-related">Checks</h3>
            <ul aria-labelledby="dt-related">
              {view.related.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => selectCheck(c.id)}>
                    <StatusMark status={c.status} label={c.title} />
                    <span className="dt-meta">{fmtUnit(c.utilization, 'fraction')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  )
}
