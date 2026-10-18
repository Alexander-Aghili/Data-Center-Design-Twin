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
  /** Pale cool midpoint of the temperature ramp, between supply and return (OKLab L 0.82). */
  tempMid: '#B8C6D2',
  ok: '#2F8F5B',
  warning: '#B7791F',
  clay: { light: '#FBFCFC', mid: '#E3E8EA', dark: '#CDD5D8' },
} as const

type Rgb = [number, number, number]
type Lab = [number, number, number]

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: Rgb): string {
  const byte = (c: number) => Math.round(Math.min(255, Math.max(0, c)))
  return `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** sRGB to OKLab (Björn Ottosson, 2020). */
function toLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map((c) => toLinear(c / 255)) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromLab([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => 255 * fromLinear(Math.min(1, Math.max(0, c)))) as Rgb
}

const mix = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/**
 * Stops at 0, ¼, ½ and 1 of the range. Supply blue and return amber are near-complementary, so any straight blend
 * between them passes through a dull gray; the pale cool stop routes the cold half through light instead.
 */
const STOPS: [number, Lab][] = [
  [0, toLab(toRgb(PALETTE.supply))],
  [0.25, toLab(toRgb(PALETTE.tempMid))],
  [0.5, toLab(toRgb(PALETTE.return))],
  [1, toLab(toRgb(PALETTE.heat))],
]

/** Sequential temperature color, blended in OKLab: supply blue at `min`, return amber halfway, heat red at `max`. */
export function tempColor(c: number, min: number, max: number): string {
  const span = max - min
  const t = span > 0 && Number.isFinite(c) ? Math.min(1, Math.max(0, (c - min) / span)) : 0
  const k = STOPS.findIndex(([at], i) => i > 0 && t <= at)
  const [t0, a] = STOPS[k - 1]!
  const [t1, b] = STOPS[k]!
  return toHex(fromLab(mix(a, b, (t - t0) / (t1 - t0))))
}
