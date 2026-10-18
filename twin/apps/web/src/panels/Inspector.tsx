import {
  num,
  type Basis,
  type CatalogEntry,
  type Check,
  type CheckKind,
  type Evaluation,
  type LayerId,
  type Plan,
  type Quantity,
  type Selection,
  type SizedEquipment,
  type Status,
  type ViewAction,
} from '@twin/schema'
import { useEffect, useRef } from 'react'
import { useTwinStore } from '../state/store'
import { fmtPower, fmtValue } from '../format'
import { fmtUnit, rowsLabel } from '../strips/parts'
import './Inspector.css'
import { StatusMark } from './StatusMark'

/** Where a shown number comes from: a calculation over named inputs, or a catalog or plan value with its basis. */
type Origin =
  | { from: string[] }
  | { setBy: string }
  | { basis: Basis; of?: string; source?: string; note?: string }
  | { catalog: string; source?: string }

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

/** Where each check's limit comes from. */
const CHECK_LIMITS: Record<CheckKind, string> = {
  'cooling.rackHeatLimit': 'the maximum rack heat of the cooling method (catalog)',
  'cooling.crahCapacity': 'CRAH unit capacity times the units sized (catalog)',
  'cooling.cduCapacity': 'CDU unit capacity times the units sized (catalog)',
  'cooling.cduPositions': 'the CDU positions that serve these rows (plan)',
  'cooling.manifoldBalance': 'the minimum flow share per rack, 0.9 to warn and 0.8 to fail (engine rule)',
  'cooling.coolantTemp': 'the rack maximum coolant supply temperature (catalog)',
  'cooling.heatRejection': 'heat rejection unit capacity times the units sized (catalog)',
  'cooling.rideThrough': 'the chiller restart time and allowed temperature rise (rules)',
  'cooling.waterPeakDay': 'the site water allowance (plan)',
  'cooling.leakExposure': 'the leak risks of the cooling method (catalog)',
  'power.gridWorstHour': 'the site grid capacity (plan)',
  'power.busway': 'the busway rating and the oversubscription allowance (catalog and plan)',
  'power.trainingSwing': 'the site grid capacity (plan)',
  'power.ups': 'UPS module rating times the modules for the redundancy (catalog and plan)',
  'power.transformer': 'transformer rating times the units for the redundancy (catalog and plan)',
  'power.inputCompat': 'the power inputs the rack supports (catalog)',
  'layout.floorBay': 'the bay floor rating (plan)',
  'layout.pointLoad': 'the bay point-load limit (plan)',
  'network.copperReach': 'DAC and AEC reach (rules)',
  'network.leafPorts': 'leaf ports times the leaves sized (catalog)',
  'demand.leadTime': 'equipment lead times against the build schedule (catalog)',
  'workload.targetCompute': 'the workload target (plan)',
}

