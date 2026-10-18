import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultPlan, loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { createRegistry, defineCommand, listCommands } from '@twin/commands'
import {
  COMMAND_TOOL_PREFIX,
  CommandError,
  EvalDiffSchema,
  ToolInputSchemas,
  placementId,
  type Builtins,
  type Check,
  type Command,
  type EvalDiff,
  type Evaluation,
  type HistoryInfo,
  type Plan,
  type Status,
  type ViewAction,
} from '@twin/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanStore, StoreChange } from '../src/contracts.js'
import { buildTools, toolResultNumbers, type AgentTool, type ToolDeps, type ToolOutcome } from '../src/agent/tools/index.js'
import { ProposalBook, type PlanEngine } from '../src/agent/tools/propose.js'

// ---------- a small command set and a deterministic stand-in engine ----------

const renamePlan = defineCommand({
  type: 'renamePlan',
  layer: 'plan',
  title: 'Rename plan',
  description: 'Renames the plan. Use it when the person asks for a different plan name.',
  apply(draft, payload) {
    draft.name = payload.name
  },
  summarize: (payload) => `Plan renamed to ${payload.name}`,
})

const setSupply = defineCommand({
  type: 'setFacilitySupplyTemp',
  layer: 'cooling',
  title: 'Set facility supply temperature',
  description: 'Sets the facility water supply temperature in °C.',
  apply(draft, payload) {
    draft.cooling.facilitySupplyC = payload.celsius
  },
  summarize: (payload, plan) => `Facility supply ${plan.cooling.facilitySupplyC} °C to ${payload.celsius} °C`,
})

const placeRacks = defineCommand({
  type: 'placeRacks',
  layer: 'layout',
  title: 'Place racks',
  description: 'Places racks of a group into row slots.',
  apply(draft, payload) {
    for (const slot of payload.slots) {
      const id = placementId(payload.rowId, slot)
      if (draft.placements.some((p) => p.id === id)) throw new CommandError(`Slot ${slot} in ${payload.rowId} is occupied`, 'payload.slots')
      draft.placements.push({ id, groupId: payload.groupId, rowId: payload.rowId, slot })
    }
  },
  summarize: (payload) => `${payload.slots.length} racks placed in ${payload.rowId}`,
})

const testRegistry = createRegistry([renamePlan, setSupply, placeRacks])
const builtins: Builtins = { entries: [], rules: {} as Builtins['rules'] }

function check(id: string, kind: Check['kind'], status: Status, value: number, limit: number): Check {
  return {
    id,
    kind,
    layer: kind.startsWith('layout') ? 'layout' : 'cooling',
    subject: { kind: 'bay', id: id.split(':')[1] ?? id, objectIds: [`obj-${id}`] },
    title: `${kind} for ${id.split(':')[1]}`,
    value,
    limit,
    unit: 'kN/m²',
    utilization: value / limit,
    status,
    explanation: 'The distributed load from racks standing on this bay compared with the rated floor load. '.repeat(2),
    causes: [
      { layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type', value: 'GB300 NVL72' },
      { layer: 'cooling', path: 'rackGroups.g2.coolingMethodId', label: 'Cooling method', value: 'DLC adds 60 kg per rack' },
    ],
    advice: 'Spread racks over more bays or strengthen the floor.',
  }
}

/** Realistic in size (8760-hour series, a check per bay), driven by a few plan fields. */
function fakeEvaluate(plan: Plan): Evaluation {
  const supply = plan.cooling.facilitySupplyC
  const hours = 8760
  const series = (f: (h: number) => number) => Array.from({ length: hours }, (_, h) => f(h))
  const racks = plan.placements.map((p, i) => ({
    placementId: p.id, groupId: p.groupId, rowId: p.rowId, slot: p.slot, objectId: `rack:${p.id}`,
    powerW: 132_000 + i, heatW: 131_500, liquidW: 0, facilityWaterW: 0, airW: 131_500, flowLps: null,
    supplyC: supply, returnC: supply + 10, airInletC: 24.5, airOutletC: 41.3, weightKg: 1580, bayId: 'B3-2', flowShare: null, coolingOk: true,
  }))
  const bayChecks = plan.hall.bays.map((b, i) => check(`layout.floorBay:${b.id}`, 'layout.floorBay', i < 30 ? 'fail' : 'pass', 8.1 + i / 100, 7.2))
  const checks: Check[] = [
    check('cooling.coolantTemp:g1', 'cooling.coolantTemp', supply > 30 ? 'fail' : 'pass', supply, 30),
    check('cooling.crahCapacity:Z1', 'cooling.crahCapacity', 'warn', 0.93, 1),
    ...bayChecks,
  ]
  return {
    headline: {
      usablePflops: 3712.5, placedPflops: 5760, gpuCount: plan.placements.length * 16, hoursOverCap: 0, worstHour: 4932,
      buildable: !checks.some((c) => c.status === 'fail'), pueAnnual: 1.2 + supply / 1000, pueWorst: 1.4 + supply / 1000, waterM3PerDayPeak: 0,
    },
    metrics: Array.from({ length: 40 }, (_, i) => ({
      id: `metric-${i}`, layer: 'cooling' as const, label: `Metric ${i}`, value: i * 1.5, unit: 'kW', basis: 'calculated' as const, inputs: ['a', 'b'],
    })),
    checks,
    racks,
    equipment: Array.from({ length: 20 }, (_, i) => ({
      key: `crah:Z${i}`, category: 'crah', modelId: 'crah-1', count: 2, required: 2, positionIds: [`crah-${i}`], autoSized: true, loadW: 1e5, capacityW: 1.5e5, objectIds: [`crah-${i}`],
    })),
    rows: plan.hall.rows.map((r) => ({ rowId: r.id, airW: 2e6, liquidW: 0, flowLps: 0, buswayLoadA: 800, cduKey: null })),
    bays: plan.hall.bays.map((b) => ({ bayId: b.id, loadKnM2: 5, ratingKnM2: b.ratingKnM2, utilization: 5 / b.ratingKnM2 })),
    network: { links: [], opticsW: 12_000, cableM: 900, baseLatencyNs: 600, oversubscription: 1 },
    cost: { capexUsd: 48_500_000, byCategory: { racks: 4e7 }, buildWeeks: 38, criticalPath: ['chiller', 'transformer'], delayCostUsd: 2e6 },
    hourly: {
      outdoorC: series((h) => 10 + 15 * Math.sin(h / 1400)), wetBulbC: series(() => 12), itW: series(() => 1.05e7), coolingW: series(() => 2.1e6),
      facilityW: series(() => 1.3e7), pue: series(() => 1.24), waterM3: series(() => 0), trimW: series(() => 0),
    },
  }
}

const RANK: Record<Status, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 }

