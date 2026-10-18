import { HOURS_PER_YEAR, type HourlySeries, type HourlySeriesKey } from '@twin/schema'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useTwinStore } from '../state/store'
import { fmtNumber, fmtPower, fmtValue } from '../format'
import { useWidth } from '../strips/parts'
import './HourlyChart.css'

/*
 * The year at a glance plus the worst-week zoom, one row per series (small multiples, never two y-scales).
 * Year panel: the daily range as a wash and the daily peak as a line. Week panel: the 168 hours around the
 * worst facility hour on the same y-scale. Facility power adds the grid cap and a red tick per hour above it.
 */

interface SeriesMeta {
  label: string
  fmt: (v: number) => string
}

const META: Record<HourlySeriesKey, SeriesMeta> = {
  outdoorC: { label: 'Outdoor dry-bulb', fmt: (v) => fmtValue(v, '°C') },
  wetBulbC: { label: 'Outdoor wet-bulb', fmt: (v) => fmtValue(v, '°C') },
  itW: { label: 'IT power', fmt: fmtPower },
  coolingW: { label: 'Cooling power', fmt: fmtPower },
  facilityW: { label: 'Facility power', fmt: fmtPower },
  pue: { label: 'PUE', fmt: (v) => fmtNumber(v, 2) },
  waterM3: { label: 'Water use per hour', fmt: (v) => fmtValue(v, 'm³') },
  trimW: { label: 'Trim cooling', fmt: fmtPower },
}

const DAYS = HOURS_PER_YEAR / 24
const WEEK = 168
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const AXIS_H = 18
const Y_AXIS_W = 46
const GAP = 20

function monthOfDay(day: number): number {
  let m = 0
  while (m < 11 && MONTH_START_DAY[m + 1]! <= day) m++
  return m
}

function dayLabel(day: number): string {
  const m = monthOfDay(day)
  return `${MONTHS[m]} ${day - MONTH_START_DAY[m]! + 1}`
}

function hourLabel(hour: number): string {
  return `${dayLabel(Math.floor(hour / 24))}, ${String(hour % 24).padStart(2, '0')}:00`
}

/** Values with nulls (PUE of an idle hour) left out. */
function finite(xs: (number | null)[]): number[] {
  return xs.filter((x): x is number => x !== null && Number.isFinite(x))
}

interface Daily {
  lo: (number | null)[]
  hi: (number | null)[]
}

function daily(values: (number | null)[]): Daily {
  const lo: (number | null)[] = []
  const hi: (number | null)[] = []
  for (let d = 0; d < DAYS; d++) {
    const day = finite(values.slice(d * 24, d * 24 + 24))
    lo.push(day.length ? Math.min(...day) : null)
    hi.push(day.length ? Math.max(...day) : null)
  }
  return { lo, hi }
}

/** Round tick step (1, 2, 2.5 or 5 × 10^k) and the domain it spans. */
function niceScale(lo: number, hi: number, count = 3): { ticks: number[]; min: number; max: number } {
  const span = hi - lo || Math.abs(hi) || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toPrecision(12)))
  return { ticks, min, max: max === min ? min + step : max }
}

/** Path through the points, broken where a value is missing. */
function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

function bandPath(band: Daily, x: (i: number) => number, y: (v: number) => number): string {
  const top: string[] = []
  const bottom: string[] = []
  band.hi.forEach((hi, i) => {
    const lo = band.lo[i]
    if (hi === null || lo === null || lo === undefined) return
    top.push(`${x(i).toFixed(1)} ${y(hi).toFixed(1)}`)
    bottom.unshift(`${x(i).toFixed(1)} ${y(lo).toFixed(1)}`)
  })
  return top.length ? `M${top.join('L')}L${bottom.join('L')}Z` : ''
}

type Hover = { panel: 'year' | 'week'; at: number } | null

/** Geometry of one small-multiple row, computed once per data and width change, never on hover. */
interface RowGeometry {
  key: HourlySeriesKey
  meta: SeriesMeta
  y: (v: number) => number
  ticks: number[]
  bandD: string
  peakD: string
  weekD: string
  capY: number | null
  yearSummary: string
  weekSummary: string
}

interface Layout {
  inner: number
  yearW: number
  weekW: number
  plotH: number
  weekStart: number
  xYear: (day: number) => number
  xWeek: (hour: number) => number
  rowTop: (row: number) => number
}

