import type { AgentEvent, Command, ViewAction } from '@twin/schema'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../src/agent/runtime'
import { buildTools, ProposalBook } from '../src/agent/tools/index'
import { createPlanStore } from '../src/store'

// Live Claude API test (~$0.20). Runs only with RUN_LIVE_AGENT=1 and a key in the repo-root .env.
const ENV_FILE = '/Users/linushabetha/Data-Center-Design-Twin/.env'
const LIVE = process.env.RUN_LIVE_AGENT === '1' && existsSync(ENV_FILE)

function messageText(events: AgentEvent[], messageId: string): string {
  return events.flatMap((e) => (e.kind === 'textDelta' && e.messageId === messageId ? [e.text] : [])).join('')
}

describe.skipIf(!LIVE)('agent live', () => {
  it('flags air cooling after a GB300 swap, proposes liquid cooling, and answers the worst-hour PUE', { timeout: 240_000 }, async () => {
    process.loadEnvFile(ENV_FILE)
    const dataDir = mkdtempSync(join(tmpdir(), 'agent-live-'))
    try {
      const store = createPlanStore({ dataDir })
      const viewListeners = new Set<(a: ViewAction) => void>()
      const proposals = new ProposalBook(store)
      const tools = buildTools({
        store,
        emitView: (a) => viewListeners.forEach((cb) => cb(a)),
        proposals,
        brief: () => '# Simulation brief',
        dataDir,
      })
      const views = {
        subscribe(cb: (a: ViewAction) => void) {
          viewListeners.add(cb)
          return () => {
            viewListeners.delete(cb)
          }
        },
      }
      const runtime = createAgentRuntime({ store, tools, dataDir, proposals, views })
      store.onChange((c) => runtime.handleChange(c))
      const events: AgentEvent[] = []
      runtime.onEvent((e) => events.push(e))
      const ended = (pred: (start: AgentEvent & { kind: 'messageStart' }) => boolean, ms: number) =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no matching message within ${ms} ms: ${JSON.stringify(events)}`)), ms)
          const off = runtime.onEvent((e) => {
            if (e.kind !== 'messageEnd') return
            const start = events.find((s): s is AgentEvent & { kind: 'messageStart' } => s.kind === 'messageStart' && s.messageId === e.messageId)
            if (start && pred(start)) {
              clearTimeout(timer)
              off()
              resolve(e.messageId)
            }
          })
        })

      const swap: Command = { type: 'setRackType', payload: { groupId: 'g2', rackTypeId: 'rack.gb300-nvl72' } }
      const observed = ended((s) => s.trigger === 'observation', 60_000)
      expect(store.dispatch(swap, 'user')).toMatchObject({ ok: true })
      const observationId = await observed

      const start = events.find((e) => e.kind === 'messageStart' && e.messageId === observationId)
      expect(start).toMatchObject({ severity: 'problem' })
      expect(messageText(events, observationId)).toMatch(/air/i)
      const proposed = events.flatMap((e) => (e.kind === 'proposal' && e.messageId === observationId ? [e.proposal] : []))
      expect(proposed.flatMap((p) => p.commands.map((c) => c.type))).toContain('setCoolingMethod')

      const answered = ended((s) => s.trigger === 'chat', 120_000)
      runtime.handleChat('What is the PUE at the worst hour?')
      const answerId = await answered
      const pueWorst = store.state().evaluation.headline.pueWorst
      expect(pueWorst).not.toBeNull()
      expect(messageText(events, answerId)).toContain((pueWorst ?? 0).toFixed(2))
      expect(events.filter((e) => e.kind === 'error')).toEqual([])
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
