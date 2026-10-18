import type { Severity } from '@twin/schema'
import { tagTrianglePath } from '../scene/annotations/cloudPath'

/** The numbered revision triangle that ties a message to its revision cloud; the same shape the drawing uses. */
export function DeltaTag({ tag, severity }: { tag: number; severity: Severity }) {
  return (
    <svg className={`ag-delta ag-delta--${severity}`} role="img" aria-label={`Revision ${tag}`} width="24" height="21" viewBox="0 0 24 21">
      <path d={tagTrianglePath(12, 11)} />
      <text x="12" y="17" textAnchor="middle" aria-hidden="true">
        {tag}
      </text>
    </svg>
  )
}
