import { existsSync } from 'node:fs'

/** The repo-root `.env` that holds `ANTHROPIC_API_KEY` (git-ignored). */
export const ENV_PATH = '/Users/linushabetha/Data-Center-Design-Twin/.env'

/**
 * Loads the `.env` file into `process.env` if it exists and reports whether an API key is now set.
 * It never reads the key's value beyond that presence check, and never logs it.
 */
export function loadApiKey(path = ENV_PATH): boolean {
  if (existsSync(path)) process.loadEnvFile(path)
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
