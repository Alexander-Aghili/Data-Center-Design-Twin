import { LAYER_IDS, type Check, type LayerId, type Plan } from '@twin/schema'

export const LAYER_NAMES: Record<LayerId, string> = {
  site: 'Site',
  workload: 'Workload',
  compute: 'Compute',
  layout: 'Layout',
  cooling: 'Cooling',
  power: 'Power',
  network: 'Network',
}

export interface LayerIssues {
  fail: number
  warn: number
}

/** Failing and warning checks per layer. */
export function issuesByLayer(checks: readonly Check[]): Record<LayerId, LayerIssues> {
  const out = Object.fromEntries(LAYER_IDS.map((id) => [id, { fail: 0, warn: 0 }])) as Record<LayerId, LayerIssues>
  for (const c of checks) {
    if (c.status === 'fail' || c.status === 'warn') out[c.layer][c.status] += 1
  }
  return out
}

function describeIssues({ fail, warn }: LayerIssues): string {
  const parts = [fail > 0 && `${fail} failing`, warn > 0 && `${warn} ${warn === 1 ? 'warning' : 'warnings'}`].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'no issues'
}

/** Screen-reader name of each layer tab: layer, owner, then its open issues ("Cooling, Mechanical engineer, 2 failing"). */
export function tabLabels(owners: Plan['owners'] | undefined, checks: readonly Check[]): Record<LayerId, string> {
  const issues = issuesByLayer(checks)
  const entries = LAYER_IDS.map((id) => [id, [LAYER_NAMES[id], owners?.[id]?.name, describeIssues(issues[id])].filter(Boolean).join(', ')])
  return Object.fromEntries(entries) as Record<LayerId, string>
}
