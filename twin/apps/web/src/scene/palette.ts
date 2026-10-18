/** Physics colors from the approved visual direction. Color appears only where physics happens. */
export const PALETTE = {
  paper: '#E6EBEC',
  panel: '#F3F5F5',
  canvas: '#EEF2F2',
  floor: '#D9E0E2',
  ink: '#172026',
  graphite: '#59656C',
  hairline: '#C6CFD3',
  supply: '#2D6CDF',
  return: '#E0922A',
  heat: '#D23B2A',
  ok: '#2F8F5B',
  warning: '#B7791F',
  clay: { light: '#FBFCFC', mid: '#E3E8EA', dark: '#CDD5D8' },
} as const

type Rgb = [number, number, number]

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

const SUPPLY = toRgb(PALETTE.supply)
const RETURN = toRgb(PALETTE.return)
const HEAT = toRgb(PALETTE.heat)

/** Sequential temperature color: supply blue at `min`, return amber halfway, heat red at `max`. */
export function tempColor(c: number, min: number, max: number): string {
  const span = max - min
  const t = span > 0 && Number.isFinite(c) ? Math.min(1, Math.max(0, (c - min) / span)) : 0
  return toHex(t <= 0.5 ? mix(SUPPLY, RETURN, t * 2) : mix(RETURN, HEAT, (t - 0.5) * 2))
}
