import { createDefaultPlan, loadBuiltins } from '@twin/catalog'
import { applyCommand } from '@twin/commands'
import { makeCatalogIndex } from '@twin/engine'
import type { Command, Plan, ViewAction } from '@twin/schema'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The store module opens a socket on import; keep it inert.
vi.hoisted(() => vi.stubGlobal('WebSocket', class { readyState = 0 }))

import { RackBar } from '../src/racks/RackBar'
import { gpuShortName } from '../src/racks/rackFacts'
import { useTwinStore } from '../src/state/store'

const catalog = makeCatalogIndex(loadBuiltins().entries)
let send: ReturnType<typeof vi.fn<(cmd: Command) => Promise<void>>>
let dispatchView: ReturnType<typeof vi.fn<(a: ViewAction) => void>>

/** A send that applies the command like the backend does, so the bar sees the new plan. */
function applyingSend() {
  return vi.fn(async (cmd: Command) => {
    const plan = useTwinStore.getState().plan!
    useTwinStore.setState({ plan: applyCommand(plan, cmd, catalog).plan })
  })
}

function usePlan(plan: Plan) {
  useTwinStore.setState({ plan })
}

beforeEach(() => {
  send = applyingSend()
  dispatchView = vi.fn<(a: ViewAction) => void>()
  useTwinStore.setState({ plan: createDefaultPlan(), send, dispatchView, selection: null })
})

afterEach(cleanup)

const bar = () => screen.getByRole('toolbar', { name: 'Rack groups' })
const chip = (name: RegExp) => within(bar()).getByRole('button', { name })

