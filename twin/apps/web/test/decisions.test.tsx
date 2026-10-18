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

/** Opens the layer card's "More settings". */
function openMore() {
  fireEvent.click(screen.getByRole('button', { name: /^More settings/ }))
}

/** Note targets of the fields shown up front, outside "More settings". */
function upFront(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-note-target]')]
    .filter((el) => !el.closest('[hidden]') && !el.matches('section'))
    .map((el) => el.dataset.noteTarget!)
}

describe('layer cards', () => {
  const ESSENTIALS: Record<string, string[]> = {
    site: ['decision:site.climateId', 'decision:site.gridCapacityW', 'decision:site.waterAllowanceM3PerDay'],
    workload: ['decision:workload.purpose', 'decision:workload.targetPflops'],
    compute: [],
    layout: ['decision:cooling.containment', 'decision:placements'],
    cooling: ['decision:cooling.heatRejectionId', 'decision:cooling.facilitySupplyC', 'decision:cooling.pipingRoute'],
    power: ['decision:power.redundancy', 'decision:power.distribution'],
    network: ['decision:network.fabric', 'decision:network.oversubscription'],
  }

  it('each layer shows at most five essentials up front and keeps every other field behind More settings', async () => {
    for (const layer of LAYER_IDS) {
      const { unmount } = render(<DecisionPanel layer={layer} />)
      await screen.findAllByRole('button', { name: /^add a note/i })
      expect(upFront(), layer).toEqual(ESSENTIALS[layer])
      const more = screen.queryByRole('button', { name: /^More settings/ })
      if (more) {
        expect(more.getAttribute('aria-expanded')).toBe('false')
        const body = document.getElementById(more.getAttribute('aria-controls')!)!
        expect(body.hidden, layer).toBe(true)
        expect(body.querySelectorAll('[data-note-target]').length, layer).toBeGreaterThan(0)
        fireEvent.click(more)
        expect(more.getAttribute('aria-expanded')).toBe('true')
        expect(body.hidden, layer).toBe(false)
      } else {
        expect(layer).toBe('workload')
      }
      unmount()
    }
  })

  it('a closed More settings counts the notes on the fields inside it', async () => {
    const plan = createDefaultPlan()
    const note = { id: 'n1', target: 'decision:cooling.bufferTankM3', importance: 'must' as const, authorRole: 'cooling' as const, text: 'Keep a tank', createdAt: plan.updatedAt }
    usePlan({ ...plan, notes: [note] })
    render(<DecisionPanel layer="cooling" />)
    expect((await screen.findByRole('button', { name: /^More settings/ })).textContent).toMatch(/1 note, must/)
  })

  it('Compute shows the groups read only and points to the rack bar', async () => {
    render(<DecisionPanel layer="compute" />)
    expect(screen.getByText(/rack bar at the bottom of the scene/)).toBeTruthy()
    const groups = within(screen.getByRole('list', { name: 'Rack groups' })).getAllByRole('listitem')
    expect(groups.map((g) => g.textContent)).toEqual([
      expect.stringContaining('Inference block'),
      expect.stringContaining('Training block'),
    ])
    expect(groups[1]!.textContent).toContain('R3, R4, R5')
    expect(within(groups[1]!).queryByRole('button')).toBeNull()
  })

  it('Layout fills the largest free stretch of a row in one click', async () => {
    render(<DecisionPanel layer="layout" />)
    const quick = await screen.findByRole('form', { name: 'Fill a row' })
    // R1 holds 16 racks in slots 0–15, so slots 16–23 are free.
    fireEvent.click(within(quick).getByRole('button', { name: 'Fill R1 with 8 racks' }))
    expect(send).toHaveBeenCalledWith({ type: 'fillRow', payload: { groupId: 'g1', rowId: 'R1', from: 16, count: 8 } })
  })

  it('Details shows the catalog facts of a picker with their basis', async () => {
    render(<DecisionPanel layer="cooling" />)
    const heat = field('decision:cooling.heatRejectionId')
    expect(heat.querySelector('[data-basis]')).toBeNull()
    const details = within(heat).getByRole('button', { name: 'Details Heat rejection' })
    expect(details.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(details)
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(heat.querySelectorAll('[data-basis]').length).toBeGreaterThan(1)
    expect(heat.textContent).toMatch(/lead time/)
  })
})

describe('decision panels', () => {
  it('Cooling panel select heat rejection sends setHeatRejection', async () => {
    render(<DecisionPanel layer="cooling" />)
    const heat = field('decision:cooling.heatRejectionId')
    fireEvent.click(await within(heat).findByRole('button', { name: /change/i }))
    fireEvent.click(within(heat).getByRole('radio', { name: 'Dry cooler' }))
    expect(send).toHaveBeenCalledWith({ type: 'setHeatRejection', payload: { heatRejectionId: 'heatRejection.dry-cooler' } })
  })

  it('Compute panel: a new rack type opens a rack of that group and pushes in on a GPU', async () => {
    const dispatchView = vi.fn()
    useTwinStore.setState({ dispatchView })
    render(<DecisionPanel layer="compute" />)
    openMore()
    const rackType = field('decision:rackGroups.g2.rackTypeId')
    fireEvent.click(await within(rackType).findByRole('button', { name: /change/i }))
    await act(async () => fireEvent.click(within(rackType).getByRole('radio', { name: /GB300 NVL72/ })))
    expect(send).toHaveBeenCalledWith({ type: 'setRackType', payload: { groupId: 'g2', rackTypeId: 'rack.gb300-nvl72' } })
    const group = createDefaultPlan().placements.filter((p) => p.groupId === 'g2')
    const middle = group[Math.floor(group.length / 2)]!
    expect(dispatchView).toHaveBeenCalledWith({ type: 'focus', target: { kind: 'rack', id: middle.id }, shot: 'gpu' })
  })

  it('CatalogPicker shows basis and key numbers per option (e.g., "Max 40 kW per rack")', async () => {
    render(<CatalogPicker kind="rackCooling" value="rackCooling.dlc-1p" onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /change/i }))
    // Collapsed, each option shows its deciding number only.
    const collapsed = screen.getByRole('radio', { name: 'Air with hot- or cold-aisle containment' })
    expect(document.getElementById(collapsed.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe('Max 40\u00a0kW per rack')
    fireEvent.click(screen.getByRole('button', { name: /details/i }))
    const air = screen.getByRole('radio', { name: 'Air with hot- or cold-aisle containment' })
    const facts = document.getElementById(air.getAttribute('aria-describedby')!.split(' ')[0]!)!
    const max = [...facts.querySelectorAll('[data-basis]')].find((el) => el.textContent?.startsWith('Max 40\u00a0kW per rack'))
    expect(max?.getAttribute('data-basis')).toBe('press')
    const twoPhase = screen.getByRole('radio', { name: 'Two-phase immersion tank' })
    expect(twoPhase.closest('label')?.textContent).toContain('▲ Stalled')
  })

  it('CatalogPicker disables methods the rack does not support, with the reason', async () => {
    render(<DecisionPanel layer="cooling" />)
    openMore()
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
      if (layer !== 'workload') openMore()
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
    openMore()
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
      if (layer !== 'workload') openMore()
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
    const supply = within(field('decision:cooling.facilitySupplyC')).getByRole('textbox', { name: 'Supply water temperature' })
    fireEvent.change(supply, { target: { value: 'warm' } })
    fireEvent.blur(supply)
    expect(supply.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(supply.getAttribute('aria-describedby')!)?.textContent).toContain('Enter a number')

    send.mockRejectedValueOnce(new Error('Overhead piping needs a ceiling of 4 m'))
    const route = within(field('decision:cooling.pipingRoute')).getByRole('radiogroup', { name: 'Pipe route' })
    await act(async () => {
      fireEvent.click(within(route).getByRole('radio', { name: 'Overhead' }))
    })
    expect(route.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(route.getAttribute('aria-describedby')!)?.textContent).toContain('Overhead piping needs a ceiling of 4 m')
  })

  it('oversubscription fields keep to the command ranges (power 1 to 2, network 1 to 8)', () => {
    const cases = [
      { layer: 'power', target: 'decision:power.oversubscription', name: 'Busway oversubscription', low: '0.5', high: '2.5', ok: '1.2', max: 2 },
      { layer: 'network', target: 'decision:network.oversubscription', name: 'Leaf oversubscription', low: '0.5', high: '16', ok: '2', max: 8 },
    ] as const
    for (const c of cases) {
      const { unmount } = render(<DecisionPanel layer={c.layer} />)
      if (c.layer === 'power') openMore()
      const input = within(field(c.target)).getByRole('textbox', { name: c.name })
      const message = () => document.getElementById(input.getAttribute('aria-describedby')!)?.textContent
      fireEvent.change(input, { target: { value: c.low } })
      fireEvent.blur(input)
      expect(message()).toContain('Enter 1 or more')
      fireEvent.change(input, { target: { value: c.high } })
      fireEvent.blur(input)
      expect(message()).toContain(`Enter ${c.max} or less`)
      expect(send).not.toHaveBeenCalled()
      fireEvent.change(input, { target: { value: c.ok } })
      fireEvent.blur(input)
      expect(send).toHaveBeenCalledTimes(1)
      send.mockClear()
      unmount()
    }
  })

  it('Layout panel rejects an empty From slot instead of placing at slot 0', async () => {
    render(<DecisionPanel layer="layout" />)
    openMore()
    const form = await screen.findByRole('form', { name: 'Place racks' })
    fireEvent.change(within(form).getByLabelText('From slot'), { target: { value: '' } })
    expect(within(form).getByRole('alert').textContent).toContain('Enter a slot to start from')
    fireEvent.submit(form)
    expect(send).not.toHaveBeenCalled()
  })
})
