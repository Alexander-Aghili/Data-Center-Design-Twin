import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, ViewAction } from '@twin/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnthropicLike } from '../src/agent/client'
import { designAgentFactory } from '../src/agent/wire'
import { createPlanStore } from '../src/store'

const noModel: AnthropicLike = {
  beta: {
    messages: {
      stream() {
        throw new Error('the model is not called in this test')
      },
    },
  },
}

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'twin-wire-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

describe('designAgentFactory', () => {
  it('wires the real tools, proposals, view actions and briefs to one runtime', async () => {
    const store = createPlanStore({ dataDir })
    const agent = designAgentFactory({ dataDir, client: noModel })(store)
    const views: ViewAction[] = []
    const events: AgentEvent[] = []
    agent.onView((a) => views.push(a))
    agent.onEvent((e) => events.push(e))

    const names = agent.listTools().map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_evaluation', 'cmd_setRackType', 'propose_change', 'annotate', 'focus', 'generate_simulation_brief']))

    const placement = store.state().plan.placements[0]!
    expect((await agent.runTool('annotate', { objectIds: [placement.id], label: 'Here', severity: 'problem' })).ok).toBe(true)
    expect(views).toEqual([{ type: 'annotate', annotation: { tag: 1, objectIds: [`rack:${placement.id}`], label: 'Here', severity: 'problem' } }])

    const proposed = await agent.runTool('propose_change', {
      title: 'Warmer supply',
      rationale: 'Test',
      commands: [{ type: 'setFacilitySupplyTemp', payload: { celsius: store.state().plan.cooling.facilitySupplyC + 1 } }],
      respectsNotes: [],
      violatesNotes: [],
    })
    const { proposalId } = JSON.parse(proposed.result ?? '{}') as { proposalId: string }
    agent.applyProposal(proposalId)
    expect(events).toContainEqual({ kind: 'proposalStatus', proposalId, status: 'applied' })
    expect(store.state().history.last).toMatch(/Facility supply temperature/)

    expect((await agent.runTool('generate_simulation_brief', { target: 'openfoam', agentNotes: 'Check the hot aisle.' })).ok).toBe(true)
    expect(existsSync(join(dataDir, 'briefs'))).toBe(true)
    expect(readdirSync(join(dataDir, 'briefs'))).toHaveLength(1)
  })
})
