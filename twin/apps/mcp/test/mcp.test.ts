import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTwinMcpServer } from '../src/main'

const TOOLS = [
  {
    name: 'get_evaluation',
    description: 'Evaluate the current plan.',
    inputSchema: {
      type: 'object',
      properties: { detail: { type: 'string', enum: ['summary', 'full'] } },
      required: ['detail'],
    },
  },
  {
    name: 'cmd_placeRacks',
    description: 'Place racks in a row.',
    inputSchema: { type: 'object', properties: { rowId: { type: 'string' } }, required: ['rowId'] },
  },
]

interface FakeApp {
  url: string
  calls: { name: string; body: unknown }[]
  close(): Promise<void>
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    req.on('end', () => resolve(JSON.parse(raw)))
    req.on('error', reject)
  })
}

/** Implements `GET /api/tools` and `POST /api/tools/:name` as in the protocol table. */
async function startFakeApp(): Promise<FakeApp> {
  const calls: FakeApp['calls'] = []
  const server: HttpServer = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && req.url === '/api/tools') return send(200, TOOLS)
    const match = req.method === 'POST' ? /^\/api\/tools\/([^/]+)$/.exec(req.url ?? '') : null
    if (!match) return send(404, { error: 'not found' })
    const name = decodeURIComponent(match[1])
    calls.push({ name, body: await readJson(req) })
    if (name === 'get_evaluation') return send(200, { ok: true, result: '{"pue":1.31}' })
    if (name === 'cmd_placeRacks') return send(400, { ok: false, error: 'payload.rowId: row R9 does not exist' })
    return send(404, { ok: false, error: `Unknown tool "${name}"` })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function connect(baseUrl: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createTwinMcpServer(baseUrl).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  return client
}

/** A URL nothing listens on: bind an ephemeral port, then release it. */
async function deadUrl(): Promise<string> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return `http://127.0.0.1:${port}`
}

describe('twin-dc MCP server', () => {
  let app: FakeApp
  let client: Client

  beforeEach(async () => {
    app = await startFakeApp()
    client = await connect(app.url)
  })

  afterEach(async () => {
    await client.close()
    await app.close()
  })

  it('lists tools from server', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['get_evaluation', 'cmd_placeRacks'])
    expect(tools[0].description).toBe('Evaluate the current plan.')
    expect(tools[0].inputSchema).toEqual(TOOLS[0].inputSchema)
    expect(tools[0].annotations?.readOnlyHint).toBe(true)
    expect(tools[1].annotations?.readOnlyHint).toBe(false)
  })

  it('calls tool and returns text content', async () => {
    const result = await client.callTool({ name: 'get_evaluation', arguments: { detail: 'summary' } })
    expect(app.calls).toEqual([{ name: 'get_evaluation', body: { input: { detail: 'summary' } } }])
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: '{"pue":1.31}' }])
  })

  it('returns a tool error from the app as isError content', async () => {
    const result = await client.callTool({ name: 'cmd_placeRacks', arguments: { rowId: 'R9' } })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'payload.rowId: row R9 does not exist' }])
  })

  it('sends an empty input object when the client passes no arguments', async () => {
    await client.callTool({ name: 'get_evaluation' })
    expect(app.calls[0].body).toEqual({ input: {} })
  })
})

describe('twin-dc MCP server without the app', () => {
  it('server down returns MCP error with "Start the app with npm run dev"', async () => {
    const client = await connect(await deadUrl())
    const listing = client.listTools()
    await expect(listing).rejects.toBeInstanceOf(McpError)
    await expect(listing).rejects.toThrow('Start the app with npm run dev')

    const result = await client.callTool({ name: 'get_evaluation', arguments: { detail: 'summary' } })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('Start the app with npm run dev') }])
    await client.close()
  })
})

describe('twin-dc over stdio', () => {
  it('starts from main.ts with TWIN_URL and lists the app tools', async () => {
    const app = await startFakeApp()
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))],
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      env: { PATH: process.env.PATH ?? '', TWIN_URL: app.url },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(transport)
    try {
      expect(client.getServerVersion()?.name).toBe('twin-dc')
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['get_evaluation', 'cmd_placeRacks'])
    } finally {
      await client.close()
      await app.close()
    }
  }, 20_000)
})
