import { loadBuiltins } from '@twin/catalog'
import { EQUIPMENT_CATEGORIES, type CatalogEntry, type Command, type RackCoolingEntry } from '@twin/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CatalogBrowser as CatalogBrowserType } from '../src/catalog/CatalogBrowser'
import type { EntryForm as EntryFormType } from '../src/catalog/EntryForm'
import type { FORM_KINDS as FormKinds, fieldLabel as FieldLabel, formFields as FormFields } from '../src/catalog/schemaForm'
import type { useTwinStore as UseTwinStore } from '../src/state/store'

let EntryForm: typeof EntryFormType
let CatalogBrowser: typeof CatalogBrowserType
let FORM_KINDS: typeof FormKinds
let formFields: typeof FormFields
let fieldLabel: typeof FieldLabel
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  // The store module opens the app's socket on import; keep it inert.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ EntryForm } = await import('../src/catalog/EntryForm'))
  ;({ CatalogBrowser } = await import('../src/catalog/CatalogBrowser'))
  ;({ FORM_KINDS, formFields, fieldLabel } = await import('../src/catalog/schemaForm'))
  ;({ useTwinStore } = await import('../src/state/store'))
})

afterEach(cleanup)

const builtinEntries = (): CatalogEntry[] => loadBuiltins().entries

function mockSend(impl: (cmd: Command) => Promise<void> = () => Promise.resolve()) {
  const send = vi.fn(impl)
  useTwinStore.setState({ send })
  return send
}

function fieldOf(label: string): HTMLElement {
  const input = screen.getByLabelText(label, { exact: true })
  const field = input.closest('[data-field]')
  if (!(field instanceof HTMLElement)) throw new Error(`no field wrapper for ${label}`)
  return field
}

