import { describe, expect, it } from 'vitest'
import { PALETTE, tempColor } from '../src/scene/palette'

describe('tempColor', () => {
  it('runs supply blue → return amber → heat red and clamps', () => {
    expect(tempColor(18, 18, 48)).toBe(PALETTE.supply)
    expect(tempColor(33, 18, 48)).toBe(PALETTE.return)
    expect(tempColor(48, 18, 48)).toBe(PALETTE.heat)
    expect(tempColor(80, 18, 48)).toBe(PALETTE.heat)
    expect(tempColor(0, 18, 48)).toBe(PALETTE.supply)
  })

  it('handles an empty range and non-finite input', () => {
    expect(tempColor(20, 20, 20)).toBe(PALETTE.supply)
    expect(tempColor(Number.NaN, 18, 48)).toBe(PALETTE.supply)
  })
})
