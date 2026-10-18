import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { RACK } from '@twin/schema'
import { openApp, totals, totalsText, Twin } from './harness'

let twin: Twin

test.beforeAll(async () => {
  twin = await new Twin().start()
})
test.afterAll(async () => twin?.close())

/** The server's current evaluation, which every number in the totals panel comes from. */
async function evaluation() {
  const res = await fetch(`${twin.serverUrl}/api/state`)
  return ((await res.json()) as { evaluation: unknown }).evaluation
}

async function sendCommand(type: string, payload: unknown) {
  const res = await fetch(`${twin.serverUrl}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: { type, payload } }),
  })
  expect(res.ok, await res.clone().text()).toBe(true)
}

test('export then re-import gives the identical totals', async ({ page }) => {
  await openApp(page, twin)
  const before = await totalsText(page)
  const evaluationBefore = await evaluation()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export plan' }).click()
  const file = await (await download).path()
  const exported = JSON.parse(await readFile(file, 'utf8')) as { name: string }
  expect(exported.name).toBe('Default hall')

  // Change the plan so the import has something to undo.
  await sendCommand('setRackType', { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 })
  await expect.poll(() => totalsText(page)).not.toBe(before)

  await page.getByLabel('Import file').setInputFiles(file)
  await expect(page.getByRole('status').filter({ hasText: 'Imported the plan Default hall.' })).toBeVisible()
  await expect.poll(() => totalsText(page)).toBe(before)
  expect(await evaluation()).toEqual(evaluationBefore)
})

test('a malformed plan is rejected with paths and leaves the plan as it was', async ({ page }) => {
  await openApp(page, twin)
  const before = await totalsText(page)

  await page.getByLabel('Import file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, name: 'Broken', rackGroups: 'none' })),
  })
  const alert = page.getByRole('alert').filter({ hasText: 'broken.json was not imported. Your current plan is unchanged.' })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('listitem').first()).toContainText(':')
  expect(await totalsText(page)).toBe(before)
  await expect(totals(page)).toBeVisible()
})
