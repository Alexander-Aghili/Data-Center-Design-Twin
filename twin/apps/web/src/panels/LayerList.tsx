import { LAYER_IDS, type Check, type LayerId } from '@twin/schema'
import { useTwinStore } from '../state/store'
import { StatusMark } from './StatusMark'

export const LAYER_NAMES: Record<LayerId, string> = {
  site: 'Site',
  workload: 'Workload',
  compute: 'Compute',
  layout: 'Layout',
  cooling: 'Cooling',
  power: 'Power',
  network: 'Network',
}

interface Issues {
  fail: number
  warn: number
}

function issuesByLayer(checks: readonly Check[]): Record<LayerId, Issues> {
  const out = Object.fromEntries(LAYER_IDS.map((id) => [id, { fail: 0, warn: 0 }])) as Record<LayerId, Issues>
  for (const c of checks) {
    if (c.status === 'fail' || c.status === 'warn') out[c.layer][c.status] += 1
  }
  return out
}

function describeIssues({ fail, warn }: Issues): string {
  const parts = [fail > 0 && `${fail} failing`, warn > 0 && `${warn} ${warn === 1 ? 'warning' : 'warnings'}`].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'no issues'
}

/** One row per planning layer: owner, name and its open issues. Choosing a row makes that layer active. */
export function LayerList() {
  const owners = useTwinStore((s) => s.plan?.owners)
  const checks = useTwinStore((s) => s.evaluation?.checks)
  const activeLayer = useTwinStore((s) => s.activeLayer)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const issues = issuesByLayer(checks ?? [])

  return (
    <nav aria-labelledby="layers-title">
      <h2 id="layers-title" className="section-title">
        Layers
      </h2>
      <ul className="layer-list">
        {LAYER_IDS.map((id) => {
          const owner = owners?.[id]
          const fixed = owner?.initials === '—'
          const who = owner ? (fixed ? owner.name.toLowerCase() : `owner ${owner.initials}`) : null
          const label = [LAYER_NAMES[id], who, describeIssues(issues[id])].filter(Boolean).join(', ')
          const { fail, warn } = issues[id]
          return (
            <li key={id}>
              <button
                type="button"
                className="layer-row"
                aria-label={label}
                aria-current={id === activeLayer ? 'true' : undefined}
                onClick={() => dispatchView({ type: 'setLayer', layer: id })}
              >
                <span className="layer-row__owner" title={owner?.name}>
                  {owner?.initials}
                </span>
                <span className="layer-row__name">{LAYER_NAMES[id]}</span>
                <span className="layer-row__issues">
                  {fail > 0 && <StatusMark status="fail" label={String(fail)} />}
                  {warn > 0 && <StatusMark status="warn" label={String(warn)} />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
