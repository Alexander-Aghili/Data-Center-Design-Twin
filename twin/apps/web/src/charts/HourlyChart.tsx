import { HOURS_PER_YEAR, type HourlySeries, type HourlySeriesKey } from '@twin/schema'
import { useState, type KeyboardEvent } from 'react'
import { useTwinStore } from '../state/store'
import { fmtNumber, fmtPower, fmtValue } from '../format'
import { useWidth } from '../strips/parts'

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
const HEADER_H = 30
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

type Hover = { panel: 'year'; at: number } | { panel: 'week'; at: number } | null

const CSS = `
.dt-hourly{position:relative;display:flex;flex-direction:column;height:100%;min-width:0;font-variant-numeric:tabular-nums}
.dt-hourly header{display:flex;align-items:baseline;gap:var(--space-3);height:${HEADER_H}px;padding:var(--space-2) var(--space-4) 0}
.dt-hourly h3{margin:0;font-size:var(--text-sm);font-weight:600;font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-hourly .dt-key{display:flex;gap:var(--space-3);align-items:center;margin-left:auto;font-size:var(--text-xs);font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-hourly .dt-key svg{vertical-align:-1px;margin-right:4px}
.dt-hourly .dt-over{font-size:var(--text-xs);font-weight:600;color:var(--heat)}
.dt-hourly .dt-over[data-ok]{color:var(--ok)}
.dt-hourly .btn{height:22px;font-size:var(--text-xs)}
.dt-hourly .dt-plots{padding:0 var(--space-4) var(--space-1)}
.dt-hourly .dt-row{display:flex;gap:${GAP}px}
.dt-hourly svg{display:block;overflow:visible}
.dt-hourly svg[tabindex]:focus-visible{outline:2px solid var(--supply);outline-offset:2px}
.dt-hourly .dt-grid{stroke:var(--hairline);stroke-width:1}
.dt-hourly .dt-tick{font-size:10.5px;fill:var(--graphite)}
.dt-hourly .dt-tip{position:absolute;pointer-events:none;background:var(--panel);border:var(--rule);border-radius:var(--radius);
  padding:var(--space-1) var(--space-2);font-size:var(--text-xs);color:var(--graphite);white-space:nowrap;box-shadow:0 1px 2px rgb(23 32 38 / .08)}
.dt-hourly .dt-tip b{color:var(--ink);font-weight:600;margin-right:4px}
.dt-hourly .dt-table{overflow:auto;padding:0 var(--space-4) var(--space-2)}
.dt-hourly table{font-size:var(--text-xs)}
.dt-hourly .data-table td{text-align:right}
.dt-hourly .dt-empty{margin:auto;padding:var(--space-4);color:var(--graphite);font-size:var(--text-sm)}
`

