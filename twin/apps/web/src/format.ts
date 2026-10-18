/**
 * Display formatting. The engine works in SI units (W, kg, L/s, USD); conversions to the units people
 * read (kW, MW, t, L/min) happen only here. A number and its unit are joined by a non-breaking space.
 */

const NBSP = ' '
const MINUS = '−'

const formatters = new Map<string, Intl.NumberFormat>()

function grouped(n: number, decimals: number, fixed: boolean): string {
  const key = `${decimals}:${fixed}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: fixed ? decimals : 0 })
    formatters.set(key, f)
  }
  return f.format(n).replace('-', MINUS)
}

/** Fewer decimals as numbers grow: 1.38, 40.5, 132. */
function autoDecimals(n: number): number {
  const a = Math.abs(n)
  return a >= 100 ? 0 : a >= 10 ? 1 : 2
}

const withUnit = (n: string, unit: string) => `${n}${NBSP}${unit}`

/** "—" for an unknown value, otherwise `format(value)`. Unknown is never shown as 0. */
export function fmtNull(value: number | null | undefined, format: (n: number) => string): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : format(value)
}

/** Grouped number with up to `decimals` fraction digits (default: fewer as the number grows). */
export function fmtNumber(n: number, decimals = autoDecimals(n)): string {
  return grouped(n, decimals, false)
}

/** 850 W, 40.5 kW, 132 kW, 9.4 MW. */
export function fmtPower(w: number): string {
  const a = Math.abs(w)
  if (a >= 1e6) return withUnit(grouped(w / 1e6, 1, true), 'MW')
  if (a >= 1e3) return withUnit(grouped(w / 1e3, a >= 1e5 ? 0 : 1, false), 'kW')
  return withUnit(grouped(w, 0, false), 'W')
}

/** 850 kg, 1.4 t, 412 t. */
export function fmtMass(kg: number): string {
  if (Math.abs(kg) < 1000) return withUnit(grouped(kg, 0, false), 'kg')
  const t = kg / 1000
  return withUnit(grouped(t, Math.abs(t) >= 100 ? 0 : 1, false), 't')
}

/** Litres per second in, litres per minute out: 2.5 L/s is 150 L/min. */
export function fmtFlow(lps: number): string {
  const perMin = lps * 60
  return withUnit(grouped(perMin, Math.abs(perMin) >= 100 ? 0 : 1, false), 'L/min')
}

/** $420, $950K, $6.1M, $184M, $1.25B. */
export function fmtMoney(usd: number): string {
  const sign = usd < 0 ? MINUS : ''
  const a = Math.abs(usd)
  const scaled = (div: number, suffix: string) => `${sign}$${grouped(a / div, autoDecimals(a / div), false)}${suffix}`
  if (a >= 1e9) return scaled(1e9, 'B')
  if (a >= 1e6) return scaled(1e6, 'M')
  if (a >= 1e3) return scaled(1e3, 'K')
  return `${sign}$${grouped(a, 0, false)}`
}

/** 1 week, 14 weeks. */
export function fmtWeeks(weeks: number): string {
  const w = Math.round(weeks)
  return withUnit(grouped(w, 0, false), w === 1 ? 'week' : 'weeks')
}

/** A ratio as a whole percentage: 0.914 is 91%, 3.3 is 330%. */
export function fmtPct(ratio: number): string {
  return `${grouped(ratio * 100, 0, false)}%`
}

/** Any engine value with its SI unit, converted to the display unit. */
export function fmtValue(value: number | null | undefined, unit: string): string {
  return fmtNull(value, (n) => {
    switch (unit) {
      case 'W':
        return fmtPower(n)
      case 'kg':
        return fmtMass(n)
      case 'L/s':
        return fmtFlow(n)
      case 'USD':
        return fmtMoney(n)
      case 'weeks':
        return fmtWeeks(n)
      case 'ratio':
        return fmtPct(n)
      case '%':
        return `${fmtNumber(n, 0)}%`
      case '°C':
      case 'K':
        return withUnit(grouped(n, 1, true), unit)
      case '':
        return fmtNumber(n)
      default:
        return withUnit(fmtNumber(n), unit)
    }
  })
}
