import type { AgentEvent, Annotation } from '@twin/schema'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTwinStore } from '../state/store'
import './agent.css'
import { ChatInput } from './ChatInput'
import { AgentMessage, ErrorLine, UserMessage, type AgentMessageModel } from './Message'
import type { ToolCallPart } from './ToolCallLine'

type ThreadItem =
  | { kind: 'agent'; message: AgentMessageModel }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'error'; id: string; message: string }

/** Folds the event stream into messages: text deltas join, tool results attach to their calls. */
function buildItems(events: AgentEvent[]): ThreadItem[] {
  const items: ThreadItem[] = []
  const messages = new Map<string, AgentMessageModel>()
  const calls = new Map<string, { part: ToolCallPart; message: AgentMessageModel }>()

  const messageFor = (id: string): AgentMessageModel => {
    let message = messages.get(id)
    if (!message) {
      message = { id, severity: 'info', streaming: true, parts: [], sources: [] }
      messages.set(id, message)
      items.push({ kind: 'agent', message })
    }
    return message
  }

  events.forEach((e, i) => {
    switch (e.kind) {
      case 'messageStart':
        messageFor(e.messageId).severity = e.severity
        return
      case 'textDelta': {
        const { parts } = messageFor(e.messageId)
        const last = parts[parts.length - 1]
        if (last?.kind === 'text') last.text += e.text
        else parts.push({ kind: 'text', text: e.text })
        return
      }
      case 'toolCall': {
        const message = messageFor(e.messageId)
        const part: ToolCallPart = { kind: 'tool', callId: e.callId, name: e.name, summary: e.summary }
        message.parts.push(part)
        calls.set(e.callId, { part, message })
        return
      }
      case 'toolResult': {
        const call = calls.get(e.callId)
        if (!call) return
        call.part.result = { ok: e.ok, summary: e.summary }
        call.message.sources.push({ name: call.part.name, numbers: e.numbers })
        return
      }
      case 'link':
        messageFor(e.messageId).parts.push({ kind: 'link', label: e.label, href: e.href })
        return
      case 'proposal':
        messageFor(e.messageId).parts.push({ kind: 'proposal', proposal: e.proposal })
        return
      case 'messageEnd':
        messageFor(e.messageId).streaming = false
        return
      case 'error':
        if (e.messageId) {
          const message = messageFor(e.messageId)
          message.parts.push({ kind: 'error', message: e.message })
          message.streaming = false
        } else {
          items.push({ kind: 'error', id: `error-${i}`, message: e.message })
        }
        return
      case 'userMessage':
        items.push({ kind: 'user', id: e.messageId, text: e.text })
        return
      case 'proposalStatus':
        return
    }
  })
  return items
}

const tagFor = (annotations: Annotation[], messageId: string) => annotations.find((a) => a.messageId === messageId)?.tag

/** Within this distance of the bottom, new output keeps the thread scrolled to the end. */
const STICK_PX = 32

/** The design agent's thread: messages as they stream, proposals, and the chat input. */
export function Thread() {
  const thread = useTwinStore((s) => s.thread)
  const annotations = useTwinStore((s) => s.annotations)
  const online = useTwinStore((s) => s.connection === 'online')
  const resetChat = useTwinStore((s) => s.resetChat)
  const items = useMemo(() => buildItems(thread), [thread])
  const streaming = items.some((it) => it.kind === 'agent' && it.message.streaming)
  const log = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = log.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [thread])

  return (
    <div className="ag-thread">
      <div className="ag-thread__head">
        <h2 className="ag-thread__title">Design agent</h2>
        {online && items.length > 0 && (
          <button type="button" className="btn btn--quiet ag-thread__reset" onClick={resetChat}>
            New conversation
          </button>
        )}
      </div>
      <div
        ref={log}
        className="ag-thread__log"
        role="log"
        aria-label="Agent messages"
        aria-busy={streaming}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
        }}
      >
        {items.length === 0 ? (
          <p className="ag-empty">Nothing to flag yet. Ask about the plan, or change it and I&rsquo;ll check the result.</p>
        ) : (
          items.map((item) => {
            switch (item.kind) {
              case 'agent':
                return <AgentMessage key={item.message.id} message={item.message} tag={tagFor(annotations, item.message.id)} />
              case 'user':
                return <UserMessage key={item.id} text={item.text} />
              case 'error':
                return <ErrorLine key={item.id} message={item.message} />
            }
          })
        )}
      </div>
      <ChatInput />
    </div>
  )
}
