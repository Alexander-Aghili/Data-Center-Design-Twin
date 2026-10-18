import { describe, expect, it } from 'vitest'
import { History } from '../src'
import { plan } from './fixtures'
import { run } from './helpers'

describe('History', () => {
  it('History undo/redo round-trip and push clears redo', () => {
    const p0 = plan()
    const history = new History(p0)
    expect(history.canUndo).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.last).toBeUndefined()

    const a = run(p0, 'renamePlan', { name: 'A' })
    history.push(a.plan, a.summary)
    const b = run(a.plan, 'renamePlan', { name: 'B' })
    history.push(b.plan, b.summary)
    expect(history.current).toBe(b.plan)
    expect(history.last).toBe('Plan renamed to "B"')

    expect(history.undo()).toBe(a.plan)
    expect(history.last).toBe('Plan renamed to "A"')
    expect(history.undo()).toBe(p0)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.redo()).toBe(a.plan)
    expect(history.current).toBe(a.plan)

    const c = run(a.plan, 'renamePlan', { name: 'C' })
    history.push(c.plan, c.summary)
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toBeNull()
    expect(history.current).toBe(c.plan)
  })

  it('keeps at most 200 undo steps', () => {
    const p0 = plan()
    const history = new History(p0)
    const plans = Array.from({ length: 205 }, (_, i) => ({ ...p0, name: `P${i}` }))
    for (const p of plans) history.push(p, p.name)
    let steps = 0
    while (history.undo()) steps++
    expect(steps).toBe(200)
    expect(history.current).toBe(plans[4])
  })
})
