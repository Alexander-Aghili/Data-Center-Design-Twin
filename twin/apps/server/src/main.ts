import { SERVER_PORT } from '@twin/schema'
import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/api/health', async () => ({ ok: true }))

await app.listen({ port: SERVER_PORT, host: '127.0.0.1' })
