import { loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { LAYER_DEFAULTS, LAYER_IDS, type Check } from '@twin/schema'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LayerHeaderModule from '../src/panels/LayerHeader'
import type * as SiteLabelsModule from '../src/scene/overlays/SiteLabels'
import type * as WorkloadTintModule from '../src/scene/overlays/WorkloadTint'
import type * as StoreModule from '../src/state/store'
import { demoEvaluation, demoPlan } from './fixtures/evaluation'

let store: typeof StoreModule.useTwinStore
let LayerHeader: typeof LayerHeaderModule.LayerHeader
let siteLabels: typeof SiteLabelsModule.siteLabels
let workloadGroups: typeof WorkloadTintModule.workloadGroups

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore: store } = await import('../src/state/store'))
  ;({ LayerHeader } = await import('../src/panels/LayerHeader'))
  ;({ siteLabels } = await import('../src/scene/overlays/SiteLabels'))
  ;({ workloadGroups } = await import('../src/scene/overlays/WorkloadTint'))
})

beforeEach(() => {
  const plan = demoPlan()
  store.setState({ plan, evaluation: demoEvaluation(plan), connection: 'online' })
  store.getState().dispatchView({ type: 'setLayer', layer: 'cooling' })
})

afterEach(cleanup)

const segments = () => within(screen.getByRole('radiogroup', { name: 'Overlay' })).getAllByRole('radio')
const segmentNames = () => segments().map((r) => r.textContent)
const checkedName = () => segments().find((r) => r.getAttribute('aria-checked') === 'true')?.textContent
const setLayer = (layer: (typeof LAYER_IDS)[number]) => act(() => store.getState().dispatchView({ type: 'setLayer', layer }))

