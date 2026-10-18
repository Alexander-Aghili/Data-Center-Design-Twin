import type { Check, Evaluation } from '@twin/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as StoreModule from '../src/state/store'
import type * as SummaryModule from '../src/panels/Summary'
import { demoEvaluation, demoPlan } from './fixtures/evaluation'

let store: typeof StoreModule.useTwinStore
let SummaryPanel: typeof SummaryModule.SummaryPanel

const NBSP = ' '

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ useTwinStore: store } = await import('../src/state/store'))
  ;({ SummaryPanel } = await import('../src/panels/Summary'))
})

beforeEach(() => {
  const plan = demoPlan()
  store.setState({ plan, evaluation: demoEvaluation(plan), selection: null, connection: 'online' })
})

afterEach(cleanup)

const noop = () => {}

/** The KPI card whose label reads `label` (the label may carry a status mark). */
function card(label: string): HTMLElement {
  const term = screen.getAllByRole('term').find((dt) => dt.textContent?.includes(label))
  const kpi = term?.closest<HTMLElement>('.kpi')
  if (!kpi) throw new Error(`No KPI card labelled ${label}`)
  return kpi
}

const gaugeWidth = (kpi: HTMLElement) => kpi.querySelector<HTMLElement>('.kpi__gauge-fill')?.style.width

function withChecks(e: Evaluation, patch: (c: Check) => Check): Evaluation {
  return { ...e, checks: e.checks.map(patch) }
}

describe('SummaryPanel KPI cards', () => {
  it('shows usable compute against what is placed', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const kpi = card('Usable compute')
    expect(kpi.textContent).toContain('5,640')
    expect(kpi.textContent).toContain('PFLOPS')
    expect(kpi.textContent).toContain('of 5,640 placed')
  })

  it('shows facility power at the worst hour against the grid cap', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    // Fixture worst hour: 7.9 MW base + 0.52 MW swing = 8.42 MW; the default site has a 10.6 MW cap.
    const kpi = card('Facility power')
    expect(kpi.textContent).toContain('8.4')
    expect(kpi.textContent).toContain(`of 10.6${NBSP}MW grid cap`)
  })

  it('shows annual PUE with the hottest hour beside it', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const kpi = card('PUE')
    expect(kpi.querySelector('.kpi__value')?.textContent).toBe('1.21')
    expect(kpi.textContent).toContain('1.38 hottest hour')
  })

  it('shows unknown PUE as a dash, never 0', () => {
    const e = demoEvaluation()
    store.setState({ evaluation: { ...e, headline: { ...e.headline, pueAnnual: null, pueWorst: null } } })
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    expect(card('PUE').querySelector('.kpi__value')?.textContent).toBe('—')
  })

  it('shows peak-day water against the allowance', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const kpi = card('Water')
    expect(kpi.textContent).toContain(`of 120${NBSP}m³/day allowance`)
  })

  it('draws each gauge as the share of its limit in use', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    expect(parseFloat(gaugeWidth(card('Facility power')) ?? '')).toBeCloseTo((8.42 / 10.6) * 100, 1)
    expect(gaugeWidth(card('Water'))).toBe('0%')
    expect(card('Usable compute').querySelector('.kpi__gauge')).toBeNull()
    expect(card('PUE').querySelector('.kpi__gauge')).toBeNull()
  })

  it('caps the gauge at the limit and marks a failing card by shape and word', () => {
    const plan = demoPlan()
    const e = demoEvaluation(plan)
    const facilityW = [...e.hourly.facilityW]
    facilityW[e.headline.worstHour] = 12_000_000
    const failing = withChecks({ ...e, hourly: { ...e.hourly, facilityW } }, (c) =>
      c.kind === 'power.gridWorstHour' ? { ...c, status: 'fail', utilization: 12 / 10.6 } : c,
    )
    store.setState({ evaluation: failing })
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const kpi = card('Facility power')
    expect(gaugeWidth(kpi)).toBe('100%')
    expect(kpi.querySelector('.kpi__gauge')?.getAttribute('data-status')).toBe('fail')
    expect(kpi.querySelector('.status-mark[data-status="fail"]')).toBeTruthy()
    expect(kpi.textContent).toContain('Fail:')
  })

  it('leaves passing cards without a status mark', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    for (const label of ['Usable compute', 'Facility power', 'PUE', 'Water']) {
      expect(card(label).querySelector('.status-mark')).toBeNull()
    }
  })
})

describe('SummaryPanel headline and issues', () => {
  it('says how many issues stand in the way of building', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const line = screen.getByRole('status')
    expect(line.textContent).toContain('Not buildable, 4 issues')
    expect(line.querySelector('[data-status="fail"]')).toBeTruthy()
  })

  it('says buildable when nothing fails or warns', () => {
    const e = demoEvaluation()
    const clean = withChecks({ ...e, headline: { ...e.headline, buildable: true } }, (c) =>
      c.status === 'fail' || c.status === 'warn' ? { ...c, status: 'pass' } : c,
    )
    store.setState({ evaluation: clean })
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    expect(screen.getByRole('status').textContent).toContain('Buildable')
    expect(screen.queryByRole('button', { name: /Issues/ })).toBeNull()
  })

  it('keeps the issues collapsed by default', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    const toggle = screen.getByRole('button', { name: 'Issues (4)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /CRAH capacity/ })).toBeNull()
  })

  it('lists failing then warning checks, worst first, without unknown or passing ones', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issues (4)' }))
    expect(screen.getByRole('button', { name: 'Issues (4)' }).getAttribute('aria-expanded')).toBe('true')
    const rows = screen.getAllByRole('button', { name: /^(Fail|Warning):/ })
    expect(rows.map((r) => r.textContent)).toEqual([
      'Fail: Air cooling, rows 3–5330%',
      'Fail: CRAH capacity214%',
      'Warning: Busway on row 391%',
      'Warning: Floor bay B4-386%',
    ])
  })

  it('selects a check when it is clicked', () => {
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issues (4)' }))
    const row = screen.getByRole('button', { name: /CRAH capacity/ })
    fireEvent.click(row)
    expect(store.getState().selection).toEqual({ kind: 'check', id: 'cooling.crahCapacity:Z1' })
    expect(row.getAttribute('aria-current')).toBe('true')
  })

  it('opens the all-variables drawer from its link', () => {
    const onToggleAll = vi.fn()
    render(<SummaryPanel allOpen={false} onToggleAll={onToggleAll} />)
    const link = screen.getByRole('button', { name: 'All variables' })
    expect(link.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(link)
    expect(onToggleAll).toHaveBeenCalledOnce()
  })

  it('explains the wait before the first evaluation', () => {
    store.setState({ evaluation: null, connection: 'offline' })
    render(<SummaryPanel allOpen={false} onToggleAll={noop} />)
    expect(screen.getByText(/The plan server is not running/)).toBeTruthy()
  })
})
