import type { Command, Plan } from '@twin/schema'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadBuiltins, snapshotCatalog } from '@twin/catalog'
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

const quantity = (value: number, unit: string) => ({ value, unit, basis: 'user' as const })
const coolant = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'coolant' as const, name: id, asOf: '2026-10-18', summary: '', custom: true,
  cpJPerKgK: quantity(4000, 'J/(kg·K)'), densityKgM3: quantity(1000, 'kg/m³'), viscosityPaS: quantity(0.001, 'Pa·s'),
  dielectric: false, glycolFraction: quantity(0, 'fraction'), twoPhase: false, ...over,
})

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

  it('export downloads the self-contained plan JSON (catalog entries copied in) named <plan-name>.json', async () => {
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
    const exported = JSON.parse(await blob!.text()) as Plan
    // The same document as the server's /api/plan/export: every catalog entry the plan uses is in the file.
    expect(exported).toEqual(snapshotCatalog(plan, loadBuiltins().entries))
    expect(Object.keys(exported.catalog)).toEqual(expect.arrayContaining([plan.site.climateId, plan.cooling.heatRejectionId, plan.rackGroups[0]!.rackTypeId]))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:plan')
  })

  it('catalog pack import adds or updates every entry as one undo step', async () => {
    const sendAll = vi.fn((_: Command[]) => Promise.resolve())
    useTwinStore.setState({ sendAll })
    const { plan } = setup(() => Promise.resolve())
    const mine = coolant('coolant.mine', { custom: true })
    useTwinStore.setState({ plan: { ...plan, catalog: { ...plan.catalog, [mine.id]: mine } } })
    pick(JSON.stringify([coolant('coolant.a'), { ...mine, name: 'Mine v2' }]), 'pack.json')
    await screen.findByRole('status')
    expect(sendAll).toHaveBeenCalledTimes(1)
    expect(sendAll.mock.calls[0]![0].map((c) => [c.type, (c.payload as { entry: { id: string } }).entry.id])).toEqual([
      ['addCatalogEntry', 'coolant.a'],
      ['updateCatalogEntry', 'coolant.mine'],
    ])
    expect(screen.getByRole('status').textContent).toContain('Added or updated 2 entries from pack.json.')
  })

  it('a catalog pack with an invalid entry imports nothing and lists the problems by entry', async () => {
    const sendAll = vi.fn((_: Command[]) => Promise.resolve())
    useTwinStore.setState({ sendAll })
    setup(() => Promise.resolve())
    const { cpJPerKgK: _, ...bad } = coolant('coolant.bad')
    pick(JSON.stringify([coolant('coolant.a'), bad]), 'pack.json')
    const alert = await screen.findByRole('alert')
    expect(sendAll).not.toHaveBeenCalled()
    expect(within(alert).getByText('pack.json was not imported. Your current plan is unchanged.')).toBeTruthy()
    expect(within(alert).getByRole('listitem').textContent).toMatch(/^coolant\.bad: cpJPerKgK: /)
  })
})
