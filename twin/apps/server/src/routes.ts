import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { snapshotCatalog } from '@twin/catalog'
import { formatIssues, parsePlan } from '@twin/commands'
import { makeCatalogIndex } from '@twin/engine'
import { CommandError, CommandSchema, type Plan, type ToolCallResponse } from '@twin/schema'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { generateBrief } from './brief/openfoam'
import type { AgentRuntime, PlanStore } from './contracts'

/** Names of briefs the agent writes into `dataDir/briefs/`. No slashes, so no path traversal. */
const BRIEF_FILE_NAME = /^[\w.-]+\.md$/
const MARKDOWN = 'text/markdown; charset=utf-8'
// Briefs open in a browser tab: browsers download text/markdown, but show text/plain inline.
const PLAIN_TEXT = 'text/plain; charset=utf-8'

const CommandBody = z.object({ command: CommandSchema })
const CommandsBody = z.object({ commands: z.array(CommandSchema).min(1) })
const ImportBody = z.object({ plan: z.unknown() })
const ChatBody = z.object({ text: z.string().min(1) })
const ToolBody = z.object({ input: z.unknown().optional() }).optional()
const BriefQuery = z.object({ target: z.literal('openfoam') })

type Parsed<T> = { ok: true; data: T } | { ok: false }

/** Parses a request part with zod; on failure sends `400 { ok: false, error }` with `path: problem` lines. */
function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply, prefix: string): Parsed<T> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  void reply.code(400).send({ ok: false, error: formatIssues(result.error, prefix) })
  return { ok: false }
}

/** "Default hall" → "default-hall", for download file names. */
function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'
}

export function registerRoutes(app: FastifyInstance, deps: { store: PlanStore; agent: AgentRuntime; dataDir: string }): void {
  const { store, agent, dataDir } = deps
  const briefsDir = resolve(dataDir, 'briefs')

  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/state', async () => store.state())

  app.post('/api/command', async (request, reply) => {
    const body = parse(CommandBody, request.body, reply, 'body')
    if (!body.ok) return reply
    const result = store.dispatch(body.data.command, 'user')
    return reply.code(result.ok ? 200 : 400).send(result)
  })

  /** All or nothing, as one undo step (used for catalog pack imports). */
  app.post('/api/commands', async (request, reply) => {
    const body = parse(CommandsBody, request.body, reply, 'body')
    if (!body.ok) return reply
    const result = store.dispatchAll(body.data.commands, 'user')
    return reply.code(result.ok ? 200 : 400).send(result)
  })

  app.post('/api/undo', async (_request, reply) =>
    store.undo() ? { ok: true } : reply.code(409).send({ ok: false, error: 'Nothing to undo' }),
  )

  app.post('/api/redo', async (_request, reply) =>
    store.redo() ? { ok: true } : reply.code(409).send({ ok: false, error: 'Nothing to redo' }),
  )

  app.get('/api/plan/export', async (_request, reply) => {
    const plan = snapshotCatalog(store.state().plan, store.builtins().entries)
    return reply.header('content-disposition', `attachment; filename="${fileSlug(plan.name)}.json"`).send(plan)
  })

  app.post('/api/plan/import', async (request, reply) => {
    const body = parse(ImportBody, request.body, reply, 'body')
    if (!body.ok) return reply
    let plan: Plan
    try {
      plan = parsePlan(body.data.plan, makeCatalogIndex(store.builtins().entries))
    } catch (err) {
      if (!(err instanceof CommandError)) throw err
      // The first line is the heading ("The file is not a valid plan:"); the rest are `path: problem` lines.
      return reply.code(400).send({ ok: false, error: err.message, issues: err.message.split('\n').slice(1) })
    }
    store.replace(plan)
    return { ok: true }
  })

  app.get('/api/catalog', async () => store.builtins())

  app.get('/api/brief', async (request, reply) => {
    const query = parse(BriefQuery, request.query, reply, 'query')
    if (!query.ok) return reply
    const { plan, evaluation } = store.state()
    return reply.type(MARKDOWN).send(generateBrief(plan, evaluation, query.data.target))
  })

  app.get<{ Params: { name: string } }>('/api/brief/file/:name', async (request, reply) => {
    const { name } = request.params
    const file = resolve(briefsDir, name)
    if (!BRIEF_FILE_NAME.test(name) || !file.startsWith(briefsDir + sep)) {
      return reply.code(400).send({ ok: false, error: `Not a brief file name: ${name}` })
    }
    try {
      const text = await readFile(file, 'utf8')
      return reply.type(PLAIN_TEXT).header('content-disposition', `inline; filename="${name}"`).send(text)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      return reply.code(404).send({ ok: false, error: `No brief named ${name}` })
    }
  })

  app.get('/api/tools', async () => agent.listTools())

  app.post<{ Params: { name: string } }>('/api/tools/:name', async (request, reply) => {
    const body = parse(ToolBody, request.body, reply, 'body')
    if (!body.ok) return reply
    const run = await agent.runTool(request.params.name, body.data?.input ?? {})
    const response: ToolCallResponse = run.ok
      ? { ok: true, result: run.result ?? '' }
      : { ok: false, error: run.error ?? `Tool ${request.params.name} failed` }
    return response
  })

  app.post('/api/chat', async (request, reply) => {
    const body = parse(ChatBody, request.body, reply, 'body')
    if (!body.ok) return reply
    agent.handleChat(body.data.text)
    return reply.code(202).send({ ok: true })
  })
}
