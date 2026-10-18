import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HourlyChart as HourlyChartComponent } from '../src/charts/HourlyChart'
import type { useTwinStore as UseTwinStore } from '../src/state/store'
import type { Strip as StripComponent } from '../src/strips/Strip'
import { DALLAS, fixtureEvaluation, fixturePlan } from './fixtures/evaluation'

let HourlyChart: typeof HourlyChartComponent
let Strip: typeof StripComponent
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore } = await import('../src/state/store'))
  ;({ HourlyChart } = await import('../src/charts/HourlyChart'))
  ;({ Strip } = await import('../src/strips/Strip'))
})

afterEach(cleanup)

const plan = fixturePlan()
const evaluation = fixtureEvaluation(plan)

function load() {
  useTwinStore.setState({ plan, evaluation, selection: null, activeLayer: 'cooling' })
}

function nodeLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-node') ?? '')
}

describe('fixture', () => {
  it('derives the hourly series from the Dallas typical year', () => {
    expect(evaluation.hourly.outdoorC).toEqual(DALLAS.dryBulbC)
    expect(evaluation.hourly.facilityW).toHaveLength(8760)
    expect(evaluation.headline.hoursOverCap).toBeGreaterThan(0)
  })
})

describe('HourlyChart', () => {
  it('HourlyChart draws facility power vs cap and marks hours over cap', () => {
    load()
    const { container } = render(<HourlyChart series={['facilityW']} />)
    const cap = plan.site.gridCapacityW
    const over = evaluation.hourly.facilityW.flatMap((w, h) => (w > cap ? [h] : []))
    expect(screen.getAllByText('Grid cap 10 MW').length).toBeGreaterThan(0)
    const marks = [...container.querySelectorAll('[data-over-cap]')].map((m) => Number(m.getAttribute('data-hour')))
    expect(marks).toEqual(over)
    expect(screen.getByText(`✕ ${over.length} hours over the cap`)).toBeTruthy()
    expect(screen.getByRole('img', { name: /^Facility power, worst week/ })).toBeTruthy()
  })

  it('draws one panel per series and offers a monthly table view', () => {
    load()
    render(<HourlyChart series={['facilityW', 'outdoorC']} />)
    expect(screen.getByRole('img', { name: /^Facility power over the year/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^Outdoor dry-bulb over the year/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(13)
    expect(within(table).getByText('Jul')).toBeTruthy()
  })

  it('says so when there is no hourly data', () => {
    useTwinStore.setState({ plan, evaluation: { ...evaluation, hourly: { ...evaluation.hourly, facilityW: [] } } })
    render(<HourlyChart series={['facilityW']} />)
    expect(screen.getByText(/No hourly results yet/)).toBeTruthy()
  })
})

describe('Strip', () => {
  it('CoolingChain shows dashed missing CDU when liquid racks lack CDU positions', () => {
    load()
    const { container } = render(<Strip layer="cooling" />)
    expect(nodeLabels(container)).toEqual(['Chiller', 'Facility loop', 'CDU', 'Technical loop', 'Rows 3–5', 'CRAH', 'Rows 1–5'])
    const cdu = container.querySelector('[data-node="CDU"]')!
    expect(cdu.getAttribute('data-state')).toBe('missing')
    expect(cdu.querySelector('circle')!.getAttribute('stroke-dasharray')).not.toBeNull()
    expect(cdu.textContent).toContain('none for rows 3–5')
    fireEvent.click(cdu)
    expect(useTwinStore.getState().selection).toEqual({ kind: 'check', id: 'cooling.cduPositions:g2' })
  })

  it('PowerOneLine shows utility→transformer→UPS→busways with loads', () => {
    load()
    const { container } = render(<Strip layer="power" />)
    expect(nodeLabels(container)).toEqual(['Utility', 'Transformers', 'UPS', 'R1', 'R2', 'R3', 'R4', 'R5'])
    const r3 = container.querySelector('[data-node="R3"]')!
    expect(r3.textContent).toContain('2.1 MW')
    expect(r3.textContent).toContain('✕')
    expect(container.querySelector('[data-node="Utility"]')!.textContent).toContain('10 MW cap')
  })

  it('NetworkTiers shows racks→leaves→spine with copper/fiber counts', () => {
    load()
    const { container } = render(<Strip layer="network" />)
    expect(nodeLabels(container)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'Leaf 1', 'Leaf 2', 'Spine'])
    const copper = evaluation.network.links.filter((l) => l.media !== 'fiber').length
    const fiber = evaluation.network.links.length - copper
    expect(screen.getByText(`${copper} copper links, ${fiber} fiber links`)).toBeTruthy()
    expect(container.querySelector('[data-node="R1"]')!.textContent).toMatch(/\d+ copper, \d+ fiber|\d+ fiber|\d+ copper/)
  })

  it('renders nothing for layers without a schematic and a prompt for an empty hall', () => {
    load()
    const { container } = render(<Strip layer="workload" />)
    expect(container.innerHTML).toBe('')
    cleanup()
    useTwinStore.setState({ evaluation: { ...evaluation, racks: [], rows: [], equipment: [], network: { ...evaluation.network, links: [] } } })
    render(<Strip layer="cooling" />)
    expect(screen.getByText(/No racks placed yet/)).toBeTruthy()
  })
})
