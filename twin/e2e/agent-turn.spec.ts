import { expect, test, type Page } from '@playwright/test'
import { agent, LIVE_AGENT, openApp, Twin } from './harness'

// A running agent turn is visible while it runs (tool lines, streamed words, the spend line and a Stop button) and can
// be stopped. The scripted client streams one word every 600 ms here; RUN_LIVE_AGENT=1 runs one short real turn instead.

let twin: Twin

test.beforeAll(async () => {
  twin = await new Twin({ liveAgent: LIVE_AGENT, env: LIVE_AGENT ? { AGENT_MAX_TURN_USD: '0.25' } : { TWIN_FAKE_AGENT_CHUNK_MS: '600' } }).start()
})
test.afterAll(async () => twin?.close())

const thread = (page: Page) => agent(page).getByRole('log', { name: 'Agent messages' })
const spend = (page: Page) => agent(page).getByRole('status', { name: 'API spend' })
const stop = (page: Page) => agent(page).getByRole('button', { name: 'Stop' })

async function ask(page: Page, text: string) {
  const box = agent(page).getByRole('textbox', { name: 'Message the design agent' })
  await box.fill(text)
  await box.press('Enter')
}

test('a turn shows its tool lines, words and cost while it runs, and Stop ends it', async ({ page }) => {
  test.setTimeout(LIVE_AGENT ? 240_000 : 60_000)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await openApp(page, twin)
  await expect(spend(page)).toHaveText(/^Spent \$\d+\.\d\d of \$5\.00 today\./)

  await ask(page, LIVE_AGENT ? 'In one sentence, what is the PUE at the worst hour?' : 'What is the PUE at the worst hour?')
  await expect(stop(page)).toBeVisible()
  await expect(spend(page)).toContainText('Working,')

  // Each part of the turn shows up while the Stop button is still there, so the turn is still running.
  const turn = thread(page).getByRole('article').last()
  if (LIVE_AGENT) {
    await expect(turn.locator('.ag-tool').first()).toBeVisible({ timeout: 120_000 })
    await expect(stop(page)).toBeHidden({ timeout: 180_000 })
    await expect(spend(page)).toHaveText(/Last turn \$0\.\d\d\./)
  } else {
    await expect(turn.getByText('Reading the')).toBeVisible()
    await expect(stop(page)).toBeVisible()
    await expect(turn.getByText(/Evaluation: \d+ failing, \d+ warning/)).toBeVisible()
    // The closing sentence has words left to stream when Stop goes in.
    await expect(turn.getByText(/^PUE at/)).toBeVisible()
    await stop(page).click()
    await expect(turn.getByText('Stopped', { exact: true })).toBeVisible()
    await expect(stop(page)).toBeHidden()
    await expect(turn.getByText(/^PUE at the worst hour is \d\.\d\d\.$/)).toHaveCount(0)
    await expect(spend(page)).not.toContainText('Working')
  }
  expect(pageErrors).toEqual([])
})

test('automatic review can be turned off, and stays off after a reload', async ({ page }) => {
  test.skip(LIVE_AGENT, 'no model involved')
  await openApp(page, twin)
  const review = agent(page).getByRole('switch', { name: 'Automatic review' })
  await expect(review).toBeChecked()
  await review.click()
  await expect(review).not.toBeChecked()
  await page.reload()
  await expect(agent(page).getByRole('switch', { name: 'Automatic review' })).not.toBeChecked()
  await agent(page).getByRole('switch', { name: 'Automatic review' }).click()
  await expect(agent(page).getByRole('switch', { name: 'Automatic review' })).toBeChecked()
})
