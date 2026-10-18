import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createApp, type AppOptions } from '../src/app'
import { tempDataDir, testBuiltins, testRegistry } from './helpers/fixtures'

const apps: FastifyInstance[] = []

async function makeApp(extra: Partial<AppOptions> = {}) {
  const app = await createApp({ dataDir: tempDataDir(), builtins: testBuiltins(), registry: testRegistry(), ...extra })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

/** Opens `/ws` with the given Origin header; resolves with the first message, or the HTTP status of a refused upgrade. */
function connect(port: number, origin?: string): Promise<{ opened: true; first: string } | { opened: false; status: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {})
    socket.once('message', (data) => {
      resolve({ opened: true, first: String(data).slice(0, 20) })
      socket.close()
    })
    socket.once('unexpected-response', (_req, res) => {
      resolve({ opened: false, status: res.statusCode ?? 0 })
      socket.terminate()
    })
    socket.once('error', reject)
  })
}

describe('local origin and host checks', () => {
  it('rejects HTTP requests whose Host is not a local name (DNS rebinding)', async () => {
    const app = await makeApp()
    const get = (host: string) => app.inject({ method: 'GET', url: '/api/state', headers: { host } })
    const refused = await get('attacker.example:4317')
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({ ok: false, error: 'Host attacker.example:4317 is not allowed' })
    expect((await get('localhost:4317')).statusCode).toBe(200)
    expect((await get('127.0.0.1:5173')).statusCode).toBe(200)
    expect((await get('[::1]:4317')).statusCode).toBe(200)
  })

  it('rejects HTTP requests from a foreign Origin; requests without one (MCP, curl) pass', async () => {
    const app = await makeApp()
    const chat = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/chat', payload: { text: 'hi' }, headers })
    const refused = await chat({ origin: 'https://evil.example' })
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({ ok: false, error: 'Origin https://evil.example is not allowed' })
    expect((await chat({ origin: 'http://localhost:5173' })).statusCode).toBe(202)
    expect((await chat({ origin: 'http://127.0.0.1:4317' })).statusCode).toBe(202)
    expect((await chat({})).statusCode).toBe(202)
  })

  it('refuses a WebSocket from a foreign Origin before sending any state', async () => {
    const app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    expect(await connect(port, 'https://evil.example')).toEqual({ opened: false, status: 403 })
    expect(await connect(port, 'http://localhost:5173')).toMatchObject({ opened: true, first: expect.stringContaining('"t":"state"') })
    expect(await connect(port)).toMatchObject({ opened: true })
  })

  it('takes the allowed origins from the options', async () => {
    const app = await makeApp({ allowedOrigins: ['http://127.0.0.1:9999'] })
    const get = (origin: string) => app.inject({ method: 'GET', url: '/api/health', headers: { origin } })
    expect((await get('http://127.0.0.1:9999')).statusCode).toBe(200)
    expect((await get('http://localhost:5173')).statusCode).toBe(403)
  })
})
