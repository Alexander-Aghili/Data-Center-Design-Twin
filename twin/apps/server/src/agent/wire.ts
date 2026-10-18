import type { ViewAction } from '@twin/schema'
import { generateBrief } from '../brief/openfoam'
import type { AgentRuntime, PlanStore } from '../contracts'
import type { AnthropicLike } from './client'
import { createAgentRuntime } from './runtime'
import { buildTools, ProposalBook } from './tools/index'

/**
 * The design agent as `createApp`'s `agentFactory`: the real tools on the plan store, one proposal book shared by
 * `propose_change` and the apply/dismiss buttons, and the tools' view actions fanned out to the browsers.
 */
export function designAgentFactory(opts: { dataDir: string; client?: AnthropicLike }): (store: PlanStore) => AgentRuntime {
  return (store) => {
    const viewListeners = new Set<(a: ViewAction) => void>()
    const views = {
      subscribe(cb: (a: ViewAction) => void) {
        viewListeners.add(cb)
        return () => {
          viewListeners.delete(cb)
        }
      },
    }
    const proposals = new ProposalBook(store)
    const tools = buildTools({
      store,
      proposals,
      brief: generateBrief,
      dataDir: opts.dataDir,
      emitView: (a) => {
        for (const cb of [...viewListeners]) cb(a)
      },
    })
    return createAgentRuntime({ store, tools, dataDir: opts.dataDir, proposals, views, ...(opts.client ? { client: opts.client } : {}) })
  }
}
