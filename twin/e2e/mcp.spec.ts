import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { HEAT_REJECTION, type Evaluation, type ServerMsg } from '@twin/schema'
import { fmtNumber } from '../apps/web/src/format'
import { fieldGroup, openApp, openLayer, recordServerMessages, totals, TWIN_DIR, Twin } from './harness'

let twin: Twin
let mcp: Client

test.beforeAll(async () => {
  twin = await new Twin().start()
  // The real stdio MCP server, pointed at this copy of the app the way an MCP client config would.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(TWIN_DIR, 'apps/mcp/src/main.ts')],
    cwd: TWIN_DIR,
    env: { ...(process.env as Record<string, string>), TWIN_URL: twin.serverUrl },
    stderr: 'pipe',
  })
  mcp = new Client({ name: 'twin-e2e', version: '0.0.0' })
  await mcp.connect(transport)
})

test.afterAll(async () => {
  await mcp?.close()
  await twin?.close()
})

/** The text of a successful tool call. */
async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await mcp.callTool({ name, arguments: args })
  const [first] = result.content as { type: string; text: string }[]
  expect(result.isError, first?.text).toBeFalsy()
  return first?.text ?? ''
}

test('MCP reads the evaluation the browser shows and changes the plan live over WebSocket', async ({ page }) => {
  const messages = recordServerMessages(page)
  await openApp(page, twin)

  const { tools } = await mcp.listTools()
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_evaluation', 'cmd_setHeatRejection']))
  expect(tools.find((t) => t.name === 'get_evaluation')?.annotations?.readOnlyHint).toBe(true)

  // get_evaluation: the same numbers the totals panel shows.
  const summary = JSON.parse(await call('get_evaluation', { detail: 'summary' })) as { headline: Evaluation['headline'] }
  await expect(totals(page).getByText(fmtNumber(summary.headline.usablePflops, 0), { exact: true })).toBeVisible()

  // cmd_setHeatRejection: the change reaches the open page as a state push, and the decision updates.
  await openLayer(page, 'Cooling')
  const plant = fieldGroup(page, 'Facility plant')
  await expect(plant).not.toContainText('Dry cooler')
  const pushedBefore = messages.length
  expect(await call('cmd_setHeatRejection', { heatRejectionId: HEAT_REJECTION.DRY_COOLER })).toContain('Dry cooler')

  await expect(plant).toContainText('Dry cooler')
  const pushed = messages.slice(pushedBefore).filter((m): m is Extract<ServerMsg, { t: 'state' }> => m.t === 'state')
  expect(pushed.at(-1)?.plan.cooling.heatRejectionId).toBe(HEAT_REJECTION.DRY_COOLER)

  // And it is one undoable step, like any other edit.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await call('undo', {})
  await expect(plant).not.toContainText('Dry cooler')
})
