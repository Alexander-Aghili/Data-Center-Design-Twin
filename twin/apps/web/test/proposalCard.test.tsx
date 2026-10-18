import { createDefaultPlan } from '@twin/catalog'
import { RACK, RACK_COOLING, type Proposal } from '@twin/schema'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ProposalCard as ProposalCardComponent } from '../src/agent/ProposalCard'
import type { useTwinStore as UseTwinStore } from '../src/state/store'
import { liquidProposal } from './fixtures/agentThread'

let ProposalCard: typeof ProposalCardComponent
let useTwinStore: typeof UseTwinStore

beforeAll(async () => {
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ ProposalCard } = await import('../src/agent/ProposalCard'))
  ;({ useTwinStore } = await import('../src/state/store'))
})

afterEach(cleanup)

describe('ProposalCard change lines', () => {
  it('name built-in catalog entries the plan has no copy of yet', () => {
    const plan = createDefaultPlan()
    delete plan.catalog[RACK.GB300_NVL72]
    delete plan.catalog[RACK_COOLING.DLC_1P]
    const proposal: Proposal = {
      ...liquidProposal,
      commands: [
        { type: 'setRackType', payload: { groupId: 'g2', rackTypeId: RACK.GB300_NVL72 } },
        { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: RACK_COOLING.DLC_1P } },
      ],
      respectsNotes: [],
    }
    useTwinStore.setState({ plan, proposals: {} })
    render(<ProposalCard proposal={proposal} />)
    const lines = within(screen.getByRole('group')).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines[0]).toMatch(/set to NVIDIA GB300 NVL72$/)
    expect(lines[1]).toMatch(/cooled by Direct-to-chip, single-phase$/)
  })
})
