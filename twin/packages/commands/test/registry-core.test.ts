import { createDefaultPlan } from '@twin/catalog'
import { CommandError, type CatalogIndex } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { createRegistry, defineCommand } from '../src'

const catalog: CatalogIndex = { get: () => undefined, all: () => [] }

const rename = defineCommand({
  type: 'renamePlan',
  layer: 'plan',
  title: 'Rename plan',
  description: 'Renames the plan. Use it when the person asks for a different plan name.',
  apply(draft, payload) {
    if (payload.name === 'taken') throw new CommandError('Name is taken', 'payload.name')
    draft.name = payload.name
  },
  summarize: (payload) => `Plan renamed to ${payload.name}`,
})

describe('registry core', () => {
  const { applyCommand, applyCommands, listCommands } = createRegistry([rename])

  it('applies a valid command and stamps updatedAt', () => {
    const plan = { ...createDefaultPlan(), updatedAt: '2000-01-01T00:00:00.000Z' }
    const result = applyCommand(plan, { type: 'renamePlan', payload: { name: 'Hall B' } }, catalog)
    expect(result.plan.name).toBe('Hall B')
    expect(result.plan.updatedAt).not.toBe(plan.updatedAt)
    expect(result.summary).toBe('Plan renamed to Hall B')
    expect(plan.name).toBe('Default hall')
  })

  it('rejects unknown types and invalid payloads with path: problem', () => {
    const plan = createDefaultPlan()
    expect(() => applyCommand(plan, { type: 'nope', payload: {} }, catalog)).toThrow(CommandError)
    expect(() => applyCommand(plan, { type: 'renamePlan', payload: { name: 3 } }, catalog)).toThrow(/^payload\.name: /)
  })

  it('applyCommands is all-or-nothing', () => {
    const plan = createDefaultPlan()
    const cmds = [
      { type: 'renamePlan', payload: { name: 'A' } },
      { type: 'renamePlan', payload: { name: 'taken' } },
    ]
    expect(() => applyCommands(plan, cmds, catalog)).toThrow('Name is taken')
    expect(plan.name).toBe('Default hall')
  })

  it('lists commands with their JSON schema', () => {
    const [info] = listCommands()
    expect(info).toMatchObject({ type: 'renamePlan', layer: 'plan', title: 'Rename plan' })
    expect(info?.jsonSchema).toMatchObject({ type: 'object', required: ['name'] })
  })
})
