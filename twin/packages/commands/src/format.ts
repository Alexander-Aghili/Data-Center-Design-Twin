import type { Plan } from '@twin/schema'

/** Non-breaking space between a number and its unit, as the UI copy rules require. */
const NBSP = ' '

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function withUnit(n: number, unit: string): string {
  return `${formatNumber(n)}${NBSP}${unit}`
}

export function formatPower(w: number): string {
  if (Math.abs(w) >= 1e6) return withUnit(w / 1e6, 'MW')
  if (Math.abs(w) >= 1e3) return withUnit(w / 1e3, 'kW')
  return withUnit(w, 'W')
}

/** Two-digit slot label, as used in placement ids. */
export function pad(slot: number): string {
  return String(slot).padStart(2, '0')
}

/** Consecutive runs, e.g. [3, 4, 5, 9] → "03–05, 09". */
export function formatSlots(slots: number[]): string {
  const sorted = [...new Set(slots)].sort((a, b) => a - b)
  const runs: string[] = []
  let start = sorted[0]
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    const next = sorted[i + 1]
    if (next === cur + 1) continue
    runs.push(start === cur ? pad(cur) : `${pad(start!)}–${pad(cur)}`)
    start = next
  }
  return runs.join(', ')
}

/** Row ids in hall order with consecutive runs collapsed, e.g. "R3–R5" or "R1, R4". */
export function formatRows(plan: Plan, rowIds: Iterable<string>): string {
  const wanted = new Set(rowIds)
  const runs: string[][] = []
  let lastIndex = -2
  plan.hall.rows.forEach((row, index) => {
    if (!wanted.has(row.id)) return
    if (index === lastIndex + 1) runs.at(-1)!.push(row.id)
    else runs.push([row.id])
    lastIndex = index
  })
  return runs.map((run) => (run.length === 1 ? run[0] : `${run[0]}–${run.at(-1)}`)).join(', ')
}

/** "1 rack" / "3 racks". */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Shortens text at a word boundary for change records. */
export function excerpt(text: string, max = 60): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : text.slice(0, max)).trimEnd()}…`
}

/** Lists up to `max` items, then "and N more". */
export function listSome(items: string[], max = 6): string {
  if (items.length <= max) return items.join(', ')
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}
