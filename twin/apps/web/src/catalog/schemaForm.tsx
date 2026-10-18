import {
  CatalogEntryInputSchema,
  CatalogEntrySchema,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_REQUIRED_PARAMS,
  type CatalogEntry,
  type CatalogKind,
  type EquipmentCategory,
  type Quantity,
} from '@twin/schema'
import { z } from 'zod'

/** Kinds that get a generated form. Climate presets hold 8,760-hour series and come in through catalog packs. */
export const FORM_KINDS = ['gpu', 'rack', 'rackCooling', 'heatRejection', 'coolant', 'equipment'] as const
export type FormKind = (typeof FORM_KINDS)[number]

export function isFormKind(kind: CatalogKind): kind is FormKind {
  return (FORM_KINDS as readonly string[]).includes(kind)
}

/**
 * Written labels and units, keyed by field name (nested fields by dotted path, equipment params by param name).
 * Units are the ones the built-in catalog stores; the entry form test checks them against the data.
 */
const FIELDS: Record<string, { label: string; unit?: string }> = {
  id: { label: 'ID' },
  name: { label: 'Name' },
  vendor: { label: 'Vendor' },
  asOf: { label: 'As of' },
  summary: { label: 'Summary' },
  category: { label: 'Category' },
  // gpu
  tdpW: { label: 'Thermal design power', unit: 'W' },
  fp8Pflops: { label: 'FP8 compute', unit: 'PFLOPS' },
  fp4Pflops: { label: 'FP4 compute', unit: 'PFLOPS' },
  hbmGb: { label: 'HBM memory', unit: 'GB' },
  cooling: { label: 'Cooling' },
  // rack
  role: { label: 'Role' },
  gpuId: { label: 'GPU' },
  gpuCount: { label: 'GPU count' },
  nominalPowerW: { label: 'Nominal power', unit: 'W' },
  peakPowerW: { label: 'Peak power', unit: 'W' },
  weightKg: { label: 'Weight', unit: 'kg' },
  widthMm: { label: 'Width', unit: 'mm' },
  depthMm: { label: 'Depth', unit: 'mm' },
  heightMm: { label: 'Height', unit: 'mm' },
  slotsWide: { label: 'Slots wide' },
  feet: { label: 'Feet' },
  maxLiquidFraction: { label: 'Max liquid-cooled share', unit: 'fraction' },
  maxCoolantSupplyC: { label: 'Max coolant supply', unit: '°C' },
  supportedCooling: { label: 'Supported cooling' },
  supportedPower: { label: 'Supported power' },
  scaleOutPorts: { label: 'Scale-out ports' },
  portGbps: { label: 'Port speed', unit: 'Gbit/s' },
  trays: { label: 'Trays' },
  'trays.compute': { label: 'Compute trays' },
  'trays.switch': { label: 'Switch trays' },
  'trays.power': { label: 'Power trays' },
  capexUsd: { label: 'Capex', unit: 'USD' },
  leadTimeWeeks: { label: 'Lead time', unit: 'week' },
  // rackCooling
  maxRackW: { label: 'Max heat per rack', unit: 'W' },
  toTechnicalLoop: { label: 'Heat to technical loop', unit: 'fraction' },
  toFacilityWaterAtRack: { label: 'Heat to facility water at rack', unit: 'fraction' },
  coolantId: { label: 'Coolant' },
  supplyRangeC: { label: 'Supply temperature range' },
  'supplyRangeC.min': { label: 'Lowest supply', unit: '°C' },
  'supplyRangeC.max': { label: 'Highest supply', unit: '°C' },
  deltaTK: { label: 'Loop temperature rise', unit: 'K' },
  pressureDropKpa: { label: 'Pressure drop', unit: 'kPa' },
  addedWeightKgPerRack: { label: 'Added weight per rack', unit: 'kg' },
  formFactor: { label: 'Form factor' },
  tankFootprintM2PerRack: { label: 'Tank footprint per rack', unit: 'm²' },
  requiresCdu: { label: 'Needs a CDU' },
  pumpPowerFraction: { label: 'Pump power share', unit: 'fraction' },
  capexUsdPerKw: { label: 'Capex per kW', unit: 'USD/kW' },
  installWeeks: { label: 'Install time', unit: 'week' },
  risks: { label: 'Risk topics' },
  status: { label: 'Status' },
  // heatRejection
  basis: { label: 'Rated against' },
  approachK: { label: 'Approach', unit: 'K' },
  copRef: { label: 'Reference COP', unit: 'W/W' },
  copRefOutdoorC: { label: 'Outdoor temperature at reference COP', unit: '°C' },
  copSlopePerK: { label: 'COP change per kelvin', unit: 'W/W/K' },
  economizer: { label: 'Economizer' },
  fanPowerFraction: { label: 'Fan power share', unit: 'fraction' },
  waterLPerKwh: { label: 'Water use', unit: 'L/kWh' },
  adiabaticAboveC: { label: 'Adiabatic assist above', unit: '°C' },
  unitCapacityW: { label: 'Unit capacity', unit: 'W' },
  footprintM2PerMw: { label: 'Footprint per MW', unit: 'm²/MW' },
  // coolant
  cpJPerKgK: { label: 'Specific heat', unit: 'J/(kg·K)' },
  densityKgM3: { label: 'Density', unit: 'kg/m³' },
  viscosityPaS: { label: 'Viscosity', unit: 'Pa·s' },
  dielectric: { label: 'Dielectric' },
  glycolFraction: { label: 'Glycol share', unit: 'fraction' },
  twoPhase: { label: 'Two-phase' },
  // equipment params
  params: { label: 'Parameters' },
  capacityW: { label: 'Capacity', unit: 'W' },
  maxFlowLps: { label: 'Max flow', unit: 'L/s' },
  pumpPowerW: { label: 'Pump power', unit: 'W' },
  airflowM3s: { label: 'Airflow', unit: 'm³/s' },
  fanPowerW: { label: 'Fan power', unit: 'W' },
  capexUsdPerM3: { label: 'Capex per m³', unit: 'USD/m³' },
  ratingA: { label: 'Current rating', unit: 'A' },
  voltageV: { label: 'Voltage', unit: 'V' },
  powerFactor: { label: 'Power factor', unit: '1' },
  capexUsdPerM: { label: 'Capex per meter', unit: 'USD/m' },
  moduleW: { label: 'Module size', unit: 'W' },
  efficiency: { label: 'Efficiency', unit: '1' },
  ratingVa: { label: 'Apparent power rating', unit: 'VA' },
  ports: { label: 'Ports', unit: 'ports' },
  powerW: { label: 'Power', unit: 'W' },
  reachM: { label: 'Reach', unit: 'm' },
  powerWPerEnd: { label: 'Power per end', unit: 'W' },
  // climate (shown in the browser, never in a form)
  city: { label: 'City' },
  lat: { label: 'Latitude' },
  lon: { label: 'Longitude' },
  dryBulbC: { label: 'Hourly dry-bulb' },
  wetBulbC: { label: 'Hourly wet-bulb' },
  designDryBulbC: { label: 'Design dry-bulb', unit: '°C' },
}

