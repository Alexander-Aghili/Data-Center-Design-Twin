import { describe, expect, it } from 'vitest'
import { fmtFlow, fmtMass, fmtMoney, fmtNull, fmtNumber, fmtPct, fmtPower, fmtValue, fmtWeeks } from '../src/format'

const nb = ' '

describe('format helpers', () => {
  it('fmtPower picks W, kW or MW and separates the unit with a non-breaking space', () => {
    expect(fmtPower(9_400_000)).toBe(`9.4${nb}MW`)
    expect(fmtPower(10_000_000)).toBe(`10.0${nb}MW`)
    expect(fmtPower(132_000)).toBe(`132${nb}kW`)
    expect(fmtPower(40_500)).toBe(`40.5${nb}kW`)
    expect(fmtPower(850)).toBe(`850${nb}W`)
    expect(fmtPower(0)).toBe(`0${nb}W`)
  })

  it('fmtNull shows an em dash for unknown values and formats the rest', () => {
    expect(fmtNull(null, fmtPower)).toBe('—')
    expect(fmtNull(undefined, fmtPower)).toBe('—')
    expect(fmtNull(1.234, (n) => fmtNumber(n, 2))).toBe('1.23')
  })

  it('formats mass, flow, money, weeks and percentages for display', () => {
    expect(fmtMass(850)).toBe(`850${nb}kg`)
    expect(fmtMass(1_360)).toBe(`1.4${nb}t`)
    expect(fmtMass(412_000)).toBe(`412${nb}t`)
    expect(fmtFlow(2.5)).toBe(`150${nb}L/min`)
    expect(fmtFlow(0.12)).toBe(`7.2${nb}L/min`)
    expect(fmtMoney(6_100_000)).toBe('$6.1M')
    expect(fmtMoney(184_000_000)).toBe('$184M')
    expect(fmtMoney(950_000)).toBe('$950K')
    expect(fmtMoney(1_250_000_000)).toBe('$1.25B')
    expect(fmtMoney(420)).toBe('$420')
    expect(fmtMoney(-4_800_000)).toBe('−$4.8M')
    expect(fmtWeeks(14)).toBe(`14${nb}weeks`)
    expect(fmtWeeks(1)).toBe(`1${nb}week`)
    expect(fmtPct(3.3)).toBe('330%')
    expect(fmtPct(0.914)).toBe('91%')
    expect(fmtNumber(23_040)).toBe('23,040')
  })

  it('fmtValue converts engine SI units to display units', () => {
    expect(fmtValue(9_400_000, 'W')).toBe(`9.4${nb}MW`)
    expect(fmtValue(2.5, 'L/s')).toBe(`150${nb}L/min`)
    expect(fmtValue(1_360, 'kg')).toBe(`1.4${nb}t`)
    expect(fmtValue(6_100_000, 'USD')).toBe('$6.1M')
    expect(fmtValue(0.91, 'ratio')).toBe('91%')
    expect(fmtValue(71, '%')).toBe('71%')
    expect(fmtValue(18, '°C')).toBe(`18.0${nb}°C`)
    expect(fmtValue(7.2, 'kN/m²')).toBe(`7.2${nb}kN/m²`)
    expect(fmtValue(null, 'W')).toBe('—')
    expect(fmtValue(1.38, '')).toBe('1.38')
  })
})