/** Hourly series over the typical year with the worst week beside it, from the current evaluation. */
export function HourlyChart({ series }: { series: HourlySeriesKey[] }) {
  const hourly = useTwinStore((s) => s.evaluation?.hourly)
  const worstHour = useTwinStore((s) => s.evaluation?.headline.worstHour ?? 0)
  const capW = useTwinStore((s) => s.plan?.site.gridCapacityW ?? null)
  const climate = useTwinStore((s) => (s.plan ? s.plan.catalog[s.plan.site.climateId]?.name : undefined))
  const [ref, width] = useWidth<HTMLDivElement>(720)
  const [hover, setHover] = useState<Hover>(null)
  const [table, setTable] = useState(false)

  const shown = series.filter((k) => (hourly?.[k].length ?? 0) === HOURS_PER_YEAR)
  const title = `${series.map((k) => META[k].label).join(', ')} over the year${climate ? `, ${climate}` : ''}`
  const facility = shown.includes('facilityW') && hourly ? hourly.facilityW : null
  const overHours = facility && capW !== null ? facility.flatMap((w, h) => (w > capW ? [h] : [])) : []

  return (
    <section className="dt-hourly" aria-label={title} ref={ref}>
      <style href="twin-hourly" precedence="default">
        {CSS}
      </style>
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
            {facility && capW !== null ? (
              <span className="dt-over" data-ok={overHours.length ? undefined : ''}>
                {overHours.length ? `✕ ${overHours.length} hours over the cap` : '✓ Never over the cap'}
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
        <Plots
          hourly={hourly}
          series={shown}
          width={width}
          worstHour={worstHour}
          capW={capW}
          overHours={overHours}
          hover={hover}
          setHover={setHover}
        />
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
  hover: Hover
  setHover: (h: Hover) => void
}

function Plots({ hourly, series, width, worstHour, capW, overHours, hover, setHover }: PlotsProps) {
  const inner = Math.max(320, width - 32)
  const weekW = Math.round(Math.max(160, inner * 0.3))
  const yearW = inner - weekW - GAP
  const plotH = series.length === 1 ? 96 : 72
  const weekStart = Math.min(Math.max(0, worstHour - WEEK / 2), HOURS_PER_YEAR - WEEK)
  const xYear = (day: number) => Y_AXIS_W + ((day + 0.5) / DAYS) * (yearW - Y_AXIS_W)
  const xWeek = (h: number) => ((h - weekStart + 0.5) / WEEK) * weekW

  const step = (e: KeyboardEvent, panel: 'year' | 'week', max: number, start: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const current = hover?.panel === panel ? hover.at : start
    const next = Math.min(max, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1)))
    setHover({ panel, at: next })
  }
  const pointer = (panel: 'year' | 'week', clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left
    if (panel === 'year') {
      const day = Math.floor(((px - Y_AXIS_W) / (yearW - Y_AXIS_W)) * DAYS)
      setHover(day >= 0 && day < DAYS ? { panel, at: day } : null)
    } else {
      const h = Math.floor((px / weekW) * WEEK)
      setHover(h >= 0 && h < WEEK ? { panel, at: h } : null)
    }
  }

  const hoverX = hover ? (hover.panel === 'year' ? xYear(hover.at) : yearW + GAP + xWeek(weekStart + hover.at)) : 0

  return (
    <div className="dt-plots">
      {series.map((key, row) => {
        const meta = META[key]
        const values = hourly[key]
        const band = daily(values)
        const all = finite(values)
        const withCap = key === 'facilityW' && capW !== null ? [...all, capW] : all
        const scale = niceScale(Math.min(...withCap), Math.max(...withCap))
        const y = (v: number) => plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH
        const week = values.slice(weekStart, weekStart + WEEK)
        const last = row === series.length - 1
        const showCap = key === 'facilityW' && capW !== null
        const yearSummary = `${meta.label} over the year, daily range and peak, ${meta.fmt(Math.min(...all))} to ${meta.fmt(Math.max(...all))}`
        const weekSummary = `${meta.label}, worst week from ${dayLabel(Math.floor(weekStart / 24))}, hourly, peak ${meta.fmt(Math.max(...finite(week)))}`
        const h = plotH + (last ? AXIS_H : 6)
        return (
          <div className="dt-row" key={key}>
            <svg
              width={yearW}
              height={h}
              role="img"
              aria-label={yearSummary}
              tabIndex={0}
              onPointerMove={(e) => pointer('year', e.clientX, e.currentTarget)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={(e) => step(e, 'year', DAYS - 1, Math.floor(worstHour / 24))}
              onBlur={() => setHover(null)}
            >
              {scale.ticks.map((t) => (
                <g key={t}>
                  <line className="dt-grid" x1={Y_AXIS_W} x2={yearW} y1={y(t)} y2={y(t)} />
                  <text className="dt-tick" x={Y_AXIS_W - 6} y={y(t) + 3.5} textAnchor="end">
                    {meta.fmt(t)}
                  </text>
                </g>
              ))}
              <rect x={xYear(weekStart / 24) - 0.5} y={0} width={(WEEK / 24 / DAYS) * (yearW - Y_AXIS_W)} height={plotH} fill="var(--ink)" fillOpacity={0.05} />
              <path d={bandPath(band, xYear, y)} fill="var(--ink)" fillOpacity={0.1} />
              <path d={linePath(band.hi, xYear, y)} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
              {showCap ? <CapLine x1={Y_AXIS_W} x2={yearW} y={y(capW)} label={`Grid cap ${fmtPower(capW)}`} /> : null}
              {showCap
                ? overHours.map((hr) => (
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
                  ))
                : null}
              {hover?.panel === 'year' ? <line className="dt-grid" x1={xYear(hover.at)} x2={xYear(hover.at)} y1={0} y2={plotH} stroke="var(--graphite)" /> : null}
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
              aria-label={weekSummary}
              tabIndex={0}
              onPointerMove={(e) => pointer('week', e.clientX, e.currentTarget)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={(e) => step(e, 'week', WEEK - 1, worstHour - weekStart)}
              onBlur={() => setHover(null)}
            >
              {scale.ticks.map((t) => (
                <line key={t} className="dt-grid" x1={0} x2={weekW} y1={y(t)} y2={y(t)} />
              ))}
              <path d={linePath(week, (i) => xWeek(weekStart + i), y)} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {showCap ? <CapLine x1={0} x2={weekW} y={y(capW)} /> : null}
              {showCap
                ? overHours
                    .filter((hr) => hr >= weekStart && hr < weekStart + WEEK)
                    .map((hr) => <line key={hr} x1={xWeek(hr)} x2={xWeek(hr)} y1={plotH - 7} y2={plotH} stroke="var(--heat)" strokeWidth={1.5} />)
                : null}
              {hover?.panel === 'week' ? (
                <>
                  <line className="dt-grid" x1={xWeek(weekStart + hover.at)} x2={xWeek(weekStart + hover.at)} y1={0} y2={plotH} stroke="var(--graphite)" />
                  {values[weekStart + hover.at] !== null ? (
                    <circle cx={xWeek(weekStart + hover.at)} cy={y(values[weekStart + hover.at]!)} r={4} fill="var(--ink)" stroke="var(--canvas)" strokeWidth={2} />
                  ) : null}
                </>
              ) : null}
              {last
                ? Array.from({ length: 7 }, (_, d) => {
                    const day = Math.floor(weekStart / 24) + d + 1
                    return day * 24 < weekStart + WEEK ? (
                      <text key={d} className="dt-tick" x={xWeek(day * 24)} y={plotH + 13} textAnchor="middle">
                        {dayLabel(day)}
                      </text>
                    ) : null
                  })
                : null}
              {row === 0 ? (
                <text className="dt-tick" x={weekW} y={-4} textAnchor="end">
                  Worst week, hourly
                </text>
              ) : null}
            </svg>
          </div>
        )
      })}
      {hover ? <Tooltip hourly={hourly} series={series} hover={hover} weekStart={weekStart} x={hoverX} width={inner} /> : null}
    </div>
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

function Tooltip(props: { hourly: HourlySeries; series: HourlySeriesKey[]; hover: NonNullable<Hover>; weekStart: number; x: number; width: number }) {
  const { hourly, series, hover, weekStart } = props
  const hour = hover.panel === 'week' ? weekStart + hover.at : null
  const left = props.x + 16 + 200 > props.width ? props.x - 16 - 200 : props.x + 16
  return (
    <div className="dt-tip" role="status" style={{ left: left + 16, top: HEADER_H + 4, width: 200 }}>
      <div>{hour === null ? `${dayLabel(hover.at)}, daily range` : hourLabel(hour)}</div>
      {series.map((key) => {
        const meta = META[key]
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
