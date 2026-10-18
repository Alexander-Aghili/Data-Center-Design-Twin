import type { Severity } from '@twin/schema'

/** The numbered revision triangle that ties a message to its revision cloud on the drawing. */
export function DeltaTag({ tag, severity }: { tag: number; severity: Severity }) {
  return (
    <svg className={`ag-delta ag-delta--${severity}`} role="img" aria-label={`Revision ${tag}`} width="20" height="18" viewBox="0 0 20 18">
      <path d="M10 1.2 19 16.8H1Z" />
      <text x="10" y="14.4" textAnchor="middle" aria-hidden="true">
        {tag}
      </text>
    </svg>
  )
}
