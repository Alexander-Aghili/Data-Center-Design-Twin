# Data Center Design Twin: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This plan runs in **parallel waves** (superpowers:dispatching-parallel-agents): tasks inside one wave touch disjoint files and run at the same time, each in its own git worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost web app where every data-center planning layer (site, workload, compute, layout, cooling, power, network) edits one shared plan. It shows the cross-layer effects instantly in a choreographed 3D view, and a design agent on the Claude API watches the plan, warns, proposes fixes and can operate the whole app.

**Architecture:** A TypeScript npm-workspaces monorepo under `twin/`.
- **Pure packages:** schema (zod contracts), catalog (sourced JSON data), commands (the single typed command registry with undo) and engine (pure `evaluate(plan)`). Server, browser and MCP all share these.
- **Node server:** holds the plan, dispatches commands, pushes state over WebSocket, and runs the agent loop with `@anthropic-ai/sdk`. Its tools are generated from the command registry.
- **Web app:** React + React Three Fiber, rendering the scene, panels and agent thread.
- **External MCP server:** proxies the same tools to Claude Code.

**Tech Stack:** Node 20.20 (installed), npm workspaces, TypeScript 6.0.3, zod 4.6, immer 11, vitest 4.1 (vitest 5 needs Node 22), Vite 8.3, React 19.3, three 0.186, @react-three/fiber 9.8, @react-three/drei 10.7, @react-three/postprocessing 3.2, zustand 5, @fontsource-variable/archivo 5.3, fastify 5.12 + @fastify/websocket 11.3, @anthropic-ai/sdk 0.135, @modelcontextprotocol/sdk 1.32, @playwright/test 1.64, tsx 4.23.

**Spec:** `docs/superpowers/specs/2026-10-18-design-twin-app-design.md`. Every executor reads it before starting. It holds the intent, anti-goals, demo script and the approved visual direction (mockup: `.superpowers/brainstorm/51186-1792345830/content/cooling-layer-v4.html`).

## Global Constraints

These apply to every task. A task's requirements implicitly include all of them.

### Where the work happens

- **Branch:** all work lands on `linus/twin-app`.
- **Never touch:** `main` or Alexander's files (`README.md`, `catalog/`, `docs/spec/`, `docs/superpowers/specs/2026-10-18-phase1-design.md`, `docs/superpowers/plans/2026-10-18-plan1-core-engine-cli.md`).
- **App location:** everything lives under `twin/`, except this plan and the spec.
- **No pushing** to any remote.
- **Worktrees:** each wave-1+ task runs in its own worktree created with superpowers:using-git-worktrees:
  - path: `../dctwin-wt/<task-id>`
  - branch: `twin/<task-id>`, created from the current `linus/twin-app`
  - after creating it: run `npm install` in `twin/`
  - the coordinator merges finished task branches into `linus/twin-app`
  - if a task needs a teammate's merged work, it runs `git merge linus/twin-app`
- **File ownership:** a task edits only the files listed in its **Files** block.
- **Dependencies:** Task 1 installs every dependency for every workspace, so no later task edits `package.json` or `package-lock.json`. If a task truly needs a new dependency, it stops and asks the coordinator.

### Commands, ports and secrets

- **Node:** v20.20.2. Run everything from `twin/`.
- **Commands:**
  - tests: `npm test` (all workspaces) or `npx vitest run <path>`
  - type check: `npm run typecheck`
  - dev: `npm run dev` (server :4317 + web :5173)
  - e2e: `npm run e2e`
- **API key:** the agent reads `ANTHROPIC_API_KEY` from the repo-root `.env` (absolute path `/Users/linushabetha/Data-Center-Design-Twin/.env`, git-ignored, already holds a working key).
  - Never print, log, commit or copy the key.
  - Never `source` the `.env`.
  - The server loads it with `process.loadEnvFile(path)`.
  - Unit tests never call the real API; they inject a fake client.
  - Live API tests run only when `RUN_LIVE_AGENT=1`.
- **Model:** `claude-opus-5-5`. Load the `claude-api` skill before writing any API code and follow it: adaptive thinking, effort, streaming, refusal `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`, no forced `tool_choice`, append-only history.

### Units, numbers and copy

- **Units:** SI inside the engine. W, kg, m, m³, °C, K, s, L/s, kN/m², USD. Display conversions happen only in the web app (kW, MW, t, L/min, m³/day, weeks).
- **Numbers:** every catalog number is a `Quantity` with `basis`. Never use 0 to mean unknown; use `value: null`. The engine never emits `NaN` or `Infinity`. An undefined ratio becomes `null` and displays as "—".
- **Copy:** sentence case, plain verbs, no exclamation marks, no "→" on buttons, no all-caps labels, no middle-dot meta strings. Units are separated by a non-breaking space in the UI.

### Visual direction (approved; refine, don't replace)

| Element | Value |
|---|---|
| Paper | `#E6EBEC` |
| Panel | `#F3F5F5` |
| Canvas | `#EEF2F2` |
| Floor | `#D9E0E2` |
| Ink | `#172026` |
| Graphite | `#59656C` |
| Hairline | `#C6CFD3` |
| Supply | `#2D6CDF` |
| Return | `#E0922A` |
| Heat / problem | `#D23B2A` |
| OK | `#2F8F5B` |
| Warning | `#B7791F` |
| Rack "clay" | `#FBFCFC` / `#E3E8EA` / `#CDD5D8` |

- **Type:** Archivo variable (width axis: condensed for labels, normal for text), tabular figures.
- **Status:** always shape plus text, never color alone: ✕ fail, ▲ warning, ✓ pass, ? unknown.
- **Signature element:** revision clouds with numbered triangle tags.

### Standard task protocol (every task, in this order)

