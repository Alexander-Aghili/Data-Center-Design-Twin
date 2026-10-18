import { useState, type KeyboardEvent } from 'react'
import type { BackendStatus } from '../state/backend'
import { useTwinStore } from '../state/store'

const PLACEHOLDER: Record<BackendStatus, string> = {
  online: 'Ask about this plan',
  connecting: 'Connecting to the server…',
  offline: 'Offline. Reconnecting to the server…',
  local: 'Start the local server to use the agent',
}

const BUDGET_SPENT = "Today's API budget is spent"

const MAX_ROWS = 6

/** Enter sends, Shift+Enter adds a line. The agent lives in the server, so the input only works online. */
export function ChatInput() {
  const connection = useTwinStore((s) => s.connection)
  const budgetSpent = useTwinStore((s) => s.agentStatus?.budgetSpent === true)
  const chat = useTwinStore((s) => s.chat)
  const [text, setText] = useState('')
  const disabled = connection !== 'online' || budgetSpent
  const rows = Math.min(MAX_ROWS, text.split('\n').length)

  const send = () => {
    const message = text.trim()
    if (!message || disabled) return
    chat(message)
    setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    send()
  }

  return (
    <form
      className="ag-input"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <textarea
        className="input"
        aria-label="Message the design agent"
        aria-describedby="ag-input-hint"
        rows={rows}
        value={text}
        placeholder={budgetSpent ? BUDGET_SPENT : PLACEHOLDER[connection]}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span id="ag-input-hint" className="visually-hidden">
        Enter sends the message, Shift+Enter starts a new line.
      </span>
      <button type="submit" className="btn btn--quiet" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  )
}
