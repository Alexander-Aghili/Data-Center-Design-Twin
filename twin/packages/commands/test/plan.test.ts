import { CommandError, type Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { customRackInput, plan } from './fixtures'
import { run } from './helpers'

function rejection(p: Plan, type: string, payload: unknown): CommandError {
  const before = structuredClone(p)
  try {
    run(p, type, payload)
  } catch (e) {
    expect(e).toBeInstanceOf(CommandError)
    expect(p).toEqual(before)
    return e as CommandError
  }
  throw new Error('expected the command to be rejected')
}

describe('newPlan', () => {
  it('replaces the plan with the default hall and keeps custom catalog entries', () => {
    let p = run(plan(), 'addCatalogEntry', { entry: customRackInput('rack.mine') }).plan
    p = run(p, 'renamePlan', { name: 'Hall B' }).plan
    p = run(p, 'removeRacks', { placementIds: ['R1-00'] }).plan
    const result = run(p, 'newPlan', {})
    expect(result.plan.name).toBe('Default hall')
    expect(result.plan.id).not.toBe(p.id)
    expect(result.plan.placements).toHaveLength(80)
    expect(Object.keys(result.plan.catalog)).toEqual(['rack.mine'])
    expect(result.summary).toBe('Started a new plan from the default hall')
  })
})

describe('importPlan', () => {
  it('importPlan rejects invalid plan with path: problem lines and leaves the plan unchanged', () => {
    const bad = structuredClone(plan()) as Record<string, unknown>
    delete bad.name
    ;(bad.hall as { rows: { slotCount: unknown }[] }).rows[2]!.slotCount = -1
    const error = rejection(plan(), 'importPlan', { plan: bad })
    const lines = error.message.split('\n')
    expect(lines[0]).toBe('The file is not a valid plan:')
    expect(lines).toContain('name: Invalid input: expected string, received undefined')
    expect(lines.some((l) => l.startsWith('hall.rows.2.slotCount: '))).toBe(true)
    expect(error.path).toBe('payload.plan')
  })

  it('rejects a future schema version with a plain message', () => {
    const future = { ...plan(), schemaVersion: 2 }
    expect(rejection(plan(), 'importPlan', { plan: future }).message).toContain('schemaVersion: this app reads schemaVersion 1; the file has 2')
  })

  it('rejects something that is not a plan at all', () => {
    expect(rejection(plan(), 'importPlan', { plan: 'hello' }).message).toContain('(root): Invalid input: expected object, received string')
  })

  it('rejects broken references and overlapping racks', () => {
    const p = plan()
    p.placements.push({ id: 'R1-03', groupId: 'g1', rowId: 'R1', slot: 3 })
    p.placements.push({ id: 'R9-00', groupId: 'g9', rowId: 'R9', slot: 0 })
    const message = rejection(plan(), 'importPlan', { plan: p }).message
    expect(message).toContain('placements.80: Slot R1-03 is taken by R1-03')
    expect(message).toContain('placements.81.groupId: unknown rack group "g9"')
    expect(message).toContain('placements.81.rowId: unknown row "R9"')
  })

  it('rejects unknown climate, heat rejection, override and position references', () => {
    const p = plan()
    p.site.climateId = 'climate.dalas'
    p.cooling.heatRejectionId = 'hr.nothing'
    p.rackGroups[0]!.rackTypeId = 'rack.nothing'
    p.rackGroups[0]!.coolingMethodId = 'rc.nothing'
    p.overrides.push({ key: 'cdu:R3', modelId: 'eq.nothing', positionIds: ['P-nowhere'] })
    p.hall.positions[0]!.servesRows = ['R99']
    const message = rejection(plan(), 'importPlan', { plan: p }).message
    expect(message).toContain('site.climateId: unknown climate "climate.dalas"')
    expect(message).toContain('cooling.heatRejectionId: unknown heat rejection method "hr.nothing"')
    expect(message).toContain('rackGroups.0.rackTypeId: unknown rack type "rack.nothing"')
    expect(message).toContain('rackGroups.0.coolingMethodId: unknown rack cooling method "rc.nothing"')
    expect(message).toContain('overrides.0.modelId: unknown equipment model "eq.nothing"')
    expect(message).toContain('overrides.0.positionIds.0: unknown equipment position "P-nowhere"')
    expect(message).toContain(`hall.positions.0.servesRows.0: unknown row "R99"`)
  })

  it('rejects out-of-range oversubscription in an imported plan', () => {
    const p = plan()
    p.power.oversubscription = 1e-9
    p.network.oversubscription = 100
    const message = rejection(plan(), 'importPlan', { plan: p }).message
    expect(message).toMatch(/power\.oversubscription: /)
    expect(message).toMatch(/network\.oversubscription: /)
  })

  it('importPlan on a valid plan replaces it and keeps schemaVersion 1', () => {
    const imported = run(plan(), 'renamePlan', { name: 'Imported hall' }).plan
    const result = run(plan(), 'importPlan', { plan: JSON.parse(JSON.stringify(imported)) })
    expect(result.plan.schemaVersion).toBe(1)
    expect(result.plan.id).toBe(imported.id)
    expect(result.plan.name).toBe('Imported hall')
    expect(result.plan.placements).toEqual(imported.placements)
    expect(result.summary).toBe('Imported plan "Imported hall"')
  })
})

describe('renamePlan', () => {
  it('renames and trims', () => {
    const result = run(plan(), 'renamePlan', { name: '  Hall B ' })
    expect(result.plan.name).toBe('Hall B')
    expect(result.summary).toBe('Plan renamed to "Hall B"')
  })

  it('rejects a blank name', () => {
    expect(rejection(plan(), 'renamePlan', { name: '   ' }).message).toBe('The plan name cannot be blank')
  })
})