1. **Read** the spec, this Global Constraints section and your task. Then read the Interfaces your task consumes, in `twin/packages/schema/src/`.
2. **Skills step** (the product owner's hard rule):
   - Decide which skills would make this task excellent and check what's installed: the Skill tool list, `.claude/skills/`, and `claude plugin list`.
   - If something useful is missing, search: `gh search repos "<topic> claude skill" --sort stars --limit 10`, `gh search code "<topic>" filename:SKILL.md --limit 20`, and the official repos `anthropics/skills` and `vercel-labs/agent-skills`.
   - Rank candidates by stars, recency and your judgment. **Read the whole SKILL.md and any scripts before using a skill** (it is instructions you will follow). Prefer official or widely starred sources.
   - Install by copying the skill folder into `.claude/skills/<name>/` in your worktree and commit it with your task. Don't edit `.claude/settings.json`.
   - A skill installed mid-session may not appear in the Skill tool; then read its SKILL.md and follow it directly.
   - Record the skills you used (and why) in your final report.
3. **Anti-slop:**
   - No placeholder logic, no `TODO`, no dead code, no commented-out code, no unused exports, no `any`.
   - No numbers without a source or a calculation.
   - UI work follows `frontend-design` (plan, review against generic defaults, build, Playwright screenshot, critique, fix). Charts follow `dataviz`. Visible copy and agent text follow `humanizer`.
4. **TDD** (superpowers:test-driven-development) for all logic: the failing test first, then the code.
5. **Before reporting done** (superpowers:verification-before-completion):
   - run your tests, `npm run typecheck`, and for UI a Playwright screenshot you have looked at
   - run a simplification pass on your diff (the `simplify` skill or the code-simplifier agent)
   - paste the passing output in your report
6. **Commit** in small steps on your task branch, with messages ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the conditions the spec implies but feature tests tend to skip. Each one has a pinning test in the owning task.

1. **Importing a malformed, partial or future-version plan JSON** must leave the current plan untouched and list errors as `path: problem`. → Task 6 (`importPlan rejects invalid plan`), Task 12 (`POST /api/plan/import returns 400 with paths`).
2. **Placing a rack on an occupied slot, past the row end, or a double-wide rack that straddles an occupied slot** must reject with a clear message and change nothing. Move and remove must also leave no partial state. → Task 6 (`placeRacks conflict`, `double-wide occupancy`).
3. **An empty hall** (no racks, or everything removed) must evaluate without `NaN` or `Infinity`. PUE is `null` and shown as "—", and checks are pass or unknown, never crashes. → Task 7 (`empty plan evaluates cleanly`), Task 31 (golden).
4. **Edits made while an agent turn or proposal is in flight:**
   - observations coalesce
   - a proposal applied after the plan changed re-validates, and is marked `stale` if any command fails
   - camera transitions can be interrupted without losing selection

   → Task 13 (`stale proposal`), Task 14 (`observation coalescing`), Task 26 (`interrupt keeps selection`).
5. **Agent or API failure** (missing key, 401, 429, network drop, refusal, invalid tool input) shows a plain message in the thread. The server and UI keep working, and invalid tool input returns `is_error` to the model. → Task 13 (`tool input invalid`), Task 14 (`api error surfaces`).

---

## Wave plan and timing (4-hour hard limit)

| Wave | When | Tasks (parallel inside a wave) |
|---|---|---|
| 0: contracts | 0:00–0:30 | Task 1 (coordinator, sequential) |
| 1: build | 0:30–2:05 | Tasks 2–30, all parallel, one worktree each (29 agents) |
| 2: integrate | 2:05–3:10 | Tasks 31–34, parallel |
| 3: verify and polish | 3:10–3:55 | Tasks 35–37 |

During wave 1 the coordinator merges finished tasks into `linus/twin-app` in dependency order: schema-consuming packages first (2–10), then server/agent (11–17), then web (18–30). It tells running UI tasks when the engine lands so they can `git merge linus/twin-app` and see real numbers.

---

## Wave 0

### Task 1: Monorepo, contracts, fixtures and shared scene geometry

The one sequential task. Everything later builds against what it fixes. It is done by the coordinator (or one agent) and reviewed before wave 1 starts.

**Files:**
- Create `twin/` root:
  - `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create `twin/packages/schema/`:
  - `package.json`
  - `src/{index,quantity,ids,catalog,plan,commands,evaluation,view,agent,protocol,tools}.ts`
  - `test/schema.test.ts`
- Create `twin/packages/catalog/`:
  - `package.json`
  - `src/{index,defaultPlan}.ts`
  - `data/` (empty folders with `.gitkeep`)
  - `test/defaultPlan.test.ts`
- Create `twin/packages/commands/`:
  - `package.json`
  - `src/{index,define,registry}.ts`
  - `src/commands/.gitkeep`
- Create `twin/packages/engine/`:
  - `package.json`
  - `src/{index,evaluate,context}.ts`
  - module stubs (listed in Step 6)
- Create `twin/apps/server/package.json`, `twin/apps/web/package.json`, `twin/apps/mcp/package.json`.
- Create `twin/apps/server/src/contracts.ts` and the mount-point stubs listed in Step 7b.
- Create `twin/apps/web/`:
  - `index.html`, `vite.config.ts`
  - `src/{main.tsx,App.tsx}`
  - `src/state/{store,backend,localBackend}.ts`
  - `src/scene/{geometry,palette,registry}.ts`
  - `src/theme/tokens.css`
  - `test/geometry.test.ts`
- Create `twin/e2e/playwright.config.ts`.
- Copy skills into `.claude/skills/`: `anthropics/skills` `webapp-testing`; `vercel-labs/agent-skills` `react-best-practices`, `composition-patterns`, `web-design-guidelines`, `writing-guidelines`. Read each fully first, per the protocol.

**Interfaces (Produces): the contracts. Names here are binding for every later task.**

`quantity.ts`:
```ts
type Basis = 'vendor' | 'oem' | 'press' | 'textbook' | 'estimate' | 'user' | 'calculated'
interface Quantity { value: number | null; low?: number; high?: number; unit: string; basis: Basis; source?: string /* URL */; note?: string }
qty(value: number, unit: string, basis: Basis, extra?: Partial<Quantity>): Quantity   // helper
num(q: Quantity, pick?: 'value' | 'low' | 'high'): number | null                     // null-safe read
```
Rule enforced by `QuantitySchema.superRefine`: `vendor` and `oem` require `source`, and `estimate` requires `note`.

`ids.ts`: every built-in catalog id is a string constant, e.g. `export const RACK = { HGX_B300_AIR: 'rack.hgx-b300-air', ... } as const`. The full id list:

| Group | Ids |
|---|---|
| GPU | `gpu.b300`, `gpu.gb300`, `gpu.vr200`, `gpu.mi355x`, `gpu.mi455x` |
| RACK | `rack.hgx-b300-air`, `rack.gb300-nvl72`, `rack.vr-nvl72`, `rack.mi355x-air`, `rack.helios`, `rack.network`, `rack.storage` |
| RACK_COOLING | `rackCooling.air-contained`, `rackCooling.rdhx-passive`, `rackCooling.rdhx-active`, `rackCooling.dlc-1p`, `rackCooling.dlc-2p`, `rackCooling.immersion-1p`, `rackCooling.immersion-2p` |
| HEAT_REJECTION | `heatRejection.chiller-air`, `heatRejection.dry-cooler`, `heatRejection.adiabatic-dry-cooler`, `heatRejection.cooling-tower` |
| COOLANT | `coolant.water`, `coolant.pg25`, `coolant.pg40`, `coolant.dielectric-oil`, `coolant.refrigerant-2p`, `coolant.fluorocarbon-2p` |
| EQUIPMENT | `cdu.1200kw`, `cdu.2000kw`, `crah.200kw`, `crah.400kw`, `bufferTank.standard`, `busway.1250a`, `busway.2500a`, `ups.500kw`, `transformer.3mva`, `leaf.64x800g`, `optic.800g`, `cable.dac`, `cable.aec`, `cable.fiber` |
| CLIMATE | `climate.dallas`, `climate.phoenix`, `climate.frankfurt`, `climate.stockholm` |

`catalog.ts`: a discriminated union `CatalogEntry` on `kind`. The common fields are `{ id, kind, name, vendor?, asOf: string, custom?: boolean, sources?: {id: string, url: string, title: string}[], summary: string }`. The other fields are typed as `Quantity` unless noted.

**`gpu`:**

| Field | Type |
|---|---|
| `tdpW` | Quantity |
| `fp8Pflops` | Quantity |
| `fp4Pflops` | Quantity |
| `hbmGb` | Quantity |
| `cooling` | `'air' \| 'liquid' \| 'either'` |

**`rack`:**

| Field | Type / meaning |
|---|---|
| `role` | `'compute' \| 'network' \| 'storage'` |
| `gpuId` | string, optional |
| `gpuCount` | number |
| `nominalPowerW`, `peakPowerW` | power |
| `weightKg` | weight |
| `widthMm`, `depthMm`, `heightMm` | dimensions |
| `slotsWide` | number: `ceil(widthMm / 600)` |
| `feet` | number |
| `maxLiquidFraction` | the most heat a liquid method can capture for this rack, e.g. 0.85 for NVL72 |
| `maxCoolantSupplyC` | coolant supply temperature limit |
| `supportedCooling` | `RackCoolingCategory[]` |
| `supportedPower` | `('ac54' \| 'dc800')[]` |
| `scaleOutPorts` | number |
| `portGbps` | number |
| `fp8Pflops` | compute |
| `trays` | `{ compute: number; switch: number; power: number }` (for 3D) |
| `capexUsd` | cost |
| `leadTimeWeeks` | lead time |

**`rackCooling`:**

| Field | Type / meaning |
|---|---|
| `category` | `RackCoolingCategory = 'air' \| 'rdhx' \| 'dlc-1p' \| 'dlc-2p' \| 'immersion-1p' \| 'immersion-2p' \| 'custom'` |
| `maxRackW` | per-rack heat limit |
| `toTechnicalLoop` | fraction of rack heat into the CDU loop, capped by the rack's `maxLiquidFraction` |
| `toFacilityWaterAtRack` | fraction (RDHx only) |
| `coolantId` | string |
| `supplyRangeC` | `{min: Quantity; max: Quantity}` |
| `deltaTK` | temperature rise |
| `pressureDropKpa` | pressure drop |
| `addedWeightKgPerRack` | weight |
| `formFactor` | `'rack' \| 'tank'` |
| `tankFootprintM2PerRack` | floor area (tanks only) |
| `requiresCdu` | boolean |
| `pumpPowerFraction` | pump power per unit of heat |
| `capexUsdPerKw` | cost |
| `installWeeks`, `leadTimeWeeks` | schedule |
| `risks` | `string[]`: knowledge-base file slugs |
| `status` | `'mainstream' \| 'emerging' \| 'stalled' \| 'research'` |

**`heatRejection`:**

| Field | Type / meaning |
|---|---|
| `category` | `'chiller' \| 'dryCooler' \| 'adiabaticDryCooler' \| 'coolingTower' \| 'custom'` |
| `basis` | `'dryBulb' \| 'wetBulb'` |
| `approachK` | approach temperature |
| `copRef`, `copRefOutdoorC`, `copSlopePerK` | chiller efficiency curve |
| `economizer` | boolean |
| `fanPowerFraction` | fan power per unit of heat |
| `waterLPerKwh` | water per kWh of heat |
| `adiabaticAboveC` | Quantity, optional |
| `unitCapacityW` | unit size |
| `capexUsdPerKw` | cost |
| `leadTimeWeeks`, `installWeeks` | schedule |
| `footprintM2PerMw` | plant space |

**`coolant`:** `cpJPerKgK`, `densityKgM3`, `viscosityPaS`, `dielectric: boolean`, `glycolFraction`, `twoPhase: boolean`.

**`equipment`:** `category: 'cdu' | 'crah' | 'bufferTank' | 'busway' | 'ups' | 'transformer' | 'leaf' | 'optic' | 'cable'`, plus `params: Record<string, Quantity>`. Required param keys per category, enforced by a refine:

| Category | Required params |
|---|---|
| cdu | `capacityW`, `maxFlowLps`, `approachK`, `pumpPowerW`, `weightKg`, `capexUsd`, `leadTimeWeeks` |
| crah | `capacityW`, `airflowM3s`, `fanPowerW`, `capexUsd`, `leadTimeWeeks` |
| bufferTank | `capexUsdPerM3`, `leadTimeWeeks` |
| busway | `ratingA`, `voltageV`, `powerFactor`, `capexUsdPerM`, `leadTimeWeeks` |
| ups | `moduleW`, `efficiency`, `capexUsdPerKw`, `leadTimeWeeks` |
| transformer | `ratingVa`, `efficiency`, `capexUsd`, `leadTimeWeeks` |
| leaf | `ports`, `portGbps`, `powerW`, `capexUsd` |
| optic | `powerW`, `reachM`, `capexUsd` |
| cable | `reachM`, `powerWPerEnd`, `capexUsdPerM` |

**`climate`:** `city`, `lat`, `lon`, `dryBulbC: number[]` and `wetBulbC: number[]` (length 8760 each, refined), `designDryBulbC` (Quantity).

**`Rules`** (not a catalog entry): `Record<RuleKey, Quantity>`. `RuleKey` is a string union fixed here. The values are provided by Task 4's catalog work, and the rules file lives at `twin/packages/catalog/data/rules.json`.

| Group | Rule keys |
|---|---|
| Air | `airDensity`, `airCp`, `airDeltaTK`, `airDeltaTKContained` |
| Distribution | `distributionEfficiency`, `upsEfficiency`, `transformerEfficiency` |
| Facility power | `miscFacilityFraction` (lighting/office), `crahFanFractionFallback` |
| Liquid | `facilityLoopDeltaTK`, `manifoldHeaderLossFraction`, `balancingValvePumpPenalty` |
| Buffer and water | `bufferAllowedRiseK`, `chillerRestartS`, `towerBlowdownFactor` |
| Workload | `peakToAverageTraining`, `peakToAverageInference`, `peakToAverageMixed` |
| Network | `dacReachM`, `aecReachM`, `fiberNsPerM`, `copperNsPerM`, `hopNs` |
| Piping | `pipingUsdPerMRaised`, `pipingUsdPerMOverhead`, `raisedFloorInstallWeeks`, `overheadInstallWeeks`, `routingSlackM` |
| Checks | `warnThreshold` (0.8) |

`plan.ts`:
```ts
type LayerId = 'site' | 'workload' | 'compute' | 'layout' | 'cooling' | 'power' | 'network'
interface Plan {
  schemaVersion: 1; id: string; name: string; updatedAt: string
  owners: Record<LayerId, { initials: string; name: string }>
  site: { climateId: string; gridCapacityW: number; waterAllowanceM3PerDay: number; valueOfComputeUsdPerGpuHour: number }
  hall: Hall
  workload: { purpose: 'training' | 'inference' | 'mixed'; targetPflops: number }
  rackGroups: RackGroup[]                 // { id: string; name: string; rackTypeId: string; coolingMethodId: string }
  placements: Placement[]                 // { id: string /* "R3-07" */; groupId: string; rowId: string; slot: number /* leftmost slot */ }
  cooling: { heatRejectionId: string; facilitySupplyC: number; pipingRoute: 'raisedFloor' | 'overhead'; flowBalancing: boolean; bufferTankM3: number; containment: 'none' | 'hotAisle' | 'coldAisle' }
  power: { redundancy: 'N' | 'N+1' | '2N'; distribution: 'ac54' | 'dc800'; oversubscription: number }
  network: { fabric: 'railOptimized' | 'fatTree'; oversubscription: number }
  overrides: EquipmentOverride[]          // { key: string; modelId?: string; count?: number; positionIds?: string[] }
  notes: Note[]                           // { id; target: string; importance: 'must' | 'prefer' | 'fyi'; authorRole: LayerId; text: string; createdAt: string }
  catalog: Record<string, CatalogEntry>   // snapshot of every entry the plan uses + all custom entries
}
interface Hall {
  widthM: number; depthM: number; ceilingM: number
  floor: { type: 'raised' | 'slab' }
  bays: Bay[]          // { id: "B3-2"; x: number; z: number; w: number; d: number; ratingKnM2: number; pointLimitKn: number }
  rows: Row[]          // { id: "R1"; x: number; z: number; slotCount: number; slotPitchM: 0.6; rackDepthM: 1.2; hotAisle: 'north' | 'south' }
  positions: EquipmentPosition[]  // { id: string; kind: 'cdu' | 'crah' | 'plant' | 'electrical' | 'leaf'; x: number; z: number; servesRows: string[]; capacity: number }
}
```
- **Coordinates:** meters. The hall origin is the north-west corner, x runs east, z runs south, and y is up in 3D.
- **Note targets:** `decision:<dot.path>` (e.g. `decision:cooling.heatRejectionId`), `group:<groupId>`, `layer:<LayerId>`, `rack:<placementId>`.

`commands.ts`:
```ts
interface Command<T extends string = string, P = unknown> { type: T; payload: P }
interface CommandDef<T extends string, P> {
  type: T; layer: LayerId | 'plan'; title: string /* "Set cooling method" */
  description: string                // used verbatim as the agent tool description
  payload: z.ZodType<P>
  apply(draft: Draft<Plan>, payload: P, ctx: { catalog: CatalogIndex }): void   // immer draft; throw CommandError to reject
  summarize(payload: P, plan: Plan): string                                       // "Rows 3–5: GB300 NVL72"
}
class CommandError extends Error { constructor(message: string, public path?: string) }
```
The full command list. Payload shapes are fixed here as zod schemas, and Task 4 implements `apply`.

| Layer | Command | Payload |
|---|---|---|
| plan | `newPlan` | `{}` |
| plan | `importPlan` | `{ plan: unknown }` |
| plan | `renamePlan` | `{ name }` |
| site | `setSiteInput` | `{ field: 'climateId' \| 'gridCapacityW' \| 'waterAllowanceM3PerDay' \| 'valueOfComputeUsdPerGpuHour'; value: string \| number }` |
| site | `setFloor` | `{ type, ratingKnM2?: number }` |
| site | `setBayRating` | `{ bayId; ratingKnM2 }` |
| workload | `setWorkload` | `{ purpose?; targetPflops? }` |
| compute | `createRackGroup` | `{ name; rackTypeId; coolingMethodId }` |
| compute | `setRackType` | `{ groupId; rackTypeId }` |
| compute | `renameRackGroup` | `{ groupId; name }` |
| compute | `deleteRackGroup` | `{ groupId }`; rejects if placed racks remain |
| layout | `placeRacks` | `{ groupId; rowId; slots: number[] }` |
| layout | `fillRow` | `{ groupId; rowId; from: number; count: number }` |
| layout | `moveRack` | `{ placementId; rowId; slot }` |
| layout | `removeRacks` | `{ placementIds: string[] }` |
| layout | `setContainment` | `{ containment }` |
| layout | `assignZone` | `{ positionId; rowIds: string[] }` |
| cooling | `setCoolingMethod` | `{ groupId; coolingMethodId }` |
| cooling | `setHeatRejection` | `{ heatRejectionId }` |
| cooling | `setFacilitySupplyTemp` | `{ celsius }` |
| cooling | `setPipingRoute` | `{ route }` |
| cooling | `setFlowBalancing` | `{ enabled }` |
| cooling | `setBufferTank` | `{ m3 }` |
| power | `setRedundancy` | `{ redundancy }` |
| power | `setDistribution` | `{ distribution }` |
| power | `setOversubscription` | `{ factor }` |
| network | `setFabric` | `{ fabric }` |
| network | `setNetworkOversubscription` | `{ ratio }` |
| equipment | `overrideEquipment` | `{ key; modelId?; count?; positionIds? }` |
| equipment | `clearOverride` | `{ key }` |
| notes | `addNote` | `{ target; importance; authorRole; text }` |
| notes | `editNote` | `{ id; text?; importance? }` |
| notes | `removeNote` | `{ id }` |
| catalog | `addCatalogEntry` | `{ entry: CatalogEntry }` (forces `custom: true`) |
| catalog | `updateCatalogEntry` | `{ entry }` (custom only) |
| catalog | `removeCatalogEntry` | `{ id }` (custom and unused only) |

`registry.ts`:
```ts
const registry: ReadonlyMap<string, CommandDef<string, unknown>>
applyCommand(plan: Plan, cmd: Command, catalog: CatalogIndex): { plan: Plan; summary: string }   // validates payload with zod, then immer produce; throws CommandError
applyCommands(plan, cmds, catalog): { plan: Plan; summaries: string[] }                           // all-or-nothing
listCommands(): { type: string; layer: string; title: string; description: string; jsonSchema: object }[]   // z.toJSONSchema(payload)
```

`evaluation.ts`: these are the engine results. Every engine module returns its own slice.
```ts
type Status = 'pass' | 'warn' | 'fail' | 'unknown'
interface Metric { id: string; layer: LayerId; label: string; value: number | null; unit: string; basis: Basis; inputs: string[]; group?: string }
interface Cause { layer: LayerId; path: string /* "rackGroups.g2.rackTypeId" */; label: string; value: string }
interface Check {
  id: string                       // "<kind>:<subjectId>", e.g. "cooling.rackHeatLimit:g2"
  kind: CheckKind; layer: LayerId
  subject: { kind: 'group' | 'rack' | 'row' | 'bay' | 'equipment' | 'site' | 'plant'; id: string; objectIds: string[] /* 3D ids */ }
  title: string; value: number | null; limit: number | null; unit: string; utilization: number | null; status: Status
  worstFailure?: { scenario: string; value: number | null; utilization: number | null; status: Status }
  explanation: string; causes: Cause[]; advice?: string
}
type CheckKind =
  | 'cooling.rackHeatLimit' | 'cooling.crahCapacity' | 'cooling.cduCapacity' | 'cooling.cduPositions' | 'cooling.manifoldBalance'
  | 'cooling.coolantTemp' | 'cooling.heatRejection' | 'cooling.rideThrough' | 'cooling.waterPeakDay' | 'cooling.leakExposure'
  | 'power.gridWorstHour' | 'power.busway' | 'power.trainingSwing' | 'power.ups' | 'power.transformer' | 'power.inputCompat'
  | 'layout.floorBay' | 'layout.pointLoad'
  | 'network.copperReach' | 'network.leafPorts'
  | 'demand.leadTime' | 'workload.targetCompute'
interface RackResult { placementId; groupId; rowId; slot; objectId: string; powerW; heatW; liquidW; facilityWaterW; airW; flowLps: number | null;
  supplyC: number | null; returnC: number | null; airInletC: number | null; airOutletC: number | null; weightKg; bayId: string; flowShare: number | null; coolingOk: boolean }
interface SizedEquipment { key: string /* "cdu:R3" | "crah:Z1" | "plant" | "busway:R3" | "ups" | "transformer" | "leaf:L1" | "bufferTank" */; category: string; modelId: string | null;
  count: number; required: number; positionIds: string[]; autoSized: boolean; loadW: number; capacityW: number | null; objectIds: string[] }
interface HourlySeries { outdoorC: number[]; wetBulbC: number[]; itW: number[]; coolingW: number[]; facilityW: number[]; pue: (number | null)[]; waterM3: number[]; trimW: number[] }
interface Evaluation {
  headline: { usablePflops: number; placedPflops: number; gpuCount: number; hoursOverCap: number; worstHour: number; buildable: boolean; pueAnnual: number | null; pueWorst: number | null; waterM3PerDayPeak: number }
  metrics: Metric[]; checks: Check[]; racks: RackResult[]; equipment: SizedEquipment[]
  rows: { rowId: string; airW: number; liquidW: number; flowLps: number; buswayLoadA: number; cduKey: string | null }[]
  bays: { bayId: string; loadKnM2: number; ratingKnM2: number; utilization: number }[]
  network: { links: { fromId: string; toId: string; media: 'dac' | 'aec' | 'fiber'; lengthM: number }[]; opticsW: number; cableM: number; baseLatencyNs: number; oversubscription: number }
  cost: { capexUsd: number; byCategory: Record<string, number>; buildWeeks: number; criticalPath: string[]; delayCostUsd: number }
  hourly: HourlySeries
}
interface EvalDiff { headline: Partial<Record<keyof Evaluation['headline'], { from: number | boolean | null; to: number | boolean | null }>>;
  worsened: Check[]; improved: Check[]; resolved: Check[]; newChecks: Check[]; capexDeltaUsd: number; buildWeeksDelta: number; waterDeltaM3PerDay: number }
```

`view.ts`:
```ts
type Overlay = 'none' | 'liquid' | 'air' | 'temperature' | 'floorLoad' | 'power' | 'network'
type ShotId = 'site' | 'hall' | 'row' | 'rack' | 'tray' | 'gpu'
type ViewAction =
  | { type: 'setLayer'; layer: LayerId } | { type: 'setOverlay'; overlay: Overlay }
  | { type: 'focus'; target: { kind: 'rack' | 'row' | 'equipment' | 'gpu' | 'bay'; id: string }; shot?: ShotId }
  | { type: 'select'; target: { kind: string; id: string } | null }
  | { type: 'annotate'; annotation: Annotation } | { type: 'clearAnnotations' }
  | { type: 'previewProposal'; proposalId: string | null }
interface Annotation { tag: number; objectIds: string[]; label: string; severity: 'problem' | 'warning' | 'info'; messageId?: string }
const LAYER_DEFAULTS: Record<LayerId, { shot: ShotId; overlay: Overlay }>
// site→site/none, workload→hall/none, compute→gpu/temperature, layout→row/floorLoad, cooling→hall/liquid, power→hall/power, network→hall/network
```

`agent.ts`:
```ts
type Severity = 'problem' | 'warning' | 'info'
interface Proposal { id: string; title: string; rationale: string; commands: Command[]; respectsNotes: string[]; violatesNotes: string[];
  diff: EvalDiff; status: 'open' | 'applied' | 'dismissed' | 'stale'; annotationTag?: number; basePlanUpdatedAt: string }
type AgentEvent =
  | { kind: 'messageStart'; messageId: string; trigger: 'chat' | 'observation'; severity: Severity }
  | { kind: 'textDelta'; messageId: string; text: string }
  | { kind: 'toolCall'; messageId: string; callId: string; name: string; summary: string }
  | { kind: 'toolResult'; callId: string; ok: boolean; summary: string; numbers: number[] /* numeric values in the result, for grounding marks */ }
  | { kind: 'link'; messageId: string; label: string; href: string }   // e.g. a generated simulation brief
  | { kind: 'proposal'; messageId: string; proposal: Proposal }
  | { kind: 'proposalStatus'; proposalId: string; status: Proposal['status'] }
  | { kind: 'messageEnd'; messageId: string }
  | { kind: 'error'; messageId?: string; message: string }
  | { kind: 'userMessage'; messageId: string; text: string }
```

`protocol.ts` (WebSocket at `/ws`, JSON):
```ts
type ClientMsg = { t: 'hello' } | { t: 'command'; id: string; command: Command } | { t: 'undo' } | { t: 'redo' }
  | { t: 'chat'; text: string } | { t: 'resetChat' } | { t: 'proposal'; proposalId: string; action: 'apply' | 'dismiss' } | { t: 'view'; action: ViewAction }
type ServerMsg = { t: 'state'; plan: Plan; evaluation: Evaluation; history: { canUndo: boolean; canRedo: boolean; last?: string } }
  | { t: 'commandResult'; id: string; ok: boolean; error?: string } | { t: 'agent'; event: AgentEvent } | { t: 'view'; action: ViewAction }
  | { t: 'thread'; events: AgentEvent[] }   // replay on connect
```
HTTP on `:4317`:

| Method and path | Purpose |
|---|---|
| `GET /api/state` | current state |
| `POST /api/command {command}` | apply a command |
| `POST /api/undo`, `POST /api/redo` | history |
| `GET /api/plan/export` | download plan JSON |
| `POST /api/plan/import {plan}` | import a plan |
| `GET /api/catalog` | built-in catalog |
| `GET /api/brief?target=openfoam` | simulation brief (deterministic part only) |
| `GET /api/brief/file/:name` | download a brief the agent generated (stored in `dataDir/briefs/`) |
| `POST /api/tools/:name {input}` | run one agent tool; returns `{ ok, result \| error }` |
| `GET /api/tools` | tool list with JSON schemas |
| `POST /api/chat {text}` | send a chat message |

`tools.ts`: the non-command agent tools, with zod input schemas. Command tools are generated as `cmd_<type>`.

| Group | Tools |
|---|---|
| read | `get_plan {section?}`, `get_evaluation {detail: 'summary' \| 'full'}`, `explain_check {checkId}`, `get_hourly {series[], fromHour?, toHour?, step?}`, `list_catalog {kind?, query?}`, `get_catalog_entry {id}`, `get_notes {target?}`, `search_knowledge {query, limit?}`, `read_knowledge {slug}` |
| act | `undo {}`, `redo {}` |
| propose | `propose_change {title, rationale, commands, respectsNotes, violatesNotes, annotate?: {objectIds, label}}`, `what_if {commands}` |
| view | `set_layer {layer}`, `focus {kind, id, shot?}`, `set_overlay {overlay}`, `annotate {objectIds, label, severity}`, `clear_annotations {}` |
| documents | `generate_simulation_brief {target: 'openfoam', agentNotes: string}` (writes `dataDir/briefs/<timestamp>-openfoam.md`, emits a `link` event), `export_plan {}` |

`apps/server/src/contracts.ts` (server-side contracts, so Tasks 12–14 build in parallel):
```ts
interface StoreChange { prev: Evaluation; next: Evaluation; author: 'user' | 'agent'; summary: string; kind: 'command' | 'undo' | 'redo' | 'replace' }
interface PlanStore {
  state(): { plan: Plan; evaluation: Evaluation; history: { canUndo: boolean; canRedo: boolean; last?: string } }
  dispatch(cmd: Command, author: 'user' | 'agent'): { ok: true; summary: string } | { ok: false; error: string }
  dispatchAll(cmds: Command[], author: 'user' | 'agent'): { ok: true; summaries: string[] } | { ok: false; error: string }   // all-or-nothing, one history entry
  undo(): boolean; redo(): boolean; replace(plan: Plan): void
  onChange(cb: (change: StoreChange) => void): () => void
  builtins(): { entries: CatalogEntry[]; rules: Rules }
}
interface AgentRuntime {
  handleChat(text: string): void; handleChange(change: StoreChange): void; resetConversation(): void
  applyProposal(id: string): void; dismissProposal(id: string): void
  onEvent(cb: (e: AgentEvent) => void): () => void; onView(cb: (a: ViewAction) => void): () => void
  threadEvents(): AgentEvent[]
  runTool(name: string, input: unknown): Promise<{ ok: boolean; result?: string; error?: string }>
  listTools(): { name: string; description: string; inputSchema: object }[]
}
```

`context.ts` (engine):
```ts
interface CatalogIndex { get<K extends CatalogEntry['kind']>(id: string, kind?: K): Extract<CatalogEntry, { kind: K }> | undefined; all(): CatalogEntry[] }
interface EvalContext { plan: Plan; catalog: CatalogIndex; rules: Rules; climate: ClimateEntry }
makeCatalogIndex(entries: CatalogEntry[]): CatalogIndex
```

**Web contracts:**

`apps/web/src/scene/geometry.ts`, pure and shared by all 3D tasks:
```ts
slotWorld(plan: Plan, rowId: string, slot: number, slotsWide = 1): { x: number; z: number; rotY: number }   // rack center on floor
rackSize(entry: RackEntry): { w: number; d: number; h: number }                                             // meters
positionWorld(plan: Plan, positionId: string): { x: number; z: number }
hallBounds(plan: Plan): { min: [number, number, number]; max: [number, number, number] }
objectIdForPlacement(placementId: string): string     // "rack:R3-07"
objectIdForEquipment(key: string, index: number): string   // "eq:cdu:R3:0"
```

`apps/web/src/scene/registry.ts`:
```ts
useSceneRegistry: zustand store { objects: Map<string, { kind: string; ref: THREE.Object3D }>; register(id, kind, ref): () => void; worldBox(id): THREE.Box3 | null }
```

`apps/web/src/scene/palette.ts`: physics colors from the visual-direction table, plus `tempColor(c: number, min: number, max: number): string` (supply blue → return amber → heat red).

`apps/web/src/state/store.ts`, the zustand store every UI task reads:
```ts
interface TwinState {
  connection: 'connecting' | 'online' | 'local' | 'offline'
  plan: Plan | null; evaluation: Evaluation | null; history: { canUndo: boolean; canRedo: boolean; last?: string }
  activeLayer: LayerId; overlay: Overlay; shot: ShotId; selection: { kind: string; id: string } | null
  annotations: Annotation[]; thread: AgentEvent[]; proposals: Record<string, Proposal>; previewProposalId: string | null
  lastError: string | null
  send(cmd: Command): Promise<void>; undo(): void; redo(): void; chat(text: string): void
  applyProposal(id: string): void; dismissProposal(id: string): void
  dispatchView(a: ViewAction): void   // local view change; also used for server-pushed view actions
}
```

`backend.ts`:
```ts
interface Backend { connect(onMsg: (m: ServerMsg) => void): void; send(m: ClientMsg): void }
```
`SocketBackend` is used by default. `LocalBackend` is used when `?local=1` or when the server is unreachable: it runs `applyCommand` + `evaluate` in the browser, chat is disabled, and the thread says the agent needs the server.

- [ ] **Step 1: Skills step.** Per protocol. Suggested: `webapp-testing`, `react-best-practices`, `composition-patterns` (install now, per the Files list), `claude-api` (read before `agent.ts` and `tools.ts`), and zod v4 docs.
- [ ] **Step 2: Scaffold the workspaces and install every dependency.**
  - Root `package.json` scripts: `test` (vitest run), `typecheck` (tsc -b), `dev` (runs server and web together via `node --run`, or a tiny `scripts/dev.mjs` spawning both), `e2e` (playwright test).
  - Workspace packages export `src/index.ts` directly (`"exports": {".": "./src/index.ts"}`), with no build step.
  - Install with exact versions:
    - every workspace: `zod@4.6.7`, `immer@11.1.21`
    - web: `react@19.3.1`, `react-dom@19.3.1`, `three@0.186.1`, `@types/three@0.186.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, `@react-three/postprocessing@3.2.0`, `postprocessing@6.39.5`, `zustand@5.0.15`, `@fontsource-variable/archivo@5.3.0`, `vite@8.3.4`, `@vitejs/plugin-react@6.1.2`, `@testing-library/react@16.3.3`, `jsdom@30.1.3`
    - server: `fastify@5.12.7`, `@fastify/websocket@11.3.4`, `ws@8.22.0`, `@types/ws@8.18.2`, `@anthropic-ai/sdk@0.135.0`
    - mcp: `@modelcontextprotocol/sdk@1.32.1`
    - root dev: `typescript@6.0.3`, `tsx@4.23.15`, `vitest@4.1.12`, `@playwright/test@1.64.1`
  - Run `npx playwright install chromium`.
  - Vite proxies `/api` and `/ws` to `http://localhost:4317`.
- [ ] **Step 3: Write `test/schema.test.ts`:**
  - `QuantitySchema rejects vendor without source`
  - `QuantitySchema rejects estimate without note`
  - `PlanSchema round-trips createDefaultPlan()` (parse → stringify → parse is deep-equal)
  - `CommandSchemas cover every command type in the table` (the registry key set equals the table's 36 types)
  - `climate arrays must be 8760 long`

  Run them and see them fail.
- [ ] **Step 4: Implement the schema files** exactly as specified above, with zod schemas `XSchema` and `type X = z.infer<typeof XSchema>`. Run the tests and see them pass.
- [ ] **Step 5: Write `packages/catalog/src/defaultPlan.ts`:** `createDefaultPlan(): Plan`, which builds the ordinary starting hall from the spec. Its `catalog` field is left empty, and the server fills it from the built-in catalog via `snapshotCatalog(plan, entries)` (implemented in Task 2).

  | Part | Value |
  |---|---|
  | Hall | 40 m × 36 m, ceiling 4.5 m, raised floor |
  | Bays | 3.6 × 3.6 m grid, rating 7.2 kN/m² (≈150 psf, an older raised floor; the value is chosen so GB300 + DLC overloads it, and the integration task tunes it), point limit 4.5 kN |
  | Rows | 8 rows `R1`–`R8`, x = 8, z = 4 + 3.6·j, 24 slots at 0.6 m, alternating `hotAisle` |
  | CRAH positions | `crah-W1`…`crah-W4` on the west wall (x = 1.5), each serving 2 rows |
  | CDU positions | `cdu-E1`…`cdu-E8` at the east row ends (x = 8 + 24·0.6 + 1.2), one per row |
  | Other positions | `plant-1` outside the north wall, `elec-1`, `leaf-1`/`leaf-2` row-end positions |
  | Groups | `g1` "Inference block" (`rack.hgx-b300-air`, `rackCooling.air-contained`) in R1–R2, slots 0–15. `g2` "Training block" (same types) in R3–R5, slots 0–15 |
  | Cooling | `heatRejection.chiller-air`, 18 °C supply, raised-floor piping, no balancing, 0 m³ buffer, hot-aisle containment |
  | Power | `N+1`, `ac54`, 1.0 oversubscription |
  | Network | `railOptimized`, 1:1 |
  | Site | `climate.dallas`, 10 MW grid, 120 m³/day water, $2.50/GPU-hour |
  | Owners | Site `—`, Workload `AK`, Compute `JR`, Layout `MS`, Cooling `LH`, Power `DC`, Network `RM` |
  | Note | `decision:cooling.heatRejectionId`, `prefer`, by `cooling`: "Water is scarce on this site. Avoid evaporative towers." |

  Test: `default plan has 80 placed racks, 2 groups, no overlapping slots`.
- [ ] **Step 6: Commands and engine skeletons.**
  - `define.ts` exports `defineCommand`.
  - `registry.ts` builds the registry from `src/commands/*.ts` modules. Each module exports `commands: CommandDef[]`, and the files listed in Task 6 are created there as empty arrays now.
  - `evaluate.ts` runs the module pipeline in this order and assembles `Evaluation`. Each module file exists as a stub returning an empty but well-typed slice (zeros, empty arrays, `null`), never throwing, so the UI can render before the engine lands. Module signatures:
    - `racks.ts`: `computeRacks(ctx) → RackResult[]`
    - `cooling/air.ts`: `airSide(ctx, racks) → { rows; checks; metrics; crahLoads: Record<string, number> }`
    - `cooling/liquid.ts`: `liquidSide(ctx, racks) → { racks: RackResult[] /* with flow, temps, flowShare */; rowFlows; checks; metrics }`
    - `sizing.ts`: `sizeEquipment(ctx, racks, air, liquid) → { equipment: SizedEquipment[]; checks }`
    - `cooling/rejection.ts`: `rejectHeat(ctx, racks, equipment) → { hourly: Pick<HourlySeries, 'outdoorC' | 'wetBulbC' | 'coolingW' | 'trimW' | 'waterM3'>; checks; metrics }`
    - `cooling/buffer.ts`: `rideThrough(ctx, racks) → { checks; metrics }`
    - `network.ts`: `networkFabric(ctx, racks) → { network: Evaluation['network']; checks; metrics }`
    - `power.ts`: `powerBudget(ctx, racks, equipment, rejection, network) → { hourly: Pick<HourlySeries, 'itW' | 'facilityW' | 'pue'>; rows; checks; metrics; headline: Partial<Evaluation['headline']> }`
    - `floor.ts`: `floorLoads(ctx, racks, equipment) → { bays; checks; metrics }`
    - `cost.ts`: `costAndSchedule(ctx, racks, equipment) → { cost: Evaluation['cost']; checks; metrics }`
    - `demand.ts`: `demandChecks(ctx, racks, power) → { checks }`
    - `n1.ts`: `applyFailureScenarios(ctx, base: Evaluation) → Evaluation`
    - `causes.ts`: `attachCauses(ctx, checks) → Check[]`
    - `diff.ts`: `diffEvaluations(prev, next) → EvalDiff`
    - `assemble.ts`: `assemble(ctx, slices) → Evaluation`
  - `evaluate(plan: Plan, builtins: { entries: CatalogEntry[]; rules: Rules }) → Evaluation` resolves the catalog from `plan.catalog` merged over the built-ins.
- [ ] **Step 7: Web skeleton and shared scene geometry.**
  - `App.tsx` renders the three-column grid with empty regions named `LayerColumn`, `SceneRegion`, `TotalsRegion`, `AgentRegion`.
  - `tokens.css` holds the visual-direction values.
  - Store, backends, `geometry.ts`, `registry.ts`, `palette.ts`.
  - Tests in `test/geometry.test.ts`: `slotWorld places R1 slot 0 at x=8.3`, `double-wide rack centers across two slots`, `hallBounds matches hall size`.
- [ ] **Step 7b: Mount-point stubs.** Wave-1 tasks mount each other's components, so Task 1 creates each mount point as a typed stub (a component returning `null`, or a function with its final signature returning an empty value). The owning task replaces the stub. Stubs:

  | File | Stub exports | Owner |
  |---|---|---|
  | `apps/web/src/panels/decisions/index.tsx` | `DecisionPanel` | 21 |
  | `apps/web/src/agent/Thread.tsx` | `Thread` | 22 |
  | `apps/web/src/panels/Inspector.tsx` | `Inspector` | 23 |
  | `apps/web/src/strips/Strip.tsx` | `Strip` | 23 |
  | `apps/web/src/charts/HourlyChart.tsx` | `HourlyChart` | 23 |
  | `apps/web/src/catalog/CatalogBrowser.tsx` | `CatalogBrowser` | 24 |
  | `apps/web/src/io/ImportExport.tsx` | `ImportExport` | 24 |
  | `apps/web/src/scene/Scene.tsx` | `Scene` | 25 |
  | `apps/web/src/scene/camera/CameraRig.tsx` | `CameraRig` | 26 |
  | `apps/web/src/scene/overlays/{LiquidFlow,AirFlow,Temperature,HeatShimmer}.tsx` | one component each | 27 |
  | `apps/web/src/scene/overlays/{FloorLoad,PowerLoad,Cables,Ghost}.tsx` | one component each | 28 |
  | `apps/web/src/scene/Picking.tsx` | `Picking` | 28 |
  | `apps/web/src/scene/annotations/RevisionClouds.tsx` | `RevisionClouds` | 29 |
  | `apps/web/src/scene/overlays/{WorkloadTint,SiteLabels}.tsx` | one component each | 30 |
  | `apps/web/src/panels/LayerHeader.tsx` | `LayerHeader` | 30 |
  | `apps/server/src/agent/prompt/system.ts` | `SYSTEM_PROMPT = "You are the design agent for this data-center plan."` | 16 |
  | `apps/server/src/knowledge/index.ts` | `KNOWLEDGE_SLUGS`, `searchKnowledge`, `readKnowledge` with final signatures, returning `[]`, `[]` and throwing "not found" | 15 |

  Mounting:
  - Task 1 also writes `apps/web/src/scene/overlays/index.tsx`, which mounts every overlay component by the store's `overlay` and `activeLayer`. It owns that file; Task 25's `Scene` renders `<Overlays />`, `<CameraRig />` and `<Picking />`.
  - Task 20's `App` mounts `Scene`, `RevisionClouds` (above the canvas), `LayerHeader`, `Strip`, `DecisionPanel`, `Thread`, `Inspector`, `CatalogBrowser` and `ImportExport`.
- [ ] **Step 8: Verify and commit.** `npm test`, `npm run typecheck` and `npm run dev` all run (the page shows the empty grid). Commit to `linus/twin-app`. The coordinator reviews the contracts once before starting wave 1.

---

## Wave 1 (all parallel)

Each task below follows the Standard task protocol. Where it says **Consumes**, read those names in `twin/packages/schema/src/`.

### Task 2: Catalog loader, validator and snapshot

**Files:**
- Create `twin/packages/catalog/src/{load,validate,snapshot}.ts`
- Create `twin/packages/catalog/test/catalog.test.ts`
- Modify `twin/packages/catalog/src/index.ts`

**Interfaces:**
- Consumes `CatalogEntrySchema`, `RulesSchema` and `ids.ts`.
- Produces:
  - `loadBuiltins(): { entries: CatalogEntry[]; rules: Rules }`: reads `data/**/*.json` at import time via `import.meta.glob` in the browser and `fs` in Node. Export both variants behind one function using a static JSON index file `data/index.json`, which Task 2 generates with `scripts/build-index.mjs` (run by `npm test` pretest).
  - `validateCatalog(entries): { ok: boolean; errors: string[] }`: schema, unique ids, and cross-references (`gpuId`, `coolantId`, `risks` slugs exist in the knowledge-base slug list exported by Task 15 as `KNOWLEDGE_SLUGS`). Until Task 15 merges, it validates against the slug list in the Task 15 table.
  - `snapshotCatalog(plan, entries): Plan`: copies the used plus custom entries into `plan.catalog`.

- [ ] **Skills step.** Suggested: none specific. Search for "json schema validation skill" only if useful.
- [ ] **Tests first:**
  - `every id in ids.ts has exactly one data file` (skipped per kind until the data tasks merge; the coordinator un-skips at merge)
  - `validateCatalog reports duplicate id`
  - `validateCatalog reports unknown coolantId`
  - `snapshotCatalog includes custom entries and drops unused built-ins`
- [ ] **Implement, verify, commit.**

### Task 3: Catalog data, GPUs and racks (research)

**Files:** `twin/packages/catalog/data/gpus/*.json`, `twin/packages/catalog/data/racks/*.json` (one file per id in `GPU` and `RACK`).

**Interfaces:** consumes the `gpu` and `rack` entry shapes. Produces the data files that Task 2 and the engine read.

- [ ] **Skills step.** Suggested: `anthropic-skills:deep-research`-style sourcing. Search for "datasheet research skill".
- [ ] **Research** each entry with WebSearch/WebFetch.
  - Use vendor and OEM pages first (NVIDIA, AMD, HPE QuickSpecs, Supermicro, Dell, Cisco), then press (DCD, The Next Platform, ServeTheHome, Tom's Hardware) as `press`.
  - Every `vendor`/`oem` number needs a URL you actually opened. Use ranges where sources conflict (Helios weight), with the conflict in `note`.
  - Rubin values are `estimate` with the method in `note`.
  - Rack capex and lead time are `estimate` with reasoning.
  - Anchors from the spec and the Jane Street tour: GB300 NVL72 ~132 kW nominal / ~140–155 kW peak, ~1,580 kg, 85–90% to liquid, 54 V busbar. HGX B300 air ~14 kW per 8-GPU server, 2 servers per rack.
- [ ] **Validate** with `npx vitest run packages/catalog` (Task 2's validator; until it merges, `npx tsx -e` with `CatalogEntrySchema.parse` per file).
- [ ] **Commit.** Report every `estimate` value with its reasoning.

### Task 4: Catalog data: rack cooling, heat rejection, coolants and rules (research)

**Files:** `twin/packages/catalog/data/{rack-cooling,heat-rejection,coolants}/*.json`, `twin/packages/catalog/data/rules.json`.

- [ ] **Skills step.** As in Task 3.
- [ ] **Research and write** one file per id. Anchors:

  | Topic | Anchor values |
  |---|---|
  | Air with containment | ~30–40 kW/rack |
  | RDHx | passive ~20–35 kW, active ~50–75 kW |
  | DLC 1P | `toTechnicalLoop` 0.85, supply 17–45 °C |
  | DLC 2P | refrigerant, higher heat flux |
  | Immersion 1P | ~1.0 to fluid, tank form factor, heavy |
  | Immersion 2P | `status: 'stalled'` (PFAS) |
  | Cooling tower | ~1.5 L/kWh evaporation plus blowdown |
  | Dry cooler | approach ~5–10 K |
  | Chiller | COP ~4–7 falling with outdoor temperature |
  | PG25 | cp ≈ 3.9 kJ/kg·K |

  - `rules.json` holds every `RuleKey` with basis and source.
  - Capex per kW and lead/install weeks are `estimate` or `textbook` with sources where they exist (vendor reports, Uptime/JLL/Vertiv market notes).
- [ ] **Validate, then commit.**

### Task 5: Catalog data, equipment and climate

**Files:**
- `twin/packages/catalog/data/equipment/*.json`
- `twin/packages/catalog/data/climate/*.json`
- `twin/packages/catalog/scripts/synthesize-climate.mjs`
- `twin/packages/catalog/test/climate.test.ts`

- [ ] **Skills step.** Suggested: `dataviz`, only to sanity-plot the climate series (throwaway).
- [ ] **Tests first:**
  - `climate series have 8760 hours`
  - `Dallas July mean dry-bulb within 1 °C of normals`
  - `wet-bulb never exceeds dry-bulb`
  - `synthesis is deterministic`
- [ ] **Climate data.** Try first for a real typical-year hourly source for Dallas, Phoenix, Frankfurt and Stockholm (e.g. EnergyPlus/OneBuilding TMY/EPW files, basis `textbook`, with source URL). If none is fetchable within 10 minutes, synthesize: monthly normal daily max/min and mean dew point from NOAA/DWD/SMHI (sources cited) → hourly sinusoid peaking at 15:00 plus a seeded day-to-day variation (deterministic PRNG) → wet-bulb via the Stull formula. Basis `estimate`, method in `note`.
- [ ] **Equipment:** one file per `EQUIPMENT` id, with required params per category (`cdu.1200kw`: capacity 1.2 MW, etc.). Sourced, or `estimate` with reasoning.
- [ ] **Verify, then commit.**

### Task 6: Command registry implementation

**Files:**
- `twin/packages/commands/src/commands/{plan,site,workload,compute,layout,cooling,power,network,equipment,notes,catalog}.ts`
- `twin/packages/commands/src/history.ts`
- `twin/packages/commands/test/*.test.ts`

**Interfaces:**
- Consumes `CommandDef`, `defineCommand`, `CommandError`, the Plan schemas and `CatalogIndex`.
- Produces:
  - `applyCommand` / `applyCommands` behavior
  - `class History { constructor(initial: Plan); current: Plan; push(next: Plan, summary: string): void; undo(): Plan | null; redo(): Plan | null; canUndo; canRedo; last?: string }` (snapshot stack, max 200)

- [ ] **Skills step.** Suggested: superpowers:test-driven-development. Search "immer patterns skill" only if useful.
- [ ] **Tests first, one file per module.** They must include:
  - `placeRacks conflict`: placing on an occupied slot throws `CommandError("Slot R3-07 is taken by R3-07")` and the plan is unchanged
  - `double-wide occupancy`: a `slotsWide: 2` rack needs `slot` and `slot+1` free and within the row
  - `fillRow stops at row end and rejects overflow`
  - `moveRack keeps placementId stable as "<row>-<slot>"`: ids are renamed on move, and notes targeting `rack:<old>` are retargeted
  - `deleteRackGroup with placements rejects`
  - `setRackType rejects unknown rack id`
  - `setCoolingMethod rejects a method the rack does not support` (`rack.supportedCooling`)
  - `importPlan rejects invalid plan` with `path: problem` lines and the plan unchanged; `importPlan` on a valid plan replaces it and keeps schemaVersion 1
  - `addCatalogEntry forces custom true and basis user on new quantities lacking basis`
  - `removeCatalogEntry rejects in-use entry`
  - `History undo/redo round-trip and push clears redo`
  - `every command has description ≥ 40 chars` (they become agent tool descriptions)
- [ ] **Implement** each `apply` on the immer draft and each `summarize` in plain language ("Rows R3–R5 set to GB300 NVL72").
- [ ] **Verify, then commit.**

### Task 7: Engine, racks, power, hourly assembly and headline

**Files:**
- `twin/packages/engine/src/{racks,power,assemble}.ts`
- `twin/packages/engine/test/{racks,power,assemble}.test.ts`

**Interfaces:**
- Consumes `EvalContext` and the slices from the other modules (by their declared types).
- Produces `computeRacks`, `powerBudget` and `assemble`.

- [ ] **Skills step.** As appropriate for numeric modeling. Search "engineering calculation skill"; probably none.
- [ ] **Tests first:**
  - `rack heat equals nominal power; capacity checks use peak`
  - `heat split follows cooling method capped by rack maxLiquidFraction`: DLC on GB300 gives 0.85 liquid, 0.15 air; air-contained gives 0 liquid
  - `facility power each hour = (IT + cooling + misc) / (upsEff·transformerEff·distributionEff)`
  - `hoursOverCap counts hours where facilityW > gridCapacityW`
  - `usablePflops = placedPflops · min(1, (cap·eff − cooling_worst − misc) / IT_worst)`
  - `pue null when IT is 0`
  - `busway check per row uses I = P / (√3 · V · pf) · peakToAverage(purpose) / oversubscription allowance`
  - `inputCompat fails for dc800 with an ac54-only rack`
  - `power.gridWorstHour` compares the worst-hour facility power to the grid capacity, and its explanation names the hour (date and outdoor °C)
  - `power.ups` and `power.transformer`: modules and units are counted with redundancy (N, N+1, 2N), and load is checked against N capacity
  - `empty plan evaluates cleanly`: no NaN/Infinity anywhere (deep scan helper `assertFinite(evaluation)`)
- [ ] **Implement, verify, commit.**

### Task 8: Engine, air side, liquid side, manifold balance and equipment sizing

**Files:**
- `twin/packages/engine/src/cooling/{air,liquid}.ts`
- `twin/packages/engine/src/sizing.ts`
- `twin/packages/engine/test/{air,liquid,sizing}.test.ts`

- [ ] **Skills step.** As above.
- [ ] **Tests first:**
  - `airflow = Q_air / (ρ·cp·ΔT)`, with ΔT from `airDeltaTKContained` when contained
  - `rackHeatLimit fails for 132 kW on air-contained (limit 40 kW) with utilization 3.3`
  - `liquid flow 130 kW, PG25, 10 K ≈ 3.33 kg/s`: assert within 2%, computed from the catalog cp and density
  - `return temperature = supply + Q/(ṁ·cp)`
  - **Manifold:** without balancing, rack k of n in a row gets share `s_k = 1 − h·(k/(n−1))`, normalized so the mean is 1 (h = `manifoldHeaderLossFraction`). With balancing, all shares are 1 and pump power rises by `balancingValvePumpPenalty`. `manifoldBalance` warns when the min share < 0.9 and fails below 0.8.
  - `CDUs per row = ceil(liquidW_row / capacity) + redundancy extra` (N: 0, N+1: 1, 2N: ×2), into the row's `servesRows` positions. When positions run out, `cooling.cduPositions` fails with advice naming the row and the free positions.
  - `CRAH zones from positions.servesRows; count = ceil(airW_zone / capacity) + redundancy`
  - `overrideEquipment fixes model and count; the check then compares load to the override's capacity`
  - `coolantTemp fails when facilitySupplyC + CDU approach > rack maxCoolantSupplyC`
  - `immersion uses tank footprint for floor area`
- [ ] **Implement, verify, commit.**

### Task 9: Engine, heat rejection, water, ride-through and PUE inputs

**Files:**
- `twin/packages/engine/src/cooling/{rejection,buffer}.ts`
- `twin/packages/engine/test/{rejection,buffer}.test.ts`

- [ ] **Skills step.** As above.
- [ ] **Tests first:**
  - **Chiller:** `cooling power = Q / COP(T)` with `COP(T) = copRef − copSlopePerK·(T − copRefOutdoorC)` floored at 1.5. With the economizer, free-cooling hours when `T_out + approach ≤ facilitySupplyC − facilityLoopDeltaTK` use fan power only.
  - **Dry cooler:** works when `T_out + approach ≤ facilitySupplyC`. Otherwise the shortfall goes to a trim chiller (trimW > 0, its power at chiller COP), and fan power = `fanPowerFraction·Q·(1 + (T_out − 10)/30)` clamped ≥ base.
  - **Adiabatic dry cooler:** uses wet-bulb + approach above `adiabaticAboveC`, with water = `waterLPerKwh·Q` during those hours only.
  - **Cooling tower:** water = `Q[kWh]·waterLPerKwh·(1 + towerBlowdownFactor)`, and `waterPeakDay` against `waterAllowanceM3PerDay`.
  - **heatRejection check:** plant capacity (units × unitCapacityW) vs worst-hour load, with N+1.
  - **Ride-through:** `t = V·ρ·cp·bufferAllowedRiseK / liquidW`. It fails when `t < chillerRestartS`, and with a 0 m³ buffer the check says no buffer tank.
  - **leakExposure:** info status. Overhead piping is a warning ("no under-floor leak containment"), raised floor passes, with explanation text.
  - **Demo anchor:** `Dallas dry cooler at 18 °C supply needs trim most summer hours; at 32 °C supply trim only on the hottest hours`.
- [ ] **Implement, verify, commit.**

### Task 10: Engine, floor loads and network

**Files:**
- `twin/packages/engine/src/{floor,network}.ts`
- `twin/packages/engine/test/{floor,network}.test.ts`

- [ ] **Skills step.** As above.
- [ ] **Tests first:**
  - `bay load = Σ(weight·g) of racks whose footprint center lies in the bay, plus equipment in the bay, ÷ bay area`, in kN/m²
  - `point load = weight·g / feet` vs `pointLimitKn`
  - `DLC adds addedWeightKgPerRack`
  - `floorBay fails for GB300+DLC in default bays (7.2 kN/m²)`: the demo anchor
  - **Network:** each compute rack links to the nearest leaf position. Length = Manhattan distance along the row + to the row end + `routingSlackM`. Media is DAC up to `dacReachM`, AEC up to `aecReachM`, fiber otherwise. Optics power = 2·`optic.powerW` per fiber link; `copperReach` is info with counts.
  - `leaf ports needed = Σ scaleOutPorts / (1 + oversubscription adjustment)`, against leaf capacity × count
  - `base latency = max path length·ns/m + hops·hopNs` (rail-optimized 2 hops, fat tree 3)
- [ ] **Implement, verify, commit.**

### Task 11: Engine, cost, demand, N-1, causes and diff

**Files:**
- `twin/packages/engine/src/{cost,demand,n1,causes,diff}.ts`
- `twin/packages/engine/test/{cost,demand,n1,causes,diff}.test.ts`

- [ ] **Skills step.** As above.
- [ ] **Tests first:**
  - **Capex:** racks + rack cooling (`capexUsdPerKw·IT kW`) + equipment + plant (`capexUsdPerKw·rejected kW`) + piping (route rate × routed length) + buffer, grouped by category.
  - **buildWeeks:** the maximum over items of `leadTimeWeeks + installWeeks`, with the critical path listing the item names. Overhead piping is faster than raised floor.
  - **delayCostUsd:** `buildWeeks·168·gpuCount·valueOfComputeUsdPerGpuHour`.
  - **trainingSwing:** warns when a busway's load × `peakToAverageTraining` exceeds 90% of its rating while the purpose is training.
  - **leadTime:** info, naming the critical-path item.
  - **targetCompute:** warns when placed PFLOPS is below the workload target.
  - **N-1:** for each of CDU per zone, CRAH per zone, plant unit, busway feed and UPS module, re-run the affected capacity check with one unit removed and set `worstFailure` to the worst scenario. With redundancy N, a single CDU loss gives a fail.
  - **Causes:** a fixed table `CheckKind → decision paths`. For example, `layout.floorBay` ← `rackGroups.<g>.rackTypeId`, `rackGroups.<g>.coolingMethodId`, `site.floor`. Each cause carries the current value label (rack name, method name).
  - **Diff:** `worsened` means the status order rose (pass < unknown < warn < fail) or utilization rose ≥ 0.05 within warn/fail. It also covers `resolved`, headline deltas and capex/build/water deltas.
- [ ] **Implement, verify, commit.**

### Task 12: Server core

**Files:**
- `twin/apps/server/src/{main,app,store,ws,routes,persist,env}.ts`
- `twin/apps/server/test/{routes,ws,store}.test.ts`

**Interfaces:**
- Consumes `applyCommand`, `History`, `evaluate`, `loadBuiltins`, `snapshotCatalog` and the protocol types.
- Produces:
  - `createApp(opts: { dataDir: string; agentFactory?: (store: PlanStore) => AgentRuntime }): Promise<FastifyInstance>`
  - `createPlanStore(opts: { dataDir: string }): PlanStore`, implementing the `PlanStore` contract from `contracts.ts` (Task 1)
  - the server takes the `AgentRuntime` contract as an option (Tasks 13 and 14 implement it), so the core runs without an agent
  - routes for every HTTP endpoint in the protocol table, including `GET /api/brief/file/:name` (served from `dataDir/briefs/`, name validated against `^[\w.-]+\.md$`) and the `resetChat` WebSocket message
  - Persistence: `dataDir/plan.json` written debounced 300 ms, loaded at start (falling back to the default plan if invalid), `dataDir` = `twin/.data/` (git-ignored).
  - `env.ts`: `loadApiKey()` uses `process.loadEnvFile('/Users/linushabetha/Data-Center-Design-Twin/.env')` if the file exists and returns a boolean. It never logs values.

- [ ] **Skills step.** Suggested: search "fastify skill" and "websocket server skill". Use `webapp-testing` for any live check.
- [ ] **Tests first** (fastify `inject` and a real `ws` client on an ephemeral port):
  - `GET /api/state returns plan+evaluation`
  - `POST /api/command applies and broadcasts state to all ws clients`
  - `invalid command returns 400 with message, state unchanged`
  - `POST /api/plan/import returns 400 with paths` for a bad plan
  - `export → import round-trip yields identical evaluation`
  - `undo/redo over ws`
  - `new ws client receives state then thread replay`
  - `persisted plan reloads after restart`
  - `chat without agent returns a thread error event "The agent needs an API key in .env"`
- [ ] **Implement, verify, commit.**

### Task 13: Agent tools (handlers, proposals, what-if, view bridge)

**Files:**
- `twin/apps/server/src/agent/tools/{index,read,act,propose,view,documents,schema}.ts`
- `twin/apps/server/test/agent-tools.test.ts`

**Interfaces:**
- Consumes `PlanStore`, the registry (`listCommands`), `diffEvaluations`, `ViewAction`, and `searchKnowledge`/`readKnowledge` from Task 15 (until merged, import from the Task 15 module path; the coordinator merges 15 first).
- Produces:
  - `buildTools(deps: { store: PlanStore; emitView: (a: ViewAction) => void; proposals: ProposalBook; brief: (target) => string }): AgentTool[]`
  - `interface AgentTool { name: string; description: string; inputSchema: object /* JSON Schema */; run(input: unknown): Promise<ToolOutcome> }`, with `ToolOutcome = { ok: true; content: string /* compact JSON or text */; summary: string } | { ok: false; error: string }`
  - `class ProposalBook { create(p): Proposal; apply(id): Proposal; dismiss(id): Proposal; get(id) }`

- [ ] **Skills step.** Load `claude-api` (tool-use-concepts, strict tools) and `mcp-server-dev` (tool design patterns). Search "agent tool design skill".
- [ ] **Tests first:**
  - `every registry command has a cmd_ tool with identical JSON schema`
  - `tool input invalid returns ok:false with zod path messages`
  - `cmd_ tool applies via store with author agent`
  - `what_if does not change the plan and returns an EvalDiff`
  - `propose_change stores proposal with diff and emits annotate view action when annotate given`
  - `stale proposal`: change the plan after proposing, apply → commands re-validated against the current plan. If any fail, status is `stale` and the plan is unchanged; if all pass, it applies and records `basePlanUpdatedAt` mismatch in the summary.
  - `get_evaluation summary is under 4 KB for default plan`: summaries are compact, and full detail comes on request
  - `explain_check returns causes and advice`
  - `focus emits ViewAction`
  - `generate_simulation_brief writes dataDir/briefs/<timestamp>-openfoam.md and emits a link event to /api/brief/file/<name>`
  - `toolResult numbers lists the numeric values found in the result JSON (max 200)`
- [ ] **Implement.** Tool descriptions are written for the model (what it does, when to use it, what it returns, in two to four sentences). Command tool descriptions come from `CommandDef.description`.
- [ ] **Verify, then commit.**

### Task 14: Agent runtime (Claude API loop, observations, conversation)

**Files:**
- `twin/apps/server/src/agent/{runtime,loop,observe,conversation,client}.ts`
- `twin/apps/server/test/agent-runtime.test.ts`
- `twin/apps/server/test/agent-live.test.ts` (runs only when `RUN_LIVE_AGENT=1`)

**Interfaces:**
- Consumes `AgentTool[]`, `PlanStore` change events, the `AgentEvent` types and `SYSTEM_PROMPT` from Task 16 (until merged, a one-line placeholder string constant imported from `agent/prompt/system.ts`, which Task 16 owns).
- Produces `createAgentRuntime(deps: { store; tools: AgentTool[]; client?: AnthropicLike; model?: string }): AgentRuntime`, where `AnthropicLike` is the minimal interface of `@anthropic-ai/sdk` streaming used here, so tests inject a scripted fake.

- [ ] **Skills step.** Load `claude-api` (TypeScript README, streaming, tool-use, prompt-caching, the Opus 5.5 migration notes). Search "anthropic agent loop skill".
- [ ] **Tests first, with the fake client:**
  - `chat streams textDelta events then messageEnd`
  - `tool_use blocks run tools and return all tool_result blocks in one user message`
  - `invalid tool input yields is_error tool_result and loop continues`
  - `observation coalescing`: 5 changes within 1.5 s make one observation turn whose user message contains `<app_event>` with the merged `EvalDiff` summary
  - `no observation turn when diff has no worsened checks and headline moved <2%`
  - `severity problem when any worsened check is fail`
  - `api error surfaces`: 401 / 429 / network error → an `error` event with a plain message ("The Claude API rejected the key. Check .env.", "Rate limited, retrying in Ns"), the runtime stays usable, and 429 retries with backoff via SDK `maxRetries`
  - `refusal stop_reason produces a plain error event`
  - `history is append-only`: earlier messages are never mutated (deep-freeze in test)
  - `a chat message during a running turn queues and runs after it`
  - `resetConversation clears history and thread; importPlan or newPlan emits an info message offering a fresh conversation`
- [ ] **Implement the loop** with `client.messages.stream`:
  - model `claude-opus-5-5`, `thinking: {type: 'adaptive'}`, `max_tokens: 16000`
  - `output_config.effort`: `'high'` for chat turns and `'low'` for observation turns, using the per-message effort beta `mid-conversation-output-config-2026-07-01` if the `claude-api` skill confirms it fits. Otherwise use one top-level effort `'medium'` for all turns.
  - the frozen system prompt and tool list carry `cache_control`
  - server-side refusal fallbacks per the skill
  - Observations are appended as a user message wrapping `<app_event>` (the system prompt explains these come from the app, not the person).
  - The conversation is persisted to `dataDir/conversation.json` after each turn.
- [ ] **Live test** (`RUN_LIVE_AGENT=1`): on the default plan, `setRackType g2 → rack.gb300-nvl72` → within 60 s an observation turn emits a `problem` message mentioning air cooling and a `propose_change` with `setCoolingMethod`. Then ask "what is the PUE at the worst hour?" and the answer contains the engine's value.
- [ ] **Verify** (the unit suite, plus the live test run once, cost ~$0.20), **then commit.**

### Task 15: Knowledge base, cooling (writing + search)

**Files:**
- `twin/apps/server/knowledge/cooling/*.md`
- `twin/apps/server/src/knowledge/{index,search}.ts`
- `twin/apps/server/test/knowledge.test.ts`

**Interfaces:** produces `KNOWLEDGE_SLUGS: string[]` (all files across Tasks 15–17, listed below), `searchKnowledge(query, limit = 5): { slug; title; snippet; score }[]` (BM25 over headings and paragraphs, no dependency) and `readKnowledge(slug): string`.

- [ ] **Skills step.** Suggested: `humanizer` and `writing-guidelines`. Search "technical writing skill".
- [ ] **Write the files.** Slugs: `air-containment`, `rear-door-heat-exchanger`, `direct-to-chip-single-phase`, `direct-to-chip-two-phase`, `immersion-single-phase`, `immersion-two-phase`, `chiller`, `dry-cooler`, `adiabatic-dry-cooler`, `cooling-tower`, `coolants`, `buffer-tanks`, `liquid-cooling-operations` (CDU, technical vs facility loop, filtration at 25 µm, glycol and biology, flow balancing, leak detection, raised floor vs overhead: the Jane Street tour lessons), `water-use`.
  - Each file has these sections: what it is; when to use it; textbook numbers (ranges with sources); interactions with other layers; what to watch for; typical failure modes; sources.
  - About 400–900 words each. No filler.
- [ ] **Tests:** `every slug in KNOWLEDGE_SLUGS has a file`, `search "rack 130 kW air" ranks air-containment and direct-to-chip-single-phase in top 3`, `readKnowledge unknown slug throws`.
- [ ] **Verify, then commit.**

### Task 16: Agent system prompt and behavior evals

**Files:**
- `twin/apps/server/src/agent/prompt/system.ts`
- `twin/apps/server/test/agent-evals.test.ts` (live, `RUN_LIVE_AGENT=1`)

- [ ] **Skills step.** Load `claude-api` (prompting Opus 5.5, `shared/prompt-audit.md` patterns to avoid) and `humanizer`. Search "system prompt writing skill".
- [ ] **Write `SYSTEM_PROMPT`.** It is frozen (no timestamps or plan data inside). It covers:
  - the agent's role as the design partner who sees all layers
  - the layers and owners
  - grounding: every number comes from a tool result; say "I don't have that" otherwise
  - proactive behavior: speak only about worsened checks or meaningful headline moves; one message per event; lead with the problem and the cause chain across layers
  - suggestions are proposals via `propose_change`, never direct commands, unless the person asked for the action
  - respect notes (`must` notes are never violated silently)
  - show, don't tell: use `focus` and `annotate` when discussing an object
  - style: plain, short sentences, numbers with units, no hype, no apologies, no lists when one sentence works
  - what `<app_event>` messages are
  - the boundary: estimates, not simulation; offer `generate_simulation_brief` when someone asks for accuracy
- [ ] **Live evals**, one scripted scenario each, asserting on the tool calls and text:
  - `swap to GB300 → problem + proposal respecting the water note`
  - `user asks "make rows 3–5 liquid cooled" → applies commands directly, no proposal`
  - `asks a number not in tools → says it doesn't have it`
  - `asks to show the worst floor bay → focus + annotate`
  - `asks for simulation brief → calls generate_simulation_brief`
  - `quiet on a harmless rename`

  Iterate the prompt until all pass twice in a row. Budget ≤ $5.
- [ ] **Commit.**

### Task 17: Knowledge base, layers, hardware and topics

**Files:** `twin/apps/server/knowledge/{layers,hardware,topics}/*.md`.

- [ ] **Skills step.** As in Task 15.
- [ ] **Write the files.**
  - `layers/`: `site`, `workload`, `compute`, `layout`, `cooling`, `power`, `network`
  - `hardware/`: `nvidia-hgx-b300`, `nvidia-gb300-nvl72`, `nvidia-vera-rubin-nvl72`, `amd-mi355x`, `amd-helios`
  - `topics/`:
    - `layout-patterns` (hot/cold aisle, containment, row length, raised floor vs slab vs overhead services)
    - `demand-problems` (grid headroom on hot hours, synchronized training swings and breakers, oversubscription, lead times, peak-day water, next-generation coolant temperatures)
    - `power-distribution` (N/N+1/2N, 54 V vs 800 V DC, busways and breakers)
    - `network-media` (DAC/AEC/optics reach, latency, fiber vs copper)
    - `cost-and-lead-times`
    - `simulation-boundary` (what the app estimates vs what CFD answers)
  - Same section structure as Task 15. Owns no code.
- [ ] **Commit.**

### Task 18: Simulation brief generator (OpenFOAM)

**Files:**
- `twin/apps/server/src/brief/{openfoam,format}.ts`
- `twin/apps/server/test/brief.test.ts`

**Interfaces:** produces `generateBrief(plan: Plan, evaluation: Evaluation, target: 'openfoam', agentNotes?: string): string` (Markdown). Task 13's `generate_simulation_brief` tool calls it, writes the file and emits the `link` event.

- [ ] **Skills step.** Search "openfoam skill" and "cfd skill". Use `humanizer` for the prose parts.
- [ ] **Tests first:**
  - `brief lists every rack with position, heat to air (W), airflow (m³/s)`
  - `includes hall geometry, CRAH positions with supply temp and flow, containment boundaries`
  - `numbers match evaluation exactly`
  - `sections in order: Purpose, Geometry, Heat sources, Boundary conditions, Solver setup (buoyantSimpleFoam, k-omega SST, Boussinesq), Mesh guidance, Runs to make (baseline, worst hour, N-1 CRAH), Results to compare with the app, Caveats`
- [ ] **Implement** deterministic tables and setup text. `agentNotes` goes verbatim under `## Notes from the design agent`; without notes the section is omitted.
- [ ] **Verify, then commit.**

### Task 19: External MCP server

**Files:**
- `twin/apps/mcp/src/main.ts`
- `twin/apps/mcp/test/mcp.test.ts`
- `twin/.mcp.json.example`

**Interfaces:** consumes `GET /api/tools` and `POST /api/tools/:name`. Produces the stdio MCP server `twin-dc`, with every agent tool under the same name.

- [ ] **Skills step.** Load `mcp-server-dev` (`build-mcp-server`). Search "mcp typescript skill".
- [ ] **Tests first:** `lists tools from server`, `calls tool and returns text content`, `server down returns MCP error with "Start the app with npm run dev"`.
- [ ] **Implement** with `@modelcontextprotocol/sdk` (stdio). Base URL from `TWIN_URL` (default `http://localhost:4317`). Document the one-line Claude Code registration in `.mcp.json.example`.
- [ ] **Verify, then commit.**

### Task 20: Web shell, tokens, layer column, totals, checks, all-variables drawer

**Files:**
- `twin/apps/web/src/App.tsx`
- `twin/apps/web/src/theme/{tokens.css,global.css}`
- `twin/apps/web/src/panels/{LayerList,Totals,Checks,AllVariables,StatusMark}.tsx`
- `twin/apps/web/src/format.ts`
- `twin/apps/web/test/{format,panels}.test.tsx`

**Interfaces:**
- Consumes the store and `Evaluation`.
- Produces `<StatusMark status />` (shape + text), `fmt` helpers (`fmtPower(w)` → "9.4 MW", `fmtMass`, `fmtFlow`, `fmtMoney`, `fmtWeeks`, `fmtPct`, `fmtNull` → "—") and the layout regions that the other web tasks mount into: `LayerColumn` children slot `DecisionPanel`, `AgentRegion`.

- [ ] **Skills step.** `frontend-design` (full process: tokens plan, review against defaults, build, screenshot, critique), `dataviz` (the totals table and number hierarchy), `web-design-guidelines`, `react-best-practices`. Search "typography skill" and "design tokens skill".
- [ ] **Tests:** `fmtPower(9_400_000) === "9.4 MW"`, `fmtNull`, `Checks ranks fail>warn>unknown>pass then utilization`, `StatusMark renders text not only color`, `LayerList shows issue count per layer from checks`.
- [ ] **Build** to the mockup direction, with keyboard focus visible and reduced-motion respected. Screenshot at 1440×900 via Playwright, critique against the anti-goals, fix, and repeat once.
- [ ] **Verify, then commit.**

### Task 21: Decision panels for all seven layers, with notes

**Files:**
- `twin/apps/web/src/panels/decisions/{Site,Workload,Compute,Layout,Cooling,Power,Network,index}.tsx`
- `twin/apps/web/src/panels/notes/{NoteBadge,NoteEditor}.tsx`
- `twin/apps/web/src/panels/fields/{Select,Number,Toggle,CatalogPicker}.tsx`
- `twin/apps/web/test/decisions.test.tsx`

**Interfaces:**
- Consumes the store, the commands (`send`) and the catalog in `plan.catalog` plus the builtins (from `GET /api/catalog`, cached in the store by this task's `useCatalog()` hook).
- Produces `<DecisionPanel layer />`, mounted by Task 20.

- [ ] **Skills step.** `frontend-design`, `composition-patterns`, `humanizer` (labels and help text). Search "form ux skill".
- [ ] **Tests:**
  - `Cooling panel select heat rejection sends setHeatRejection`
  - `CatalogPicker shows basis and key numbers per option (e.g., "Max 40 kW per rack")`
  - `CatalogPicker disables methods the rack does not support, with the reason`
  - `NoteEditor adds note with importance and authorRole = active layer`
  - `every decision field shows a note badge when notes target it`
  - `Layout panel fillRow form validates count against free slots`
- [ ] **Build.** Each layer's decisions match the spec's layer table. Picker options show the deciding numbers (rack kW, weight, cost, lead time, status `stalled` for 2P immersion), so choices are informed.
- [ ] **Verify** (screenshots of all 7 panels), **then commit.**

### Task 22: Agent thread, proposal cards and chat input

**Files:**
- `twin/apps/web/src/agent/{Thread,Message,ToolCallLine,ProposalCard,ChatInput,DeltaTag}.tsx`
- `twin/apps/web/test/agent.test.tsx`

**Interfaces:** consumes `thread`, `proposals`, `applyProposal`, `dismissProposal`, `chat` and `dispatchView({type:'previewProposal'})` from the store.

- [ ] **Skills step.** `frontend-design`, `humanizer`, `react-best-practices`. Search "chat ui skill" and "streaming markdown skill".
- [ ] **Tests:**
  - `textDelta events render incrementally`
  - `problem severity renders red rule and DeltaTag matching annotation tag`
  - `tool calls render as one quiet line with summary`
  - `ProposalCard shows + / = lines from commands summaries, diff (capex, build weeks, PUE, worst check), Preview/Apply/Dismiss`
  - `stale proposal shows "Plan changed since this was proposed" and disables Apply`
  - `error event renders plain message`
  - `Enter sends, Shift+Enter newline, disabled while offline`
  - `markdown subset: paragraphs, bold, inline code, lists only`
  - `numbers in a message that equal a value in that message's toolResult.numbers (after unit display rounding) get a dotted underline with title "From <tool name>"`
  - `link events render as a download link`
- [ ] **Build, verify** (screenshot with a scripted thread), **commit.**

### Task 23: Inspector, hourly chart and layer strips

**Files:**
- `twin/apps/web/src/panels/Inspector.tsx`
- `twin/apps/web/src/charts/HourlyChart.tsx`
- `twin/apps/web/src/strips/{CoolingChain,PowerOneLine,NetworkTiers,Strip}.tsx`
- `twin/apps/web/test/{inspector,strips}.test.tsx`

**Interfaces:**
- Consumes `selection`, `Evaluation` (racks, equipment, checks, metrics, hourly).
- Produces `<Inspector />` (a drawer opened on selection), `<HourlyChart series=... />` (SVG, the year at a glance plus the worst-week zoom) and `<Strip layer />`, mounted under the scene by Task 20's App.

- [ ] **Skills step.** `dataviz` (mandatory for the chart), `frontend-design`. Search "svg chart skill" and "d3 skill" (no d3 dependency is installed, so use plain SVG and the math).
- [ ] **Tests:**
  - `Inspector for a rack lists power, heat split, flow, temps, weight, bay, each with basis or "calculated from"`
  - `Inspector for a check lists causes as links that select the decision layer`
  - `HourlyChart draws facility power vs cap and marks hours over cap`
  - `CoolingChain shows dashed missing CDU when liquid racks lack CDU positions`
  - `PowerOneLine shows utility→transformer→UPS→busways with loads`
  - `NetworkTiers shows racks→leaves→spine with copper/fiber counts`
- [ ] **Build** in the piping-diagram language from the mockup. **Verify** (screenshots), **commit.**

### Task 24: Import/export, catalog browser and custom-entry forms

**Files:**
- `twin/apps/web/src/catalog/{CatalogBrowser,EntryForm,schemaForm}.tsx`
- `twin/apps/web/src/io/{ImportExport}.tsx`
- `twin/apps/web/test/{entryForm,io}.test.tsx`

**Interfaces:**
- Consumes the `CatalogEntrySchema` JSON Schema (via `z.toJSONSchema`) and the commands `addCatalogEntry`, `updateCatalogEntry`, `importPlan`.
- Produces `<CatalogBrowser kind? />` and `<ImportExport />`. Task 20 mounts both in its top bar.

- [ ] **Skills step.** `frontend-design`, `composition-patterns`. Search "json schema form skill".
- [ ] **Tests:**
  - `EntryForm generated for rackCooling has every required field with unit labels`
  - `submit builds Quantity with basis user`
  - `duplicate id rejected inline`
  - `import shows path: problem errors from server and keeps current plan`
  - `export downloads plan JSON named <plan-name>.json`
  - `catalog pack import (array of entries) adds each via addCatalogEntry`
- [ ] **Build, verify, commit.**

### Task 25: 3D foundation and procedural models

**Files:**
- `twin/apps/web/src/scene/{Scene,Lighting,Ground}.tsx`
- `twin/apps/web/src/scene/models/{Site,Hall,Rack,Tray,Gpu,Cdu,Crah,Plant,Busway,Pipes,LeafSwitch,BufferTank}.tsx`
- `twin/apps/web/test/models.test.tsx`

**Interfaces:**
- Consumes `geometry.ts`, `palette.ts`, `registry.ts`, the store and `Evaluation.equipment`/`racks`.
- Produces `<Scene />` (Canvas with shadows and soft AO via @react-three/postprocessing, restrained), plus:
  - `<Rack placementId openness={0..1} />`: doors swing and trays slide out by `openness`. Tray `i` exposes the object id `rack:<id>:tray:<i>`, and GPU `j` exposes `rack:<id>:tray:<i>:gpu:<j>`, each registered in `useSceneRegistry`.
  - `<Site />`: building shell, roof or yard plant from `equipment` `plant`, utility feed, water feed.
  - Every rendered object registers its id.

- [ ] **Skills step.** Search hard here: `gh search repos "react three fiber skill" --sort stars`, `"three.js claude skill"` (e.g. Impertio-Studio/Three.js-Claude-Skill-Package is low-star, so read it critically), drei docs. Use `frontend-design` for the material and lighting look (white architectural model).
- [ ] **Tests** (jsdom + R3F test renderer where practical, otherwise geometry-level unit tests): `Rack registers tray and gpu ids`, `openness 0 keeps trays inside chassis bounds`, `Hall renders one mesh per placement (instanced for >40)`.
- [ ] **Build.**
  - **Racks:** clay materials. Front perforated-door texture is procedural, with no image assets.
  - **GPU board:** cold plate with inlet/outlet quick disconnects and manifold hoses.
  - **Equipment:** CDU cabinet and CRAH units with fan grilles.
  - **Plant:** chillers or dry coolers as fan arrays on the roof or yard.
  - **Instancing** for racks when count > 40.
  - 60 fps target at the default plan on a MacBook (measure with `r3f-perf`, or a manual frame-time readout in dev only).
- [ ] **Verify** (screenshots of site, hall, rack open, GPU close-up), **commit.**

### Task 26: Camera rig and layer choreography

**Files:**
- `twin/apps/web/src/scene/camera/{shots,CameraRig,path}.ts(x)`
- `twin/apps/web/test/camera.test.ts`

**Interfaces:**
- Consumes `LAYER_DEFAULTS`, the store (`activeLayer`, `selection`, `shot`), `useSceneRegistry().worldBox` and `Evaluation.checks`.
- Produces:
  - `shotFor(id: ShotId, ctx: { plan; evaluation; focusId: string | null; worldBox }): { position: Vec3; target: Vec3; fov: number }`
  - `transitionPath(from: ShotId, to: ShotId): ShotId[]`: the hierarchy `site > hall > row > rack > tray > gpu`, passing every level in between
  - `<CameraRig />`: uses drei `CameraControls` (camera-controls) `setLookAt(..., true)`, chained per waypoint with durations scaled by distance (0.8–1.6 s total), interruptible. Rack `openness` animates during the `rack ↔ tray ↔ gpu` legs.

- [ ] **Skills step.** Search "camera animation three.js skill" and "react three fiber animation skill". Use `frontend-design` (motion restraint: one orchestrated movement).
- [ ] **Tests:**
  - `transitionPath gpu→site = [gpu, tray, rack, row, hall, site]`
  - `focus picks the selected rack, else the rack of the worst failing check, else the hall center`
  - `interrupt keeps selection`: start gpu→site, dispatch setLayer compute mid-way → the final shot is gpu, and the selection is unchanged
  - `reduced motion uses cross-fade (duration 0.2 s, no path)`
- [ ] **Build, verify** (record a Playwright video of Compute → Cooling → Site → Compute and review the frames), **commit.**

### Task 27: Flow overlays (liquid, air, temperature, heat shimmer)

**Files:**
- `twin/apps/web/src/scene/overlays/{LiquidFlow,AirFlow,Temperature,HeatShimmer,flowPaths}.ts(x)`
- `twin/apps/web/test/flow.test.ts`

**Interfaces:**
- Consumes `Evaluation.racks` (flowLps, supplyC, returnC, airW, airInletC, airOutletC, flowShare, coolingOk), `equipment` (CDU/CRAH/plant positions), `geometry.ts` and `palette.tempColor`.
- Produces the overlay components selected by the store's `overlay`, plus `fillPipes(progress)`, used by the cooling transition.

- [ ] **Skills step.** Search "three.js particles skill", "instanced mesh skill" and "shader skill". Use `frontend-design` (color only where physics happens).
- [ ] **Tests** (pure functions in `flowPaths.ts`):
  - `pipe path runs plant→facility loop→CDU→row header→each rack and back`
  - `particle speed proportional to flow (k·flowLps, clamped)`
  - `particle count per rack ∝ flowShare`
  - `air paths start at the serving CRAH and end at its return`
  - `color lerp supply→return from temperatures`
- [ ] **Build.**
  - Instanced particles along `CatmullRomCurve3`s.
  - Pipes are blue supply and amber return tubes.
  - Air particles are sparse, slow and translucent.
  - Heat shimmer is a subtle shader plane above racks with `coolingOk === false`.
  - The always-visible caption reads "Illustrative flow, scaled from computed values".
- [ ] **Verify, then commit.**

### Task 28: Data overlays, picking and proposal ghost

**Files:**
- `twin/apps/web/src/scene/overlays/{FloorLoad,PowerLoad,Cables,Ghost}.tsx`
- `twin/apps/web/src/scene/Picking.tsx`
- `twin/apps/web/test/overlays.test.ts`

**Interfaces:**
- Consumes `Evaluation.bays`, `rows` (busway load), `network.links`, `previewProposalId` plus `proposals`, `applyCommands` and `evaluate` (local preview).
- Produces `<Ghost />`, which renders the proposal's resulting changed objects (new CDUs, moved racks, method changes) as translucent outlines, and the click/hover picking that sets `selection` (rack, equipment, bay, row) with a hover outline.

- [ ] **Skills step.** Use `dataviz` (sequential scale for floor load, legend). Search "three.js picking skill".
- [ ] **Tests:**
  - `ghost diff lists added/removed/changed object ids between plan and preview plan`
  - `floor load color scale clamps at 120%`
  - `cables classify media colors: copper graphite, fiber blue`
  - `clicking empty space clears selection`
- [ ] **Build, verify, commit.**

### Task 29: Revision clouds and annotation layer

**Files:**
- `twin/apps/web/src/scene/annotations/{RevisionClouds,cloudPath}.ts(x)`
- `twin/apps/web/test/cloud.test.ts`

**Interfaces:**
- Consumes `annotations`, `useSceneRegistry().worldBox` and the camera.
- Produces an SVG overlay above the canvas that, every frame (throttled to 30 Hz), projects each annotation's object boxes to screen, builds the convex hull, offsets it outward by 10 px, and draws a revision cloud (arcs of radius ~8 px along the hull, as in the mockup). It adds a numbered triangle tag with a leader to a clear spot and the label.

- [ ] **Skills step.** Use `frontend-design` (this is the signature element). Search "svg path skill".
- [ ] **Tests:**
  - `cloudPath returns closed path with arc count ≈ perimeter/(2r)`
  - `hull of boxes covers all projected corners`
  - `tag placement avoids overlapping other tags`
  - `annotation for removed object disappears`
- [ ] **Build, verify** (screenshot compared against the mockup's cloud), **commit.**

### Task 30: Workload and site visuals, and the layer header

**Files:**
- `twin/apps/web/src/scene/overlays/{WorkloadTint,SiteLabels}.tsx`
- `twin/apps/web/src/panels/LayerHeader.tsx`
- `twin/apps/web/test/layerHeader.test.tsx`

**Interfaces:**
- Consumes the store and the overlays registry.
- Produces:
  - the workload tint (racks tinted by group; legend with group names and purpose)
  - site labels (grid MW, water allowance, climate design temperature at their 3D anchors)
  - `<LayerHeader />` above the scene: the overlay switcher (segmented control) and the caption hint. This is the only owner of the overlay switcher.

- [ ] **Skills step.** `frontend-design`, `humanizer`.
- [ ] **Tests:** `overlay switcher lists only overlays valid for the active layer`, `switching layer sets LAYER_DEFAULTS overlay`.
- [ ] **Build, verify, commit.**

---

## Wave 2 (integration, parallel)

### Task 31: Engine integration, golden tests and demo tuning

**Files:**
- `twin/packages/engine/test/{golden,demo,perf}.test.ts`
- Modify `twin/packages/catalog/src/defaultPlan.ts` (tuning only)
- Allowed: bug fixes in engine modules, each with a regression test

- [ ] **Skills step.** Use superpowers:systematic-debugging for any mismatch.
- [ ] **Tests:**
  - `golden: default plan` has all checks pass or info, hoursOverCap 0, a buildable headline and PUE between 1.2 and 1.6.
  - `demo` replays the spec's demo steps as commands:
    - after `setRackType g2 → GB300`: `cooling.rackHeatLimit:g2` fails and `cooling.crahCapacity` fails
    - after `setCoolingMethod g2 → dlc-1p` + `setFacilitySupplyTemp 32` + `setHeatRejection dry-cooler`: rack heat passes, at least one `layout.floorBay` in R3–R5 fails, `cooling.cduPositions` passes, `hoursOverCap` is between 1 and 1500, and `usablePflops` < `placedPflops`
    - after moving racks to spread the load (two `moveRack`s per affected bay, or `setBayRating` if the agent chooses slab reinforcement): the floor passes
  - `perf`: `evaluate(default)` < 100 ms and `evaluate(demo state)` < 150 ms (median of 20).
- [ ] **Tune** only plan inputs (grid capacity, bay rating, water allowance) within realistic ranges to hit the demo anchors. Record each tuned value and why in the commit message.
- [ ] **Commit.**

### Task 32: App integration (server, agent and web wired end to end)

**Files:**
- Modify `twin/apps/server/src/main.ts`, `twin/apps/web/src/App.tsx`, `twin/apps/web/src/state/store.ts`, `twin/apps/web/src/scene/Scene.tsx` (mounting only)
- Plus fixes with tests in the owning modules

- [ ] **Skills step.** Use `webapp-testing`, superpowers:systematic-debugging.
- [ ] **Wire it:**
  - `main.ts` creates the agent runtime when `loadApiKey()` succeeds.
  - Server view actions dispatch to the store, so the camera follows the agent's `focus`.
  - Proposal preview drives `<Ghost />`, and applying it triggers the cooling transition `fillPipes`.
  - The agent's `annotate` produces clouds tied to message `DeltaTag`s.
  - `LocalBackend` falls back cleanly when the server is down.
- [ ] **Verify live** with `npm run dev` and the real key: walk through the spec's demo steps 1–8 by hand in Chromium via `webapp-testing`, screenshot each step, and fix what breaks.
- [ ] **Commit.**

### Task 33: End-to-end demo test and MCP smoke

**Files:** `twin/e2e/{demo,import-export,offline,mcp}.spec.ts`.

- [ ] **Skills step.** Use `webapp-testing`.
- [ ] **Tests (Playwright):**
  - `demo`: steps 1–8 with the live agent when `RUN_LIVE_AGENT=1`. Otherwise the agent steps use a server started with a scripted fake client (`TWIN_FAKE_AGENT=1`, a server option from Task 14's `AnthropicLike` injection).
  - `import-export`: round-trip yields identical totals
  - `offline`: the server is stopped → the UI shows offline, local edits keep evaluating, and chat says the agent needs the server
  - `mcp`: spawn `apps/mcp`, call `get_evaluation` and `cmd_setHeatRejection`, and see the UI update over WebSocket
- [ ] **Run green, then commit.**

### Task 34: Visual QA pass across every layer and transition

**Files:** fixes only, in the owning files, each with a before/after screenshot in `twin/e2e/screens/` (git-ignored except `final/`).

- [ ] **Skills step.** Use `frontend-design` (critique mode), `web-design-guidelines`, `dataviz`.
- [ ] **Screenshot** all 7 layers at 1440×900 and 1280×800, the inspector, a proposal card, a revision cloud, and transition frames (Compute→Cooling→Site).
- [ ] **Critique** against the spec's anti-goals and the generic-default list. Fix issues in priority order: legibility, hierarchy, alignment, overlap, motion.
- [ ] **Commit** with `final/` screenshots.

## Wave 3 (verification and polish)

### Task 35: Whole-branch code review and simplification

- [ ] **Skills step.** Use superpowers:requesting-code-review, the code-simplifier agent, `simplify` and the `code-review` skill (high).
- [ ] **Review** the diff `main...linus/twin-app` under `twin/`. Fix every confirmed finding with a test where behavior changes.
- [ ] **Run** `npm test && npm run typecheck && npm run e2e`, all green. **Commit.**

### Task 36: Copy, knowledge base and prompt polish

- [ ] **Skills step.** Use `humanizer`, `writing-guidelines`.
- [ ] **Pass** over all visible UI strings, check explanations and advice text in the engine, knowledge-base files, tool descriptions and the system prompt: plain, specific, no slop.
- [ ] **Re-run** the Task 16 evals once. **Commit.**

### Task 37: Final verification and handoff

- [ ] **Skills step.** Use superpowers:verification-before-completion, superpowers:finishing-a-development-branch.
- [ ] **Fresh run:** `npm install && npm test && npm run typecheck && npm run e2e` and, with `RUN_LIVE_AGENT=1`, the live demo spec once. Paste the outputs.
- [ ] **Write `twin/README.md`:** run instructions, demo script, architecture sketch, agent setup (`.env`), MCP registration, and what is estimated vs sourced.
- [ ] **Present** the branch to the product owner. Do not push without their say-so.
