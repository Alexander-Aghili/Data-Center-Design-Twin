import { COMMAND_TYPES } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { listCommands, registry } from '../src'

describe('built-in registry', () => {
  it('registers every contract command type', () => {
    expect([...registry.keys()].sort()).toEqual([...COMMAND_TYPES].sort())
    expect(registry.size).toBe(36)
  })

  it('every command has description ≥ 40 chars', () => {
    for (const info of listCommands()) {
      expect(info.description.length, info.type).toBeGreaterThanOrEqual(40)
      expect(info.title.length, info.type).toBeGreaterThan(0)
    }
  })

  it('every payload converts to a JSON schema object for the agent tools', () => {
    for (const info of listCommands()) expect(info.jsonSchema, info.type).toMatchObject({ type: 'object' })
  })
})
