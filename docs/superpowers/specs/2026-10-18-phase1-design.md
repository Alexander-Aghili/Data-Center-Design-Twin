# Phase 1 design: exact cross-domain twin + Sculptured design desk

Date: 2026-10-18. Product spec: [docs/spec/product-spec.md](../../spec/product-spec.md) (copied from the Claude Doc of the same name, rev 15). This document narrows that spec to Phase 1 and records the decisions needed to plan it. Items marked **(builder's call)** were decided while writing this, not by the product owner; they can be revisited.

## Intent

The users are people designing data center layouts, at a design firm or on an operator's engineering team. Their question is: "can this hall take these racks, and what breaks if it does?" Rack power has gone from ~40 kW to 130–245 kW in two generations, and every generation changes power, cooling and weight, so this question keeps coming back and today is answered slowly and per-domain.

Phase 1 has two parts that make each other useful:

1. **The twin.** Exact, instant physics only (no CFD, ML surrogates or packet simulation). Racks or multi-rack systems are placed and the twin immediately reports power, liquid cooling, air, floor load and network consequences, including each N-1 failure, with the origin of every number visible.
2. **The design desk.** A [Sculptured](https://github.com/Sculptured/Sculptured) team of AI agents that acts as the designer. Given a brief ("20 MW of Vera Rubin in Hall B, 2N power, existing 14 kN/m² slab"), the agents research missing catalog data, place systems, fix failing checks domain by domain, independently verify the result against the twin, and write up the design. Each candidate design lands as a twin branch the human opens and compares in the 3D view.

The twin is the agents' engineering tool and the human's review tool; the agents never make an engineering claim the twin has not checked.

## What success looks like

A designer can:

1. Load a hall (dimensions, row/slot grid, slab rating per bay, column grid, utility capacity, heat-rejection limit, outdoor design temperature, equipment positions).
2. Pick presets: redundancy (N+1 or 2N), power distribution (54 V in-rack busbar or 800 V DC), facility water supply temperature and rack-loop ΔT, network fabric (fat tree or rail-optimized, oversubscription, switch model).
3. Place racks or whole systems (for example an 8-rack GB300 NVL72 scalable unit) into row slots in a 3D view or 2D plan, by mouse or keyboard.
4. Within one second of each edit, read a ranked headroom report — normal operation and worst N-1 failure per check — like the spec's example (CDU-3 flow 104%; slab bay D7 15.2 vs 14 kN/m²; PDU-B 91% with feed A lost).
5. Click any rack, component or number to see its inputs, computed values, headroom and provenance.
6. Pin an auto-sized item and see the engine design around it; undo; save and reopen.
7. Branch the design and compare two branches side by side (checks, IT load, PUE, cable totals).
8. Produce a self-contained HTML report for any branch, or a comparison of two, that shows someone who never opens the tool what the hall looks like and what the twin found.
9. Start the design desk on the sample brief from the Sculptured board, watch its edits appear live in the twin, and finish with at least two candidate branches, each carrying the checker's verdict and a written report.

## Goals

- Sub-second recompute after any edit for halls up to **500 racks** (builder's call; the spec leaves hall size open).
- Every value carries provenance; unknown values stay unknown, never zero; every result inherits the weakest label among its inputs.
- N-1 failure scenarios are first-class: each check reports normal and worst-failure headroom and names the failure.
- Sizing rules are visible, editable configuration.
- New rack types and systems are data, not code.
- Everything the UI can do, the command line can do, with JSON output, so agents and people use the same twin.
- Agent edits are attributed: every journal entry records who made it (the user or a named agent).

## Non-goals for Phase 1 (with where they go)

- **Phase 2:** CFD training data, ML surrogates, air temperature fields and hot-aisle temperature checks, a thermal engineer on the design desk. Phase 1 leaves the seam for them (see "Surrogate seam").
- **Later:** tail latency, traffic matrices, flow or packet simulation; transients (GPU power swings, ride-through, startup); the placement optimizer; exports (BOM, single-line diagram, schedules, PDF); reverse sizing; the roadmap time axis; cost and water use; shell sketching (the hall is imported JSON); accounts, multi-user editing, cloud hosting; N-2 combinations; merging branches.

## Anti-goals (would make Phase 1 a failure even if it runs)

- A check that shows "pass" when one of its inputs is unknown.
- A number in the UI with no provenance label.
- Sizing logic hidden in code that an engineer cannot inspect or change.
- A UI that moves cards, resets the camera or drops the selection when results update (including updates caused by agents).
- Status shown by color alone.
- Silent changes to anything the user placed or pinned.
- An agent report that states a design passes without a twin evaluation backing it.

## Constraints and decisions from the product owner

- Python core; TypeScript + Three.js front end.
- Phase 1 scope is the spec's Phase 1 (catalog, typed asset graph with exact solvers, headroom checks with N-1 failures) plus the Sculptured design desk as the designer.
- CFD and ML surrogates come in a later phase.
- Outputs are design-stage estimates, not permitting-grade engineering.

## Architecture (builder's call)

```
core/       Python package `dctwin` — model, catalog, solvers, checks, CLI, HTTP API
web/        TypeScript front end (Vite, React, Three.js via react-three-fiber)
catalog/    JSON data: racks, systems, equipment, rules
examples/   sample hall, sample project, sample brief
sculptured/ design-desk team files (Claude and Codex copies), agent job texts, README
docs/
```

- **Core**: Python 3.12, pydantic v2, pytest, `uv`. Pure evaluation: `evaluate(project_state) -> Result`. Solvers do not depend on the CLI or API.
- **CLI** (`dctwin`): `new`, `show`, `place`, `place-system`, `remove`, `swap`, `preset`, `pin`, `unpin`, `undo`, `evaluate`, `explain <check-id>`, `branch`, `checkout`, `branches`, `compare <a> <b>`, `catalog list|show`. Every command takes `--project`, `--branch`, `--author`, and `--json`. Writes take a file lock so several agents can work on different branches of one project at once.
- **API**: FastAPI, local only: load/save, catalog, apply edit, undo, evaluate, branches, compare, and a server-sent events stream that pushes a new result whenever the project file changes on disk (so CLI and agent edits appear live in the UI).
- **Front end**: displays results and sends edits; holds no physics.

## Data model

### Values and provenance

Every physical number is a `Quantity`: `{value, unit, provenance, source?, note?}`, or `{low, high, ...}` for vendor ranges (capacity checks use `high` by default, set in rules). `value: null` means unknown. Units are SI internally.

Labels, strongest to weakest (builder's call): `measured` > `vendor_spec` > `oem_datasheet` > `user_input` > `derived` > `estimated` > `surrogate` > `unknown`. A computed result takes the weakest input label, with `derived` as the best a computed value can be. A check with an `unknown` input reports **Unknown** and names the missing input.

### Catalog

`catalog/racks/`, `catalog/systems/`, `catalog/equipment/`, `catalog/rules.json`, one entry per file, with the spec's field groups (identity, electrical, thermal, mechanical, network, compute) plus `supported_power_input` (54 V busbar AC chain, 800 V DC, or both) and `max_coolant_supply_temp`.

Racks in Phase 1: NVIDIA GB300 NVL72, NVIDIA Vera Rubin NVL72, AMD Helios (weight as a range, note that reports conflict), air-cooled 8-GPU rack (HGX B300 class), network rack, storage rack. Rubin Ultra (Kyber) is deferred: its sidecar layout needs the multi-rack system model to mature first (builder's call).

**Catalog data beyond the spec's table** (liquid/air heat split, flow per kW, pressure drop, power shelves, feet, scale-out ports) is researched during the build with a source link per value. Where no public figure exists, the entry gets an `estimated` value with a note on how it was estimated (for example Rubin's weight from GB300 plus its stated differences); `unknown` is left only where no defensible estimate exists (builder's call). The design desk's catalog researcher can later upgrade estimates to sourced values.

**Systems** (multi-rack bundles) are the normal placement unit, because AI halls are built in blocks: a system lists member racks with relative slot offsets, adjacency requirements (members joined by copper must be within copper reach), and internal links. Phase 1 ships an 8-rack GB300 NVL72 scalable unit with its network racks (network rack count labeled `estimated`), an AMD Helios pod, and the single racks as one-member systems. Systems can be placed whole and members inspected individually.

**Per-placement overrides**: catalog fields marked `overridable` (chassis count, user-defined power and weight for network/storage racks) can be overridden on a placement with label `user_input` (builder's call).

**Catalog snapshot**: a project stores a copy of every catalog entry it uses plus the catalog version hash. Reopening a project whose entries changed in `catalog/` shows a notice and offers an "update catalog" edit, which is journaled; results never change silently (builder's call).

### Hall (imported JSON)

Rectangular hall: dimensions; rows (origin, orientation, slot count, slot pitch); aisle assignment; slab bays (rectangles with rated distributed load kN/m² and point-load limit kN); columns; utility capacity (kW); heat-rejection limit (kW); outdoor design dry-bulb temperature; tray routes (polylines at ceiling height); equipment positions (see "Sizing limits"). `examples/` ships one sample hall of about 8 rows × 20 slots.

### Project, journal and branches

A project is one JSON file: `{hall, catalog_snapshot, branches: {name: {parent, base_index, journal[]}}}`. A journal entry is `{index, timestamp, author, edit}`; edits are place, place-system, remove, swap type, override, change preset, pin, unpin, update catalog. State is the replay of `main` up to a branch's base plus the branch's own entries. Undo appends an inverse edit. Branches are never merged in Phase 1.

### Asset graph

One typed graph generated from the state on every evaluation. Networks:

- **Power, 54 V AC chain**: utility → transformer → switchgear → UPS → busway/PDU → rack power shelves.
- **Power, 800 V DC chain**: utility → solid-state transformer or rectifier → 800 V DC busway (battery on the DC bus, no UPS) → rack DC-DC shelves.
- **Liquid**: heat rejection (dry cooler or chiller) → facility water loop → CDU → rack loop.
- **Air**: residual rack heat, non-liquid racks and optics → air handlers.
- **Network**: spine → leaf → cables/optics → rack ports.
- **Structural**: rack feet and tray weight → slab bay.

CDU, air-handler and optics power feed the power network; optics heat feeds air; tray weight feeds structural. Nodes have capacity, loss, redundancy group, position, stable id (tied to its position, such as `CDU-R4-E1`) and provenance.

## Solvers (exact)

All coefficients come from `catalog/rules.json`.

- **Power**: rack peak power (EDPp) per busway, plus CDU, air-handler and optics loads, with per-stage efficiency upstream.
  - **2N** (builder's call): two fully independent chains A and B (transformer, switchgear, UPS or rectifier, busway). Each rack draws from both. Losing one feed puts 100% of the load on the other.
  - **N+1** (builder's call): parallel-redundant. One switchboard and N+1 UPS modules feed both A and B busways of each row. Losing a busway puts the row on the other one. Losing a UPS module leaves N to carry the load. Transformers and switchgear are also N+1.
  - **800 V DC** replaces the UPS/AC stages with the DC chain above. Placing a rack that doesn't support the hall's power input is allowed and fails an "input compatibility" check, so the designer sees it.
- **Liquid**: liquid heat share × rack power → rack-loop mass flow `ṁ = Q / (c_p · ΔT)`, with ΔT the rack-loop preset (130 kW, water, 10 K ≈ 3.1 kg/s ≈ 190 L/min is a required test). Rack flows sum per CDU. Facility-loop ΔT comes from rules. Facility pipe diameter comes from a velocity limit, pressure drop per segment from Darcy–Weisbach on the tree-shaped loop, and pump head is checked against the CDU rating. Coolants: water, 25% or 40% propylene glycol.
- **Heat rejection** (builder's call): a dry cooler if facility supply temp ≥ outdoor design temp + approach (rules), otherwise a chiller. Chiller power goes into PUE. Each rack's `max_coolant_supply_temp` is checked against the rack-loop supply temperature (facility supply + CDU approach).
- **Air**: air heat → air-handler count against positions, energy balance only.
- **Structural**: bay load = rack weights over their footprints plus tray weight over the bay area, compared with the bay rating; point load = weight ÷ feet, compared with the point-load limit. This sits behind an influence-matrix interface (`bay_load = M · rack_loads`) so an FEA-derived matrix can replace the tributary-area matrix later.
- **Network**: leaf and spine counts and the port map come from the fabric preset and scale-out ports. Links route along the tray graph (shortest path plus slack and drops) and are classified copper vs optics by reach. Also computed: optics power per row, oversubscription and bisection per pod and hall, and base latency per path (~5 ns/m plus per-hop latency plus serialization, with constants labeled `estimated`). Switches live in placed network racks; with none placed, the fabric check fails with that reason.
- **Rollups**: IT load (peak, nominal), facility load, PUE estimate, total weight, cable counts and length by class, each with provenance.

### Sizing limits

(Builder's call; the product owner said to proceed without settling it.) What bounds auto-sizing so equipment checks can fail: the hall declares equipment positions (CDU slots per row, air-handler slots, electrical-room capacity for UPS/switchgear/transformers) and may list existing equipment. The engine fills free positions with the largest suitable catalog model up to the count needed. Existing and pinned equipment is fixed. When positions run out, the check fails with advice ("CDU-3 104%: add a CDU position at row 4 or move racks to row 5").

### Pinning

Auto-sized items have stable ids. A pin fixes count, position or model; solvers treat pins as constraints and fail affected checks with a reason rather than overriding a pin.

### Surrogate seam (for Phase 2)

Phase 1 defines the interface Phase 2 fills: `Surrogate.predict(inputs) -> {outputs, confidence, out_of_distribution}` plus a fallback hook to a full solve. Phase 1 registers a `NotModeled` implementation for room airflow, so air-temperature checks appear in the report as **Unknown — not modeled until Phase 2** instead of being absent. Phase 2 adds OpenFOAM (or commercial) CFD sweeps, Gaussian-process scalar surrogates, active learning, and a thermal engineer agent, without changing checks, CLI or UI.

## Checks and failure scenarios

Each check: `{id, subject, metric, normal, worst_failure, failure_name, limit, utilization, status, provenance, explanation, advice?}`. Status: **Pass** (below warning threshold, default 80%), **Warning** (80–100%), **Fail** (over 100%), **Unknown**. Ranked by status then utilization.

Checks: utility capacity, transformer, switchgear, UPS or rectifier, busway/PDU per feed, rack power shelves, power-input compatibility, CDU flow and heat, facility loop velocity and pump head, coolant temperature compatibility, heat rejection, air handlers, air temperature (Unknown until Phase 2), slab bay load, point load, copper reach and system adjacency, leaf/spine ports, oversubscription.

N-1 scenarios, each by removing one component and re-solving the affected domain: one CDU, one feed (A or B), one power shelf, one UPS module or rectifier, one dry cooler or chiller, one air handler, one spine switch. Facility deltas from the previous state (IT kW, cooling kW, PUE) appear beside the report.

## Front end

- 3D hall view (shell, rows, slots, racks sized from footprints, CDUs, busways, trays) with orbit camera; 2D plan toggle.
- Catalog palette with racks and systems; drag onto a slot (a system shows its footprint before dropping). Keyboard path: arrows move a slot cursor, a key opens the palette, Enter places, Delete removes.
- One overlay at a time: power, liquid, structural, network.
- Headroom report panel (status as icon shape + text + color) and inspect panel (inputs, values, headroom, provenance, pin/unpin).
- Branch picker; compare view of two branches (checks side by side, rollup deltas).
- Journal panel showing who made each edit (user or agent name), with live updates from the event stream.
- Stable layout under all updates; presets panel; undo/redo; open/save.

## Visualization and reports

The last step of every design is a report people can read without the tool: what the data center looks like and what the twin found. `dctwin report` writes one self-contained HTML file (no server, works offline, prints to PDF from the browser, light and dark), and the web viewer shows the same report in a Report tab.

A report for one branch contains, top to bottom:

1. **Verdict.** One sentence with the counts of Pass, Warning, Fail and Unknown checks. The top failures follow, with their advice.
2. **Floor plan.** A top-down drawing of the hall:
   - racks drawn to scale and labeled by type, with systems outlined;
   - CDUs, air handlers, trays and columns;
   - failing items marked with a status shape and text, not color alone.
3. **Domain plans.** Small copies of the floor plan, one per domain:
   - power: busway run loading;
   - liquid: CDU loading;
   - structural: bay utilization against rating;
   - network: cable media, copper vs optics.
4. **Facility summary.** IT load, facility load, PUE, total weight, accelerator count and cable totals. A chart breaks facility power into IT, cooling and conversion losses.
5. **Headroom.** The ranked check table: normal, worst N-1 case, failure name, advice and provenance.
6. **Failure scenarios.** For each N-1 scenario, its worst status and the checks it breaks.
7. **Provenance.** The share of results by weakest label, plus the unknown or estimated inputs that most limit confidence, each with its source link.
8. **Design history.** Journal entries with their authors, showing which agent or person made each change.

`dctwin report --compare A B` writes a comparison report instead. It shows the two floor plans side by side, check differences (only the checks whose status changed) and rollup deltas. The design desk's report writer attaches one report per candidate branch and a comparison report to `RUN/report.md`.

## The design desk (Sculptured team)

Shipped in `sculptured/` as a Sculptured `TeamDraft` JSON (Claude) and a `-codex` copy, in the same format and loading procedure as Sculptured's `examples/teams/`, plus a README. Agents work in `runs/design-desk/<date>/`, call the twin only through `dctwin` with `--author <agent-id>`, work each on its own branch, and never edit the twin's source.

| Agent | Job |
|---|---|
| Lead designer | Reads the brief, writes the design plan and the list of candidate approaches, creates one branch per candidate, assigns work. |
| Catalog researcher | Finds sourced values for `estimated` or `unknown` catalog fields the brief depends on; writes proposed catalog updates with links to `RUN/catalog-proposals/` for human approval (never edits `catalog/` directly). |
| Layout designer | Places systems on each candidate branch through the CLI. |
| Power, cooling, structural, network engineers | Each reads its domain's failing or warning checks via `dctwin evaluate --json` and `explain`, proposes and applies fixes (moves, pins, presets) on the branch, and records the reasoning. |
| Independent checker | Re-evaluates each candidate branch from a clean read, including N-1, and writes `RUN/review/<branch>.json` with the verdict and the exact check results; rejects any claim in other agents' notes that the twin output does not support. |
| Report writer | Writes `RUN/report.md`: candidates compared, verdicts, remaining failures, assumptions and provenance gaps. |

The handoffs run lead → researcher and layout (in parallel) → the four engineers (in parallel) → checker → report writer. If the checker finds failures, work goes back to the engineers, up to a revision limit. Each agent gets a token budget like the example teams'. `examples/briefs/hall-b-rubin.md` is the sample brief, written against the sample hall.

## Testing (builder's call)

- Solver unit tests against hand calculations: the 130 kW → 3.1 kg/s case, 2N feed-loss transfer, N+1 module loss, tributary bay load, copper-reach classification.
- Provenance tests: weakest label wins, unknown never passes, overrides carry `user_input`.
- A golden test on the sample hall: fixed placements give a fixed check list.
- A performance test: a 500-rack hall evaluates in under 1 s.
- CLI tests: each command, JSON output schema, concurrent writes to two branches.
- Journal tests: replay, undo, branch base, catalog snapshot notice.
- Front end: component tests for report, inspect and compare panels; one end-to-end test placing a system and seeing the report update, and one where a CLI edit appears live.
- Design desk: the team JSON passes Sculptured's `validate` endpoint; a dry-run script exercises every CLI command the agent jobs reference.

## Left to the builder

Module layout, graph library, API payload shapes, visual style within the rules above, default numbers in `rules.json` and generic equipment (labeled `estimated` with notes), incremental vs full recompute as long as 1 s holds, and the exact wording of agent jobs.

## Open questions carried from the product spec (not blocking)

Primary user segment; commercial CFD vs OpenFOAM (Phase 2); export formats; a live operations twin on the 12-month roadmap.
