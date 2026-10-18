import { CommandSchemas, type CommandDef, type CommandPayloads, type CommandType } from '@twin/schema'
import type { z } from 'zod'

/** Any registered command definition, as stored in the registry. */
export type AnyCommandDef = CommandDef<string, unknown>

/** Defines a command; the payload schema always comes from the contract in `CommandSchemas`. */
export function defineCommand<K extends CommandType>(
  def: Omit<CommandDef<K, CommandPayloads[K]>, 'payload'>,
): CommandDef<K, CommandPayloads[K]> {
  return { ...def, payload: CommandSchemas[def.type] as unknown as z.ZodType<CommandPayloads[K], unknown> }
}
