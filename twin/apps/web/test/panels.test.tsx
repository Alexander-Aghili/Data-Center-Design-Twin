import type { Check } from '@twin/schema'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChecksModule from '../src/panels/Checks'
import type * as StatusMarkModule from '../src/panels/StatusMark'
import type * as AllVariablesModule from '../src/panels/AllVariables'
import type * as StoreModule from '../src/state/store'
import { demoChecks, demoEvaluation, demoPlan } from './fixtures/evaluation'

let store: typeof StoreModule.useTwinStore
let StatusMark: typeof StatusMarkModule.StatusMark
let rankChecks: typeof ChecksModule.rankChecks
let AllVariables: typeof AllVariablesModule.AllVariables

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore: store } = await import('../src/state/store'))
  ;({ StatusMark } = await import('../src/panels/StatusMark'))
  ;({ rankChecks } = await import('../src/panels/Checks'))
  ;({ AllVariables } = await import('../src/panels/AllVariables'))
})

beforeEach(() => {
  const plan = demoPlan()
  store.setState({ plan, evaluation: demoEvaluation(plan), activeLayer: 'cooling', selection: null, connection: 'online' })
})

afterEach(cleanup)

const byId = (id: string) => demoChecks.find((c) => c.id === id) as Check

describe('StatusMark', () => {
  it('renders text, not only color', () => {
    render(
      <>
        <StatusMark status="fail" />
        <StatusMark status="warn" />
        <StatusMark status="pass" />
        <StatusMark status="unknown" />
      </>,
    )
    expect(screen.getByText('Fail')).toBeTruthy()
    expect(screen.getByText('Warning')).toBeTruthy()
    expect(screen.getByText('Pass')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('keeps the status word for screen readers when the label is a count', () => {
    const { container } = render(<StatusMark status="fail" label="2" />)
    expect(container.textContent).toContain('2')
    expect(container.querySelector('[data-status="fail"]')).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('rankChecks', () => {
  it('ranks fail > warn > unknown > pass, then by utilization', () => {
    const mixed = [
      byId('cooling.coolantTemp:hall'),
      byId('network.copperReach:leaf-2'),
      byId('layout.floorBay:B4-3'),
      byId('cooling.crahCapacity:Z1'),
      byId('power.busway:R3'),
      byId('cooling.rackHeatLimit:g2'),
    ]
    expect(rankChecks(mixed).map((c) => c.id)).toEqual([
      'cooling.rackHeatLimit:g2',
      'cooling.crahCapacity:Z1',
      'power.busway:R3',
      'layout.floorBay:B4-3',
      'network.copperReach:leaf-2',
      'cooling.coolantTemp:hall',
    ])
  })
})

describe('AllVariables', () => {
  it('groups every metric by layer and closes on Escape', () => {
    const onClose = vi.fn()
    render(<AllVariables onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'All variables' })
    expect(within(dialog).getByRole('heading', { name: 'Cooling' })).toBeTruthy()
    expect(within(dialog).getByRole('row', { name: /Heat to air/ }).textContent).toContain('6.8 MW')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('is modal: focus starts in the filter and Tab wraps inside the drawer', () => {
    render(<AllVariables onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'All variables' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const search = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(search)
    const last = within(dialog).getAllByRole('button').at(-1) as HTMLElement
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('filters variables by name', () => {
    render(<AllVariables onClose={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'crah' } })
    expect(screen.queryByRole('row', { name: /Heat to air/ })).toBeNull()
    expect(screen.getByRole('row', { name: /CRAH capacity installed/ })).toBeTruthy()
  })
})
