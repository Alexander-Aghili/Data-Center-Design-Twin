import type { Check } from '@twin/schema'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChecksModule from '../src/panels/Checks'
import type * as LayerListModule from '../src/panels/LayerList'
import type * as StatusMarkModule from '../src/panels/StatusMark'
import type * as TotalsModule from '../src/panels/Totals'
import type * as AllVariablesModule from '../src/panels/AllVariables'
import type * as StoreModule from '../src/state/store'
import type * as AppModule from '../src/App'
import { demoChecks, demoEvaluation, demoPlan } from './fixtures/evaluation'

let store: typeof StoreModule.useTwinStore
let StatusMark: typeof StatusMarkModule.StatusMark
let Checks: typeof ChecksModule.Checks
let rankChecks: typeof ChecksModule.rankChecks
let LayerList: typeof LayerListModule.LayerList
let Totals: typeof TotalsModule.Totals
let AllVariables: typeof AllVariablesModule.AllVariables
let App: typeof AppModule.App

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore: store } = await import('../src/state/store'))
  ;({ StatusMark } = await import('../src/panels/StatusMark'))
  ;({ Checks, rankChecks } = await import('../src/panels/Checks'))
  ;({ LayerList } = await import('../src/panels/LayerList'))
  ;({ Totals } = await import('../src/panels/Totals'))
  ;({ AllVariables } = await import('../src/panels/AllVariables'))
  ;({ App } = await import('../src/App'))
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

describe('Checks', () => {
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

  it('lists the issues in rank order and sums up the passing checks', () => {
    render(<Checks />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[0]).toContain('Air cooling, rows 3–5')
    expect(items[0]).toContain('330%')
    expect(items[1]).toContain('CRAH capacity')
    expect(items[4]).toContain('Copper reach to leaf 2')
    expect(items[4]).toContain('—')
    expect(items.at(-1)).toContain('17 other checks pass')
  })

  it('selects a check when it is clicked', () => {
    render(<Checks />)
    fireEvent.click(screen.getByRole('button', { name: /CRAH capacity/ }))
    expect(store.getState().selection).toEqual({ kind: 'check', id: 'cooling.crahCapacity:Z1' })
  })
})

describe('LayerList', () => {
  it('shows the issue count per layer from checks', () => {
    render(<LayerList />)
    const cooling = screen.getByRole('button', { name: /^Cooling/ })
    expect(cooling.getAttribute('aria-label')).toBe('Cooling, Mechanical engineer, 2 failing')
    expect(cooling.getAttribute('aria-current')).toBe('true')
    expect(within(cooling).getByText('2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Power/ }).getAttribute('aria-label')).toBe('Power, Electrical engineer, 1 warning')
    expect(screen.getByRole('button', { name: /^Layout/ }).getAttribute('aria-label')).toBe('Layout, Facility planner, 1 warning')
    expect(screen.getByRole('button', { name: /^Workload/ }).getAttribute('aria-label')).toBe('Workload, Product and compute buyer, no issues')
    expect(screen.getByRole('button', { name: /^Site/ }).getAttribute('aria-label')).toBe('Site, Fixed inputs, no issues')
  })

  it('switches the active layer', () => {
    render(<LayerList />)
    fireEvent.click(screen.getByRole('button', { name: /^Power/ }))
    expect(store.getState()).toMatchObject({ activeLayer: 'power', overlay: 'power' })
  })
})

describe('Totals', () => {
  it('leads with usable compute and says why the plan is not buildable', () => {
    render(<Totals allOpen={false} onToggleAll={() => {}} />)
    expect(screen.getByText('5,640')).toBeTruthy()
    expect(screen.getByText('Not buildable as drawn: 2 failing checks')).toBeTruthy()
    expect(screen.getByRole('row', { name: /Capex/ }).textContent).toContain('$184M')
  })

  it('marks a limit row with the check status shape and word, not only the meter color', () => {
    const evaluation = demoEvaluation()
    const checks = evaluation.checks.map((c) => (c.kind === 'power.gridWorstHour' ? { ...c, status: 'fail' as const } : c))
    store.setState({ evaluation: { ...evaluation, checks } })
    render(<Totals allOpen={false} onToggleAll={() => {}} />)
    const facility = screen.getByRole('row', { name: /Facility power, worst hour/ })
    expect(facility.querySelector('th [data-status="fail"] svg')).toBeTruthy()
    expect(within(facility).getByText('Fail:')).toBeTruthy()
    expect(facility.querySelector('.meter-rule')?.getAttribute('data-status')).toBe('fail')
    const water = screen.getByRole('row', { name: /Water, peak day/ })
    expect(water.querySelector('th .status-mark')).toBeNull()
  })

  it('shows unknown PUE as a dash, never 0', () => {
    const evaluation = demoEvaluation()
    store.setState({ evaluation: { ...evaluation, headline: { ...evaluation.headline, pueAnnual: null } } })
    render(<Totals allOpen={false} onToggleAll={() => {}} />)
    expect(screen.getByRole('row', { name: /PUE, annual/ }).textContent).toContain('—')
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

describe('App', () => {
  it('mounts every region and toggles the all-variables drawer inside the plan view', () => {
    render(<App />)
    for (const name of ['Layers and decisions', 'Plan view', 'Plan totals', 'Design agent']) {
      expect(screen.getByLabelText(name)).toBeTruthy()
    }
    const toggle = screen.getByRole('button', { name: 'All variables' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(screen.getByRole('main')).getByRole('dialog', { name: 'All variables' })).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns focus to the All variables button when the drawer closes with Escape', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'All variables' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('undoes on Cmd+Z and redoes on Shift+Cmd+Z, but not while typing', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    store.setState({ undo, redo })
    render(<App />)
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'All variables' }))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'z', metaKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })
})
