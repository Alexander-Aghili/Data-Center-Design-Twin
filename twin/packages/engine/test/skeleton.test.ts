import { createDefaultPlan } from '@twin/catalog'
import { CLIMATE, EvaluationSchema, RULE_KEYS, qty, type Builtins, type CatalogEntry, type Rules } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { evaluate, makeCatalogIndex } from '../src'

const climate: CatalogEntry = {
  id: CLIMATE.DALLAS,
  kind: 'climate',
  name: 'Dallas',
  asOf: '2026-10-18',
  summary: 'Flat test climate',
  city: 'Dallas',
  lat: 32.8,
  lon: -96.8,
  dryBulbC: Array.from({ length: 8760 }, () => 20),
  wetBulbC: Array.from({ length: 8760 }, () => 15),
  designDryBulbC: qty(38, '°C', 'estimate', { note: 'test value' }),
}
const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, qty(1, '-', 'estimate', { note: 'test value' })])) as Rules
const builtins: Builtins = { entries: [climate], rules }

describe('engine skeleton', () => {
  it('evaluate returns a schema-valid evaluation', () => {
    const evaluation = evaluate(createDefaultPlan(), builtins)
    expect(EvaluationSchema.safeParse(evaluation).success).toBe(true)
  })

  it('evaluate without the climate preset returns an empty evaluation', () => {
    const evaluation = evaluate(createDefaultPlan(), { entries: [], rules })
    expect(evaluation.checks).toEqual([])
    expect(evaluation.headline.pueAnnual).toBeNull()
    expect(evaluation.network.baseLatencyNs).toBeNull()
  })

  it('makeCatalogIndex lets later entries win and filters by kind', () => {
    const custom = { ...climate, name: 'Dallas (custom)', custom: true }
    const index = makeCatalogIndex([climate, custom])
    expect(index.get(CLIMATE.DALLAS)?.name).toBe('Dallas (custom)')
    expect(index.get(CLIMATE.DALLAS, 'climate')?.city).toBe('Dallas')
    expect(index.get(CLIMATE.DALLAS, 'rack')).toBeUndefined()
    expect(index.all()).toHaveLength(1)
  })
})
