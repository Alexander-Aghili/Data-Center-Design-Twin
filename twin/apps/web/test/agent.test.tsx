import type { AgentEvent, Proposal } from '@twin/schema'
import { fmtFlow, fmtMass, fmtMoney, fmtPct, fmtPower, fmtWeeks } from '../src/format'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Thread as ThreadComponent } from '../src/agent/Thread'
import type { TwinState, useTwinStore as UseTwinStore } from '../src/state/store'
import { chatTurn, liquidProposal, problemAnnotation, problemTurn, rateLimitError } from './fixtures/agentThread'

vi.mock('@twin/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@twin/commands')>()
  const { registry } = actual.createRegistry([
    actual.defineCommand({
      type: 'setCoolingMethod',
      layer: 'cooling',
      title: 'Set cooling method',
      description: 'Sets the cooling method of a rack group.',
      apply: () => {},
      summarize: (p) => `Direct-to-chip cold plates on group ${p.groupId}`,
    }),
  ])
  return { ...actual, registry }
})

let Thread: typeof ThreadComponent
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  // The store module opens the app's socket on import; keep it from reaching a real server.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ Thread } = await import('../src/agent/Thread'))
  ;({ useTwinStore } = await import('../src/state/store'))
})

afterEach(cleanup)

function setup(thread: AgentEvent[], over: Partial<TwinState> = {}) {
  const actions = {
    chat: vi.fn(),
    applyProposal: vi.fn(),
    dismissProposal: vi.fn(),
    dispatchView: vi.fn(),
    resetChat: vi.fn(),
  }
  const proposals: Record<string, Proposal> = {}
  for (const e of thread) if (e.kind === 'proposal') proposals[e.proposal.id] = e.proposal
  useTwinStore.setState({
    connection: 'online',
    plan: null,
    thread,
    proposals,
    annotations: [],
    previewProposalId: null,
    ...actions,
    ...over,
  })
  render(<Thread />)
  return actions
}

const push = (e: AgentEvent) => act(() => useTwinStore.setState((s) => ({ thread: [...s.thread, e] })))

