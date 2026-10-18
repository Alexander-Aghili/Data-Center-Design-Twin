import { RACK, RACK_COOLING } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { WIDE_RACK, catalog, plan } from './fixtures'
import { expectRejected, run } from './helpers'

describe('createRackGroup', () => {
  it('creates the next group id and reports it', () => {
    const result = run(plan(), 'createRackGroup', { name: 'Liquid block', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P })
    expect(result.plan.rackGroups.at(-1)).toEqual({ id: 'g3', name: 'Liquid block', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P })
    expect(result.summary).toBe('Created rack group g3 "Liquid block" (GB300 NVL72, Single-phase direct-to-chip)')
  })

  it('rejects unknown catalog ids, unsupported cooling and duplicate names', () => {
    expectRejected(plan(), 'createRackGroup', { name: 'X', rackTypeId: 'rack.nope', coolingMethodId: RACK_COOLING.DLC_1P }, /^Unknown rack type "rack\.nope"\. Known rack types: rack\.hgx-b300-air/)
    expectRejected(plan(), 'createRackGroup', { name: 'X', rackTypeId: RACK.GB300_NVL72, coolingMethodId: 'gpu.b300' }, /^Unknown rack cooling method "gpu\.b300"/)
    expectRejected(plan(), 'createRackGroup', { name: 'X', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.AIR_CONTAINED }, 'GB300 NVL72 does not support air cooling (Air with containment). It supports: dlc-1p, dlc-2p.')
    expectRejected(plan(), 'createRackGroup', { name: ' training BLOCK ', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED }, 'A rack group named "Training block" already exists (g2)')
  })
})

describe('setRackType', () => {
  it('switches the rack type and names the rows the group occupies and the entry, from the catalog when the plan has no copy yet', () => {
    const result = run(plan(), 'setRackType', { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 })
    expect(result.plan.rackGroups.find((g) => g.id === 'g2')?.rackTypeId).toBe(RACK.GB300_NVL72)
    expect(result.summary).toBe('Training block (rows R3–R5) set to GB300 NVL72')
  })

  it('names catalog entries already in the plan snapshot', () => {
    const p = plan()
    p.catalog[RACK.GB300_NVL72] = catalog.get(RACK.GB300_NVL72, 'rack')!
    expect(run(p, 'setRackType', { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 }).summary).toBe('Training block (rows R3–R5) set to GB300 NVL72')
  })

  it('setRackType rejects unknown rack id', () => {
    expectRejected(plan(), 'setRackType', { groupId: 'g2', rackTypeId: 'rack.gb200' }, /^Unknown rack type "rack\.gb200"/)
    expectRejected(plan(), 'setRackType', { groupId: 'g2', rackTypeId: RACK_COOLING.DLC_1P }, /^Unknown rack type "rackCooling\.dlc-1p"/)
  })

  it('rejects unknown groups', () => {
    expectRejected(plan(), 'setRackType', { groupId: 'g7', rackTypeId: RACK.GB300_NVL72 }, /^Unknown rack group "g7"/)
  })

  it('rejects a wider rack type that would overlap placed racks', () => {
    expectRejected(
      plan(),
      'setRackType',
      { groupId: 'g2', rackTypeId: WIDE_RACK },
      /^Wide test rack is 2 slots wide; the placed racks of Training block would not fit: Slot R3-01 is taken by R3-00/,
    )
  })
})

describe('renameRackGroup and deleteRackGroup', () => {
  it('renames', () => {
    const result = run(plan(), 'renameRackGroup', { groupId: 'g1', name: 'Serving' })
    expect(result.plan.rackGroups[0]?.name).toBe('Serving')
    expect(result.summary).toBe('Rack group "Inference block" renamed to "Serving"')
  })

  it('deleteRackGroup with placements rejects', () => {
    expectRejected(plan(), 'deleteRackGroup', { groupId: 'g1' }, 'Inference block still has 32 placed racks in rows R1–R2. Remove them with removeRacks first.')
  })

  it('deletes an empty group and its notes', () => {
    let p = run(plan(), 'createRackGroup', { name: 'Spare', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED }).plan
    p = run(p, 'addNote', { target: 'group:g3', importance: 'fyi', authorRole: 'compute', text: 'Hold.' }).plan
    const result = run(p, 'deleteRackGroup', { groupId: 'g3' })
    expect(result.plan.rackGroups.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(result.plan.notes.some((n) => n.target === 'group:g3')).toBe(false)
    expect(result.summary).toBe('Deleted rack group "Spare" and 1 note on it')
  })
})