function lookup(key: string) {
  return FIELDS[key] ?? FIELDS[key.replace(/^params\./, '')]
}

/** Written label for a field key; unknown keys (e.g. a pack's extra params) fall back to the key split into words. */
export function fieldLabel(key: string): string {
  const leaf = key.split('.').pop() ?? key
  return lookup(key)?.label ?? leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/** Plural names for the browser's kind list and singular nouns for form headings. */
export const KIND_NAMES: Record<CatalogKind, { plural: string; noun: string }> = {
  gpu: { plural: 'GPUs', noun: 'GPU' },
  rack: { plural: 'Rack types', noun: 'rack type' },
  rackCooling: { plural: 'Rack cooling', noun: 'rack cooling method' },
  heatRejection: { plural: 'Heat rejection', noun: 'heat rejection method' },
  coolant: { plural: 'Coolants', noun: 'coolant' },
  equipment: { plural: 'Equipment', noun: 'equipment model' },
  climate: { plural: 'Climate', noun: 'climate preset' },
}

const OPTION_LABELS: Record<string, string> = {
  rdhx: 'Rear-door heat exchanger',
  'dlc-1p': 'Direct-to-chip, single-phase',
  'dlc-2p': 'Direct-to-chip, two-phase',
  'immersion-1p': 'Immersion, single-phase',
  'immersion-2p': 'Immersion, two-phase',
  cdu: 'CDU',
  crah: 'CRAH',
  ups: 'UPS',
  leaf: 'Leaf switch',
  ac54: 'ac54',
  dc800: 'dc800',
}

/** Display text for an enum option: camelCase codes split into words, a few written out in full. */
export function optionLabel(option: string): string {
  const spaced = option.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return OPTION_LABELS[option] ?? spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** How a stored unit reads next to a number. Dimensionless ratios show no unit. */
export function unitText(unit: string): string {
  if (unit === '1') return ''
  if (unit === 'week') return 'weeks'
  if (unit === 'fraction') return '0 to 1'
  return unit
}

/** Label of a schema field; every field a form renders must have a written label. */
function writtenLabel(key: string): string {
  const label = lookup(key)?.label
  if (!label) throw new Error(`No label is written for catalog field "${key}"`)
  return label
}

/** Entry kinds that a reference field points at. */
const REFERENCES: Record<string, CatalogKind> = { gpuId: 'gpu', coolantId: 'coolant' }

interface FieldBase {
  key: string // dotted path into the entry
  label: string
  required: boolean
  group?: string // label of the enclosing object, e.g. "Supply temperature range"
}

export type FieldSpec =
  | (FieldBase & { type: 'text'; multiline: boolean; nonEmpty: boolean })
  | (FieldBase & { type: 'number'; integer: boolean; min?: number; exclusiveMin?: number; unit?: string })
  | (FieldBase & { type: 'boolean' })
  | (FieldBase & { type: 'choice'; options: string[] })
  | (FieldBase & { type: 'choices'; options: string[] })
  | (FieldBase & { type: 'list' })
  | (FieldBase & { type: 'reference'; refKind: CatalogKind })
  | (FieldBase & { type: 'quantity'; unit: string })

/** Form state: one string, boolean or list per field key. */
export type FormValues = Record<string, string | boolean | string[]>

interface JsonSchema {
  type?: string | string[]
  const?: unknown
  enum?: string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  minimum?: number
  exclusiveMinimum?: number
  minLength?: number
  oneOf?: JsonSchema[]
}

const SKIPPED = new Set(['kind', 'custom', 'sources'])

let branches: Map<string, JsonSchema> | undefined

/** The JSON Schema branch of `CatalogEntrySchema` for one kind. */
function branchFor(kind: FormKind): JsonSchema {
  if (!branches) {
    const root = z.toJSONSchema(CatalogEntrySchema, { unrepresentable: 'any' }) as JsonSchema
    branches = new Map((root.oneOf ?? []).map((b) => [String(b.properties?.kind?.const), b]))
  }
  const branch = branches.get(kind)
  if (!branch) throw new Error(`CatalogEntrySchema has no branch for kind "${kind}"`)
  return branch
}

function isQuantity(s: JsonSchema): boolean {
  const p = s.properties
  return Boolean(p && 'value' in p && 'unit' in p && 'basis' in p)
}

function walk(props: Record<string, JsonSchema>, required: string[], prefix: string, group?: string): FieldSpec[] {
  return Object.entries(props).flatMap(([name, s]): FieldSpec[] => {
    if (!prefix && SKIPPED.has(name)) return []
    const key = prefix + name
    const base = { key, label: writtenLabel(key), required: required.includes(name), group }
    if (isQuantity(s)) {
      const unit = lookup(key)?.unit
      if (!unit) throw new Error(`No unit is defined for quantity field "${key}"`)
      return [{ ...base, type: 'quantity', unit }]
    }
    if (s.type === 'object' && s.properties) return walk(s.properties, s.required ?? [], `${key}.`, writtenLabel(key))
    if (s.enum) return [{ ...base, type: 'choice', options: s.enum }]
    if (s.type === 'boolean') return [{ ...base, type: 'boolean' }]
    if (s.type === 'number' || s.type === 'integer') {
      return [{ ...base, type: 'number', integer: s.type === 'integer', min: s.minimum, exclusiveMin: s.exclusiveMinimum, unit: lookup(key)?.unit }]
    }
    if (s.type === 'array' && s.items?.enum) return [{ ...base, type: 'choices', options: s.items.enum }]
    if (s.type === 'array') return [{ ...base, type: 'list' }]
    if (REFERENCES[name]) return [{ ...base, type: 'reference', refKind: REFERENCES[name] }]
    return [{ ...base, type: 'text', multiline: name === 'summary', nonEmpty: (s.minLength ?? 0) > 0 || name === 'asOf' }]
  })
}

/**
 * Form fields for a kind, generated from the `CatalogEntrySchema` JSON Schema in schema order.
 * Equipment params are a free record in the schema, so they expand to the params its category requires.
 */
export function formFields(kind: FormKind, category?: EquipmentCategory): FieldSpec[] {
  const branch = branchFor(kind)
  const fields = walk(branch.properties ?? {}, branch.required ?? [], '')
  if (kind !== 'equipment') return fields
  const params = EQUIPMENT_REQUIRED_PARAMS[category ?? EQUIPMENT_CATEGORIES[0]]
  return fields.flatMap((f): FieldSpec[] => {
    if (f.key !== 'params') return [f]
    return params.map((p) => {
      const unit = lookup(p)?.unit
      if (!unit) throw new Error(`No unit is defined for equipment param "${p}"`)
      return { key: `params.${p}`, label: writtenLabel(p), required: true, group: writtenLabel('params'), type: 'quantity', unit }
    })
  })
}

function getPath(o: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o)
}

function setPath(o: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split('.')
  const last = parts.pop() as string
  let node = o
  for (const p of parts) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {}
    node = node[p] as Record<string, unknown>
  }
  node[last] = value
}