const STATUS_WORDS: Record<Status, string> = {
  fail: 'Fails',
  warn: 'Close to the limit',
  pass: 'Passes',
  unknown: 'Not enough data',
}

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
  const planBay = plan?.hall.bays.find((b) => b.id === r.bayId)
  const bayGrid = planBay
    ? `the ${fmtValue(planBay.w, 'm')} by ${fmtValue(planBay.d, 'm')} bay in the plan`
    : 'the bay grid in the plan'
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
      ? [
          {
            label: 'Peak power',
            value: [fmtUnit(num(rack.peakPowerW), 'W')],
            origin: quantityOrigin(rack.peakPowerW, `${rackName} peak power`),
          },
        ]
      : []),
    {
      label: 'Heat split',
      value: [
        `${fmtPower(r.liquidW)} to liquid (${pctOf(r.liquidW, r.heatW)})`,
        `${fmtPower(r.airW)} to air (${pctOf(r.airW, r.heatW)})`,
      ],
      origin: {
        from: [
          `heat ${fmtPower(r.heatW)}`,
          input(`${methodName} share to liquid`, method?.toTechnicalLoop),
          input('rack liquid limit', rack?.maxLiquidFraction),
        ],
      },
    },
    ...(r.facilityWaterW > 0
      ? [
          {
            label: 'To facility water',
            value: [fmtPower(r.facilityWaterW)],
            origin: { from: [input(`${methodName} share at the rack`, method?.toFacilityWaterAtRack)] },
          },
        ]
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
      origin: {
        from: [input(`${rackName} weight`, rack?.weightKg), input(`${methodName} added weight`, method?.addedWeightKgPerRack)],
      },
    },
    {
      label: 'Bay',
      value: [
        bay
          ? `${r.bayId}, ${fmtUnit(bay.loadKnM2, 'kN/m²')} of ${fmtUnit(bay.ratingKnM2, 'kN/m²')} (${fmtUnit(bay.utilization, 'fraction')})`
          : r.bayId,
      ],
      origin: {
        from: [`footprint center of row ${r.rowId.replace(/\D/g, '')}, slot ${r.slot + 1}`, bayGrid, 'rack weights in the bay'],
      },
    },
  ]

  return {
    kind: 'Rack',
    title: r.placementId,
    subtitle: [group?.name, rack?.name, method?.name].filter(Boolean).join(', '),
    facts,
    related: ev.checks.filter(
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
  const unitQ =
    model?.kind === 'equipment' && unit
      ? model.params[unit.key]
      : model?.kind === 'heatRejection'
        ? model.unitCapacityW
        : undefined
  const unitLabel = unit?.unit ?? 'W'
  const rows = servedRows(plan, ev, e)
  const loadOf =
    e.category === 'crah'
      ? 'air-side heat'
      : e.category === 'cdu'
        ? 'liquid heat'
        : e.category === 'heatRejection'
          ? 'heat'
          : 'IT load'
  const name = EQUIPMENT_NAMES[e.category] ?? e.category

  const facts: Fact[] = [
    {
      label: 'Model',
      value: [model?.name ?? 'not chosen'],
      origin: model
        ? model.custom
          ? { basis: 'user', of: 'custom catalog entry' }
          : { catalog: `catalog entry as of ${model.asOf}`, source: model.sources?.[0]?.url }
        : undefined,
    },
    {
      label: 'Count',
      value: [e.count === e.required ? `${e.count}` : `${e.count}, ${e.required} required`],
      origin: e.autoSized
        ? {
            from: [
              `${loadOf} ${fmtPower(e.loadW)}`,
              input('unit rating', unitQ, unitLabel),
              plan ? `${plan.power.redundancy} redundancy (set in the plan)` : 'redundancy',
            ],
          }
        : { basis: 'user', of: 'equipment override' },
    },
    { label: 'Load', value: [fmtPower(e.loadW)], origin: { from: [`${loadOf} of ${rowsLabel(rows, false)}`] } },
    {
      label: 'Capacity',
      value: [fmtUnit(e.capacityW, 'W')],
      origin: {
        from: [
          `${e.count} × ${input('unit rating', unitQ, unitLabel)}`,
          plan ? `${plan.power.redundancy} redundancy` : 'redundancy',
        ],
      },
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
    {
      label: 'Positions',
      value: [e.positionIds.length ? e.positionIds.join(', ') : 'none'],
      origin: {
        setBy: e.autoSized ? 'the engine, from the plan positions that serve these rows' : 'the equipment override in the plan',
      },
    },
  ]

  return {
    kind: 'Equipment',
    title: [name, e.key.split(':')[1]].filter(Boolean).join(' '),
    subtitle: e.autoSized ? 'Auto-sized to the load' : 'Model and count set in the plan',
    facts,
    related: ev.checks.filter((c) => c.subject.id === e.key || c.subject.objectIds.some((o) => e.objectIds.includes(o))),
  }
}

function checkView(ev: Evaluation, id: string): View | null {
  const c = ev.checks.find((x) => x.id === id)
  if (!c) return null
  const facts: Fact[] = [
    {
      label: 'Value',
      value: [fmtUnit(c.value, c.unit)],
      origin: { from: [c.causes.length ? 'the plan decisions listed under causes' : 'the evaluated plan'] },
    },
    { label: 'Limit', value: [fmtUnit(c.limit, c.unit)], origin: { setBy: CHECK_LIMITS[c.kind] } },
    { label: 'Utilization', value: [fmtUnit(c.utilization, 'fraction')], origin: { from: ['value', 'limit'] } },
    ...(c.worstFailure
      ? [
          {
            label: 'Worst failure',
            value: [
              `${c.worstFailure.scenario}: ${fmtUnit(c.worstFailure.value, c.unit)} (${fmtUnit(c.worstFailure.utilization, 'fraction')})`,
            ],
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
      {
        label: 'Load',
        value: [fmtUnit(b.loadKnM2, 'kN/m²')],
        origin: { from: ['rack and equipment weights in the bay', 'bay area'] },
      },
      { label: 'Rating', value: [fmtUnit(b.ratingKnM2, 'kN/m²')], origin: { basis: 'user', of: 'floor rating of the hall' } },
      { label: 'Utilization', value: [fmtUnit(b.utilization, 'fraction')], origin: { from: ['load', 'rating'] } },
    ],
    related: ev.checks.filter((c) => c.subject.kind === 'bay' && c.subject.id === b.bayId),
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
      {
        label: 'Busway current',
        value: [fmtUnit(r.buswayLoadA, 'A')],
        origin: { from: ['row IT load', 'busway voltage and power factor'] },
      },
      {
        label: 'CDU',
        value: [r.cduKey ?? 'none'],
        origin: { setBy: 'the engine, from the row liquid heat and the CDU positions that serve the row' },
      },
    ],
    related: ev.checks.filter((c) => c.subject.kind === 'row' && c.subject.id === r.rowId),
  }
}

function metricView(ev: Evaluation, id: string): View | null {
  const m = ev.metrics.find((x) => x.id === id)
  if (!m) return null
  return {
    kind: `${LAYER_NAMES[m.layer]} value`,
    title: m.label,
    facts: [
      { label: 'Value', value: [fmtUnit(m.value, m.unit)], origin: m.inputs.length ? { from: m.inputs } : { basis: m.basis } },
    ],
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

function SourceLink({ href }: { href?: string }) {
  return href ? (
    <>
      {', '}
      <a href={href} target="_blank" rel="noreferrer">
        source
      </a>
    </>
  ) : null
}

function OriginLine({ origin }: { origin: Origin }) {
  if ('from' in origin) return <p className="dt-origin">Calculated from {origin.from.join(', ')}</p>
  if ('setBy' in origin) return <p className="dt-origin">Set by {origin.setBy}</p>
  if ('catalog' in origin)
    return (
      <p className="dt-origin">
        {origin.catalog[0]!.toUpperCase() + origin.catalog.slice(1)}
        <SourceLink href={origin.source} />
      </p>
    )
  return (
    <p className="dt-origin" title={origin.note}>
      Basis: {BASIS_WORDS[origin.basis]}
      {origin.of ? `, ${origin.of}` : ''}
      <SourceLink href={origin.source} />
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

/** Escape belongs to the field being edited (it reverts the draft), not to the drawer. */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function closeDrawer(dispatchView: (a: ViewAction) => void, opener: { current: HTMLElement | null }) {
  dispatchView({ type: 'select', target: null })
  const back = opener.current
  opener.current = null
  if (back?.isConnected) back.focus()
}

/** Detail drawer for the current selection: inputs, computed values, limits, headroom and the origin of each number. */
export function Inspector() {
  const selection = useTwinStore((s) => s.selection)
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const dispatchView = useTwinStore((s) => s.dispatchView)

  const opener = useRef<HTMLElement | null>(null)
  const open = selection !== null

  // Remember what had focus when the drawer opened, so closing can hand focus back.
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) opener.current ??= active
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTextEntry(e.target)) return
      closeDrawer(dispatchView, opener)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dispatchView])

  if (!selection || !evaluation) return null
  const view = describe(selection, plan, evaluation)
  const close = () => closeDrawer(dispatchView, opener)
  const selectCheck = (id: string) => dispatchView({ type: 'select', target: { kind: 'check', id } })

  return (
    <aside className="dt-inspector" aria-label="Inspector">
      <header>
        <p className="dt-kind">{view?.kind ?? 'Selection'}</p>
        <h2>{view?.title ?? selection.id}</h2>
        {view?.subtitle ? <p className="dt-sub">{view.subtitle}</p> : null}
        <button type="button" className="btn btn--quiet dt-close" onClick={close} aria-label="Close inspector">
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
