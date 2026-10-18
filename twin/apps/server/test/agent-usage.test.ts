import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { costUsd, UsageLedger } from '../src/agent/usage'

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-usage-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

const usage = (input: number, output: number, cacheWrite = 0, cacheRead = 0) => ({ input, output, cacheWrite, cacheRead })

describe('costUsd', () => {
  it('prices claude-opus-5-5 at $4 input, $20 output, $5 cache write and $0.20 cache read per million tokens', () => {
    expect(costUsd('claude-opus-5-5', usage(1_000_000, 0))).toBeCloseTo(4, 10)
    expect(costUsd('claude-opus-5-5', usage(0, 1_000_000))).toBeCloseTo(20, 10)
    expect(costUsd('claude-opus-5-5', usage(0, 0, 1_000_000))).toBeCloseTo(5, 10)
    expect(costUsd('claude-opus-5-5', usage(0, 0, 0, 1_000_000))).toBeCloseTo(0.2, 10)
    // A typical agent step: 2k fresh input, 30k cached prefix read, 1k written to the cache, 800 output.
    expect(costUsd('claude-opus-5-5', usage(2000, 800, 1000, 30_000))).toBeCloseTo(0.008 + 0.016 + 0.005 + 0.006, 10)
  })
})

describe('UsageLedger', () => {
  const day = (iso: string) => () => new Date(iso)

  it('adds each request to today, keeps days apart and survives a restart through usage.json', () => {
    const file = join(dataDir, 'usage.json')
    let now = day('2026-10-18T09:00:00')
    const ledger = new UsageLedger(file, () => now())
    expect(ledger.todayUsd()).toBe(0)
    expect(ledger.record('claude-opus-5-5', usage(1000, 500, 0, 10_000))).toBeCloseTo(0.004 + 0.01 + 0.002, 10)
    ledger.record('claude-opus-5-5', usage(1000, 0))
    expect(ledger.todayUsd()).toBeCloseTo(0.02, 10)

    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved).toEqual({
      version: 1,
      days: { '2026-10-18': { requests: 2, input: 2000, output: 500, cacheWrite: 0, cacheRead: 10_000, usd: expect.closeTo(0.02, 10) } },
    })

    const reloaded = new UsageLedger(file, () => now())
    expect(reloaded.todayUsd()).toBeCloseTo(0.02, 10)
    now = day('2026-10-19T00:30:00')
    expect(reloaded.todayUsd()).toBe(0)
    reloaded.record('claude-opus-5-5', usage(0, 1000))
    expect(reloaded.todayUsd()).toBeCloseTo(0.02, 10)
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).days)).toEqual(['2026-10-18', '2026-10-19'])
  })

  it('starts empty from a missing or unreadable usage.json, and keeps working in memory without a file', () => {
    const file = join(dataDir, 'usage.json')
    writeFileSync(file, '{ not json')
    expect(new UsageLedger(file).todayUsd()).toBe(0)
    const memory = new UsageLedger(null)
    memory.record('claude-opus-5-5', usage(0, 1000))
    expect(memory.todayUsd()).toBeCloseTo(0.02, 10)
  })
})