const LABEL_H = 16
const ROW_GAP = 6

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function layoutFor(width: number, rows: number, worstHour: number): Layout {
  const inner = Math.max(320, width - 32)
  const weekW = Math.round(Math.max(160, inner * 0.3))
  const yearW = inner - weekW - GAP
  const plotH = rows === 1 ? 82 : 72
  const weekStart = Math.min(Math.max(0, worstHour - WEEK / 2), HOURS_PER_YEAR - WEEK)
  return {
    inner,
    yearW,
    weekW,
    plotH,
    weekStart,
    xYear: (day) => Y_AXIS_W + ((day + 0.5) / DAYS) * (yearW - Y_AXIS_W),
    xWeek: (h) => ((h - weekStart + 0.5) / WEEK) * weekW,
    rowTop: (row) => row * (LABEL_H + plotH + ROW_GAP) + LABEL_H,
  }
}

function rowGeometry(hourly: HourlySeries, key: HourlySeriesKey, layout: Layout, capW: number | null): RowGeometry {
  const meta = META[key]
  const values = hourly[key]
  const band = daily(values)
  const all = finite(values)
  const cap = key === 'facilityW' ? capW : null
  const withCap = cap !== null ? [...all, cap] : all
  const scale = niceScale(Math.min(...withCap), Math.max(...withCap), 4)
  const { plotH, weekStart, xYear, xWeek } = layout
  const y = (v: number) => plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH
  const week = values.slice(weekStart, weekStart + WEEK)
  return {
    key,
    meta,
    y,
    ticks: scale.ticks,
    bandD: bandPath(band, xYear, y),
    peakD: linePath(band.hi, xYear, y),
    weekD: linePath(week, (i) => xWeek(weekStart + i), y),
    capY: cap === null ? null : y(cap),
    yearSummary: `${meta.label} over the year, daily range and peak, ${meta.fmt(Math.min(...all))} to ${meta.fmt(Math.max(...all))}`,
    weekSummary: `${meta.label}, worst week from ${dayLabel(Math.floor(weekStart / 24))}, hourly, peak ${meta.fmt(Math.max(...finite(week)))}`,
  }
}

/** Hourly series over the typical year with the worst week beside it, from the current evaluation. */
export function HourlyChart({ series }: { series: HourlySeriesKey[] }) {
  const hourly = useTwinStore((s) => s.evaluation?.hourly)
  const worstHour = useTwinStore((s) => s.evaluation?.headline.worstHour ?? 0)
  const capW = useTwinStore((s) => s.plan?.site.gridCapacityW ?? null)
  const climate = useTwinStore((s) => (s.plan ? s.plan.catalog[s.plan.site.climateId]?.name : undefined))
  const [ref, width] = useWidth<HTMLDivElement>(720)
  const [table, setTable] = useState(false)

  const shownKey = series.filter((k) => (hourly?.[k].length ?? 0) === HOURS_PER_YEAR).join(',')
  const shown = useMemo(() => (shownKey ? (shownKey.split(',') as HourlySeriesKey[]) : []), [shownKey])
  const facility = shown.includes('facilityW') && hourly && capW !== null ? hourly.facilityW : null
  const overHours = useMemo(
    () => (facility && capW !== null ? facility.flatMap((w, h) => (w > capW ? [h] : [])) : []),
    [facility, capW],
  )
  const title = `${series.length === 1 ? META[series[0]!].label : 'Hourly results'} over the year${climate ? `, ${climate}` : ''}`

  return (
    <section className="dt-hourly" aria-label={title} ref={ref}>
      <header>
        <h3>{title}</h3>
        {shown.length ? (
          <>
            <span className="dt-key">
              <span>
                <svg width="14" height="8" aria-hidden="true">
                  <path d="M0 4H14" stroke="var(--ink)" strokeWidth="2" />
                </svg>
                daily peak
              </span>
              <span>
                <svg width="14" height="8" aria-hidden="true">
                  <rect width="14" height="8" fill="var(--ink)" fillOpacity="0.1" />
                </svg>
                daily range
              </span>
            </span>
            {facility ? (
              <span className="dt-over" data-ok={overHours.length ? undefined : ''}>
                {overHours.length ? `✕ ${plural(overHours.length, 'hour', 'hours')} over the cap` : '✓ Never over the cap'}
              </span>
            ) : null}
            <button type="button" className="btn" aria-pressed={table} onClick={() => setTable((t) => !t)}>
              {table ? 'Show chart' : 'Show table'}
            </button>
          </>
        ) : null}
      </header>
      {!hourly || shown.length === 0 ? (
        <p className="dt-empty">No hourly results yet. They appear once the plan has racks and a climate.</p>
      ) : table ? (
        <MonthlyTable hourly={hourly} series={shown} capW={facility ? capW : null} />
      ) : (
        <Plots hourly={hourly} series={shown} width={width} worstHour={worstHour} capW={capW} overHours={overHours} />
      )}
    </section>
  )
}

interface PlotsProps {
  hourly: HourlySeries
  series: HourlySeriesKey[]
  width: number
  worstHour: number
  capW: number | null
  overHours: number[]
}

/**
 * The plots hold the hover state themselves. The series geometry and the static SVG are memoized, so a
 * pointer move only redraws the crosshair overlay and the tooltip.
 */
