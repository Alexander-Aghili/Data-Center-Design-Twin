import type { Check, Status } from '@twin/schema'

const STATUS_RANK: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 }

/** Worst first: fail, warn, unknown, pass; within a status, the highest utilization first (unknown utilization last). */
export function rankChecks(checks: readonly Check[]): Check[] {
  const use = (c: Check) => c.utilization ?? -1
  return [...checks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || use(b) - use(a))
}
