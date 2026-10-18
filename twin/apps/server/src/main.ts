import { fileURLToPath } from 'node:url'
import { SERVER_PORT } from '@twin/schema'
import { designAgentFactory } from './agent/wire'
import { createApp } from './app'
import { loadApiKey } from './env'

/** `twin/.data/` (git-ignored): plan.json, conversation.json and generated briefs. */
const dataDir = fileURLToPath(new URL('../../../.data/', import.meta.url))

const hasApiKey = loadApiKey()
const app = await createApp({ dataDir, logger: true, ...(hasApiKey ? { agentFactory: designAgentFactory({ dataDir }) } : {}) })
app.log.info({ dataDir, hasApiKey }, hasApiKey ? 'API key loaded' : 'No API key in .env; the agent is unavailable')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ port: Number(process.env.PORT ?? SERVER_PORT), host: '127.0.0.1' })
