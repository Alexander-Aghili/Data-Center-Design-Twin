import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { SERVER_PORT, TOOL_GROUPS, type ToolCallResponse } from '@twin/schema'
import { z } from 'zod'
import pkg from '../package.json' with { type: 'json' }

/** Tools that only read the plan; every other tool changes the plan, the proposals or the view. */
const READ_ONLY_TOOLS = new Set<string>([...TOOL_GROUPS.read, 'what_if', 'export_plan'])

const ToolListSchema = z.array(
  z.object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.looseObject({ type: z.literal('object') }),
  }),
)

const ToolCallResponseSchema: z.ZodType<ToolCallResponse> = z.union([
  z.object({ ok: z.literal(true), result: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

/**
 * The stdio MCP server `twin-dc`: proxies every agent tool of the running app
 * (`GET /api/tools`, `POST /api/tools/:name`) under the same name.
 */
export function createTwinMcpServer(baseUrl: string): McpServer {
  const mcp = new McpServer(
    { name: 'twin-dc', version: pkg.version },
    {
      capabilities: { tools: {} },
      instructions:
        `Tools of the Data Center Design Twin app running at ${baseUrl}. ` +
        'They act on the plan open in the browser, so changes show up there live. ' +
        'Every plan change can be reverted with the undo tool.',
    },
  )

  async function request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, baseUrl), init)
    } catch {
      throw new Error(
        `The Data Center Design Twin app is not reachable at ${baseUrl}. Start the app with npm run dev (from twin/), then try again.`,
      )
    }
  }

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Errors thrown here reach the client as JSON-RPC InternalError responses.
    const res = await request('/api/tools')
    if (!res.ok) throw new Error(`GET /api/tools failed with HTTP ${res.status}`)
    const parsed = ToolListSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error(`GET /api/tools returned an unexpected body: ${parsed.error.message}`)
    const tools: Tool[] = parsed.data.map((tool) => ({
      ...tool,
      annotations: { readOnlyHint: READ_ONLY_TOOLS.has(tool.name) },
    }))
    return { tools }
  })

  mcp.server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
    const path = `/api/tools/${encodeURIComponent(params.name)}`
    const fail = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] })
    let res: Response
    try {
      res = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: params.arguments ?? {} }),
      })
    } catch (err) {
      return fail((err as Error).message)
    }
    const parsed = ToolCallResponseSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) return fail(`POST ${path} failed with HTTP ${res.status}`)
    const body = parsed.data
    return body.ok ? { content: [{ type: 'text', text: body.result }] } : fail(body.error)
  })

  return mcp
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.TWIN_URL ?? `http://localhost:${SERVER_PORT}`
  await createTwinMcpServer(baseUrl).connect(new StdioServerTransport())
}
