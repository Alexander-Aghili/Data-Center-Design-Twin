import { createDefaultPlan } from '@twin/catalog'
import { describe, expect, it } from 'vitest'
import { CatalogEntrySchema, CommandSchemas, PlanSchema, QuantitySchema, qty } from '../src'

const COMMAND_TYPES = [
  'newPlan', 'importPlan', 'renamePlan',
  'setSiteInput', 'setFloor', 'setBayRating',
  'setWorkload',
  'createRackGroup', 'setRackType', 'renameRackGroup', 'deleteRackGroup',
  'placeRacks', 'fillRow', 'moveRack', 'removeRacks', 'setContainment', 'assignZone',
  'setCoolingMethod', 'setHeatRejection', 'setFacilitySupplyTemp', 'setPipingRoute', 'setFlowBalancing', 'setBufferTank',
  'setRedundancy', 'setDistribution', 'setOversubscription',
  'setFabric', 'setNetworkOversubscription',
  'overrideEquipment', 'clearOverride',
  'addNote', 'editNote', 'removeNote',
  'addCatalogEntry', 'updateCatalogEntry', 'removeCatalogEntry',
]

function climate(hours: number) {
  return {
    id: 'climate.test',
    kind: 'climate',
    name: 'Test',
    asOf: '2026-10-18',
    summary: 'Synthetic test climate',
    city: 'Test',
    lat: 0,
    lon: 0,
    dryBulbC: Array.from({ length: hours }, () => 20),
    wetBulbC: Array.from({ length: hours }, () => 15),
    designDryBulbC: qty(38, '°C', 'estimate', { note: 'test value' }),
  }
}

describe('schema', () => {
  it('QuantitySchema rejects vendor without source', () => {
    expect(QuantitySchema.safeParse({ value: 1, unit: 'W', basis: 'vendor' }).success).toBe(false)
    expect(QuantitySchema.safeParse({ value: 1, unit: 'W', basis: 'oem' }).success).toBe(false)
    expect(QuantitySchema.safeParse({ value: 1, unit: 'W', basis: 'vendor', source: 'https://example.com/datasheet' }).success).toBe(true)
  })

  it('QuantitySchema rejects estimate without note', () => {
    expect(QuantitySchema.safeParse({ value: 1, unit: 'W', basis: 'estimate' }).success).toBe(false)
    expect(QuantitySchema.safeParse({ value: 1, unit: 'W', basis: 'estimate', note: 'scaled from B200' }).success).toBe(true)
  })

  it('PlanSchema round-trips createDefaultPlan()', () => {
    const parsed = PlanSchema.parse(createDefaultPlan())
    const again = PlanSchema.parse(JSON.parse(JSON.stringify(parsed)))
    expect(again).toEqual(parsed)
  })

  it('CommandSchemas cover every command type in the table', () => {
    expect(COMMAND_TYPES).toHaveLength(36)
    expect(new Set(Object.keys(CommandSchemas))).toEqual(new Set(COMMAND_TYPES))
  })

  it('climate arrays must be 8760 long', () => {
    expect(CatalogEntrySchema.safeParse(climate(8760)).success).toBe(true)
    expect(CatalogEntrySchema.safeParse(climate(8759)).success).toBe(false)
  })
})