function Plots({ hourly, series, width, worstHour, capW, overHours }: PlotsProps) {
  const [hover, setHover] = useState<Hover>(null)
  const layout = useMemo(() => layoutFor(width, series.length, worstHour), [width, series.length, worstHour])
  const rows = useMemo(() => series.map((key) => rowGeometry(hourly, key, layout, capW)), [hourly, series, layout, capW])

  const plots = useMemo(() => {
    const { yearW, weekW, plotH, weekStart, xYear, xWeek } = layout
    const atPointer = (panel: 'year' | 'week', clientX: number, el: SVGSVGElement) => {
      const px = clientX - el.getBoundingClientRect().left
      const at = panel === 'year' ? Math.floor(((px - Y_AXIS_W) / (yearW - Y_AXIS_W)) * DAYS) : Math.floor((px / weekW) * WEEK)
      setHover(at >= 0 && at < (panel === 'year' ? DAYS : WEEK) ? { panel, at } : null)
    }
    const onKey = (e: KeyboardEvent, panel: 'year' | 'week') => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const max = panel === 'year' ? DAYS - 1 : WEEK - 1
      const start = panel === 'year' ? Math.floor(worstHour / 24) : worstHour - weekStart
      setHover((h) => {
        const current = h?.panel === panel ? h.at : start
        return { panel, at: Math.min(max, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1))) }
      })
    }
    const overInWeek = overHours.filter((hr) => hr >= weekStart && hr < weekStart + WEEK)
    const firstDay = Math.floor(weekStart / 24)

    return rows.map((r, row) => {
      const last = row === rows.length - 1
      const h = plotH + (last ? AXIS_H : ROW_GAP)
      return (
        <div key={r.key}>
          <div className="dt-rowlabel">
            <span data-series-label="" style={{ width: yearW, paddingLeft: Y_AXIS_W }}>
              {r.meta.label}
            </span>
            {row === 0 ? <span aria-hidden="true">Worst week, hour by hour</span> : null}
          </div>
          <div className="dt-row">
            <svg
              width={yearW}
              height={h}
              role="img"
              aria-label={r.yearSummary}
              tabIndex={0}
              onPointerMove={(e) => atPointer('year', e.clientX, e.currentTarget)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={(e) => onKey(e, 'year')}
              onBlur={() => setHover(null)}
            >
              {r.ticks.map((t) => (
                <g key={t}>
                  <line className="dt-grid" x1={Y_AXIS_W} x2={yearW} y1={r.y(t)} y2={r.y(t)} />
                  <text className="dt-tick" x={Y_AXIS_W - 6} y={r.y(t) + 3.5} textAnchor="end">
                    {r.meta.fmt(t)}
                  </text>
                </g>
              ))}
              <rect
                x={xYear(weekStart / 24) - 0.5}
                y={0}
                width={(WEEK / 24 / DAYS) * (yearW - Y_AXIS_W)}
                height={plotH}
                fill="var(--ink)"
                fillOpacity={0.05}
              />
              <path d={r.bandD} fill="var(--ink)" fillOpacity={0.1} />
              <path d={r.peakD} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
              {r.capY !== null && capW !== null ? (
                <>
                  <CapLine x1={Y_AXIS_W} x2={yearW} y={r.capY} label={`Grid cap ${fmtPower(capW)}`} />
                  {overHours.map((hr) => (
                    <line
                      key={hr}
                      data-over-cap=""
                      data-hour={hr}
                      x1={xYear(hr / 24 - 0.5)}
                      x2={xYear(hr / 24 - 0.5)}
                      y1={plotH - 7}
                      y2={plotH}
                      stroke="var(--heat)"
                      strokeWidth={1.5}
                    />
                  ))}
                </>
              ) : null}
              {last
                ? MONTH_START_DAY.map((d, m) => (
                    <text key={m} className="dt-tick" x={xYear(d + 14)} y={plotH + 13} textAnchor="middle">
                      {MONTHS[m]}
                    </text>
                  ))
                : null}
            </svg>
            <svg
              width={weekW}
              height={h}
              role="img"
              aria-label={r.weekSummary}
              tabIndex={0}
              onPointerMove={(e) => atPointer('week', e.clientX, e.currentTarget)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={(e) => onKey(e, 'week')}
              onBlur={() => setHover(null)}
            >
              {r.ticks.map((t) => (
                <line key={t} className="dt-grid" x1={0} x2={weekW} y1={r.y(t)} y2={r.y(t)} />
              ))}
              <path d={r.weekD} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {r.capY !== null ? (
                <>
                  <CapLine x1={0} x2={weekW} y={r.capY} />
                  {overInWeek.map((hr) => (
                    <line
                      key={hr}
                      x1={xWeek(hr)}
                      x2={xWeek(hr)}
                      y1={plotH - 7}
                      y2={plotH}
                      stroke="var(--heat)"
                      strokeWidth={1.5}
                    />
                  ))}
                </>
              ) : null}
              {last
                ? Array.from({ length: 7 }, (_, d) => {
                    const day = firstDay + d + 1
                    return day * 24 < weekStart + WEEK ? (
                      <text key={d} className="dt-tick" x={xWeek(day * 24)} y={plotH + 13} textAnchor="middle">
                        {d === 0 ? dayLabel(day) : day - MONTH_START_DAY[monthOfDay(day)]! + 1}
                      </text>
                    ) : null
                  })
                : null}
            </svg>
          </div>
        </div>
      )
    })
  }, [rows, layout, overHours, capW, worstHour])

  return (
    <div className="dt-plots">
      <div className="dt-stack">
        {plots}
        {hover ? <Crosshair hourly={hourly} rows={rows} layout={layout} hover={hover} /> : null}
      </div>
    </div>
  )
}

