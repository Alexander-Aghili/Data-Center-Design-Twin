import type { Proposal, Severity } from '@twin/schema'
import type { ReactNode } from 'react'
import { DeltaTag } from './DeltaTag'
import { ProposalCard } from './ProposalCard'
import { ToolCallLine, type ToolCallPart } from './ToolCallLine'

export type MessagePart =
  | { kind: 'text'; text: string }
  | ToolCallPart
  | { kind: 'link'; label: string; href: string }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'error'; message: string }

/** Numbers one tool call returned, for grounding marks. */
export interface GroundingSource {
  name: string
  numbers: number[]
}

export interface AgentMessageModel {
  id: string
  severity: Severity
  streaming: boolean
  parts: MessagePart[]
  sources: GroundingSource[]
}

const SEVERITY_MARK: Record<Exclude<Severity, 'info'>, { mark: string; label: string }> = {
  problem: { mark: '✕', label: 'Problem' },
  warning: { mark: '▲', label: 'Warning' },
}

export function AgentMessage({ message, tag }: { message: AgentMessageModel; tag?: number }) {
  const { severity, parts, streaming, sources } = message
  const last = parts.length - 1
  return (
    <article className={`ag-msg ag-msg--${severity}`} data-message-id={message.id}>
      {severity === 'info' ? null : (
        <div className="ag-msg__gutter">
          {tag === undefined ? (
            <span className="ag-msg__mark" aria-hidden="true">
              {SEVERITY_MARK[severity].mark}
            </span>
          ) : (
            <DeltaTag tag={tag} severity={severity} />
          )}
          <span className="ag-msg__rule" aria-hidden="true" />
          <span className="ag-sr">{SEVERITY_MARK[severity].label}</span>
        </div>
      )}
      <div className="ag-msg__body">
        {parts.map((part, i) => {
          switch (part.kind) {
            case 'text':
              return <Markdown key={i} text={part.text} sources={sources} streaming={streaming && i === last} />
            case 'tool':
              return <ToolCallLine key={part.callId} call={part} />
            case 'link':
              return <DownloadLink key={i} label={part.label} href={part.href} />
            case 'proposal':
              return <ProposalCard key={part.proposal.id} proposal={part.proposal} />
            case 'error':
              return <ErrorLine key={i} message={part.message} />
          }
        })}
        {streaming && parts[last]?.kind !== 'text' ? <Caret /> : null}
      </div>
    </article>
  )
}

export function UserMessage({ text }: { text: string }) {
  return <p className="ag-user">{text}</p>
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <p className="ag-error" role="alert">
      <span className="ag-error__mark" aria-hidden="true">
        ✕
      </span>
      {message}
    </p>
  )
}

function DownloadLink({ label, href }: { label: string; href: string }) {
  return (
    <a className="ag-link" href={href} download>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
        <path d="M6 1v7M3 5.5 6 8.5 9 5.5M1.5 11h9" />
      </svg>
      {label}
    </a>
  )
}

function Caret() {
  return <span className="ag-caret" aria-hidden="true" />
}

/* Markdown subset: paragraphs, **bold**, `inline code`, bullet and numbered lists. Everything else stays literal. */

type Block = { type: 'p'; lines: string[] } | { type: 'ul' | 'ol'; items: string[] }

const LIST_ITEM = /^\s*([-*]|\d+[.)])\s+(.*)$/
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // The block a non-blank line continues; a blank line ends it.
  let open = false
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      open = false
      continue
    }
    const current = open ? blocks[blocks.length - 1] : undefined
    const item = LIST_ITEM.exec(line)
    if (item) {
      const type = /\d/.test(item[1]) ? 'ol' : 'ul'
      if (current?.type === type) current.items.push(item[2])
      else blocks.push({ type, items: [item[2]] })
    } else if (current && current.type !== 'p' && /^\s/.test(line)) {
      current.items[current.items.length - 1] += ` ${line.trim()}`
    } else if (current?.type === 'p') {
      current.lines.push(line.trim())
    } else {
      blocks.push({ type: 'p', lines: [line.trim()] })
    }
    open = true
  }
  return blocks
}

