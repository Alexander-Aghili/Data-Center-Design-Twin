import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Inspector as InspectorComponent } from '../src/panels/Inspector'
import type { useTwinStore as UseTwinStore } from '../src/state/store'
import { fixtureEvaluation, fixturePlan } from './fixtures/dallasEvaluation'

let Inspector: typeof InspectorComponent
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore } = await import('../src/state/store'))
  ;({ Inspector } = await import('../src/panels/Inspector'))
})

afterEach(cleanup)

const plan = fixturePlan()
const evaluation = fixtureEvaluation(plan)

function select(kind: string, id: string) {
  useTwinStore.setState({ plan, evaluation, activeLayer: 'cooling', selection: { kind, id } })
  return render(<Inspector />)
}

describe('Inspector', () => {
  it('Inspector for a rack lists power, heat split, flow, temps, weight, bay, each with basis or "calculated from"', () => {
    select('rack', 'R3-07')
    const drawer = screen.getByRole('complementary', { name: 'Inspector' })
    expect(within(drawer).getByRole('heading', { name: 'R3-07' })).toBeTruthy()
    for (const label of ['Power', 'Heat split', 'Flow', 'Temperatures', 'Weight', 'Bay']) {
      const fact = within(drawer).getByRole('group', { name: label })
      expect(within(fact).getByText(/^(Calculated from|Basis)/)).toBeTruthy()
    }
    expect(within(drawer).getByRole('group', { name: 'Power' }).textContent).toContain('132\u00a0kW')
    expect(within(drawer).getByRole('group', { name: 'Heat split' }).textContent).toContain('85%')
    expect(within(drawer).getByRole('group', { name: 'Bay' }).textContent).toContain(evaluation.racks.find((r) => r.placementId === 'R3-07')!.bayId)
  })

  it('accepts the scene object id of a rack, tray or GPU as the selection id', () => {
    select('rack', 'rack:R3-07:tray:2')
    expect(screen.getByRole('heading', { name: 'R3-07' })).toBeTruthy()
  })

  it('Inspector for a check lists causes as links that select the decision layer', () => {
    select('check', 'cooling.cduPositions:g2')
    const drawer = screen.getByRole('complementary', { name: 'Inspector' })
    expect(drawer.querySelector('.status-mark[data-status="fail"]')).not.toBeNull()
    const causes = within(drawer).getByRole('list', { name: 'Causes' })
    expect(within(causes).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(within(causes).getByRole('button', { name: /CDU positions in the hall/ }))
    expect(useTwinStore.getState().activeLayer).toBe('layout')
    expect(useTwinStore.getState().selection).toEqual({ kind: 'check', id: 'cooling.cduPositions:g2' })
  })

  it('Inspector for equipment shows load, capacity and headroom with their origin, and says it was auto-sized', () => {
    select('equipment', 'eq:crah:W1:1')
    const drawer = screen.getByRole('complementary', { name: 'Inspector' })
    expect(within(drawer).getByText(/Auto-sized/)).toBeTruthy()
    const headroom = within(drawer).getByRole('group', { name: 'Headroom' })
    expect(headroom.textContent).toContain('−96\u00a0kW')
    expect(within(within(drawer).getByRole('group', { name: 'Capacity' })).getByText(/^Calculated from/)).toBeTruthy()
  })

  it('a check on the selected object links to that check', () => {
    select('rack', 'R4-00')
    fireEvent.click(screen.getByRole('button', { name: /CDU positions, rows 3–5/ }))
    expect(useTwinStore.getState().selection).toEqual({ kind: 'check', id: 'cooling.cduPositions:g2' })
  })

  it('closes on Escape and renders nothing without a selection', () => {
    select('rack', 'R3-07')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useTwinStore.getState().selection).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull()
  })
})
