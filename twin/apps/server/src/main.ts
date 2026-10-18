import { fileURLToPath } from 'node:url'
import { SERVER_PORT } from '@twin/schema'
import { createScriptedClient } from './agent/fakeClient'
import { designAgentFactory } from './agent/wire'
import { createApp, DEV_WEB_PORT, localOrigins } from './app'
import type { PlanStore } from './contracts'
import { loadApiKey } from './env'

/** Plan, conversation and generated briefs: `twin/.data/` (git-ignored), or `TWIN_DATA_DIR` (end-to-end tests). */
const dataDir = process.env.TWIN_DATA_DIR ?? fileURLToPath(new URL('../../../.data/', import.meta.url))

/** `TWIN_FAKE_AGENT=1` runs the agent on the scripted client instead of the Claude API (end-to-end tests, demos without a key). */
const fakeAgent = process.env.TWIN_FAKE_AGENT === '1'
const hasApiKey = !fakeAgent && loadApiKey()
const agentFactory = fakeAgent
  ? (store: PlanStore) => designAgentFactory({ dataDir, client: createScriptedClient(store) })(store)
  : hasApiKey
    ? designAgentFactory({ dataDir })
    : undefined

const port = Number(process.env.PORT ?? SERVER_PORT)
/** Vite's dev server and this server on local names, plus `TWIN_ALLOWED_ORIGINS` (comma-separated; end-to-end tests run Vite on a free port). */
const allowedOrigins = [
  ...localOrigins([DEV_WEB_PORT, port]),
  ...(process.env.TWIN_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

const app = await createApp({ dataDir, logger: true, allowedOrigins, ...(agentFactory ? { agentFactory } : {}) })
app.log.info(
  { dataDir, hasApiKey, fakeAgent },
  fakeAgent ? 'Scripted agent (TWIN_FAKE_AGENT=1)' : hasApiKey ? 'API key loaded' : 'No API key in .env; the agent is unavailable',
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ port, host: '127.0.0.1' })
