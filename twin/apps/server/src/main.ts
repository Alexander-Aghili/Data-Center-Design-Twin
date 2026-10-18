import { fileURLToPath } from 'node:url'
import { SERVER_PORT } from '@twin/schema'
import { createScriptedClient } from './agent/fakeClient'
import { limitsFromEnv } from './agent/limits'
import { designAgentFactory } from './agent/wire'
import { createApp, DEV_WEB_PORT, localOrigins } from './app'
import type { SpendLog } from './agent/meter'
import type { PlanStore } from './contracts'
import { loadApiKey } from './env'

/** Plan, conversation and generated briefs: `twin/.data/` (git-ignored), or `TWIN_DATA_DIR` (end-to-end tests). */
const dataDir = process.env.TWIN_DATA_DIR ?? fileURLToPath(new URL('../../../.data/', import.meta.url))

/**
 * `TWIN_FAKE_AGENT=1` runs the agent on the scripted client instead of the Claude API (end-to-end tests, demos without a
 * key); `TWIN_FAKE_AGENT_CHUNK_MS` makes it stream one word per that many milliseconds.
 */
const fakeAgent = process.env.TWIN_FAKE_AGENT === '1'
const fakeChunkMs = Number(process.env.TWIN_FAKE_AGENT_CHUNK_MS ?? 0)
const hasApiKey = !fakeAgent && loadApiKey()
/** Spending caps: the defaults, or `AGENT_*` variables from the shell or the repo-root .env (loaded just above). */
const limits = limitsFromEnv(process.env)
const agentFactory = fakeAgent
  ? (store: PlanStore, log: SpendLog) => designAgentFactory({ dataDir, limits, client: createScriptedClient(store, { chunkMs: fakeChunkMs }) })(store, log)
  : hasApiKey
    ? designAgentFactory({ dataDir, limits })
    : undefined

const port = Number(process.env.PORT ?? SERVER_PORT)
/** Vite's dev server and this server on local names, plus `TWIN_ALLOWED_ORIGINS` (comma-separated; end-to-end tests run Vite on a free port). */
const allowedOrigins = [
  ...localOrigins([DEV_WEB_PORT, port]),
  ...(process.env.TWIN_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

const app = await createApp({ dataDir, logger: true, allowedOrigins, ...(agentFactory ? { agentFactory } : {}) })
app.log.info(
  { dataDir, hasApiKey, fakeAgent, limits },
  fakeAgent ? 'Scripted agent (TWIN_FAKE_AGENT=1)' : hasApiKey ? 'API key loaded' : 'No API key in .env; the agent is unavailable',
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ port, host: '127.0.0.1' })
