import { describe, expect, it } from 'vitest'
import { plan } from './fixtures'
import { expectRejected, run } from './helpers'

const note = (target: string) => ({ target, importance: 'must', authorRole: 'cooling', text: 'Keep supply at or above 30 °C so dry coolers work most of the year.' })

describe('addNote', () => {
  it('adds a note with the next id and a timestamp', () => {
    const result = run(plan(), 'addNote', note('decision:cooling.facilitySupplyC'))
    const added = result.plan.notes.at(-1)
    expect(added).toMatchObject({ id: 'note-2', target: 'decision:cooling.facilitySupplyC', importance: 'must', authorRole: 'cooling' })
    expect(Number.isNaN(Date.parse(added!.createdAt))).toBe(false)
    expect(result.summary).toBe('Added note on cooling.facilitySupplyC (must): "Keep supply at or above 30 °C so dry coolers work most of…"')
  })

  it('accepts every target kind', () => {
    for (const target of ['group:g1', 'layer:power', 'rack:R1-00', 'decision:site.gridCapacityW', 'decision:hall.rows']) {
      expect(run(plan(), 'addNote', note(target)).plan.notes).toHaveLength(2)
    }
  })

  it('rejects targets that do not exist', () => {
    expectRejected(plan(), 'addNote', note('decision:cooling.colour'), 'Unknown decision "cooling.colour". Decision paths are plan fields, e.g. cooling.facilitySupplyC.')
    expectRejected(plan(), 'addNote', note('group:g9'), /^Unknown rack group "g9"/)
    expectRejected(plan(), 'addNote', note('layer:plumbing'), 'Unknown layer "plumbing". Layers: site, workload, compute, layout, cooling, power, network')
    expectRejected(plan(), 'addNote', note('rack:R8-00'), /^Unknown rack "R8-00"/)
    expectRejected(plan(), 'addNote', note('cooling'), 'Note target "cooling" must start with decision:, group:, layer: or rack:')
  })
})

describe('editNote and removeNote', () => {
  it('edits text and importance', () => {
    const result = run(plan(), 'editNote', { id: 'note-1', importance: 'must' })
    expect(result.plan.notes[0]).toMatchObject({ importance: 'must', text: 'Water is scarce on this site. Avoid evaporative towers.' })
    expect(result.summary).toBe('Note note-1 changed to must')
    expect(run(plan(), 'editNote', { id: 'note-1', text: 'No towers.' }).summary).toBe('Note note-1 text changed')
    expectRejected(plan(), 'editNote', { id: 'note-1' }, 'editNote needs text, importance or both')
    expectRejected(plan(), 'editNote', { id: 'note-7', text: 'x' }, 'Unknown note "note-7". Notes: note-1')
  })

  it('removes a note', () => {
    const result = run(plan(), 'removeNote', { id: 'note-1' })
    expect(result.plan.notes).toEqual([])
    expect(result.summary).toBe('Removed note note-1 ("Water is scarce on this site. Avoid evaporative towers.")')
  })
})