describe('rack bar chips', () => {
  it('shows one chip per rack group with its rack count and GPU, plus a new group chip', () => {
    render(<RackBar />)
    const chips = within(bar()).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['Inference block32 racks, B300', 'Training block48 racks, B300', 'New group'])
  })

  it('names GPUs by their model', () => {
    expect(gpuShortName('NVIDIA B300 (HGX, SXM)')).toBe('B300')
    expect(gpuShortName('AMD Instinct MI455X')).toBe('MI455X')
    expect(gpuShortName('NVIDIA Rubin (VR200)')).toBe('Rubin')
  })

  it('a click focuses the camera on the group’s first rack and marks the chip selected', () => {
    render(<RackBar />)
    fireEvent.click(chip(/Training block/))
    expect(dispatchView).toHaveBeenCalledWith({ type: 'focus', target: { kind: 'rack', id: 'R3-00' } })
    expect(chip(/Training block/).getAttribute('aria-current')).toBe('true')
    expect(chip(/Inference block/).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Training block' })).toBeTruthy()
  })

  it('a group with no racks is selected as a group', async () => {
    const plan = createDefaultPlan()
    usePlan({ ...plan, rackGroups: [...plan.rackGroups, { id: 'g3', name: 'Spare', rackTypeId: 'rack.vr-nvl72', coolingMethodId: 'rackCooling.dlc-1p' }] })
    render(<RackBar />)
    fireEvent.click(chip(/Spare/))
    expect(dispatchView).toHaveBeenCalledWith({ type: 'select', target: { kind: 'group', id: 'g3' } })
  })

  it('a rack selected in the scene marks its group’s chip', () => {
    useTwinStore.setState({ selection: { kind: 'rack', id: 'R1-04' } })
    render(<RackBar />)
    expect(chip(/Inference block/).getAttribute('aria-current')).toBe('true')
  })

  it('arrow keys move between chips, Escape closes the panel and returns focus to the chip', () => {
    render(<RackBar />)
    const first = chip(/Inference block/)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(chip(/Training block/))
    fireEvent.keyDown(chip(/Training block/), { key: 'End' })
    expect(document.activeElement).toBe(chip(/New group/))
    fireEvent.keyDown(chip(/New group/), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(first)
    fireEvent.click(first)
    const dialog = screen.getByRole('dialog', { name: 'Inference block' })
    expect(first.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(first)
  })
})

describe('group panel', () => {
  function openGroup(name: RegExp) {
    render(<RackBar />)
    fireEvent.click(chip(name))
    return screen.getByRole('dialog')
  }

  it('cards show the deciding numbers and mark the current rack type', () => {
    const dialog = openGroup(/Training block/)
    const current = within(dialog).getByRole('button', { name: /HGX B300 air-cooled/ })
    expect(current.getAttribute('aria-pressed')).toBe('true')
    const gb300 = within(dialog).getByRole('button', { name: /GB300 NVL72/ })
    expect(gb300.getAttribute('aria-pressed')).toBe('false')
    expect(gb300.textContent).toContain('72\u00a0GPUs')
    expect(gb300.textContent).toContain('132\u00a0kW')
    expect(gb300.textContent).toContain('1.6\u00a0t')
    expect(gb300.textContent).toContain('B300')
    expect(gb300.textContent).toContain('Direct-to-chip')
  })

  it('a card sends setRackType for the group', async () => {
    const dialog = openGroup(/Training block/)
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /GB300 NVL72/ })))
    expect(send).toHaveBeenCalledWith({ type: 'setRackType', payload: { groupId: 'g2', rackTypeId: 'rack.gb300-nvl72' } })
  })

  it('a rejected rack type shows the reason', async () => {
    send = vi.fn(async () => {
      throw new Error('AMD Helios is 2 slots wide and does not fit in R3')
    })
    useTwinStore.setState({ send })
    const dialog = openGroup(/Training block/)
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /Helios/ })))
    expect(within(dialog).getByRole('alert').textContent).toContain('does not fit in R3')
  })

  it('cooling pills list only the methods the rack takes, and a pill sends setCoolingMethod', async () => {
    const dialog = openGroup(/Training block/)
    const pills = within(dialog).getByRole('group', { name: 'Cooling' })
    expect(within(pills).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Air with hot- or cold-aisle containment',
      // Rated 25 kW, below the HGX rack's 28 kW: offered with a warning mark.
      '▲Passive rear-door heat exchanger',
      'Active rear-door heat exchanger',
    ])
    expect(within(pills).getByRole('button', { name: /Air with/ }).getAttribute('aria-pressed')).toBe('true')
    await act(async () => fireEvent.click(within(pills).getByRole('button', { name: /Active rear-door/ })))
    expect(send).toHaveBeenCalledWith({ type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: 'rackCooling.rdhx-active' } })
  })

  it('after a liquid rack type, only liquid methods remain and the panel asks for one', async () => {
    const dialog = openGroup(/Training block/)
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /GB300 NVL72/ })))
    const pills = within(dialog).getByRole('group', { name: 'Cooling' })
    expect(within(pills).getAllByRole('button').map((b) => b.textContent)).toEqual(['Direct-to-chip, single-phase'])
    expect(dialog.textContent).toContain('Pick a cooling method this rack takes')
  })

  it('renames inline', async () => {
    const dialog = openGroup(/Training block/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    const input = within(dialog).getByRole('textbox', { name: 'Group name' })
    fireEvent.change(input, { target: { value: 'Pretraining' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(send).toHaveBeenCalledWith({ type: 'renameRackGroup', payload: { groupId: 'g2', name: 'Pretraining' } })
  })

  it('delete waits until the group has no racks', async () => {
    const plan = createDefaultPlan()
    const dialog = openGroup(/Training block/)
    const del = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Delete group' })
    expect(del.disabled).toBe(true)
    expect(document.getElementById(del.getAttribute('aria-describedby')!)?.textContent).toBe('Remove its 48 racks first.')
    act(() => usePlan({ ...plan, placements: plan.placements.filter((p) => p.groupId !== 'g2') }))
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' })))
    expect(send).toHaveBeenCalledWith({ type: 'deleteRackGroup', payload: { groupId: 'g2' } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('new group', () => {
  it('creates the group from a card, then places racks in a row with room', async () => {
    render(<RackBar />)
    fireEvent.click(chip(/New group/))
    const dialog = screen.getByRole('dialog', { name: 'New rack group' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Rubin pod' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Vera Rubin NVL72/ }))
    expect(within(dialog).getByRole('button', { name: /Vera Rubin NVL72/ }).getAttribute('aria-pressed')).toBe('true')
    expect(send).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' })))
    expect(send).toHaveBeenCalledWith({
      type: 'createRackGroup',
      payload: { name: 'Rubin pod', rackTypeId: 'rack.vr-nvl72', coolingMethodId: 'rackCooling.dlc-1p' },
    })

    const place = screen.getByRole('dialog', { name: 'Place Rubin pod racks' })
    const rows = within(place).getByRole('group', { name: 'Row' })
    // The default plan fills 16 of 24 slots in R1 to R5 and leaves R6 to R8 empty.
    expect(within(rows).getAllByRole('button').map((b) => b.textContent)).toEqual([
      ...['R1', 'R2', 'R3', 'R4', 'R5'].map((r) => `${r}, 8 free`),
      ...['R6', 'R7', 'R8'].map((r) => `${r}, 24 free`),
    ])
    expect((within(place).getByRole('spinbutton', { name: 'Racks' }) as HTMLInputElement).value).toBe('8')
    fireEvent.click(within(rows).getByRole('button', { name: /R7/ }))
    fireEvent.change(within(place).getByRole('spinbutton', { name: 'Racks' }), { target: { value: '10' } })
    await act(async () => fireEvent.click(within(place).getByRole('button', { name: 'Place racks' })))
    expect(send).toHaveBeenLastCalledWith({ type: 'fillRow', payload: { groupId: 'g3', rowId: 'R7', from: 0, count: 10 } })
    expect(dispatchView).toHaveBeenLastCalledWith({ type: 'focus', target: { kind: 'rack', id: 'R7-00' } })
    expect(screen.getByRole('dialog', { name: 'Rubin pod' })).toBeTruthy()
  })

  it('asks for a name before creating', async () => {
    render(<RackBar />)
    fireEvent.click(chip(/New group/))
    const dialog = screen.getByRole('dialog', { name: 'New rack group' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: '  ' } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' })))
    expect(send).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert').textContent).toBe('✕ Name the group first')
  })

  it('counts double-wide racks against the free slots', async () => {
    render(<RackBar />)
    fireEvent.click(chip(/New group/))
    const dialog = screen.getByRole('dialog', { name: 'New rack group' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Helios' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /AMD Helios/ }))
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' })))
    const place = screen.getByRole('dialog', { name: 'Place Helios racks' })
    const rows = within(place).getByRole('group', { name: 'Row' })
    expect(within(rows).getByRole('button', { name: /R1/ }).textContent).toBe('R1, 4 free')
    fireEvent.click(within(rows).getByRole('button', { name: /R6/ }))
    expect(within(rows).getByRole('button', { name: /R6/ }).textContent).toBe('R6, 12 free')
    expect((within(place).getByRole('spinbutton', { name: 'Racks' }) as HTMLInputElement).value).toBe('12')
  })
})