/** Starting values: from an existing entry when duplicating or editing, otherwise empty with today's date. */
export function initialValues(fields: FieldSpec[], from?: CatalogEntry): FormValues {
  const values: FormValues = {}
  for (const f of fields) {
    const v = getPath(from, f.key)
    switch (f.type) {
      case 'quantity': {
        const q = v as Quantity | undefined
        values[f.key] = q && q.value !== null ? String(q.value) : ''
        break
      }
      case 'boolean':
        values[f.key] = v === true
        break
      case 'choices':
        values[f.key] = Array.isArray(v) ? v.map(String) : []
        break
      case 'list':
        values[f.key] = Array.isArray(v) ? v.join(', ') : ''
        break
      case 'choice':
        values[f.key] = typeof v === 'string' ? v : f.required ? f.options[0] : ''
        break
      case 'number':
        values[f.key] = typeof v === 'number' ? String(v) : ''
        break
      default:
        values[f.key] = typeof v === 'string' ? v : f.key === 'asOf' ? new Date().toISOString().slice(0, 10) : ''
    }
  }
  return values
}

export type BuildResult = { ok: true; entry: CatalogEntry } | { ok: false; errors: Record<string, string> }

function parseNumber(raw: string): number | null | 'invalid' {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 'invalid'
}

function splitList(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
}

