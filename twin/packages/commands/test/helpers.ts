import { CommandError, type Plan } from '@twin/schema'
import { expect } from 'vitest'
import { applyCommand } from '../src'
import { catalog } from './fixtures'

export const run = (p: Plan, type: string, payload: unknown) => applyCommand(p, { type, payload }, catalog)

/** Asserts the command throws a CommandError matching `message` and leaves `p` untouched. */
export function expectRejected(p: Plan, type: string, payload: unknown, message: string | RegExp): void {
  const before = structuredClone(p)
  let error: unknown
  try {
    run(p, type, payload)
  } catch (e) {
    error = e
  }
  expect(error).toBeInstanceOf(CommandError)
  if (typeof message === 'string') expect((error as Error).message).toBe(message)
  else expect((error as Error).message).toMatch(message)
  expect(p).toEqual(before)
}
