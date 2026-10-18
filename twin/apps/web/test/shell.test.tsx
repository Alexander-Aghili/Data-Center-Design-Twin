import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AppModule from '../src/App'
import type * as LayersModule from '../src/shell/layers'
import type * as LayerTabsModule from '../src/shell/LayerTabs'
import type * as MoreMenuModule from '../src/shell/MoreMenu'
import type * as StoreModule from '../src/state/store'
import { demoEvaluation, demoPlan } from './fixtures/evaluation'

let store: typeof StoreModule.useTwinStore
let tabLabels: typeof LayersModule.tabLabels
let LayerTabs: typeof LayerTabsModule.LayerTabs
let MoreMenu: typeof MoreMenuModule.MoreMenu
let App: typeof AppModule.App

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore: store } = await import('../src/state/store'))
  ;({ tabLabels } = await import('../src/shell/layers'))
  ;({ LayerTabs } = await import('../src/shell/LayerTabs'))
  ;({ MoreMenu } = await import('../src/shell/MoreMenu'))
  ;({ App } = await import('../src/App'))
})

beforeEach(() => {
  const plan = demoPlan()
  store.setState({ plan, evaluation: demoEvaluation(plan), activeLayer: 'cooling', selection: null, connection: 'online' })
})

afterEach(cleanup)

describe('tabLabels', () => {
  it('names each layer with its owner and its open issues from checks', () => {
    const plan = demoPlan()
    const labels = tabLabels(plan.owners, demoEvaluation(plan).checks)
    expect(labels.cooling).toBe('Cooling, Mechanical engineer, 2 failing')
    expect(labels.power).toBe('Power, Electrical engineer, 1 warning')
    expect(labels.layout).toBe('Layout, Facility planner, 1 warning')
    expect(labels.workload).toBe('Workload, Product and compute buyer, no issues')
    expect(labels.site).toBe('Site, Fixed inputs, no issues')
  })

  it('works before a plan or evaluation arrives', () => {
    expect(tabLabels(undefined, []).network).toBe('Network, no issues')
  })
})

describe('LayerTabs', () => {
  it('is a tab list with the active layer selected and its issue count shown', () => {
    render(<LayerTabs panelId="layer-panel" />)
    const list = screen.getByRole('tablist', { name: 'Layers' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent?.replace(/\d|Fail|Warning|:/g, '').trim())).toEqual([
      'Site',
      'Workload',
      'Compute',
      'Layout',
      'Cooling',
      'Power',
      'Network',
    ])
    const cooling = screen.getByRole('tab', { name: 'Cooling, Mechanical engineer, 2 failing' })
    expect(cooling.getAttribute('aria-selected')).toBe('true')
    expect(cooling.getAttribute('aria-controls')).toBe('layer-panel')
    expect(cooling.querySelector('[data-status="fail"]')?.textContent).toContain('2')
    // Roving tab stop: only the active tab is in the page's tab order.
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([cooling])
  })

  it('switches the layer on click', () => {
    render(<LayerTabs panelId="layer-panel" />)
    fireEvent.click(screen.getByRole('tab', { name: /^Power,/ }))
    expect(store.getState()).toMatchObject({ activeLayer: 'power', overlay: 'power' })
  })

  it('moves with the arrow keys, wrapping, and jumps with Home and End', () => {
    render(<LayerTabs panelId="layer-panel" />)
    const cooling = screen.getByRole('tab', { name: /^Cooling,/ })
    fireEvent.keyDown(cooling, { key: 'ArrowRight' })
    expect(store.getState().activeLayer).toBe('power')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Power,/ }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(store.getState().activeLayer).toBe('network')
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })
    expect(store.getState().activeLayer).toBe('site')
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(store.getState().activeLayer).toBe('network')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
    expect(store.getState().activeLayer).toBe('site')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Site,/ }))
  })
})

describe('MoreMenu', () => {
  it('discloses catalog, import and export, and closes on Escape with focus back on its button', () => {
    render(<MoreMenu />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Export plan' })).toBeNull()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('group', { name: 'More actions' })
    for (const name of ['Catalog', 'Import', 'Export plan']) expect(within(menu).getByRole('button', { name })).toBeTruthy()
    fireEvent.keyDown(within(menu).getByRole('button', { name: 'Import' }), { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes after an action and on a click outside', () => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    render(
      <>
        <MoreMenu />
        <p>Outside</p>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByText('Outside'))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('dialog', { hidden: true })).toBeTruthy()
  })
})

describe('App', () => {
  it('mounts the layer card, plan view, summary and agent regions', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(within(screen.getByRole('banner')).getByRole('tablist', { name: 'Layers' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Layer decisions' })).toBeTruthy()
    expect(screen.getByRole('main', { name: 'Plan view' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Plan totals' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Design agent' })).toBeTruthy()
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { selected: true }).id)
    expect(within(panel).getByRole('heading', { name: /Cooling decisions/ })).toBeTruthy()
  })

  it('has icon undo and redo buttons with names that follow the history', () => {
    store.setState({ history: { canUndo: true, canRedo: false } })
    render(<App />)
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(true)
  })

  it('collapses and reopens the layer card', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'Hide layer card' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Show layer card')
    expect(screen.queryByRole('complementary', { name: 'Layer decisions' })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('complementary', { name: 'Layer decisions' })).toBeTruthy()
  })

  it('opens the inspector over the layer card, outside the plan view', () => {
    store.setState({ selection: { kind: 'check', id: 'cooling.crahCapacity:Z1' } })
    render(<App />)
    const inspector = screen.getByRole('complementary', { name: 'Inspector' })
    expect(within(screen.getByRole('main')).queryByRole('complementary', { name: 'Inspector' })).toBeNull()
    expect(inspector.closest('.inspector-dock')).toBeTruthy()
  })

  it('shows the layer schematic on request, only for layers that have one', () => {
    render(<App />)
    const show = screen.getByRole('button', { name: 'Show cooling chain' })
    expect(screen.queryByRole('group', { name: 'Cooling chain' })).toBeNull()
    fireEvent.click(show)
    expect(show.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('group', { name: 'Cooling chain' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Compute,/ }))
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull()
  })

  it('opens the all-variables drawer inside the plan view from the summary', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'All variables' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(screen.getByRole('main')).getByRole('dialog', { name: 'All variables' })).toBeTruthy()
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
