import type { Status } from '@twin/schema'

const STATUS_TEXT: Record<Status, string> = { fail: 'Fail', warn: 'Warning', pass: 'Pass', unknown: 'Unknown' }

function Shape({ status }: { status: Status }) {
  switch (status) {
    case 'fail':
      return <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    case 'warn':
      return <path d="M6 1.4L11.2 10.6H0.8Z" fill="currentColor" />
    case 'pass':
      return <path d="M1.8 6.4l2.8 2.8 5.6-6.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    case 'unknown':
      return (
        <text x="6" y="11" textAnchor="middle" fontSize="14" fontWeight="800" fill="currentColor">
          ?
        </text>
      )
  }
}

/**
 * A status shown by shape and text, never by color alone: ✕ fail, ▲ warning, ✓ pass, ? unknown.
 * `label` replaces the visible word (a count, a title); the status word then stays for screen readers.
 */
export function StatusMark({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="status-mark" data-status={status}>
      <svg className="status-mark__shape" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <Shape status={status} />
      </svg>
      {label === undefined ? (
        <span>{STATUS_TEXT[status]}</span>
      ) : (
        <>
          <span className="visually-hidden">{STATUS_TEXT[status]}: </span>
          <span>{label}</span>
        </>
      )}
    </span>
  )
}
