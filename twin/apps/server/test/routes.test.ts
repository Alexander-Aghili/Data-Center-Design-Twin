import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@twin/schema'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { rename, tempDataDir, testBuiltins, testRegistry } from './helpers/fixtures'

const apps: FastifyInstance[] = []

async function makeApp(dataDir = tempDataDir()) {
  const app = await createApp({ dataDir, builtins: testBuiltins(), registry: testRegistry() })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('HTTP routes', () => {
  it('GET /api/state returns plan+evaluation', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/state' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.plan.name).toBe('Default hall')
    expect(body.evaluation.headline).toBeDefined()
    expect(body.history).toEqual({ canUndo: false, canRedo: false })
  })

  it('POST /api/command applies a command', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Hall B') } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, summary: 'Plan renamed to Hall B' })
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json().plan.name).toBe('Hall B')
  })

  it('invalid command returns 400 with message, state unchanged', async () => {
    const app = await makeApp()
    const before = (await app.inject({ method: 'GET', url: '/api/state' })).json()
    const res = await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('') } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/^payload\.name: /) })
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json()).toEqual(before)

    const malformed = await app.inject({ method: 'POST', url: '/api/command', payload: { nope: true } })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toMatchObject({ ok: false, error: expect.stringContaining('command') })
  })

  it('POST /api/undo and /api/redo move through history', async () => {
    const app = await makeApp()
    expect((await app.inject({ method: 'POST', url: '/api/undo' })).statusCode).toBe(409)
    await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Hall B') } })
    const undo = await app.inject({ method: 'POST', url: '/api/undo' })
    expect(undo.json()).toEqual({ ok: true })
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json().plan.name).toBe('Default hall')
    expect((await app.inject({ method: 'POST', url: '/api/redo' })).json()).toEqual({ ok: true })
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json().plan.name).toBe('Hall B')
    const redo = await app.inject({ method: 'POST', url: '/api/redo' })
    expect(redo.statusCode).toBe(409)
    expect(redo.json()).toEqual({ ok: false, error: 'Nothing to redo' })
  })

  it('POST /api/plan/import returns 400 with paths', async () => {
    const app = await makeApp()
    const before = (await app.inject({ method: 'GET', url: '/api/state' })).json()
    const plan = { ...before.plan, schemaVersion: 2, site: { ...before.plan.site, climateId: 42 } }
    const res = await app.inject({ method: 'POST', url: '/api/plan/import', payload: { plan } })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.ok).toBe(false)
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^plan\.schemaVersion: /), expect.stringMatching(/^plan\.site\.climateId: /)]),
    )
    expect(body.error).toBe(body.issues.join('\n'))
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json()).toEqual(before)

    const partial = await app.inject({ method: 'POST', url: '/api/plan/import', payload: { plan: { name: 'Half' } } })
    expect(partial.statusCode).toBe(400)
    expect(partial.json().issues.length).toBeGreaterThan(1)
  })

  it('export then import round-trip yields identical evaluation', async () => {
    const source = await createApp({ dataDir: tempDataDir() })
    const target = await createApp({ dataDir: tempDataDir() })
    apps.push(source, target)
    const exported = await source.inject({ method: 'GET', url: '/api/plan/export' })
    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-disposition']).toBe('attachment; filename="default-hall.json"')
    const plan: Plan = exported.json()
    expect(Object.keys(plan.catalog).length).toBeGreaterThan(0)

    const imported = await target.inject({ method: 'POST', url: '/api/plan/import', payload: { plan } })
    expect(imported.json()).toEqual({ ok: true })
    const sourceState = (await source.inject({ method: 'GET', url: '/api/state' })).json()
    const targetState = (await target.inject({ method: 'GET', url: '/api/state' })).json()
    expect(targetState.evaluation).toEqual(sourceState.evaluation)
    expect(targetState.plan.id).toBe(sourceState.plan.id)
    expect(targetState.history.last).toBe('Imported plan "Default hall"')
  })

  it('runs real commands against the built-in registry and catalog', async () => {
    const app = await createApp({ dataDir: tempDataDir() })
    apps.push(app)
    const before = (await app.inject({ method: 'GET', url: '/api/state' })).json()
    const bad = await app.inject({
      method: 'POST',
      url: '/api/command',
      payload: { command: { type: 'placeRacks', payload: { groupId: 'nope', rowId: 'R1', slots: [0] } } },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toContain('nope')
    expect((await app.inject({ method: 'GET', url: '/api/state' })).json()).toEqual(before)

    const ok = await app.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Real hall') } })
    expect(ok.statusCode).toBe(200)
    const after = (await app.inject({ method: 'GET', url: '/api/state' })).json()
    expect(after.plan.name).toBe('Real hall')
    expect(after.evaluation).toEqual(before.evaluation)
  })

  it('persisted plan reloads after restart', async () => {
    const dataDir = tempDataDir()
    const first = await createApp({ dataDir, builtins: testBuiltins(), registry: testRegistry() })
    await first.inject({ method: 'POST', url: '/api/command', payload: { command: rename('Survives restart') } })
    await first.close()
    const second = await makeApp(dataDir)
    expect((await second.inject({ method: 'GET', url: '/api/state' })).json().plan.name).toBe('Survives restart')
  })

  it('GET /api/catalog returns the built-ins', async () => {
    const app = await makeApp()
    const body = (await app.inject({ method: 'GET', url: '/api/catalog' })).json()
    expect(body.entries).toEqual([])
    expect(Object.keys(body.rules).length).toBeGreaterThan(0)
  })

  it('GET /api/brief/file/:name serves a generated brief and validates the name', async () => {
    const dataDir = tempDataDir()
    mkdirSync(join(dataDir, 'briefs'))
    writeFileSync(join(dataDir, 'briefs', '2026-10-18T15-00-00-openfoam.md'), '# Brief\n')
    writeFileSync(join(dataDir, 'outside.md'), 'not a brief\n')
    const app = await makeApp(dataDir)

    const ok = await app.inject({ method: 'GET', url: '/api/brief/file/2026-10-18T15-00-00-openfoam.md' })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(ok.body).toBe('# Brief\n')

    expect((await app.inject({ method: 'GET', url: '/api/brief/file/missing.md' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/brief/file/plan.json' })).statusCode).toBe(400)
    for (const attempt of ['..%2Foutside.md', '..%5Coutside.md', '%2Fetc%2Fpasswd.md', '.md%00.md']) {
      const res = await app.inject({ method: 'GET', url: `/api/brief/file/${attempt}` })
      expect(res.statusCode, attempt).toBe(400)
      expect(res.body).not.toContain('not a brief')
    }
    expect((await app.inject({ method: 'GET', url: '/api/brief/file/..' })).statusCode).toBe(404)
  })

  it('GET /api/brief returns the deterministic brief for openfoam and rejects other targets', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/brief?target=openfoam' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(res.body.length).toBeGreaterThan(0)
    expect((await app.inject({ method: 'GET', url: '/api/brief?target=fluent' })).statusCode).toBe(400)
  })

  it('tools without an agent: empty list, and a plain error when run', async () => {
    const app = await makeApp()
    expect((await app.inject({ method: 'GET', url: '/api/tools' })).json()).toEqual([])
    const res = await app.inject({ method: 'POST', url: '/api/tools/get_plan', payload: { input: {} } })
    expect(res.json()).toEqual({ ok: false, error: 'The agent needs an API key in .env' })
  })

  it('tools with an agent: lists them as a bare array and runs one', async () => {
    const tools = [{ name: 'get_plan', description: 'Reads the plan.', inputSchema: { type: 'object' } }]
    const inputs: unknown[] = []
    const app = await createApp({
      dataDir: tempDataDir(),
      builtins: testBuiltins(),
      registry: testRegistry(),
      agentFactory: () => ({
        handleChat() {},
        handleChange() {},
        resetConversation() {},
        applyProposal() {},
        dismissProposal() {},
        onEvent: () => () => {},
        onView: () => () => {},
        threadEvents: () => [],
        async runTool(name, input) {
          inputs.push(input)
          return { ok: true, result: `ran ${name}` }
        },
        listTools: () => tools,
      }),
    })
    apps.push(app)
    expect((await app.inject({ method: 'GET', url: '/api/tools' })).json()).toEqual(tools)
    const res = await app.inject({ method: 'POST', url: '/api/tools/get_plan', payload: { input: { section: 'site' } } })
    expect(res.json()).toEqual({ ok: true, result: 'ran get_plan' })
    expect(inputs).toEqual([{ section: 'site' }])
  })

  it('POST /api/chat rejects an empty message', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { text: '' } })
    expect(res.statusCode).toBe(400)
  })
})
