import { describe, expect, it } from 'vitest'
import { PIPE_FILL_S, pipeFillAt } from '../src/scene/overlays/pipeFill'

describe('pipe fill transition', () => {
  it('runs from empty to full over the fill time, easing out, and clamps', () => {
    expect(pipeFillAt(0)).toBe(0)
    expect(pipeFillAt(PIPE_FILL_S)).toBe(1)
    expect(pipeFillAt(PIPE_FILL_S * 3)).toBe(1)
    expect(pipeFillAt(-1)).toBe(0)
    const half = pipeFillAt(PIPE_FILL_S / 2)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
  })
})
