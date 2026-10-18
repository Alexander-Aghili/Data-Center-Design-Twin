import type { HourlySeries, ServerMsg } from '@twin/schema'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HourlyChart as HourlyChartComponent } from '../src/charts/HourlyChart'
import type { AllVariables as AllVariablesComponent } from '../src/panels/AllVariables'
import type { useTwinStore as UseTwinStore } from '../src/state/store'
import type { Strip as StripComponent } from '../src/strips/Strip'
import type * as Parts from '../src/strips/parts'
import { fixtureEvaluation, fixturePlan } from './fixtures/dallasEvaluation'

// The hourly chart calls useWidth exactly once per render, so its calls count the chart's renders.
vi.mock('../src/strips/parts', async (importOriginal) => {
  const actual = await importOriginal<typeof Parts>()
  return { ...actual, useWidth: vi.fn(actual.useWidth) }
})

interface StubSocket {
  onmessage: ((event: { data: string }) => void) | null
}
const sockets: StubSocket[] = []

let HourlyChart: typeof HourlyChartComponent
let AllVariables: typeof AllVariablesComponent
let Strip: typeof StripComponent
let useTwinStore: typeof UseTwinStore
let chartRenders: () => number

beforeAll(async () => {
  // The app store talks to this stub; the test plays the server by calling its onmessage.
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 0
      onmessage = null
      constructor() {
        sockets.push(this)
      }
    },
  )
  ;({ useTwinStore } = await import('../src/state/store'))
  ;({ HourlyChart } = await import('../src/charts/HourlyChart'))
  ;({ AllVariables } = await import('../src/panels/AllVariables'))
  ;({ Strip } = await import('../src/strips/Strip'))
  const { useWidth } = await import('../src/strips/parts')
  chartRenders = () => vi.mocked(useWidth).mock.calls.length
})

afterEach(cleanup)

const plan = fixturePlan()
const evaluation = fixtureEvaluation(plan)
const { hourly: _hourly, ...lean } = evaluation
const history = { canUndo: true, canRedo: false }

function push(msg: ServerMsg) {
  act(() => sockets[0]!.onmessage!({ data: JSON.stringify(msg) }))
}

/** A server state push; `hourly` only when the series changed. A changed first metric shows the panels re-rendering. */
function state(metricValue: number, hourlyVersion: number, hourly?: HourlySeries): ServerMsg {
  const metrics = lean.metrics.map((m, i) => (i === 0 ? { ...m, value: metricValue } : m))
  return { t: 'state', plan, evaluation: { ...lean, metrics, ...(hourly ? { hourly } : {}) }, history, hourlyVersion }
}

describe('hourly chart rendering', () => {
  it('a state push that leaves the hourly series out re-renders the panels but none of the hourly charts', () => {
    push(state(1, 1, evaluation.hourly))
    render(
      <>
        <AllVariables onClose={() => {}} />
        <Strip layer="site" />
        <HourlyChart series={['outdoorC']} />
      </>,
    )
    expect(screen.getAllByRole('region', { name: /over the year/ }).length).toBeGreaterThanOrEqual(3)
    const before = chartRenders()

    push(state(4242, 1))
    expect(screen.getByText(/4,242/)).toBeTruthy()
    expect(chartRenders()).toBe(before)

    const hotter = { ...evaluation.hourly, outdoorC: evaluation.hourly.outdoorC.map((c) => c + 1) }
    push(state(4242, 2, hotter))
    expect(chartRenders()).toBeGreaterThan(before)
    expect(useTwinStore.getState().evaluation?.hourly).toEqual(hotter)
  })
})
