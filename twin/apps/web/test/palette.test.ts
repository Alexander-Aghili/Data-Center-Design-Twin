import { describe, expect, it } from 'vitest'
import { PALETTE, tempColor } from '../src/scene/palette'

/** Relative luminance (WCAG) of a #RRGGBB color. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => lin(c / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Spread between the largest and smallest channel: 0 for a gray. */
function channelSpread(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return Math.max(...c) - Math.min(...c)
}

describe('tempColor', () => {
  it('runs supply blue → return amber → heat red and clamps', () => {
    expect(tempColor(18, 18, 48)).toBe(PALETTE.supply)
    expect(tempColor(33, 18, 48)).toBe(PALETTE.return)
    expect(tempColor(48, 18, 48)).toBe(PALETTE.heat)
    expect(tempColor(80, 18, 48)).toBe(PALETTE.heat)
    expect(tempColor(0, 18, 48)).toBe(PALETTE.supply)
  })

  it('crosses from blue to amber through a pale cool stop, not a dark gray-mauve', () => {
    expect(tempColor(25.5, 18, 48)).toBe(PALETTE.tempMid)
    const supplyLum = luminance(PALETTE.supply)
    for (let c = 18.5; c < 33; c += 0.5) {
      // An RGB blend of the two near-complementary hues dips to a dull gray-mauve near 25 °C.
      expect(luminance(tempColor(c, 18, 48)), `${c} °C`).toBeGreaterThan(supplyLum)
    }
    // The pale stop is a tinted neutral: lighter than both hues, but not a flat gray.
    expect(luminance(PALETTE.tempMid)).toBeGreaterThan(luminance(PALETTE.return))
    expect(channelSpread(PALETTE.tempMid)).toBeGreaterThan(16)
  })

  it('interpolates in OKLab: the warm leg keeps its chroma instead of an RGB midpoint', () => {
    // Halfway between return amber and heat red; an RGB blend gives #D96A2A.
    expect(tempColor(40.5, 18, 48)).toBe('#DB6A2B')
  })

  it('handles an empty range and non-finite input', () => {
    expect(tempColor(20, 20, 20)).toBe(PALETTE.supply)
    expect(tempColor(Number.NaN, 18, 48)).toBe(PALETTE.supply)
  })
})
