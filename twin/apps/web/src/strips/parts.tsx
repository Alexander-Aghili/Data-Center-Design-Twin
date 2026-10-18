import type { Check, Evaluation, Plan, Selection, SizedEquipment, Status } from '@twin/schema'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { fmtNull, fmtPct, fmtPower, fmtValue } from '../format'

/* The drawing kit shared by the layer strips, the inspector and the hourly chart. */

const NBSP = '\u00a0'

/** A value in a contract or catalog unit, null-safe: format.ts units plus "fraction" and "VA". */
export function fmtUnit(v: number | null, unit: string): string {
  switch (unit) {
    case 'fraction':
      return fmtNull(v, fmtPct)
    case 'VA':
      return fmtNull(v, (n) => fmtPower(n).replace(/W$/, 'VA'))
    default:
      return fmtValue(v, unit)
  }
}

/** "7.2 of 9.1 MW": a load against its capacity, the unit said once when both share it. */
export function fmtLoadOf(loadW: number, capacityW: number | null): string {
  if (capacityW === null) return fmtPower(loadW)
  const load = fmtPower(loadW)
  const cap = fmtPower(capacityW)
  const unit = cap.slice(cap.indexOf(NBSP))
  return `${load.endsWith(unit) ? load.slice(0, -unit.length) : load} of ${cap}`
}

/** "Rows 3–5", "Row 2", "Rows 1–2, 4" from row ids like "R3". */
export function rowsLabel(rowIds: string[], capital = true): string {
  const n = [...new Set(rowIds.map((id) => Number(id.replace(/\D/g, ''))))].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < n.length; ) {
    let j = i
    while (j + 1 < n.length && n[j + 1] === n[j]! + 1) j++
    runs.push(j > i ? `${n[i]}–${n[j]}` : `${n[i]}`)
    i = j + 1
  }
  const word = n.length === 1 ? 'row' : 'rows'
  return `${capital ? word[0]!.toUpperCase() + word.slice(1) : word} ${runs.join(', ')}`
}

export const STATUS_GLYPH: Record<Status, string> = { fail: '✕', warn: '▲', pass: '✓', unknown: '?' }
export const STATUS_COLOR: Record<Status, string> = {
  fail: 'var(--heat)',
  warn: 'var(--warning)',
  pass: 'var(--ok)',
  unknown: 'var(--graphite)',
}
const STATUS_RANK: Record<Status, number> = { fail: 3, warn: 2, unknown: 1, pass: 0 }

/** The most severe check of a set (fail, then warn, then unknown, then pass; ties by utilization). */
export function worstCheck(checks: Check[]): Check | null {
  let worst: Check | null = null
  for (const c of checks) {
    const better = !worst || STATUS_RANK[c.status] > STATUS_RANK[worst.status]
    const tie = worst && STATUS_RANK[c.status] === STATUS_RANK[worst.status] && (c.utilization ?? 0) > (worst.utilization ?? 0)
    if (better || tie) worst = c
  }
  return worst
}

/** Status a node shows: its worst check's, if it has checks. */
export function statusOf(checks: Check[]): Status | undefined {
  return worstCheck(checks)?.status
}

/** What every layer strip draws from. */
export interface LayerStripProps {
  plan: Plan
  evaluation: Evaluation
  select: (target: Selection) => void
}

/**
 * What clicking a node opens: its worst problem when it has one, else the equipment, else its worst check.
 * Returns undefined when there is nothing to inspect.
 */
export function selectFor(select: (t: Selection) => void, checks: Check[], equipment?: SizedEquipment): (() => void) | undefined {
  const worst = worstCheck(checks)
  if (worst && (worst.status === 'fail' || worst.status === 'warn')) return () => select({ kind: 'check', id: worst.id })
  if (equipment) return () => select({ kind: 'equipment', id: equipment.key })
  if (worst) return () => select({ kind: 'check', id: worst.id })
  return undefined
}

/** Units of one category summed: "4 units, 3.9 of 4.8 MW". `null` when none are sized. */
export function sizedSummary(items: SizedEquipment[], noun = 'units'): { value: string; detail: string } | null {
  if (items.length === 0) return null
  const count = items.reduce((n, e) => n + e.count, 0)
  const loadW = items.reduce((n, e) => n + e.loadW, 0)
  const caps = items.map((e) => e.capacityW)
  const capacityW = caps.every((c) => c !== null) ? caps.reduce<number>((n, c) => n + c, 0) : null
  return { value: `${count} ${count === 1 ? noun.replace(/s$/, '') : noun}`, detail: fmtLoadOf(loadW, capacityW) }
}

/** Width of an element, tracked with ResizeObserver; `fallback` until measured or where it is unavailable. */
export function useWidth<T extends Element>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width
      if (w) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Enter and Space activate an SVG element that acts as a button. */
export function activateOnKey(onSelect: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
}

export type PipeKind = 'supply' | 'air' | 'missing' | 'power' | 'copper' | 'fiber'

/** A run of pipe, cable or bus in the piping-diagram language. */
export function Pipe({ d, kind, width = 2 }: { d: string; kind: PipeKind; width?: number }) {
  return <path className={`dt-pipe dt-pipe-${kind}`} d={d} strokeWidth={width} fill="none" strokeLinecap="round" />
}

