import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { Evaluation, ServerMsg } from '@twin/schema'
import {
  agent,
  decisions,
  fieldGroup,
  LIVE_AGENT,
  openApp,
  openLayer,
  pickCatalogEntry,
  recordServerMessages,
  totals,
  totalsText,
  totalsValue,
  Twin,
} from './harness'

// The spec's demo script, steps 1 to 8. The agent steps run against the scripted client (TWIN_FAKE_AGENT=1)
// unless RUN_LIVE_AGENT=1, which uses the real Claude API with the key in the repo-root .env (about $1).

const AGENT_MS = LIVE_AGENT ? 180_000 : 15_000

let twin: Twin

test.beforeAll(async () => {
  twin = await new Twin({ liveAgent: LIVE_AGENT }).start()
})
test.afterAll(async () => twin?.close())

const thread = (page: Page) => agent(page).getByRole('log', { name: 'Agent messages' })
const messages = (page: Page) => thread(page).getByRole('article')
const layerButton = (page: Page, name: string) => decisions(page).getByRole('button', { name: new RegExp(`^${name},`) })

/** Waits until a new agent message has appeared after `count` and the thread has stopped streaming. */
async function nextAgentMessage(page: Page, count: number) {
  await expect(messages(page)).toHaveCount(count + 1, { timeout: AGENT_MS })
  await expect(thread(page)).toHaveAttribute('aria-busy', 'false', { timeout: AGENT_MS })
  return messages(page).nth(count)
}

async function chat(page: Page, text: string) {
  const count = await messages(page).count()
  const box = agent(page).getByRole('textbox', { name: 'Message the design agent' })
  await box.fill(text)
  await box.press('Enter')
  await expect(thread(page).getByText(text, { exact: true })).toBeVisible()
  return nextAgentMessage(page, count)
}

async function serverEvaluation(): Promise<Evaluation> {
  return ((await (await fetch(`${twin.serverUrl}/api/state`)).json()) as { evaluation: Evaluation }).evaluation
}

const nonPassing = (e: Evaluation, kind: string) => e.checks.filter((c) => c.kind === kind && c.status !== 'pass')

test('demo script: GB300 swap, liquid-cooling proposal, ripple effects, floor fix, brief, export round trip', async ({ page }) => {
  test.setTimeout(LIVE_AGENT ? 900_000 : 120_000)
  const pushed = recordServerMessages(page)

  await test.step('1. the default plan opens, every check passes and the agent is quiet', async () => {
    await openApp(page, twin)
    await expect(totals(page).getByText(/^All \d+ checks pass$/)).toBeVisible()
    await expect(thread(page).getByText(/^Nothing to flag yet/)).toBeVisible()
    await expect(messages(page)).toHaveCount(0)
  })

  await test.step('2. in Compute, rows 3 to 5 switch to GB300 NVL72: 28 kW to 132 kW per rack', async () => {
    await openLayer(page, 'Compute')
    const training = fieldGroup(page, 'Training block')
    await expect(training).toContainText('R3, R4, R5')
    await expect(training).toContainText('28 kW per rack')
    await pickCatalogEntry(page, 'Training block', 'NVIDIA GB300 NVL72')
    await expect(training).toContainText('132 kW per rack')
  })

  const warning = await test.step('3. the agent posts a red warning with a revision cloud and proposes liquid cooling', async () => {
    const message = await nextAgentMessage(page, 0)
    await expect(message.getByText('Problem', { exact: true })).toBeAttached()
    await expect(message).toContainText(LIVE_AGENT ? /air/i : /air can.t carry 132 ?\s?kW per rack/i)
    await expect(page.getByRole('group', { name: 'Revision clouds' }).getByRole('note', { name: /^Revision \d+/ }).first()).toBeAttached()
    // The proposal card is the message's only group, named by its title.
    const proposal = message.getByRole('group').first()
    await expect(proposal).toContainText(/direct-to-chip|liquid/i)
    await expect(proposal).toContainText(/Respects note: Water is scarce/)
    return proposal
  })

  await test.step('4. preview the proposal, then apply it', async () => {
    const preview = warning.getByRole('button', { name: 'Preview' })
    await preview.click()
    await expect(preview).toHaveAttribute('aria-pressed', 'true')
    await warning.getByRole('button', { name: 'Apply' }).click()
    await expect(warning.getByText('Applied', { exact: true })).toBeVisible()
    await openLayer(page, 'Cooling')
    await expect(fieldGroup(page, 'Training block')).toContainText('Direct-to-chip')
  })

  await test.step('5. the effects ripple out: floor, water, trim cooling and the grid cap', async () => {
    await expect(layerButton(page, 'Layout')).toHaveAccessibleName(/failing/)
    await expect(fieldGroup(page, 'Facility plant')).toContainText('Dry cooler')
    await expect(totalsValue(page, 'Water, peak day')).toHaveText(/^0\D/)
    await expect(totalsValue(page, 'Hours over the grid cap')).not.toHaveText(/^0\s?h$/)
    const e = await serverEvaluation()
    expect(nonPassing(e, 'layout.floorBay').length).toBeGreaterThan(0)
    expect(e.headline.hoursOverCap).toBeGreaterThan(0)
    expect(e.headline.usablePflops).toBeLessThan(e.headline.placedPflops)
  })

  await test.step('6. asked to fix the floor, the agent changes it through its tools and the camera follows', async () => {
    const viewsBefore = pushed.length
    await chat(page, 'Fix the floor, please.')
    await expect(layerButton(page, 'Layout')).not.toHaveAccessibleName(/failing/)
    expect(nonPassing(await serverEvaluation(), 'layout.floorBay')).toEqual([])
    const focus = pushed.slice(viewsBefore).find((m): m is Extract<ServerMsg, { t: 'view' }> => m.t === 'view' && m.action.type === 'focus')
    expect(focus, 'a focus view action reached the browser').toBeDefined()
  })

  await test.step('7. the agent writes the OpenFOAM simulation brief, and it opens', async () => {
    const reply = await chat(page, 'Write the simulation brief for OpenFOAM.')
    const link = reply.getByRole('link', { name: 'OpenFOAM simulation brief' })
    const download = page.waitForEvent('download')
    await link.click()
    const brief = await readFile(await (await download).path(), 'utf8')
    expect(brief).toMatch(/OpenFOAM/)
    expect(brief).toMatch(/buoyantSimpleFoam/)
  })

  await test.step('8. export the plan, re-import it, and get the identical result', async () => {
    const before = await totalsText(page)
    const evaluationBefore = await serverEvaluation()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export plan' }).click()
    const file = await (await download).path()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => totalsText(page)).not.toBe(before)

    await page.getByLabel('Import file').setInputFiles(file)
    await expect(page.getByRole('status').filter({ hasText: 'Imported the plan Default hall.' })).toBeVisible()
    await expect.poll(() => totalsText(page)).toBe(before)
    expect(await serverEvaluation()).toEqual(evaluationBefore)
  })
})