describe('agent thread', () => {
  it('textDelta events render incrementally', () => {
    setup([{ kind: 'messageStart', messageId: 'm9', trigger: 'chat', severity: 'info' }])
    push({ kind: 'textDelta', messageId: 'm9', text: 'The hall is ' })
    expect(screen.getByText(/The hall is/)).toBeTruthy()
    push({ kind: 'textDelta', messageId: 'm9', text: 'within limits.' })
    expect(screen.getByText('The hall is within limits.')).toBeTruthy()
    expect(document.querySelector('.ag-caret')).not.toBeNull()
    push({ kind: 'messageEnd', messageId: 'm9' })
    expect(document.querySelector('.ag-caret')).toBeNull()
  })

  it('problem severity renders red rule and DeltaTag matching annotation tag', () => {
    setup(problemTurn, { annotations: [{ ...problemAnnotation, tag: 4 }] })
    const msg = document.querySelector<HTMLElement>('[data-message-id="m1"]')
    expect(msg?.className).toContain('ag-msg--problem')
    expect(msg?.querySelector('.ag-msg__rule')).not.toBeNull()
    const tag = within(msg as HTMLElement).getByRole('img', { name: 'Revision 4' })
    expect(tag.textContent).toBe('4')
  })

  it('info messages have neither rule nor tag', () => {
    setup(chatTurn)
    const msg = document.querySelector<HTMLElement>('[data-message-id="m2"]')
    expect(msg?.className).toContain('ag-msg--info')
    expect(msg?.querySelector('.ag-msg__rule')).toBeNull()
    expect(within(msg as HTMLElement).queryByRole('img', { name: /Revision/ })).toBeNull()
  })

  it('offers a new conversation once there is a thread, and only while online', () => {
    const actions = setup(chatTurn)
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(actions.resetChat).toHaveBeenCalledTimes(1)
    cleanup()
    setup([])
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
    cleanup()
    setup(chatTurn, { connection: 'local' })
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
  })

  it('a message the person sends brings the thread back to its end, even after they scrolled up', () => {
    setup(chatTurn)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 })
    log.scrollTop = 0
    fireEvent.scroll(log)
    push({ kind: 'messageStart', messageId: 'm9', trigger: 'observation', severity: 'info' })
    expect(log.scrollTop).toBe(0)
    push({ kind: 'userMessage', messageId: 'u9', text: 'Fix the floor' })
    expect(log.scrollTop).toBe(1000)
  })

  it('tool calls render as one quiet line with summary', () => {
    setup(problemTurn)
    const lines = document.querySelectorAll<HTMLElement>('.ag-tool')
    expect(lines).toHaveLength(3)
    expect(lines[0].textContent).toBe('✓Done: 1 check fails')
    expect(lines[0].title).toBe('get_evaluation')
  })

  it('a pending tool call shows no result yet and a failed one shows ✕', () => {
    setup([
      { kind: 'messageStart', messageId: 'm5', trigger: 'chat', severity: 'info' },
      { kind: 'toolCall', messageId: 'm5', callId: 'a', name: 'get_plan', summary: 'Read the plan' },
      { kind: 'toolCall', messageId: 'm5', callId: 'b', name: 'get_catalog_entry', summary: 'Looked up rack-x' },
      { kind: 'toolResult', callId: 'b', ok: false, summary: 'No catalog entry "rack-x"', numbers: [] },
    ])
    const [pending, failed] = document.querySelectorAll<HTMLElement>('.ag-tool')
    expect(pending.textContent).toBe('…Running: Read the plan')
    expect(failed.textContent).toBe('✕Failed: Looked up rack-x: No catalog entry "rack-x"')
    expect(failed.querySelector('.visually-hidden')?.textContent).toBe('Failed: ')
  })

  it('ProposalCard shows + / = lines from commands summaries, diff (capex, build weeks, PUE, worst check), Preview/Apply/Dismiss', () => {
    const plan = { notes: [{ id: 'note-1', text: 'No evaporative water' }] } as unknown as TwinState['plan']
    const actions = setup(problemTurn, { plan })
    const card = screen.getByRole('group', { name: 'Liquid cooling for rows 3–5' })
    const items = within(card)
      .getAllByRole('listitem')
      .map((li) => [li.dataset.mark, li.textContent])
    expect(items).toEqual([
      ['+', 'Direct-to-chip cold plates on group g2'],
      ['+', 'Override equipment'],
      ['=', 'Respects note: No evaporative water'],
    ])
    const effect = card.querySelector('.ag-card__effect')?.textContent
    expect(effect).toContain('Capex +$4.8M.')
    expect(effect).toContain('Build +9 weeks.')
    expect(effect).toContain('PUE 1.38 to 1.19.')
    expect(effect).toContain('Warning: Floor bay B4-3 rises to 97%.')
    expect(effect).toContain('Pass: Clears CRAH capacity.')

    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }))
    expect(actions.dispatchView).toHaveBeenCalledWith({ type: 'previewProposal', proposalId: 'p1' })
    fireEvent.click(within(card).getByRole('button', { name: 'Apply' }))
    expect(actions.applyProposal).toHaveBeenCalledWith('p1')
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }))
    expect(actions.dismissProposal).toHaveBeenCalledWith('p1')
  })

  it('preview toggles off while the proposal is previewed', () => {
    const actions = setup(problemTurn, { previewProposalId: 'p1' })
    const preview = screen.getByRole('button', { name: 'Preview' })
    expect(preview.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(preview)
    expect(actions.dispatchView).toHaveBeenCalledWith({ type: 'previewProposal', proposalId: null })
  })

  it('stale proposal shows "Plan changed since this was proposed" and disables Apply', () => {
    setup([...problemTurn, { kind: 'proposalStatus', proposalId: 'p1', status: 'stale' }], {
      proposals: { p1: { ...liquidProposal, status: 'stale' } },
    })
    expect(screen.getByText('Plan changed since this was proposed')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('applied and dismissed proposals drop their buttons and say so', () => {
    setup(problemTurn, { proposals: { p1: { ...liquidProposal, status: 'applied' } } })
    expect(screen.getByText('Applied')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('error event renders plain message', () => {
    setup([rateLimitError])
    const line = document.querySelector('.ag-error') as HTMLElement
    expect(line.textContent).toBe('✕The Claude API is rate limiting requests. Try again in a minute.')
    // The log is the live region; an alert inside it would announce the error twice.
    expect(line.closest('[role="log"]')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an error inside a message ends its streaming', () => {
    setup([
      { kind: 'messageStart', messageId: 'm7', trigger: 'chat', severity: 'info' },
      { kind: 'textDelta', messageId: 'm7', text: 'Checking' },
      { kind: 'error', messageId: 'm7', message: 'The connection to the Claude API dropped.' },
    ])
    expect(document.querySelector('.ag-error')?.textContent).toContain('The connection to the Claude API dropped.')
    expect(document.querySelector('.ag-caret')).toBeNull()
  })

  it('Enter sends, Shift+Enter newline, disabled while offline', () => {
    const actions = setup([])
    const input = screen.getByRole('textbox', { name: 'Message the design agent' }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Why is PUE up?' } })
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(actions.chat).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.chat).toHaveBeenCalledWith('Why is PUE up?')
    expect(input.value).toBe('')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.chat).toHaveBeenCalledTimes(1)

    act(() => useTwinStore.setState({ connection: 'offline' }))
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('Offline. Reconnecting to the server…')
  })

  it('markdown subset: paragraphs, bold, inline code, lists only', () => {
    setup([
      { kind: 'messageStart', messageId: 'm3', trigger: 'chat', severity: 'info' },
      {
        kind: 'textDelta',
        messageId: 'm3',
        text: 'First **bold** and `code`.\nSame paragraph.\n\nOptions:\n- one\n- two\n\n1. first\n2. second\n\n# Not a heading [link](http://x) <b>raw</b> _em_',
      },
      { kind: 'messageEnd', messageId: 'm3' },
    ])
    const body = document.querySelector('[data-message-id="m3"] .ag-msg__body') as HTMLElement
    const paragraphs = body.querySelectorAll('p')
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0].textContent).toBe('First bold and code. Same paragraph.')
    expect(body.querySelector('strong')?.textContent).toBe('bold')
    expect(body.querySelector('code')?.textContent).toBe('code')
    expect([...body.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', 'two'])
    expect([...body.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['first', 'second'])
    expect(body.querySelector('h1, a, b, em')).toBeNull()
    expect(paragraphs[2].textContent).toBe('# Not a heading [link](http://x) <b>raw</b> _em_')
  })

  it('numbers in a message that equal a value in that message\'s toolResult.numbers (after unit display rounding) get a dotted underline with title "From <tool name>"', () => {
    setup([...problemTurn, ...chatTurn])
    const m1 = document.querySelector('[data-message-id="m1"]') as HTMLElement
    const marks = [...m1.querySelectorAll<HTMLElement>('.ag-grounded')].map((el) => [el.textContent, el.title])
    expect(marks).toEqual([
      ['132 kW', 'From get_evaluation'],
      ['40 kW', 'From explain_check'],
      ['214%', 'From get_evaluation'],
    ])
    // Numbers from another message's tools are not used.
    const m2 = document.querySelector('[data-message-id="m2"]') as HTMLElement
    expect([...m2.querySelectorAll('.ag-grounded')].map((el) => el.textContent)).toEqual(['38 weeks', '30 weeks', '26 weeks'])
  })

  it('the proposal tag takes its severity from the checks the change hurts', () => {
    const tagClass = () => document.querySelector('.ag-card .ag-delta')?.getAttribute('class')
    setup(problemTurn)
    expect(tagClass()).toContain('ag-delta--warning')
    cleanup()
    const fails = { ...liquidProposal.diff.worsened[0], status: 'fail' as const }
    setup(problemTurn, { proposals: { p1: { ...liquidProposal, diff: { ...liquidProposal.diff, worsened: [fails] } } } })
    expect(tagClass()).toContain('ag-delta--problem')
    cleanup()
    setup(problemTurn, { proposals: { p1: { ...liquidProposal, diff: { ...liquidProposal.diff, worsened: [] } } } })
    expect(tagClass()).toContain('ag-delta--info')
  })

  it('a previewed proposal that stops being open ends the preview', () => {
    const actions = setup(problemTurn, { previewProposalId: 'p1' })
    expect(actions.dispatchView).not.toHaveBeenCalled()
    act(() => useTwinStore.setState({ proposals: { p1: { ...liquidProposal, status: 'applied' } } }))
    expect(actions.dispatchView).toHaveBeenCalledWith({ type: 'previewProposal', proposalId: null })
  })

  it('grounding understands every unit format.ts writes', () => {
    const shown = [fmtPower(132_000), fmtPower(9_400_000), fmtMass(412_000), fmtFlow(2.5), fmtMoney(4_800_000), fmtWeeks(9), fmtPct(0.914)]
    setup([
      { kind: 'messageStart', messageId: 'm6', trigger: 'chat', severity: 'info' },
      { kind: 'toolCall', messageId: 'm6', callId: 'f', name: 'get_evaluation', summary: 'Read the evaluation' },
      { kind: 'toolResult', callId: 'f', ok: true, summary: 'ok', numbers: [132_000, 9_400_000, 412_000, 2.5, 4_800_000, 9, 0.914] },
      { kind: 'textDelta', messageId: 'm6', text: shown.join(', ') },
      { kind: 'messageEnd', messageId: 'm6' },
    ])
    const marks = [...document.querySelectorAll('[data-message-id="m6"] .ag-grounded')].map((el) => el.textContent)
    expect(marks).toEqual(shown)
  })

  it('links that point outside the app are not offered', () => {
    setup([
      { kind: 'messageStart', messageId: 'm8', trigger: 'chat', severity: 'info' },
      { kind: 'link', messageId: 'm8', label: 'Brief', href: 'https://example.com/api/brief/file/x.md' },
      { kind: 'messageEnd', messageId: 'm8' },
    ])
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Brief \(not offered/)).toBeTruthy()
  })

  it('link events render as a download link', () => {
    setup(chatTurn)
    const link = screen.getByRole('link', { name: 'OpenFOAM simulation brief' })
    expect(link.getAttribute('href')).toBe('/api/brief/file/2026-10-18-openfoam.md')
    expect(link.hasAttribute('download')).toBe(true)
  })

  it('an empty thread invites a question', () => {
    setup([])
    expect(screen.getByText(/Ask about the plan/)).toBeTruthy()
  })
})
