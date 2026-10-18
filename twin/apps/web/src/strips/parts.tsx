import type { Check, Evaluation, Plan, Selection, SizedEquipment, Status } from '@twin/schema'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { fmtNull, fmtPower, fmtValue } from '../format'
import './strips.css'

/* The drawing kit shared by the layer strips, the inspector and the hourly chart. */

/** A value in a contract or catalog unit, null-safe: format.ts, with catalog "fraction" read as a ratio and VA like W. */
export function fmtUnit(v: number | null, unit: string): string {
  if (unit === 'fraction') return fmtValue(v, 'ratio')
  if (unit === 'VA') return fmtNull(v, (n) => fmtPower(n).replace(/W$/, 'VA'))
  return fmtValue(v, unit)
}

/** "7.2 of 9.1 MW": a load against its capacity, the unit said once when both share it. */
function fmtLoadOf(loadW: number, capacityW: number | null): string {
  if (capacityW === null) return fmtPower(loadW)
  const load = fmtPower(loadW)
  const cap = fmtPower(capacityW)
  const unit = cap.slice(cap.search(/\s/))
  return `${load.endsWith(unit) ? load.slice(0, -unit.length) : load} of ${cap}`
}

/** "Rows 3–5", "Row 2", "Rows 1–2, 4" from row ids like "R3". */
export function rowsLabel(rowIds: string[], capital = true): string {
  const n = [...new Set(rowIds.map((id) => Number(id.replace(/\D/g, ''))))].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < n.length;) {
    let j = i
    while (j + 1 < n.length && n[j + 1] === n[j]! + 1) j++
    runs.push(j > i ? `${n[i]}–${n[j]}` : `${n[i]}`)
    i = j + 1
  }
  const word = n.length === 1 ? 'row' : 'rows'
  return `${capital ? word[0]!.toUpperCase() + word.slice(1) : word} ${runs.join(', ')}`
}

const STATUS_GLYPH: Record<Status, string> = { fail: '✕', warn: '▲', pass: '✓', unknown: '?' }
const STATUS_COLOR: Record<Status, string> = {
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
function activateOnKey(onSelect: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
}

type PipeKind = 'supply' | 'air' | 'missing' | 'power' | 'copper' | 'fiber'

/** A run of pipe, cable or bus in the piping-diagram language. */
export function Pipe({ d, kind, width = 2 }: { d: string; kind: PipeKind; width?: number }) {
  return <path className={`dt-pipe dt-pipe-${kind}`} d={d} strokeWidth={width} fill="none" strokeLinecap="round" />
}

interface NodeProps {
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
          stroke={missing ? 'var(--graphite)' : problem ? STATUS_COLOR[problem] : 'var(--ink)'}
          strokeOpacity={missing ? 0.6 : undefined}
          strokeDasharray={missing ? '3 2' : undefined}
        />
      )}
      <text
        className="dt-label"
        x={tx}
        y={ty}
        textAnchor={anchor}
        fill={missing ? 'var(--graphite)' : problem ? STATUS_COLOR[problem] : 'var(--ink)'}
      >
        {problem ? <tspan fill={STATUS_COLOR[problem]}>{`${STATUS_GLYPH[problem]} `}</tspan> : null}
        {label}
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

/** Frame of a layer strip: a quiet title, a one-line summary, and the drawing at the measured width. */
export function StripFrame(props: { title: string; summary?: string; empty?: string; children: (width: number) => ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>(720)
  return (
    <section className="dt-strip" aria-label={props.title}>
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