describe('LayerHeader', () => {
  it('overlay switcher lists only overlays valid for the active layer', () => {
    render(<LayerHeader />)
    expect(segmentNames()).toEqual(['Liquid', 'Air', 'Temperature', 'Floor load', 'Off'])

    setLayer('power')
    expect(segmentNames()).toEqual(['Busway load', 'Off'])

    setLayer('network')
    expect(segmentNames()).toEqual(['Cables', 'Off'])

    setLayer('site')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('switching layer sets LAYER_DEFAULTS overlay', () => {
    render(<LayerHeader />)
    const labels = { liquid: 'Liquid', temperature: 'Temperature', floorLoad: 'Floor load', power: 'Busway load', network: 'Cables' }
    for (const layer of LAYER_IDS) {
      setLayer(layer)
      const overlay = LAYER_DEFAULTS[layer].overlay
      expect(store.getState().overlay).toBe(overlay)
      if (overlay === 'none') expect(screen.queryByRole('radiogroup')).toBeNull()
      else expect(checkedName()).toBe(labels[overlay as keyof typeof labels])
    }
  })

  it('choosing a segment sets the overlay, and arrow keys move the choice', () => {
    render(<LayerHeader />)
    fireEvent.click(screen.getByRole('radio', { name: 'Air' }))
    expect(store.getState().overlay).toBe('air')
    expect(checkedName()).toBe('Air')

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Air' }), { key: 'ArrowRight' })
    expect(store.getState().overlay).toBe('temperature')
    expect(document.activeElement?.textContent).toBe('Temperature')

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Liquid' }), { key: 'ArrowLeft' })
    expect(store.getState().overlay).toBe('none')
  })

  it('keeps an overlay the agent set from another layer visible and checked', () => {
    render(<LayerHeader />)
    setLayer('power')
    act(() => store.getState().dispatchView({ type: 'setOverlay', overlay: 'temperature' }))
    expect(segmentNames()).toEqual(['Busway load', 'Off', 'Temperature'])
    expect(checkedName()).toBe('Temperature')
  })

  it('captions flow overlays as illustrative', () => {
    render(<LayerHeader />)
    expect(screen.getByText('Illustrative flow, scaled from computed values')).toBeTruthy()
    setLayer('layout')
    expect(screen.queryByText('Illustrative flow, scaled from computed values')).toBeNull()
    expect(screen.getByText('Floor bays shaded by load against their rating')).toBeTruthy()
  })

  it('shows the workload legend with group names, rack counts and purpose', () => {
    render(<LayerHeader />)
    setLayer('workload')
    const legend = screen.getByRole('list', { name: 'Rack groups' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Inference block32\u00A0racks',
      'Training block48\u00A0racks',
    ])
    expect(legend.nextElementSibling?.textContent).toBe('Mixed training and inference. Target 4,000\u00A0PFLOPS, 5,640 placed.')
  })
})

describe('workloadGroups', () => {
  it('gives each group a fixed color by plan order and counts its racks', () => {
    const groups = workloadGroups(demoPlan())
    expect(groups.map((g) => [g.id, g.racks])).toEqual([
      ['g1', 32],
      ['g2', 48],
    ])
    expect(groups[0]!.color).not.toBe(groups[1]!.color)
  })

  it('folds groups past the third into one neutral color', () => {
    const plan = demoPlan()
    const extra = ['g3', 'g4', 'g5'].map((id) => ({ ...plan.rackGroups[0]!, id, name: id }))
    const groups = workloadGroups({ ...plan, rackGroups: [...plan.rackGroups, ...extra] })
    expect(new Set(groups.map((g) => g.color)).size).toBe(4)
    expect(groups[3]!.color).toBe(groups[4]!.color)
  })
})

describe('siteLabels', () => {
  const plan = snapshotCatalog(demoPlan(), loadBuiltins().entries)

  it('reads grid, water and design temperature from the plan and its climate entry', () => {
    const labels = siteLabels(plan, null)
    expect(labels.map((l) => [l.id, l.title, l.value])).toEqual([
      ['grid', 'Grid connection', '10.4\u00A0MW'],
      ['water', 'Water allowance', '120\u00A0m³/day'],
      ['climate', 'Design dry bulb', '38.9\u00A0°C'],
    ])
    expect(labels[2]!.note).toBe('Dallas–Fort Worth, Texas')
    expect(labels.every((l) => l.status === undefined)).toBe(true)
  })

  it('anchors grid at the electrical room, water at the plant and climate on the roof', () => {
    const labels = siteLabels(plan, null)
    const at = (kind: string) => plan.hall.positions.find((p) => p.kind === kind)!
    expect(labels[0]!.anchor).toEqual([at('electrical').x, 0, at('electrical').z])
    expect(labels[1]!.anchor).toEqual([at('plant').x, 0, at('plant').z])
    expect(labels[2]!.anchor).toEqual([plan.hall.widthM / 4, plan.hall.ceilingM, plan.hall.depthM / 2])
  })

  it('adds the worst-hour and peak-day checks with their status', () => {
    const grid: Check = {
      id: 'power.gridWorstHour:site',
      kind: 'power.gridWorstHour',
      layer: 'power',
      subject: { kind: 'site', id: 'site', objectIds: [] },
      title: 'Grid capacity at the worst hour',
      value: 11_200_000,
      limit: 10_000_000,
      unit: 'W',
      utilization: 1.12,
      status: 'fail',
      explanation: '',
      causes: [],
    }
    const evaluation = { ...demoEvaluation(plan), checks: [grid] }
    const labels = siteLabels(plan, evaluation)
    expect(labels[0]!.status).toEqual({ status: 'fail', text: 'Worst hour 11.2\u00A0MW' })
    expect(labels[1]!.status).toBeUndefined()
  })

  it('shows a dash when the climate is not in the catalog', () => {
    const labels = siteLabels({ ...plan, site: { ...plan.site, climateId: 'climate.nowhere' }, catalog: {} }, null)
    expect(labels[2]!).toMatchObject({ value: '—', note: 'Climate not in the catalog' })
  })
})
