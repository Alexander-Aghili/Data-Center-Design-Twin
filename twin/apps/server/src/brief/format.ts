/** Plain-text number and Markdown helpers for generated briefs. Unknown or non-finite values print as "—". */

export const DASH = '—'

export function fixed(value: number | null | undefined, decimals: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : DASH
}

/** Watts as a whole number, no separators, so agents can parse it. */
export function watts(value: number | null | undefined): string {
  return fixed(value, 0)
}

/** Four significant figures without trailing zeros (0.9 stays "0.9", 946400 stays "946400"). */
export function significant(value: number | null | undefined, digits = 4): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
  return Math.abs(value) >= 10 ** digits ? value.toFixed(0) : String(Number(value.toPrecision(digits)))
}

export function range(from: number, to: number, decimals = 2): string {
  return `${fixed(from, decimals)}–${fixed(to, decimals)}`
}

const KELVIN_OFFSET = 273.15

export function kelvin(celsius: number | null | undefined): string {
  return typeof celsius === 'number' && Number.isFinite(celsius) ? (celsius + KELVIN_OFFSET).toFixed(2) : DASH
}

export function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

export function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

export function code(language: string, body: string): string {
  return `\`\`\`${language}\n${body}\n\`\`\``
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Hour of a typical (non-leap) weather year as "27 Jul, 15:00". */
export function hourOfYear(hour: number): string {
  const date = new Date(Date.UTC(2025, 0, 1) + hour * 3_600_000)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${String(date.getUTCHours()).padStart(2, '0')}:00`
}