export interface NodeProps {
  x: number
  y: number
  label: string
  value: string
  /** Second value line, for nodes that carry a load and a limit. */
  detail?: string
  status?: Status
  missing?: boolean
  /** Equipment symbol drawn centered on (x, y); an instrument bubble when omitted. */
  symbol?: ReactNode
  /** Text below the symbol (default), to its right on two lines, or to its right on one line. */
  textAt?: 'below' | 'right' | 'inline'
  onSelect?: () => void
}

/** A piece of equipment: symbol, name and its key value. Problems carry shape and text, never color alone. */
export function Node({ x, y, label, value, detail, status, missing, symbol, textAt = 'below', onSelect }: NodeProps) {
  const problem = status === 'fail' || status === 'warn' ? status : null
  const state = missing ? 'missing' : (status ?? 'unknown')
  const right = textAt !== 'below'
  const inline = textAt === 'inline'
  const tx = right ? x + 14 : x
  const ty = inline ? y + 4 : right ? y - 3 : y + 23
  const anchor = right ? 'start' : 'middle'
  const name = [problem ? `${STATUS_GLYPH[problem]} ${label}` : label, value, detail].filter(Boolean).join(', ')
  return (
    <g
      className="dt-node"
      data-node={label}
      data-state={state}
      role={onSelect ? 'button' : 'img'}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={name}
      onClick={onSelect}
      onKeyDown={onSelect ? activateOnKey(onSelect) : undefined}
    >
      <rect
        className="dt-hit"
        x={right ? x - 10 : x - 52}
        y={inline ? y - 8 : y - 14}
        width={right ? 170 : 104}
        height={inline ? 16 : right ? 36 : 62}
      />
      {symbol ?? (
        <circle
          className="dt-bubble"
          cx={x}
          cy={y}
          r={8}
          stroke={missing ? 'var(--dt-missing)' : problem ? STATUS_COLOR[problem] : 'var(--ink)'}
          strokeDasharray={missing ? '3 2' : undefined}
        />
      )}
      <text className="dt-label" x={tx} y={ty} textAnchor={anchor} fill={missing ? 'var(--graphite)' : problem ? STATUS_COLOR[problem] : 'var(--ink)'}>
        {problem ? `${STATUS_GLYPH[problem]} ${label}` : label}
      </text>
      <text className="dt-value" x={inline ? tx + 26 : tx} y={inline ? ty : ty + 13} textAnchor={anchor}>
        {value}
      </text>
      {detail ? (
        <text className="dt-value" x={tx} y={ty + 25} textAnchor={anchor}>
          {detail}
        </text>
      ) : null}
    </g>
  )
}

const STRIP_CSS = `
.dt-strip{height:100%;display:flex;flex-direction:column;background:var(--canvas);
  --dt-missing:#9aa6ac;font-variant-numeric:tabular-nums;min-width:0}
.dt-strip header{display:flex;align-items:baseline;gap:var(--space-3);padding:var(--space-2) var(--space-4) 0}
.dt-strip h3{margin:0;font-size:var(--text-sm);font-weight:600;font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-strip header p{margin:0 0 0 auto;font-size:var(--text-xs);font-stretch:var(--stretch-label);color:var(--graphite)}
.dt-strip-body{flex:1;min-height:0}
.dt-strip-body svg{display:block;overflow:visible}
.dt-strip-empty{margin:auto;color:var(--graphite);font-size:var(--text-sm)}
.dt-pipe-supply{stroke:var(--supply);stroke-dasharray:10 4;animation:dt-flow 1.1s linear infinite}
.dt-pipe-air{stroke:var(--supply);stroke-dasharray:3 6;opacity:.8;animation:dt-flow 2.4s linear infinite}
.dt-pipe-missing{stroke:var(--dt-missing);stroke-dasharray:4 4}
.dt-pipe-power{stroke:var(--ink)}
.dt-pipe-copper{stroke:var(--graphite)}
.dt-pipe-fiber{stroke:var(--supply)}
@keyframes dt-flow{to{stroke-dashoffset:-28}}
@media (prefers-reduced-motion:reduce){.dt-pipe-supply,.dt-pipe-air{animation:none}}
.dt-node{cursor:default;outline:none}
.dt-node[role=button]{cursor:pointer}
.dt-hit{fill:transparent}
.dt-node[role=button]:hover .dt-hit{fill:var(--panel)}
.dt-node:focus-visible .dt-hit{fill:var(--panel);stroke:var(--supply);stroke-width:2}
.dt-bubble{fill:var(--panel);stroke-width:1.6}
.dt-symbol{fill:var(--panel);stroke:var(--ink);stroke-width:1.6}
.dt-label{font-size:11.5px;font-weight:600;font-stretch:var(--stretch-label)}
.dt-value{font-size:10.5px;fill:var(--graphite)}
.dt-tier{font-size:var(--text-xs);font-stretch:var(--stretch-label);fill:var(--graphite)}
`

/** Frame of a layer strip: a quiet title, a one-line summary, and the drawing at the measured width. */
export function StripFrame(props: { title: string; summary?: string; empty?: string; children: (width: number) => ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>(720)
  return (
    <section className="dt-strip" aria-label={props.title}>
      <style href="twin-strip" precedence="default">
        {STRIP_CSS}
      </style>
      <header>
        <h3>{props.title}</h3>
        {props.summary ? <p>{props.summary}</p> : null}
      </header>
      <div ref={ref} className="dt-strip-body">
        {props.empty ? <p className="dt-strip-empty">{props.empty}</p> : props.children(width)}
      </div>
    </section>
  )
}
