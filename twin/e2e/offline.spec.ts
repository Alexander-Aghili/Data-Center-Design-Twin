import { expect, test } from '@playwright/test'
import { agent, openApp, openLayer, pickCatalogEntry, totalsText, totalsValue, Twin } from './harness'

let twin: Twin

test.beforeAll(async () => {
  twin = await new Twin().start()
})
test.afterAll(async () => twin?.close())

const AGENT_NEEDS_SERVER = /agent needs the server/i

test('with the server stopped the UI says so, local edits keep evaluating, and chat says the agent needs the server', async ({ page }) => {
  await openApp(page, twin)
  const chatBox = agent(page).getByRole('textbox', { name: 'Message the design agent' })
  await expect(chatBox).toBeEnabled()

  await twin.stopServer()

  // The open page notices.
  await expect(page.getByRole('banner').getByRole('status')).toHaveText(/offline|local mode/i)
  await expect(chatBox).toBeDisabled()

  // A fresh load with the server down runs the plan in the browser.
  await page.reload()
  await expect(page.getByRole('banner').getByRole('status')).toHaveText(/local mode/i, { timeout: 20_000 })
  await expect(totalsValue(page, 'IT load')).toHaveText(/\d/)
  const before = await totalsText(page)

  await openLayer(page, 'Compute')
  await pickCatalogEntry(page, 'Training block', 'NVIDIA GB300 NVL72')
  await expect.poll(() => totalsText(page)).not.toBe(before)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()

  await expect(agent(page).getByRole('log', { name: 'Agent messages' }).getByText(AGENT_NEEDS_SERVER)).toBeVisible()
  await expect(chatBox).toBeDisabled()
  await expect(chatBox).toHaveAttribute('placeholder', /start the local server/i)

  // Back online: the server's plan (untouched by the local edits) is shown again after a reload.
  await twin.startServer()
  await page.reload()
  await expect(chatBox).toBeEnabled({ timeout: 20_000 })
  await expect.poll(() => totalsText(page)).toBe(before)
})