/** The field a schema or server error path belongs to: the longest field key that prefixes it. */
export function fieldForPath(fields: FieldSpec[], path: string): string | undefined {
  return fields
    .map((f) => f.key)
    .filter((k) => path === k || path.startsWith(`${k}.`))
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * Builds a catalog entry from form values. A quantity the user typed gets basis `user`; one left at the value it
 * was duplicated from keeps its original provenance. An empty quantity is unknown (`value: null`), never 0.
 */
export function buildEntry(kind: FormKind, fields: FieldSpec[], values: FormValues, from?: CatalogEntry): BuildResult {
  const errors: Record<string, string> = {}
  const entry: Record<string, unknown> = { kind, custom: true }
  if (from?.sources) entry.sources = from.sources

  for (const f of fields) {
    const raw = values[f.key]
    switch (f.type) {
      case 'quantity': {
        const n = parseNumber(String(raw ?? ''))
        if (n === 'invalid') {
          errors[f.key] = 'Enter a number, or leave it empty if unknown.'
          break
        }
        const prior = getPath(from, f.key) as Quantity | undefined
        if (prior && prior.value === n) setPath(entry, f.key, prior)
        else if (n !== null || f.required) setPath(entry, f.key, { value: n, unit: f.unit, basis: 'user' })
        break
      }
      case 'number': {
        const n = parseNumber(String(raw ?? ''))
        if (n === null) {
          if (f.required) errors[f.key] = 'Enter a number.'
        } else if (n === 'invalid') errors[f.key] = 'Enter a number.'
        else if (f.integer && !Number.isInteger(n)) errors[f.key] = 'Enter a whole number.'
        else if (f.min !== undefined && n < f.min) errors[f.key] = `Enter ${f.min} or more.`
        else if (f.exclusiveMin !== undefined && n <= f.exclusiveMin) errors[f.key] = `Enter more than ${f.exclusiveMin}.`
        else setPath(entry, f.key, n)
        break
      }
      case 'boolean':
        setPath(entry, f.key, raw === true)
        break
      case 'choices':
        setPath(entry, f.key, Array.isArray(raw) ? raw : [])
        break
      case 'list':
        setPath(entry, f.key, splitList(String(raw ?? '')))
        break
      case 'text': {
        const text = String(raw ?? '').trim()
        if (text) setPath(entry, f.key, text)
        else if (f.nonEmpty) errors[f.key] = 'Required.'
        else if (f.required) setPath(entry, f.key, '')
        break
      }
      default: {
        const text = String(raw ?? '').trim()
        if (text) setPath(entry, f.key, text)
        else if (f.required) errors[f.key] = 'Required.'
      }
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const parsed = CatalogEntryInputSchema.safeParse(entry)
  if (parsed.success) return { ok: true, entry: parsed.data }
  for (const issue of parsed.error.issues) {
    const key = fieldForPath(fields, issue.path.join('.')) ?? ''
    errors[key] ??= issue.message
  }
  return { ok: false, errors }
}