/** While a reply streams, close a dangling ** or ` so half-written emphasis doesn't flash as raw markers. */
function closeOpenMarks(text: string): string {
  let out = text.trimEnd()
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**'
  if ((out.match(/`/g) ?? []).length % 2 === 1) out += '`'
  return out
}

function Markdown({ text, sources, streaming }: { text: string; sources: GroundingSource[]; streaming: boolean }) {
  const blocks = parseBlocks(streaming ? closeOpenMarks(text) : text)
  const inline = (s: string, isLast: boolean) => (
    <>
      {renderInline(s, sources)}
      {streaming && isLast ? <Caret /> : null}
    </>
  )
  return blocks.map((block, b) => {
    const lastBlock = b === blocks.length - 1
    if (block.type === 'p') return <p key={b}>{inline(block.lines.join(' '), lastBlock)}</p>
    const List = block.type
    return (
      <List key={b}>
        {block.items.map((item, i) => (
          <li key={i}>{inline(item, lastBlock && i === block.items.length - 1)}</li>
        ))}
      </List>
    )
  })
}

function renderInline(text: string, sources: GroundingSource[]): ReactNode[] {
  return text.split(INLINE).map((chunk, i) => {
    if (i % 2 === 0) return <span key={i}>{groundNumbers(chunk, sources)}</span>
    if (chunk.startsWith('`')) return <code key={i}>{chunk.slice(1, -1)}</code>
    return <strong key={i}>{groundNumbers(chunk.slice(2, -2), sources)}</strong>
  })
}

/* Grounding marks: a number is marked when a tool result of the same message holds a value that displays as it. */

const NUMBER =
  /(?<![\p{L}\p{N}.,])([+\-−]?\$?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:([kMB])(?![\p{L}\p{N}]))?(?:([  ]?)(%|°C|kN\/m²|kW|MW|GW|W|kg|t|m³\/day|m³|mm|m|L\/s|L\/min|K|weeks?|hours?|h)(?![\p{L}\p{N}]))?/gu

const SUFFIX_FACTOR: Record<string, number> = { k: 1e3, M: 1e6, B: 1e9 }

/** Display value = SI value / factor. Percent may show a fraction (utilization) or a value already in percent. */
const UNIT_FACTORS: Record<string, number[]> = {
  '%': [0.01, 1],
  kW: [1e3],
  MW: [1e6],
  GW: [1e9],
  t: [1e3],
  mm: [1e-3],
  'L/min': [1 / 60],
}

function displaysAs(value: number, shown: number, decimals: number, factor: number): boolean {
  const scale = 10 ** decimals
  return Math.round((Math.abs(value) / factor) * scale) / scale === shown
}

function findSource(shown: number, decimals: number, factors: number[], sources: GroundingSource[]): string | undefined {
  return sources.find((s) => s.numbers.some((n) => factors.some((f) => displaysAs(n, shown, decimals, f))))?.name
}

function groundNumbers(text: string, sources: GroundingSource[]): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(NUMBER)) {
    const [whole, prefix, int, decimals = '', suffix = '', space = '', unit = ''] = m
    const shown = Number(`${int.replaceAll(',', '')}${decimals ? `.${decimals}` : ''}`)
    const display = `${prefix}${int}${decimals ? `.${decimals}` : ''}${suffix}${space ? ' ' : ''}${unit}`
    // Bare single-digit counts ("rows 3–5") match too many tool values to mean anything.
    const meaningful = Boolean(unit || suffix || decimals || prefix.includes('$')) || shown >= 10
    const factors = (UNIT_FACTORS[unit] ?? [1]).map((f) => f * (SUFFIX_FACTOR[suffix] ?? 1))
    const source = meaningful ? findSource(shown, decimals.length, factors, sources) : undefined
    out.push(text.slice(at, m.index))
    out.push(
      source ? (
        <span key={m.index} className="ag-grounded" title={`From ${source}`}>
          {display}
        </span>
      ) : (
        display
      ),
    )
    at = m.index + whole.length
  }
  out.push(text.slice(at))
  return out
}