function fakeDiff(prev: Evaluation, next: Evaluation): EvalDiff {
  const before = new Map(prev.checks.map((c) => [c.id, c]))
  const headline: EvalDiff['headline'] = {}
  for (const key of Object.keys(next.headline) as (keyof Evaluation['headline'])[]) {
    if (prev.headline[key] !== next.headline[key]) headline[key] = { from: prev.headline[key], to: next.headline[key] }
  }
  const worsened = next.checks.filter((c) => { const p = before.get(c.id); return p !== undefined && RANK[c.status] > RANK[p.status] })
  const improved = next.checks.filter((c) => { const p = before.get(c.id); return p !== undefined && RANK[c.status] < RANK[p.status] })
  return { headline, worsened, improved, resolved: improved.filter((c) => c.status === 'pass'), newChecks: [], capexDeltaUsd: 0, buildWeeksDelta: 0, waterDeltaM3PerDay: 0 }
}

const engine: PlanEngine = { registry: testRegistry, evaluate: fakeEvaluate, diff: fakeDiff }

/** A PlanStore over the test registry: history of plans, all-or-nothing dispatchAll. */
function createFakeStore(): PlanStore & { authors: string[] } {
  let plan = createDefaultPlan()
  let evaluation = fakeEvaluate(plan)
  const past: Plan[] = []
  const future: Plan[] = []
  const authors: string[] = []
  const listeners = new Set<(c: StoreChange) => void>()
  const catalog = { get: () => undefined, all: () => [] }
  const commit = (next: Plan, author: 'user' | 'agent', summary: string, kind: StoreChange['kind']) => {
    const prev = evaluation
    plan = next
    evaluation = fakeEvaluate(plan)
    for (const cb of listeners) cb({ prev, next: evaluation, author, summary, kind })
  }
  const history = (): HistoryInfo => ({ canUndo: past.length > 0, canRedo: future.length > 0 })
  return {
    authors,
    state: () => ({ plan, evaluation, history: history() }),
    dispatch(cmd: Command, author) {
      try {
        const result = testRegistry.applyCommand(plan, cmd, catalog)
        past.push(plan)
        future.length = 0
        authors.push(author)
        commit(result.plan, author, result.summary, 'command')
        return { ok: true, summary: result.summary }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
    dispatchAll(cmds: Command[], author) {
      try {
        const result = testRegistry.applyCommands(plan, cmds, catalog)
        past.push(plan)
        future.length = 0
        authors.push(author)
        commit(result.plan, author, result.summaries.join('; '), 'command')
        return { ok: true, summaries: result.summaries }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
    undo() {
      const prev = past.pop()
      if (!prev) return false
      future.push(plan)
      commit(prev, 'user', 'Undo', 'undo')
      return true
    },
    redo() {
      const next = future.pop()
      if (!next) return false
      past.push(plan)
      commit(next, 'user', 'Redo', 'redo')
      return true
    },
    replace(next: Plan) {
      commit(next, 'user', 'Replaced', 'replace')
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    builtins: () => builtins,
  }
}

function setup(overrides: Partial<ToolDeps> = {}) {
  const store = createFakeStore()
  const views: ViewAction[] = []
  const proposals = new ProposalBook(store, engine)
  const dataDir = mkdtempSync(join(tmpdir(), 'twin-tools-'))
  const brief = vi.fn((plan: Plan, _evaluation: Evaluation, target: 'openfoam', notes?: string) => `# Brief for ${plan.name} (${target})\n\n${notes ?? ''}\n`)
  const tools = buildTools({ store, emitView: (a) => views.push(a), proposals, brief, dataDir, engine, ...overrides })
  const byName = new Map(tools.map((t) => [t.name, t]))
  const tool = (name: string): AgentTool => {
    const t = byName.get(name)
    if (!t) throw new Error(`no tool ${name}`)
    return t
  }
  const run = (name: string, input: unknown) => tool(name).run(input)
  return { store, views, proposals, dataDir, brief, tools, tool, run }
}

function okContent(outcome: ToolOutcome): string {
  if (!outcome.ok) throw new Error(`tool failed: ${outcome.error}`)
  return outcome.content
}

function okJson(outcome: ToolOutcome): Record<string, unknown> {
  return JSON.parse(okContent(outcome)) as Record<string, unknown>
}

afterEach(() => {
  vi.useRealTimers()
})

// ---------- tests ----------

describe('tool list', () => {
  it('every registry command has a cmd_ tool with identical JSON schema', () => {
    // The built-in registry (default engine) and the test registry.
    for (const [overrides, commands] of [
      [{ engine: undefined }, listCommands()],
      [{}, testRegistry.listCommands()],
    ] as const) {
      const { tools } = setup(overrides)
      const cmdTools = tools.filter((t) => t.name.startsWith(COMMAND_TOOL_PREFIX))
      expect(cmdTools.map((t) => t.name).sort()).toEqual(commands.map((c) => `${COMMAND_TOOL_PREFIX}${c.type}`).sort())
      for (const info of commands) {
        const t = cmdTools.find((x) => x.name === `${COMMAND_TOOL_PREFIX}${info.type}`)
        expect(t?.inputSchema).toEqual(info.jsonSchema)
        expect(t?.description).toBe(info.description)
      }
    }
    expect(testRegistry.listCommands()).toHaveLength(3)
  })

  it('has every non-command tool from the contract, with an object input schema and a description', () => {
    const { tools } = setup()
    for (const name of Object.keys(ToolInputSchemas)) {
      const t = tools.find((x) => x.name === name)
      expect(t, name).toBeDefined()
      expect(t?.inputSchema).toMatchObject({ type: 'object' })
      expect(t?.description.length).toBeGreaterThan(80)
    }
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
  })

  it('every tool input schema is a JSON Schema object with top-level type object', () => {
    for (const engineOverride of [{}, { engine: undefined }]) {
      const { tools } = setup(engineOverride)
      for (const t of tools) {
        expect(t.inputSchema, t.name).toMatchObject({ type: 'object' })
        expect(Array.isArray(t.inputSchema), t.name).toBe(false)
      }
      for (const name of ['undo', 'redo', 'clear_annotations', 'export_plan']) {
        expect(tools.find((t) => t.name === name)?.inputSchema).toMatchObject({ type: 'object', properties: {}, additionalProperties: false })
      }
    }
  })
})

describe('input validation', () => {
  it('tool input invalid returns ok:false with zod path messages', async () => {
    const { run } = setup()
    const focus = await run('focus', { kind: 'tower', id: '' })
    expect(focus.ok).toBe(false)
    if (!focus.ok) {
      expect(focus.error).toMatch(/^kind: /m)
      expect(focus.error).toMatch(/^id: /m)
    }
    const cmd = await run('cmd_placeRacks', { groupId: 'g1', rowId: 'R6', slots: [-1] })
    expect(cmd.ok).toBe(false)
    if (!cmd.ok) expect(cmd.error).toMatch(/^slots\.0: /m)
    const notObject = await run('get_evaluation', 'summary')
    expect(notObject.ok).toBe(false)
  })

  it('a command rejected by the plan returns ok:false with the reason and changes nothing', async () => {
    const { run, store } = setup()
    const before = store.state().plan
    const outcome = await run('cmd_placeRacks', { groupId: 'g1', rowId: 'R1', slots: [0] })
    expect(outcome).toEqual({ ok: false, error: 'Slot 0 in R1 is occupied' })
    expect(store.state().plan).toBe(before)
  })
})

describe('act', () => {
  it('cmd_ tool applies via store with author agent', async () => {
    const { run, store } = setup()
    const outcome = await run('cmd_setFacilitySupplyTemp', { celsius: 32 })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.summary).toBe('Facility supply 18 °C to 32 °C')
    expect(store.state().plan.cooling.facilitySupplyC).toBe(32)
    expect(store.authors).toEqual(['agent'])
    const content = okJson(outcome)
    expect(content.applied).toBe('Facility supply 18 °C to 32 °C')
    expect(JSON.stringify(content.diff)).toContain('cooling.coolantTemp:g1')
  })

  it('undo and redo go through the store and report when there is nothing to undo', async () => {
    const { run, store } = setup()
    expect((await run('undo', {})).ok).toBe(false)
    await run('cmd_renamePlan', { name: 'Hall B' })
    expect((await run('undo', {})).ok).toBe(true)
    expect(store.state().plan.name).toBe('Default hall')
    expect((await run('redo', {})).ok).toBe(true)
    expect(store.state().plan.name).toBe('Hall B')
  })
})

describe('what-if and proposals', () => {
  it('what_if does not change the plan and returns an EvalDiff', async () => {
    const { run, store } = setup()
    const before = store.state()
    const outcome = await run('what_if', { commands: [{ type: 'setFacilitySupplyTemp', payload: { celsius: 34 } }] })
    const content = okJson(outcome)
    expect(store.state().plan).toBe(before.plan)
    expect(store.state().evaluation).toBe(before.evaluation)
    expect(() => EvalDiffSchema.parse(content.diff)).not.toThrow()
    const diff = EvalDiffSchema.parse(content.diff)
    expect(diff.worsened.map((c) => c.id)).toEqual(['cooling.coolantTemp:g1'])
    expect(diff.headline.pueAnnual).toEqual({ from: 1.218, to: 1.234 })
    expect(content.summaries).toEqual(['Facility supply 18 °C to 34 °C'])
  })

  it('what_if reports which command fails and why', async () => {
    const { run } = setup()
    const unknown = await run('what_if', { commands: [{ type: 'renamePlan', payload: { name: 'X' } }, { type: 'fly', payload: {} }] })
    expect(unknown).toEqual({ ok: false, error: expect.stringMatching(/^commands\.1\.type: Unknown command "fly"/) })
    const badPayload = await run('what_if', { commands: [{ type: 'setFacilitySupplyTemp', payload: { celsius: 'hot' } }] })
    expect(badPayload.ok).toBe(false)
    if (!badPayload.ok) expect(badPayload.error).toMatch(/^commands\.0\.payload\.celsius: /m)
    const occupied = await run('what_if', { commands: [{ type: 'placeRacks', payload: { groupId: 'g1', rowId: 'R1', slots: [0] } }] })
    expect(occupied).toEqual({ ok: false, error: 'commands.0 (placeRacks): Slot 0 in R1 is occupied' })
  })

  it('propose_change stores proposal with diff and emits annotate view action when annotate given', async () => {
    const { run, views, proposals, store } = setup()
    const before = store.state().plan
    const outcome = await run('propose_change', {
      title: 'Warmer facility water',
      rationale: 'Raises chiller efficiency.',
      commands: [{ type: 'setFacilitySupplyTemp', payload: { celsius: 34 } }],
      respectsNotes: ['note-1'],
      violatesNotes: [],
      annotate: { objectIds: ['obj-cooling.coolantTemp:g1'], label: 'Coolant limit' },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(store.state().plan).toBe(before)
    const event = outcome.events?.find((e) => e.kind === 'proposal')
    expect(event?.kind).toBe('proposal')
    if (event?.kind !== 'proposal') return
    const proposal = event.proposal
    expect(proposals.get(proposal.id)).toEqual(proposal)
    expect(proposal).toMatchObject({ status: 'open', title: 'Warmer facility water', respectsNotes: ['note-1'], basePlanUpdatedAt: before.updatedAt })
    expect(proposal.diff.worsened.map((c) => c.id)).toEqual(['cooling.coolantTemp:g1'])
    expect(views).toEqual([
      { type: 'annotate', annotation: { tag: proposal.annotationTag, objectIds: ['obj-cooling.coolantTemp:g1'], label: 'Coolant limit', severity: 'info' } },
    ])
    expect(proposal.annotationTag).toBe(1)
    expect(okJson(outcome).proposalId).toBe(proposal.id)
  })

  it('a proposal cloud takes the worst status of the checks on its objects, so a fix for a failure draws in red', async () => {
    const { run, views, store } = setup()
    const failing = store.state().evaluation.checks.find((c) => c.status === 'fail')!
    const propose = (objectIds: string[]) =>
      run('propose_change', {
        title: 'Rename',
        rationale: 'Test',
        commands: [{ type: 'renamePlan', payload: { name: 'X' } }],
        respectsNotes: [],
        violatesNotes: [],
        annotate: { objectIds, label: 'Here' },
      })
    await propose(failing.subject.objectIds)
    await propose(['obj-cooling.crahCapacity:Z1'])
    await propose(['obj-cooling.coolantTemp:g1'])
    expect(views.map((v) => (v.type === 'annotate' ? v.annotation.severity : null))).toEqual(['problem', 'warning', 'info'])
  })

  it('propose_change without annotate emits no view action, and invalid commands create no proposal', async () => {
    const { run, views, proposals } = setup()
    const base = { title: 'T', rationale: 'R', respectsNotes: [], violatesNotes: [] }
    expect((await run('propose_change', { ...base, commands: [{ type: 'renamePlan', payload: { name: 'B' } }] })).ok).toBe(true)
    expect(views).toEqual([])
    const bad = await run('propose_change', { ...base, commands: [{ type: 'placeRacks', payload: { groupId: 'g1', rowId: 'R1', slots: [0] } }] })
    expect(bad.ok).toBe(false)
    expect(proposals.list()).toHaveLength(1)
  })

  describe('stale proposal', () => {
    it('fails re-validation after the plan changed: status stale, plan unchanged', () => {
      vi.useFakeTimers({ now: new Date('2026-10-18T10:00:00.000Z') })
      const { store, proposals } = setup()
      const proposal = proposals.create({
        title: 'Fill R6', rationale: 'More compute.', commands: [{ type: 'placeRacks', payload: { groupId: 'g1', rowId: 'R6', slots: [0, 1] } }],
        respectsNotes: [], violatesNotes: [],
      })
      vi.setSystemTime(new Date('2026-10-18T10:01:00.000Z'))
      expect(store.dispatch({ type: 'placeRacks', payload: { groupId: 'g2', rowId: 'R6', slots: [1] } }, 'user').ok).toBe(true)
      const before = store.state().plan
      const result = proposals.apply(proposal.id)
      expect(result.proposal.status).toBe('stale')
      expect(proposals.get(proposal.id)?.status).toBe('stale')
      expect(result.summary).toMatch(/Slot 1 in R6 is occupied/)
      expect(store.state().plan).toBe(before)
      expect(() => proposals.apply(proposal.id)).toThrow(/stale/)
    })

    it('still applies when every command passes, and records the basePlanUpdatedAt mismatch in the summary', () => {
      vi.useFakeTimers({ now: new Date('2026-10-18T10:00:00.000Z') })
      const { store, proposals } = setup()
      const proposal = proposals.create({
        title: 'Warmer water', rationale: 'Efficiency.', commands: [{ type: 'setFacilitySupplyTemp', payload: { celsius: 24 } }],
        respectsNotes: [], violatesNotes: [],
      })
      vi.setSystemTime(new Date('2026-10-18T10:01:00.000Z'))
      store.dispatch({ type: 'renamePlan', payload: { name: 'Hall B' } }, 'user')
      const changedAt = store.state().plan.updatedAt
      vi.setSystemTime(new Date('2026-10-18T10:02:00.000Z'))
      const result = proposals.apply(proposal.id)
      expect(result.proposal.status).toBe('applied')
      expect(store.state().plan.cooling.facilitySupplyC).toBe(24)
      expect(store.state().plan.name).toBe('Hall B')
      expect(result.summary).toContain('Facility supply 18 °C to 24 °C')
      expect(result.summary).toContain(proposal.basePlanUpdatedAt)
      expect(result.summary).toContain(changedAt)
      expect(store.authors.at(-1)).toBe('agent')
    })

    it('applies without a mismatch note when the plan did not change, and dismiss closes a proposal', () => {
      const { proposals } = setup()
      const a = proposals.create({ title: 'A', rationale: 'R', commands: [{ type: 'renamePlan', payload: { name: 'A' } }], respectsNotes: [], violatesNotes: [] })
      const applied = proposals.apply(a.id)
      expect(applied.summary).toBe('Plan renamed to A')
      const b = proposals.create({ title: 'B', rationale: 'R', commands: [{ type: 'renamePlan', payload: { name: 'B' } }], respectsNotes: [], violatesNotes: [] })
      expect(proposals.dismiss(b.id).status).toBe('dismissed')
      expect(() => proposals.apply(b.id)).toThrow(/dismissed/)
      expect(() => proposals.get('nope')).not.toThrow()
      expect(proposals.get('nope')).toBeUndefined()
      expect(() => proposals.dismiss('nope')).toThrow(/Unknown proposal/)
    })
  })
})

describe('read', () => {
  it('get_evaluation summary is under 4 KB for default plan', async () => {
    const { run } = setup()
    const outcome = await run('get_evaluation', { detail: 'summary' })
    const content = okContent(outcome)
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(4096)
    const summary = JSON.parse(content) as { headline: unknown; checks: { counts: Record<string, number>; problems: { id: string }[]; moreProblems: number } }
    expect(summary.headline).toMatchObject({ pueAnnual: 1.218, gpuCount: 1280 })
    expect(summary.checks.counts).toEqual({ fail: 30, warn: 1, unknown: 0, pass: 91 })
    // Failures first, highest utilization first: bay index 29 (B6-3) carries the most load.
    expect(summary.checks.problems[0]?.id).toBe('layout.floorBay:B6-3')
    expect(summary.checks.problems.length + summary.checks.moreProblems).toBe(31)
  })

  it('get_evaluation full carries the detail but leaves the hourly series to get_hourly', async () => {
    const { run } = setup()
    const full = okJson(await run('get_evaluation', { detail: 'full' }))
    expect(full.racks).toHaveLength(80)
    expect(full.checks).toHaveLength(122)
    expect(full.hourly).toMatch(/use get_hourly/)
  })

  it('explain_check returns causes and advice', async () => {
    const { run } = setup()
    const content = okJson(await run('explain_check', { checkId: 'layout.floorBay:B1-1' }))
    expect(content.causes).toEqual([
      { layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type', value: 'GB300 NVL72' },
      { layer: 'cooling', path: 'rackGroups.g2.coolingMethodId', label: 'Cooling method', value: 'DLC adds 60 kg per rack' },
    ])
    expect(content.advice).toBe('Spread racks over more bays or strengthen the floor.')
    expect(content.explanation).toBeTypeOf('string')
    const missing = await run('explain_check', { checkId: 'floorBay:B99' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('layout.floorBay:B1-1')
  })

  it('get_hourly returns the requested series over a range, with stats', async () => {
    const { run } = setup()
    const content = okJson(await run('get_hourly', { series: ['pue', 'itW'], fromHour: 100, toHour: 123, step: 2 }))
    expect(content).toMatchObject({ fromHour: 100, toHour: 123, step: 2 })
    const series = content.series as Record<string, { values: number[]; min: number; max: number; mean: number }>
    expect(series.pue?.values).toHaveLength(12)
    expect(series.itW?.max).toBe(1.05e7)
    const whole = okJson(await run('get_hourly', { series: ['outdoorC'] }))
    expect((whole.series as Record<string, { values: number[] }>).outdoorC?.values.length).toBeLessThanOrEqual(400)
    expect((await run('get_hourly', { series: ['pue'], fromHour: 50, toHour: 10 })).ok).toBe(false)
  })

  it('get_plan returns a section or a compact plan, and get_notes filters by target', async () => {
    const { run } = setup()
    expect(okJson(await run('get_plan', { section: 'cooling' }))).toMatchObject({ facilitySupplyC: 18 })
    expect(okJson(await run('get_plan', {})).name).toBe('Default hall')
    const notes = okJson(await run('get_notes', { target: 'decision:cooling' })).notes as { id: string }[]
    expect(notes.map((n) => n.id)).toEqual(['note-1'])
    const none = okJson(await run('get_notes', { target: 'group:g9' })).notes as unknown[]
    expect(none).toEqual([])
  })

  it('search_knowledge and read_knowledge accept bare risk slugs (R-slug)', async () => {
    const { run } = setup()
    const hits = okJson(await run('search_knowledge', { query: 'rack 130 kW air', limit: 3 })).hits as { slug: string }[]
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.map((h) => h.slug)).toContain('cooling/air-containment')
    const bare = await run('read_knowledge', { slug: 'air-containment' })
    expect(okContent(bare)).toMatch(/^# /)
    const full = await run('read_knowledge', { slug: 'cooling/air-containment' })
    expect(okContent(full)).toBe(okContent(bare))
    const missing = await run('read_knowledge', { slug: 'nope' })
    expect(missing.ok).toBe(false)
  })

  it('list_catalog names what it listed', async () => {
    const { run } = setup()
    const outcome = await run('list_catalog', { kind: 'rackCooling' })
    expect(outcome.ok && outcome.summary).toMatch(/^Listed \d+ rack cooling methods?$/)
    const all = await run('list_catalog', {})
    expect(all.ok && all.summary).toMatch(/^Listed \d+ catalog entr(y|ies)$/)
  })

  it('list_catalog and get_catalog_entry read the plan catalog merged over the built-ins', async () => {
    const { run, store } = setup()
    const custom = { id: 'coolant.test', kind: 'coolant', name: 'Test glycol', asOf: '2026-10', summary: 'A test coolant', custom: true } as const
    const q = (v: number) => ({ value: v, unit: '', basis: 'user' as const })
    store.replace({ ...store.state().plan, catalog: { 'coolant.test': { ...custom, cpJPerKgK: q(3900), densityKgM3: q(1030), viscosityPaS: q(0.002), dielectric: false, glycolFraction: q(0.25), twoPhase: false } } })
    const list = okJson(await run('list_catalog', { kind: 'coolant', query: 'glycol' })).entries as { id: string }[]
    expect(list.map((e) => e.id)).toEqual(['coolant.test'])
    expect(okJson(await run('get_catalog_entry', { id: 'coolant.test' }))).toMatchObject({ id: 'coolant.test', glycolFraction: { value: 0.25 } })
    expect((await run('get_catalog_entry', { id: 'nope' })).ok).toBe(false)
  })
})

describe('get_plan size', () => {
  // The server's plan carries snapshotted catalog entries, the Dallas climate with two 8760-hour series among them.
  const snapshotted = () => snapshotCatalog(createDefaultPlan(), loadBuiltins().entries)

  it('the default plan reads in under 8 KB, with catalog rows instead of entries', async () => {
    const { run, store } = setup()
    store.replace(snapshotted())
    const content = okContent(await run('get_plan', {}))
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(8 * 1024)
    expect(content).not.toContain('dryBulbC')
    const plan = JSON.parse(content) as {
      catalog: { entries: { id: string; kind: string }[] }
      placements: { count: number; byRow: Record<string, Record<string, number[]>> }
      hall: { rows: unknown[]; positions: unknown[]; bays: { count: number } }
      cooling: unknown
      rackGroups: unknown[]
    }
    expect(plan.catalog.entries.map((e) => e.id)).toContain('climate.dallas')
    expect(plan.placements.count).toBe(80)
    expect(plan.placements.byRow.R1?.g1).toHaveLength(16)
    expect(plan.hall.rows).toHaveLength(8)
    expect(plan.hall.bays.count).toBe(store.state().plan.hall.bays.length)
    expect(plan.cooling).toEqual(store.state().plan.cooling)
    expect(plan.rackGroups).toEqual(store.state().plan.rackGroups)
  })

  it('sections come in full, except the catalog, which comes as rows', async () => {
    const { run, store } = setup()
    store.replace(snapshotted())
    expect(okJson(await run('get_plan', { section: 'hall' }))).toEqual(store.state().plan.hall)
    expect(JSON.parse(okContent(await run('get_plan', { section: 'placements' })))).toEqual(store.state().plan.placements)
    const catalog = okContent(await run('get_plan', { section: 'catalog' }))
    expect(Buffer.byteLength(catalog, 'utf8')).toBeLessThan(8 * 1024)
    expect(catalog).not.toContain('dryBulbC')
    expect(catalog).toContain('get_catalog_entry')
  })
})

describe('view', () => {
  it('focus emits ViewAction', async () => {
    const { run, views } = setup()
    const outcome = await run('focus', { kind: 'row', id: 'R3', shot: 'row' })
    expect(outcome.ok).toBe(true)
    expect(views).toEqual([{ type: 'focus', target: { kind: 'row', id: 'R3' }, shot: 'row' }])
    const missing = await run('focus', { kind: 'rack', id: 'R9-99' })
    expect(missing.ok).toBe(false)
    expect(views).toHaveLength(1)
  })

  it('set_layer, set_overlay, annotate and clear_annotations emit their view actions with rising tags', async () => {
    const { run, views } = setup()
    await run('set_layer', { layer: 'cooling' })
    await run('set_overlay', { overlay: 'floorLoad' })
    await run('annotate', { objectIds: ['a'], label: 'Bay over limit', severity: 'problem' })
    await run('annotate', { objectIds: ['b'], label: 'Second', severity: 'warning' })
    await run('clear_annotations', {})
    expect(views).toEqual([
      { type: 'setLayer', layer: 'cooling' },
      { type: 'setOverlay', overlay: 'floorLoad' },
      { type: 'annotate', annotation: { tag: 1, objectIds: ['a'], label: 'Bay over limit', severity: 'problem' } },
      { type: 'annotate', annotation: { tag: 2, objectIds: ['b'], label: 'Second', severity: 'warning' } },
      { type: 'clearAnnotations' },
    ])
  })

  it('annotate maps placement ids, row ids, bay ids and equipment keys to scene object ids', async () => {
    const { run, views, store } = setup()
    const { plan, evaluation } = store.state()
    const first = plan.placements[0]!
    const rowRacks = evaluation.racks.filter((r) => r.rowId === first.rowId).map((r) => r.objectId)
    const bayRacks = evaluation.racks.filter((r) => r.bayId === 'B3-2').map((r) => r.objectId)
    await run('annotate', { objectIds: [first.id, `rack:${first.id}`], label: 'One rack', severity: 'problem' })
    await run('annotate', { objectIds: [first.rowId], label: 'A row', severity: 'problem' })
    await run('annotate', { objectIds: ['B3-2', 'crah:Z3'], label: 'Bay and CRAH', severity: 'warning' })
    await run('propose_change', {
      title: 'Rename',
      rationale: 'Test',
      commands: [{ type: 'renamePlan', payload: { name: 'X' } }],
      respectsNotes: [],
      violatesNotes: [],
      annotate: { objectIds: [first.id], label: 'Here' },
    })
    const ids = views.map((v) => (v.type === 'annotate' ? v.annotation.objectIds : []))
    expect(ids).toEqual([[`rack:${first.id}`], rowRacks, [...bayRacks, 'crah-3'], [`rack:${first.id}`]])
    expect(rowRacks.length).toBeGreaterThan(1)
  })
})

describe('documents', () => {
  it('generate_simulation_brief writes dataDir/briefs/<timestamp>-openfoam.md and emits a link event to /api/brief/file/<name>', async () => {
    const { run, dataDir, brief, store } = setup()
    const outcome = await run('generate_simulation_brief', { target: 'openfoam', agentNotes: 'Run the N-1 CRAH case first.' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const files = readdirSync(join(dataDir, 'briefs'))
    expect(files).toHaveLength(1)
    const name = files[0] ?? ''
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-openfoam\.md$/)
    expect(name).toMatch(/^[\w.-]+\.md$/)
    expect(brief).toHaveBeenCalledWith(store.state().plan, store.state().evaluation, 'openfoam', 'Run the N-1 CRAH case first.')
    expect(readFileSync(join(dataDir, 'briefs', name), 'utf8')).toContain('Run the N-1 CRAH case first.')
    expect(outcome.events).toEqual([{ kind: 'link', label: 'OpenFOAM simulation brief', href: `/api/brief/file/${name}` }])
    expect(okJson(outcome).href).toBe(`/api/brief/file/${name}`)
  })

  it('export_plan writes dataDir/exports/<name>.json and returns a link, not the plan', async () => {
    const { run, store, dataDir } = setup()
    store.replace(snapshotCatalog(createDefaultPlan(), loadBuiltins().entries))
    const outcome = await run('export_plan', {})
    const content = okContent(outcome)
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(512)
    const files = readdirSync(join(dataDir, 'exports'))
    expect(files).toHaveLength(1)
    const name = files[0] ?? ''
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-default-hall\.json$/)
    expect(JSON.parse(readFileSync(join(dataDir, 'exports', name), 'utf8'))).toEqual(store.state().plan)
    const href = `/api/plan/export/file/${name}`
    expect(JSON.parse(content)).toMatchObject({ file: name, href })
    if (outcome.ok) expect(outcome.events).toEqual([{ kind: 'link', label: 'Plan JSON', href }])
  })
})

describe('toolResult numbers', () => {
  it('lists the numeric values found in the result JSON (max 200)', () => {
    const content = JSON.stringify({ a: 1.5, b: [2, 3, { c: -4e-3 }], d: 'R3 has 12 racks', e: true, f: null, g: 1.5 })
    expect(toolResultNumbers(content)).toEqual([1.5, 2, 3, -0.004])
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => i))
    expect(toolResultNumbers(many)).toHaveLength(200)
    expect(toolResultNumbers('# Brief\nRack heat 132.5 kW at 24 °C')).toEqual([132.5, 24])
  })

  it('works on a real tool result', async () => {
    const { run } = setup()
    const numbers = toolResultNumbers(okContent(await run('get_evaluation', { detail: 'summary' })))
    expect(numbers).toContain(1.218)
    expect(numbers.length).toBeLessThanOrEqual(200)
  })
})
