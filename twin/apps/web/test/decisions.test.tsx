import { createDefaultPlan } from '@twin/catalog'
import { LAYER_IDS, type Command, type Plan } from '@twin/schema'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The store module opens a socket on import; keep it inert.
vi.hoisted(() => vi.stubGlobal('WebSocket', class { readyState = 0 }))

import { CatalogPicker } from '../src/panels/fields/CatalogPicker'
import { DecisionPanel } from '../src/panels/decisions'
import { NoteEditor } from '../src/panels/notes/NoteEditor'
import { useTwinStore } from '../src/state/store'

let send: ReturnType<typeof vi.fn<(cmd: Command) => Promise<void>>>

function usePlan(plan: Plan) {
  useTwinStore.setState({ plan })
}

beforeEach(() => {
  send = vi.fn(async () => undefined)
  useTwinStore.setState({ plan: createDefaultPlan(), send, activeLayer: 'cooling', selection: null })
})

afterEach(cleanup)

/** The field (or field group) that carries a note target. */
function field(target: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-target="${target}"]`)
  if (!el) throw new Error(`no field for ${target}`)
  return el
}

describe('decision panels', () => {
  it('Cooling panel select heat rejection sends setHeatRejection', async () => {
    render(<DecisionPanel layer="cooling" />)
    const heat = field('decision:cooling.heatRejectionId')
    fireEvent.click(await within(heat).findByRole('button', { name: /change/i }))
    fireEvent.click(within(heat).getByRole('radio', { name: 'Dry cooler' }))
    expect(send).toHaveBeenCalledWith({ type: 'setHeatRejection', payload: { heatRejectionId: 'heatRejection.dry-cooler' } })
  })

  it('CatalogPicker shows basis and key numbers per option (e.g., "Max 40 kW per rack")', async () => {
    render(<CatalogPicker kind="rackCooling" value="rackCooling.dlc-1p" onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /change/i }))
    const air = screen.getByRole('radio', { name: 'Air with hot- or cold-aisle containment' })
    const facts = document.getElementById(air.getAttribute('aria-describedby')!.split(' ')[0]!)!
    const max = [...facts.querySelectorAll('[data-basis]')].find((el) => el.textContent?.startsWith('Max 40\u00a0kW per rack'))
    expect(max?.getAttribute('data-basis')).toBe('press')
    const twoPhase = screen.getByRole('radio', { name: 'Two-phase immersion tank' })
    expect(twoPhase.closest('label')?.textContent).toContain('▲ Stalled')
  })

  it('CatalogPicker disables methods the rack does not support, with the reason', async () => {
    render(<DecisionPanel layer="cooling" />)
    const method = field('decision:rackGroups.g1.coolingMethodId')
    fireEvent.click(await within(method).findByRole('button', { name: /change/i }))
    const dlc = within(method).getByRole('radio', { name: 'Direct-to-chip, single-phase' })
    expect((dlc as HTMLInputElement).disabled).toBe(true)
    expect(dlc.closest('label')?.textContent).toMatch(/✕ HGX B300 air-cooled rack \(2 servers\) takes air or rear door only/)
    expect((within(method).getByRole('radio', { name: 'Active rear-door heat exchanger' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('NoteEditor adds note with importance and authorRole = active layer', () => {
    useTwinStore.setState({ activeLayer: 'power' })
    render(<NoteEditor target="decision:power.redundancy" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Utility asks for 2N on the B feed.' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Must' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(send).toHaveBeenCalledWith({
      type: 'addNote',
      payload: { target: 'decision:power.redundancy', importance: 'must', authorRole: 'power', text: 'Utility asks for 2N on the B feed.' },
    })
  })

  it('every decision field shows a note badge when notes target it', async () => {
    for (const layer of LAYER_IDS) {
      const plan = createDefaultPlan()
      usePlan({ ...plan, notes: [] })
      const { unmount } = render(<DecisionPanel layer={layer} />)
      await screen.findAllByRole('button', { name: /^add a note/i })
      const targets = [...document.querySelectorAll<HTMLElement>('[data-note-target]')].map((el) => el.dataset.noteTarget!)
      expect(targets.length, layer).toBeGreaterThan(1)
      for (const target of targets) {
        expect(within(field(target)).queryByRole('button', { name: /^1 note/ }), target).toBeNull()
      }

      const notes = targets.map((target, i) => ({
        id: `n${i}`,
        target,
        importance: 'fyi' as const,
        authorRole: layer,
        text: `About ${target}`,
        createdAt: plan.updatedAt,
      }))
      act(() => usePlan({ ...plan, notes }))
      for (const target of targets) {
        expect(within(field(target)).getAllByRole('button', { name: /^1 note, for info/ }), target).not.toHaveLength(0)
        expect(field(target).textContent, target).toContain(`About ${target}`)
      }
      unmount()
    }
  })

  it('Layout panel fillRow form validates count against free slots', async () => {
    render(<DecisionPanel layer="layout" />)
    const form = await screen.findByRole('form', { name: 'Place racks' })
    fireEvent.change(within(form).getByLabelText('Row'), { target: { value: 'R1' } })
    // R1 holds 16 racks in slots 0–15, so slots 16–23 are free.
    expect((within(form).getByLabelText('From slot') as HTMLInputElement).value).toBe('16')
    fireEvent.change(within(form).getByLabelText('Count'), { target: { value: '10' } })
    expect(within(form).getByRole('alert').textContent).toContain('Only 8 racks fit from slot 16')
    expect((within(form).getByRole('button', { name: 'Place racks' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(within(form).getByLabelText('From slot'), { target: { value: '3' } })
    expect(within(form).getByRole('alert').textContent).toContain('Slot 3 in R1 is taken')

    fireEvent.change(within(form).getByLabelText('From slot'), { target: { value: '16' } })
    fireEvent.change(within(form).getByLabelText('Count'), { target: { value: '8' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Place racks' }))
    expect(send).toHaveBeenCalledWith({ type: 'fillRow', payload: { groupId: 'g1', rowId: 'R1', from: 16, count: 8 } })
  })

  it('every label in the panels points at a real control', async () => {
    for (const layer of LAYER_IDS) {
      const { unmount } = render(<DecisionPanel layer={layer} />)
      await screen.findAllByRole('button', { name: /^add a note/i })
      for (const label of document.querySelectorAll('label[for]')) {
        const control = document.getElementById(label.getAttribute('for')!)
        expect(control?.tagName, `${layer}: ${label.textContent}`).toMatch(/^(INPUT|SELECT|TEXTAREA|BUTTON)$/)
      }
      for (const el of document.querySelectorAll('[aria-labelledby]')) {
        for (const id of el.getAttribute('aria-labelledby')!.split(' ')) {
          expect(document.getElementById(id), `${layer}: aria-labelledby ${id}`).not.toBeNull()
        }
      }
      unmount()
    }
  })

  it('a field error marks its control invalid and describes it', async () => {
    render(<DecisionPanel layer="cooling" />)
    const supply = within(field('decision:cooling.facilitySupplyC')).getByRole('textbox', { name: 'Facility supply temperature' })
    fireEvent.change(supply, { target: { value: 'warm' } })
    fireEvent.blur(supply)
    expect(supply.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(supply.getAttribute('aria-describedby')!)?.textContent).toContain('Enter a number')

    send.mockRejectedValueOnce(new Error('Overhead piping needs a ceiling of 4 m'))
    const route = within(field('decision:cooling.pipingRoute')).getByRole('radiogroup', { name: 'Piping route' })
    await act(async () => {
      fireEvent.click(within(route).getByRole('radio', { name: 'Overhead' }))
    })
    expect(route.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(route.getAttribute('aria-describedby')!)?.textContent).toContain('Overhead piping needs a ceiling of 4 m')
  })

  it('Layout panel rejects an empty From slot instead of placing at slot 0', async () => {
    render(<DecisionPanel layer="layout" />)
    const form = await screen.findByRole('form', { name: 'Place racks' })
    fireEvent.change(within(form).getByLabelText('From slot'), { target: { value: '' } })
    expect(within(form).getByRole('alert').textContent).toContain('Enter a slot to start from')
    fireEvent.submit(form)
    expect(send).not.toHaveBeenCalled()
  })
})
