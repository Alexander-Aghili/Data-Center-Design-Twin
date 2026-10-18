export interface ToolCallPart {
  kind: 'tool'
  callId: string
  name: string
  summary: string
  result?: { ok: boolean; summary: string }
}

/** One quiet line per tool call: a status shape, what the agent did and, once back, what it found. */
export function ToolCallLine({ call }: { call: ToolCallPart }) {
  const state = call.result ? (call.result.ok ? 'ok' : 'failed') : 'pending'
  const mark = { ok: '✓', failed: '✕', pending: '…' }[state]
  return (
    <div className={`ag-tool ag-tool--${state}`} title={call.name}>
      <span className="ag-tool__mark" aria-hidden="true">
        {mark}
      </span>
      {call.result ? `${call.summary}: ${call.result.summary}` : call.summary}
    </div>
  )
}
