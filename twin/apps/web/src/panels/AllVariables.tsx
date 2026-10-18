import { LAYER_IDS, type HourlySeriesKey, type LayerId, type Metric } from '@twin/schema'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { HourlyChart } from '../charts/HourlyChart'
import { fmtNull, fmtPct, fmtValue } from '../format'
import { useTwinStore } from '../state/store'
import { rankChecks } from './Checks'
import { LAYER_NAMES } from './LayerList'
import { StatusMark } from './StatusMark'

/** The hourly series that belong to a layer's numbers (one unit per chart). */
const HOURLY_BY_LAYER: Partial<Record<LayerId, HourlySeriesKey[]>> = {
  site: ['outdoorC', 'wetBulbC'],
  cooling: ['coolingW'],
  power: ['facilityW', 'itW'],
}

function groupMetrics(metrics: readonly Metric[]): [string | undefined, Metric[]][] {
  const groups = new Map<string | undefined, Metric[]>()
  for (const m of metrics) groups.set(m.group, [...(groups.get(m.group) ?? []), m])
  return [...groups]
}

/**
 * Every number the engine produced, grouped by layer, with its basis, plus every check.
 * A drawer over the center column; Escape or Close returns focus to whatever opened it.
 */
export function AllVariables({ onClose }: { onClose: () => void }) {
  const evaluation = useTwinStore((s) => s.evaluation)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    return () => opener?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  const q = query.trim().toLowerCase()
  const matches = (...texts: (string | undefined)[]) => q === '' || texts.some((t) => t?.toLowerCase().includes(q))
  const metrics = evaluation?.metrics ?? []
  const checks = rankChecks(evaluation?.checks ?? [])
  const sections = LAYER_IDS.map((layer) => ({
    layer,
    metrics: metrics.filter((m) => m.layer === layer && matches(m.label, m.group, LAYER_NAMES[layer])),
    checks: checks.filter((c) => c.layer === layer && matches(c.title, LAYER_NAMES[layer])),
    hourly: q === '' ? HOURLY_BY_LAYER[layer] : undefined,
  })).filter((s) => s.metrics.length > 0 || s.checks.length > 0)

  return (
    <div className="drawer" role="dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="drawer__head">
        <h2 id={titleId} className="drawer__title">
          All variables
        </h2>
        <span className="drawer__count">
          {metrics.length} numbers, {checks.length} checks
        </span>
        <input
          ref={searchRef}
          type="search"
          className="input drawer__search"
          name="variable-filter"
          aria-label="Filter variables by name"
          placeholder="Filter, e.g. CRAH…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="drawer__body">
        {sections.length === 0 && (
          <p className="empty-note">{q === '' ? 'No numbers yet. The engine fills this in once the plan evaluates.' : `Nothing matches “${query.trim()}”.`}</p>
        )}
        <div className="variables">
          {sections.map((s) => (
            <section key={s.layer} className="variables__layer" aria-labelledby={`${titleId}-${s.layer}`}>
              <h3 id={`${titleId}-${s.layer}`} className="variables__heading">
                {LAYER_NAMES[s.layer]}
              </h3>
              {s.metrics.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Variable</th>
                      <th scope="col" className="num">
                        Value
                      </th>
                      <th scope="col">Basis</th>
                    </tr>
                  </thead>
                  {groupMetrics(s.metrics).map(([group, ms]) => (
                    <tbody key={group ?? ''}>
                      {group && (
                        <tr className="data-table__group">
                          <th scope="rowgroup" colSpan={3}>
                            {group}
                          </th>
                        </tr>
                      )}
                      {ms.map((m) => (
                        <tr key={m.id}>
                          <th scope="row">
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => dispatchView({ type: 'select', target: { kind: 'metric', id: m.id } })}
                            >
                              {m.label}
                            </button>
                          </th>
                          <td className="num">{fmtValue(m.value, m.unit)}</td>
                          <td className="data-table__basis">{m.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              )}
              {s.checks.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Check</th>
                      <th scope="col" className="num">
                        Value
                      </th>
                      <th scope="col" className="num">
                        Limit
                      </th>
                      <th scope="col" className="num">
                        Use
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.checks.map((c) => (
                      <tr key={c.id}>
                        <th scope="row">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => dispatchView({ type: 'select', target: { kind: 'check', id: c.id } })}
                          >
                            <StatusMark status={c.status} label={c.title} />
                          </button>
                        </th>
                        <td className="num">{fmtValue(c.value, c.unit)}</td>
                        <td className="num">{fmtValue(c.limit, c.unit)}</td>
                        <td className="num">{fmtNull(c.utilization, fmtPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.hourly && <HourlyChart series={s.hourly} />}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
