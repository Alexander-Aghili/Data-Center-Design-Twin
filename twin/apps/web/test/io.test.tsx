import type { Command, Plan } from '@twin/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDefaultPlan } from '../../../packages/catalog/src/defaultPlan'
import type { ImportExport as ImportExportType } from '../src/io/ImportExport'
import type { useTwinStore as UseTwinStore } from '../src/state/store'

let ImportExport: typeof ImportExportType
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  // The store module opens the app's socket on import; keep it inert.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ ImportExport } = await import('../src/io/ImportExport'))
  ;({ useTwinStore } = await import('../src/state/store'))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(send: (cmd: Command) => Promise<void>) {
  const plan: Plan = { ...createDefaultPlan(), name: 'Hall A' }
  const spy = vi.fn(send)
  useTwinStore.setState({ plan, send: spy })
  render(<ImportExport />)
  return { plan, send: spy }
}

function pick(json: string, name = 'upload.json') {
  const input = screen.getByLabelText('Import file')
  fireEvent.change(input, { target: { files: [new File([json], name, { type: 'application/json' })] } })
}

describe('plan import and export', () => {
  it('import shows path: problem errors from server and keeps current plan', async () => {
    const { plan, send } = setup(() =>
      Promise.reject(new Error('hall.widthM: Too small: expected number to be >0\nschemaVersion: Invalid input: expected 1')),
    )
    pick(JSON.stringify({ schemaVersion: 2, hall: { widthM: -1 } }), 'future.json')

    const alert = await screen.findByRole('alert')
    expect(send).toHaveBeenCalledWith({ type: 'importPlan', payload: { plan: { schemaVersion: 2, hall: { widthM: -1 } } } })
    expect(within(alert).getByText('future.json was not imported. Your current plan is unchanged.')).toBeTruthy()
    const rows = within(alert).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['hall.widthM: Too small: expected number to be >0', 'schemaVersion: Invalid input: expected 1'])
    expect(useTwinStore.getState().plan).toBe(plan)
  })

  it('import of a file that is not JSON never reaches the server', async () => {
    const { send } = setup(() => Promise.resolve())
    pick('{ "name": ', 'broken.json')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/broken.json is not valid JSON/)).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
  })

  it('export downloads plan JSON named <plan-name>.json', async () => {
    const { plan } = setup(() => Promise.resolve())
    let blob: Blob | undefined
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b
      return 'blob:plan'
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Export plan' }))

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('Hall A.json')
    expect(clicked[0].href).toBe('blob:plan')
    expect(blob?.type).toBe('application/json')
    expect(JSON.parse(await blob!.text())).toEqual(plan)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:plan')
  })

  it('catalog pack import (array of entries) adds each via addCatalogEntry', async () => {
    const { send } = setup((cmd) =>
      (cmd.payload as { entry: { id: string } }).entry.id === 'coolant.bad'
        ? Promise.reject(new Error('payload.entry.cpJPerKgK: Invalid input'))
        : Promise.resolve(),
    )
    const coolant = (id: string) => ({ id, kind: 'coolant', name: id, asOf: '2026-10-18', summary: '' })
    pick(JSON.stringify([coolant('coolant.a'), coolant('coolant.b'), coolant('coolant.bad')]), 'pack.json')

    const alert = await screen.findByRole('alert')
    expect(send.mock.calls.map(([c]) => [c.type, (c.payload as { entry: { id: string } }).entry.id])).toEqual([
      ['addCatalogEntry', 'coolant.a'],
      ['addCatalogEntry', 'coolant.b'],
      ['addCatalogEntry', 'coolant.bad'],
    ])
    expect(within(alert).getByText('Added 2 of 3 entries from pack.json.')).toBeTruthy()
    expect(within(alert).getByRole('listitem').textContent).toBe('coolant.bad: cpJPerKgK: Invalid input')
  })

  it('a pack entry already in the plan as a custom entry is updated', async () => {
    const { plan, send } = setup(() => Promise.resolve())
    const mine = { id: 'coolant.mine', kind: 'coolant' as const, name: 'Mine', asOf: '2026-10-18', summary: '', custom: true,
      cpJPerKgK: { value: 4000, unit: 'J/(kg·K)', basis: 'user' as const }, densityKgM3: { value: 1000, unit: 'kg/m³', basis: 'user' as const },
      viscosityPaS: { value: 0.001, unit: 'Pa·s', basis: 'user' as const }, dielectric: false,
      glycolFraction: { value: 0, unit: 'fraction', basis: 'user' as const }, twoPhase: false }
    useTwinStore.setState({ plan: { ...plan, catalog: { ...plan.catalog, [mine.id]: mine } } })
    pick(JSON.stringify([{ ...mine, name: 'Mine v2' }]), 'pack.json')
    await screen.findByRole('status')
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0].type).toBe('updateCatalogEntry')
    expect(screen.getByRole('status').textContent).toContain('Updated 1 entry from pack.json.')
  })
})
