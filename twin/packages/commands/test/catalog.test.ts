import { RACK, RACK_COOLING } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { catalog, customRackInput, plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('addCatalogEntry', () => {
  it('addCatalogEntry forces custom true and basis user on new quantities lacking basis', () => {
    const input = { ...(customRackInput('rack.mine') as object), custom: false }
    const result = run(plan(), 'addCatalogEntry', { entry: input })
    const entry = result.plan.catalog['rack.mine']
    expect(entry?.custom).toBe(true)
    expect(entry?.kind === 'rack' && entry.nominalPowerW).toEqual({ value: 28_000, unit: 'W', basis: 'user' })
    expect(result.summary).toBe('Added custom rack type "My rack" (rack.mine)')
  })

  it('keeps an explicit basis', () => {
    const input = customRackInput('rack.mine') as { weightKg: object }
    input.weightKg = { value: 1000, unit: 'kg', basis: 'estimate', note: 'Scaled from the vendor 8-GPU chassis.' }
    const entry = run(plan(), 'addCatalogEntry', { entry: input }).plan.catalog['rack.mine']
    expect(entry?.kind === 'rack' && entry.weightKg.basis).toBe('estimate')
  })

  it('rejects ids that exist and broken references', () => {
    expectRejected(plan(), 'addCatalogEntry', { entry: customRackInput(RACK.GB300_NVL72) }, 'A catalog entry with id "rack.gb300-nvl72" already exists. Pick a new id, or use updateCatalogEntry to change a custom entry.')
    const withGpu = { ...(customRackInput('rack.mine') as object), gpuId: 'gpu.unknown' }
    expectRejected(plan(), 'addCatalogEntry', { entry: withGpu }, 'gpuId: unknown GPU "gpu.unknown"')
  })

  it('reports schema problems as path: problem', () => {
    expectRejected(plan(), 'addCatalogEntry', { entry: { kind: 'rack', id: 'rack.x' } }, /^payload\.entry\.name: /)
  })
})

describe('updateCatalogEntry', () => {
  it('replaces a custom entry', () => {
    const p = run(plan(), 'addCatalogEntry', { entry: customRackInput('rack.mine') }).plan
    const changed = { ...(customRackInput('rack.mine') as object), name: 'My rack v2' }
    const result = run(p, 'updateCatalogEntry', { entry: changed })
    expect(result.plan.catalog['rack.mine']).toMatchObject({ name: 'My rack v2', custom: true })
    expect(result.summary).toBe('Updated custom rack type "My rack v2" (rack.mine)')
  })

  it('rejects built-ins, unknown ids and kind changes', () => {
    const p = plan()
    p.catalog[RACK.GB300_NVL72] = catalog.get(RACK.GB300_NVL72, 'rack')!
    expectRejected(p, 'updateCatalogEntry', { entry: customRackInput(RACK.GB300_NVL72) }, 'rack.gb300-nvl72 is a built-in entry and cannot be changed. Add a custom copy with a new id instead.')
    expectRejected(plan(), 'updateCatalogEntry', { entry: customRackInput('rack.mine') }, 'No custom catalog entry "rack.mine". Use addCatalogEntry to create it.')
  })

  it('rejects a wider custom rack that no longer fits its placements', () => {
    let p = run(plan(), 'addCatalogEntry', { entry: customRackInput('rack.mine') }).plan
    p = run(p, 'setRackType', { groupId: 'g1', rackTypeId: 'rack.mine' }).plan
    const wide = customRackInput('rack.mine') as { widthMm: { value: number }; slotsWide: number }
    wide.widthMm.value = 1200
    wide.slotsWide = 2
    expectRejected(p, 'updateCatalogEntry', { entry: wide }, /^My rack is 2 slots wide; the placed racks of Inference block would not fit/)
  })
})

describe('removeCatalogEntry', () => {
  it('removes an unused custom entry', () => {
    const p = run(plan(), 'addCatalogEntry', { entry: customRackInput('rack.mine') }).plan
    const result = run(p, 'removeCatalogEntry', { id: 'rack.mine' })
    expect(result.plan.catalog['rack.mine']).toBeUndefined()
    expect(result.summary).toBe('Removed custom rack type "My rack" (rack.mine)')
  })

  it('removeCatalogEntry rejects in-use entry', () => {
    let p = run(plan(), 'addCatalogEntry', { entry: customRackInput('rack.mine') }).plan
    p = run(p, 'createRackGroup', { name: 'Mine', rackTypeId: 'rack.mine', coolingMethodId: RACK_COOLING.AIR_CONTAINED }).plan
    expectRejected(p, 'removeCatalogEntry', { id: 'rack.mine' }, 'rack.mine is in use by rackGroups.g3.rackTypeId. Change those first.')
  })

  it('rejects built-in and unknown entries', () => {
    expectRejected(plan(), 'removeCatalogEntry', { id: RACK.GB300_NVL72 }, 'rack.gb300-nvl72 is a built-in entry and cannot be removed')
    expectRejected(plan(), 'removeCatalogEntry', { id: 'rack.nothing' }, 'No custom catalog entry "rack.nothing"')
  })
})