describe('schema-driven entry form', () => {
  it('EntryForm generated for rackCooling has every required field with unit labels', () => {
    render(<EntryForm intent={{ type: 'add', kind: 'rackCooling' }} existingIds={new Set()} references={[]} onDone={() => {}} onCancel={() => {}} />)
    const required = ['id', 'name', 'asOf', 'summary', 'category', 'maxRackW', 'toTechnicalLoop', 'supplyRangeC.min', 'supplyRangeC.max',
      'deltaTK', 'pressureDropKpa', 'addedWeightKgPerRack', 'formFactor', 'requiresCdu', 'pumpPowerFraction', 'capexUsdPerKw',
      'installWeeks', 'leadTimeWeeks', 'risks', 'status']
    for (const key of required) {
      const field = fieldOf(fieldLabel(key))
      expect(within(field).queryByText('optional'), key).toBeNull()
    }
    expect(within(fieldOf('Max heat per rack')).getByText('W')).toBeTruthy()
    expect(within(fieldOf('Pressure drop')).getByText('kPa')).toBeTruthy()
    expect(within(fieldOf('Capex per kW')).getByText('USD/kW')).toBeTruthy()
    expect(within(fieldOf('Lowest supply')).getByText('°C')).toBeTruthy()
    expect(within(fieldOf('Lead time')).getByText('weeks')).toBeTruthy()
    expect(within(fieldOf('Heat to facility water at rack')).getByText('optional')).toBeTruthy()
  })

  it('every form field has a written label and unit, and the units match the built-in catalog', () => {
    const units = new Map<string, string>()
    for (const kind of FORM_KINDS) {
      const categories = kind === 'equipment' ? EQUIPMENT_CATEGORIES : [undefined]
      for (const category of categories) {
        // formFields throws when a field has no written label or a quantity has no unit.
        for (const f of formFields(kind, category)) {
          if (f.type === 'quantity') units.set(f.key.replace(/^params\./, ''), f.unit)
        }
      }
    }
    for (const entry of builtinEntries()) {
      const walk = (o: unknown, key: string) => {
        if (!o || typeof o !== 'object' || Array.isArray(o)) return
        if ('unit' in o && 'basis' in o) {
          if (units.has(key)) expect(o.unit, `${entry.id} ${key}`).toBe(units.get(key))
          return
        }
        for (const [k, v] of Object.entries(o)) walk(v, key && key !== 'params' ? `${key}.${k}` : k)
      }
      walk(entry, '')
    }
  })

  it('submit builds Quantity with basis user', async () => {
    const send = mockSend()
    const onDone = vi.fn()
    const from: RackCoolingEntry = {
      id: 'rackCooling.rdhx-test',
      kind: 'rackCooling',
      name: 'Rear door',
      asOf: '2026-10-18',
      summary: 'A rear door.',
      category: 'rdhx',
      maxRackW: { value: 50000, unit: 'W', basis: 'vendor', source: 'https://example.com/rdhx' },
      toTechnicalLoop: { value: 0, unit: 'fraction', basis: 'textbook' },
      supplyRangeC: { min: { value: 14, unit: '°C', basis: 'textbook' }, max: { value: 24, unit: '°C', basis: 'textbook' } },
      deltaTK: { value: 6, unit: 'K', basis: 'textbook' },
      pressureDropKpa: { value: 40, unit: 'kPa', basis: 'textbook' },
      addedWeightKgPerRack: { value: 90, unit: 'kg', basis: 'textbook' },
      formFactor: 'rack',
      requiresCdu: true,
      pumpPowerFraction: { value: 0.01, unit: 'fraction', basis: 'textbook' },
      capexUsdPerKw: { value: 200, unit: 'USD/kW', basis: 'textbook' },
      installWeeks: { value: 4, unit: 'week', basis: 'textbook' },
      leadTimeWeeks: { value: 16, unit: 'week', basis: 'textbook' },
      risks: ['rear-door-heat-exchangers'],
      status: 'mainstream',
    }
    render(<EntryForm intent={{ type: 'add', kind: 'rackCooling', from }} existingIds={new Set([from.id])} references={[]} onDone={onDone} onCancel={() => {}} />)

    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'rackCooling.rdhx-ours' } })
    fireEvent.change(screen.getByLabelText('Max heat per rack'), { target: { value: '62000' } })
    fireEvent.change(screen.getByLabelText('Pressure drop'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(send).toHaveBeenCalledTimes(1)
    const cmd = send.mock.calls[0][0]
    expect(cmd.type).toBe('addCatalogEntry')
    const entry = (cmd.payload as { entry: RackCoolingEntry }).entry
    expect(entry).toMatchObject({ id: 'rackCooling.rdhx-ours', kind: 'rackCooling', custom: true, risks: ['rear-door-heat-exchangers'] })
    expect(entry.maxRackW).toEqual({ value: 62000, unit: 'W', basis: 'user' })
    expect(entry.pressureDropKpa).toEqual({ value: null, unit: 'kPa', basis: 'user' })
    // Untouched values keep their original provenance.
    expect(entry.deltaTK).toEqual({ value: 6, unit: 'K', basis: 'textbook' })
  })

  it('duplicate id rejected inline', () => {
    const send = mockSend()
    render(<EntryForm intent={{ type: 'add', kind: 'coolant' }} existingIds={new Set(['coolant.water'])} references={[]} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'coolant.water' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tap water' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(within(fieldOf('ID')).getByText('An entry with ID coolant.water already exists. Pick another ID.')).toBeTruthy()
    expect(screen.getByLabelText('ID').getAttribute('aria-invalid')).toBe('true')
    expect(send).not.toHaveBeenCalled()
  })

  it('maps a server rejection with a payload path onto the field', async () => {
    mockSend(() => Promise.reject(new Error('payload.entry.name: Too small: expected string to have >=1 characters')))
    render(<EntryForm intent={{ type: 'add', kind: 'coolant' }} existingIds={new Set()} references={[]} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'coolant.brine' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Brine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(await within(fieldOf('Name')).findByText('Too small: expected string to have >=1 characters')).toBeTruthy()
  })

  it('catalog browser lists built-in and custom entries and copies one into a prefilled form', async () => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    const builtins = builtinEntries()
    const mine = { ...builtins.find((e) => e.id === 'coolant.water')!, id: 'coolant.site-water', name: 'Site water', custom: true }
    useTwinStore.setState({ plan: { catalog: { [mine.id]: mine } } as never })
    render(<CatalogBrowser kind="coolant" />)

    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    const list = await screen.findByRole('region', { name: 'Coolants entries' })
    await within(list).findByText('Site water')
    const builtInNames = builtins.filter((e) => e.kind === 'coolant').map((e) => e.name).sort((x, y) => x.localeCompare(y))
    const names = within(list).getAllByRole('listitem').map((li) => li.querySelector('.cb-entry-name')?.textContent)
    expect(names).toEqual([...builtInNames, 'Site water'])

    fireEvent.click(within(list).getByText('Treated water'))
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy as custom entry' }))
    expect((screen.getByLabelText('ID') as HTMLInputElement).value).toBe('coolant.water-custom')
    expect((screen.getByLabelText('Specific heat') as HTMLInputElement).value).not.toBe('')
  })
})