/** The only part that changes on hover: a hairline at the hovered day or hour, a dot in the week, the readout. */
function Crosshair({
  hourly,
  rows,
  layout,
  hover,
}: {
  hourly: HourlySeries
  rows: RowGeometry[]
  layout: Layout
  hover: NonNullable<Hover>
}) {
  const { yearW, plotH, weekStart, xYear, xWeek, rowTop, inner } = layout
  const hour = hover.panel === 'week' ? weekStart + hover.at : null
  const x = hour === null ? xYear(hover.at) : yearW + GAP + xWeek(hour)
  const height = rowTop(rows.length - 1) + plotH
  const tipW = 200
  const tipLeft = x + 16 + tipW > inner ? x - 16 - tipW : x + 16
  return (
    <>
      <svg className="dt-overlay" width={inner} height={height} aria-hidden="true" data-crosshair="">
        {rows.map((r, i) => {
          const v = hour === null ? null : hourly[r.key][hour]
          return (
            <g key={r.key} transform={`translate(0 ${rowTop(i)})`}>
              <line x1={x} x2={x} y1={0} y2={plotH} stroke="var(--graphite)" strokeWidth={1} />
              {v !== null && v !== undefined ? (
                <circle cx={x} cy={r.y(v)} r={4} fill="var(--ink)" stroke="var(--canvas)" strokeWidth={2} />
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="dt-tip" aria-hidden="true" style={{ left: tipLeft, top: LABEL_H, width: tipW }}>
        <div>{hour === null ? `${dayLabel(hover.at)}, daily range` : hourLabel(hour)}</div>
        {rows.map(({ key, meta }) => {
          if (hour !== null) {
            const v = hourly[key][hour]
            return (
              <div key={key}>
                <b>{v === null || v === undefined ? '—' : meta.fmt(v)}</b>
                {meta.label}
              </div>
            )
          }
          const day = finite(hourly[key].slice(hover.at * 24, hover.at * 24 + 24))
          return (
            <div key={key}>
              <b>{day.length ? `${meta.fmt(Math.min(...day))} to ${meta.fmt(Math.max(...day))}` : '—'}</b>
              {meta.label}
            </div>
          )
        })}
      </div>
    </>
  )
}

function CapLine({ x1, x2, y, label }: { x1: number; x2: number; y: number; label?: string }) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke="var(--graphite)" strokeWidth={1} strokeDasharray="6 3" />
      {label ? (
        <text className="dt-tick" x={x2 - 4} y={y - 4} textAnchor="end">
          {label}
        </text>
      ) : null}
    </g>
  )
}

function MonthlyTable({ hourly, series, capW }: { hourly: HourlySeries; series: HourlySeriesKey[]; capW: number | null }) {
  return (
    <div className="dt-table">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            {series.flatMap((k) => [
              <th key={`${k}-peak`} scope="col">{`${META[k].label}, peak`}</th>,
              <th key={`${k}-mean`} scope="col">{`${META[k].label}, mean`}</th>,
            ])}
            {capW !== null ? <th scope="col">Hours over the cap</th> : null}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((name, m) => {
            const from = MONTH_START_DAY[m]! * 24
            const to = (MONTH_START_DAY[m + 1] ?? DAYS) * 24
            return (
              <tr key={name}>
                <th scope="row">{name}</th>
                {series.flatMap((k) => {
                  const xs = finite(hourly[k].slice(from, to))
                  return [
                    <td key={`${k}-peak`}>{xs.length ? META[k].fmt(Math.max(...xs)) : '—'}</td>,
                    <td key={`${k}-mean`}>{xs.length ? META[k].fmt(xs.reduce((a, b) => a + b, 0) / xs.length) : '—'}</td>,
                  ]
                })}
                {capW !== null ? <td>{hourly.facilityW.slice(from, to).filter((w) => w > capW).length}</td> : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
