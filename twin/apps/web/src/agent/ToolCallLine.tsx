export interface ToolCallPart {
  kind: 'tool'
  callId: string
  name: string
  summary: string
  result?: { ok: boolean; summary: string }
}

const STATE = {
  ok: { mark: '✓', label: 'Done: ' },
  failed: { mark: '✕', label: 'Failed: ' },
  pending: { mark: '…', label: 'Running: ' },
} as const

/** One quiet line per tool call: a status shape, what the agent did and, once back, what it found. */
export function ToolCallLine({ call }: { call: ToolCallPart }) {
  const state = call.result ? (call.result.ok ? 'ok' : 'failed') : 'pending'
  const { mark, label } = STATE[state]
  return (
    <div className={`ag-tool ag-tool--${state}`} title={call.name}>
      <span className="ag-tool__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="visually-hidden">{label}</span>
      {call.result ? `${call.summary}: ${call.result.summary}` : call.summary}
    </div>
  )
}
