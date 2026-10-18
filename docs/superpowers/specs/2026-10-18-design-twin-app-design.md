# Data Center Design Twin: hackathon app design

Date: 2026-10-18. Status: draft for approval. Replaces the earlier Phase 1 design (`2026-10-18-phase1-design.md`) and Plan 1 for this build. Those documents (Python core, Sculptured design desk, 8-label provenance lattice) are not binding. Items marked **(builder's call)** were decided while writing this; everything else came from the product owner.

## Intent

AI data centers are planned by several specialists: compute, rack layout, cooling, power and network. Each works in a separate tool and sees the others' consequences late. Rack power went from about 40 kW to 130–150 kW (GB300 NVL72) in two hardware generations, so one decision now ripples hard across every other layer. Swapping GPUs changes rack power, which changes cooling, which changes weight on the floor, water use, grid headroom on hot days and, in the end, how much compute fits.

This app puts every planning layer into **one shared plan**. Anyone can see the second- and third-order effects of a decision immediately, and **a design agent watches the whole plan**: it warns about problems as they appear, explains the cause chain, suggests fixes without pushing them, and can operate the entire app on request.

Scope is the data center itself. The site is legal, water availability is fixed, and the grid delivers a fixed capacity.

Success means a judge watching the demo understands, in seconds and visually, why a rack decision forces a cooling decision. They see a 3D view that feels like a venture-backed product, not a generated dashboard, and they trust the numbers because each one has a visible origin.

## Who uses it

- **One person at one screen** clicking through all layers (decided: no multi-user sync).
- Each layer stands for a role (compute planner, layout planner, cooling engineer, and so on). Layers show owner initials and per-layer issue badges so the "uniting different people's planning" story stays visible, even though one person drives it.
- Desktop browser on localhost. A laptop-size window (1440×900) is the design target **(builder's call)**.

## Goals

1. Every decision in every layer immediately updates all derived results, with no recompute button.
2. Cooling is the deepest domain: methods, heat rejection, coolant, geometry, flows, water, cost, build-out time and risks, all computed from the plan.
3. Visualization is a top priority: a clean, minimal 3D model of the site, hall, racks and GPUs, with choreographed camera moves between layers and data-driven flow animations.
4. The design agent can do **everything** the UI can do, and more (what-if analysis, explanations, simulation briefs), through tools on one shared command layer.
5. Plans and catalogs import and export as JSON. Users can add their own GPUs, racks, cooling methods and equipment by filling in the same parameters the built-in entries use.
6. Every number on screen comes from either a sourced catalog or knowledge-base value, or the engine's calculation, and the user can see which.
7. No AI slop in visuals, copy or code (see "Quality bar"). This is the product owner's #1 rule.

## Non-goals

- Multi-user editing, accounts, hosting and auth.
- Real CFD or any physics solver beyond textbook algebra. The flow visuals are illustrative and say so.
- Permitting-grade accuracy. Outputs are design-stage estimates.
- Importing CAD or BIM files.
- Mobile layout.
- Extra features nobody asked for. Depth on the requested features matters more than breadth.

## Anti-goals (failure even if it runs)

- A number on screen with no computed origin or catalog source.
- The agent stating a number that neither the engine nor the knowledge base produced.
- Presenting the flow animation as simulation.
- The agent nagging: speaking on every edit, or applying changes nobody asked for.
- Any UI action the agent cannot perform.
- Camera moves that block input, can't be interrupted, or drop the user's selection.
- Status shown by color alone.
- The design tells listed in `frontend-design`: tinted near-black with one acid accent, identical rounded cards everywhere, all-caps eyebrow labels, middle-dot meta strings, "→" on buttons, a monospace face for data labels, fade-up on every element.
- Functionality cut to make room for animation. Both have to be good.

## Constraints

- **Time:** a hard limit of about **4 hours**, including automated testing, design verification and bug fixing. Parallel subagents are used as heavily as the work allows (15 or more). The plan splits into packages that touch disjoint files behind contracts fixed in a short first phase. **Everything in this document is wanted.** The build priority below only orders the work.
- **Siloed from the parallel approach:** a teammate (Alexander) is building a separate version of this product in the same repository, and the two will be compared later.
  - This build lives on its own branch, `linus/twin-app`, created from `main`.
  - Parallel agents work in their own git worktrees and merge into that branch.
  - Nothing on `main` is changed, and his files (`catalog/`, `docs/spec/`, the Phase 1 documents) are neither edited nor reused.
  - Nothing is pushed without the product owner's say-so.
- **Stack:** TypeScript end to end **(builder's call)**. One language lets the engine, schemas and command registry be shared by the server, the browser and the MCP server.
- **Agent runtime:** the official Anthropic TypeScript SDK (`@anthropic-ai/sdk`) calling the Claude API directly, with the SDK's tool runner (or a manual loop where finer control is needed), streaming, prompt caching and adaptive thinking. Authentication is an `ANTHROPIC_API_KEY` from the product owner's Console account (about $20 of credit) in a git-ignored `.env`. The Claude Agent SDK and the Claude Code login are not used for the in-app agent, which avoids sharing rate limits with the build agents and keeps the loop fully under the app's control.
- **Model:** `claude-opus-5-5`, with effort set per turn: low for background observation turns, high for chat **(builder's call)**. A cost estimate of about $0.07 per turn keeps a full demo day within about $20.
- **Skills:** every implementation task starts with a skills step (see "Quality bar").

## The screen

Three columns, as in the approved mockup (`.superpowers/brainstorm/.../cooling-layer-v4.html`):

```
┌────────────┬──────────────────────────────────────┬──────────────────┐
│ Layers     │  overlay switcher            hint     │ Plan totals      │
│  owner,    │                                       │  headline metric │
│  status    │        3D scene (the shared plan)     │  key numbers     │
│            │                                       │  checks, ranked  │
│ Decisions  │                                       ├──────────────────┤
│ for the    │                                       │ Design agent     │
│ active     │                                       │  thread, red     │
│ layer,     │                                       │  warnings, fix   │
│ with notes │───────────────────────────────────────│  proposals,      │
│            │  layer strip (e.g. cooling chain)     │  chat input      │
└────────────┴──────────────────────────────────────┴──────────────────┘
```

- **Left:** the layer list (owner initials, issue counts by shape and number). Below it, the active layer's decisions as editable fields. Each decision can carry a note.
- **Center:** the 3D scene, always on screen, re-lit and re-overlaid per layer. Layers that aren't spatial (Workload, parts of Compute) show their editors in the left column while the scene shows the matching level of detail. A strip under the scene shows a layer-specific schematic: the cooling chain as a piping diagram, the power chain as a one-line diagram, the network as a tier diagram.
- **Top right:** the headline metric, key totals in an aligned table, and the ranked checks. Everything expands into a full "all variables" view (the complete wall of numbers, grouped by layer), opened from the panel. **(builder's call:** a drawer over the center column.)
- **Bottom right:** the agent thread and chat input.
- **Detail-on-click:** clicking any object (rack, CDU, pipe, busway, check, number) opens an inspector with its inputs, computed values, limits, headroom and the origin of each number.

### Design direction (approved)

An engineering-drawing language: a cool paper-grey background, racks rendered as white architectural models, and color only where physics happens. Supply coolant is blue, return is amber, heat and problems are red, OK is green. Typography is Archivo with its width axis (condensed for labels, normal for text) and tabular figures. The memorable element is the **revision cloud**: the agent marks problems on the drawing with the red bumpy outline engineers use on real drawings, and a numbered triangle ties each cloud to its message in the thread. The builder runs the `frontend-design` process again from this direction to produce the full token system. The mockup is a direction, not a spec.

## Layers

Each layer has decisions (what its owner sets), a camera shot and an overlay. All decisions can carry notes.

| Layer | Owner role | Decisions | 3D shot and overlay |
|---|---|---|---|
| **Site** | fixed inputs | location preset (hourly climate), grid capacity (MW), water allowance (m³/day), hall dimensions, floor type and rating (kN/m²) per bay, ceiling height | Whole site: building, roof or yard plant (chillers, dry coolers, towers), utility feed, water feed |
| **Workload** | product / compute buyer | purpose (training, inference, mixed), target compute, notes | Hall at a distance, with racks tinted by the workload they serve **(builder's call)** |
| **Compute** | hardware planner | GPU or rack type per rack group, rack count, custom GPU and rack entries | Rack opens, trays slide out, push in on one GPU with its cold plate |
| **Layout** | facility planner | placing, moving and removing racks on the slot grid; rows; containment (hot/cold aisle); cooling zones (which CDU or CRAH serves which slots) | Low orbit over the rows, then fly to a selected rack. Floor-load heatmap, zone outlines |
| **Cooling** | mechanical engineer | rack cooling method per rack group, heat rejection, coolant, facility supply temperature, piping route (raised floor or overhead), flow balancing, buffer tank volume, custom cooling methods | Whole hall with liquid flow, air flow and temperature overlays, plus the cooling-chain strip |
| **Power** | electrical engineer | redundancy (N, N+1, 2N), distribution (54 V AC busbar or 800 V DC), busway assignment per row, oversubscription allowance | Overhead busways colored by load, plus the one-line strip |
| **Network** | network engineer | fabric (rail-optimized or fat tree), oversubscription, leaf placement | Cable runs from racks to leaves, copper vs optical, plus the tier strip |

Workload, Power and Network are shallower than Cooling, Compute and Layout, but every decision they expose drives numbers.

### Equipment is derived, with overrides

The product owner's framing is that people decide the GPUs/racks, the layout and the cooling solution, and everything else **results** from those decisions. So downstream equipment is **auto-sized by the engine**: CDUs, CRAHs, chillers, dry coolers or towers, pumps, buffer tanks, busways, UPS, transformers and leaf switches.
- The hall defines **equipment positions**: CDU positions per row end, CRAH positions on the perimeter, plant space on the roof or yard, and electrical room capacity. The engine fills the free positions with the smallest suitable catalog model, in the count the load and redundancy need.
- When positions or capacity run out, the matching check fails with advice, e.g. "Rows 3–5 need 3 CDUs; 2 positions are free. Add a position at row 6 or move racks."
- Any auto-sized item can be **overridden**: model, count or position fixed by the user (command `overrideEquipment`, undoable). The engine then checks against the override instead of resizing it.
- Auto-sized items appear in the 3D scene in their positions, labeled as auto-sized in the inspector.

### Failure scenarios (N-1)

Redundancy only means something if losing a unit is checked. **(builder's call:** a light N-1 pass.) The engine re-evaluates the affected domain with one unit removed: one CDU per zone, one chiller/dry cooler/tower, one CRAH per zone, one busway feed, one UPS module. Each relevant check then reports its normal value and its worst single failure, with that failure named. Network N-1 is out of scope.

## Demo script (the cascade the build must make work end to end)

1. Open the default plan. All checks pass, and the agent is quiet.
2. In Compute, switch rows 3–5 to GB300 NVL72. Rack power goes from about 28 kW to 132 kW. The camera opens one rack and pushes in on a GPU.
3. The agent posts a red warning, and a revision cloud appears on rows 3–5: air can't carry 132 kW per rack. It proposes direct-to-chip liquid cooling with auto-sized CDUs, citing the cooling owner's note.
4. Preview it (a ghost overlay of CDUs and piping in 3D), then apply it. The camera returns to the hall and the pipes fill.
5. New effects ripple out:
   - A raised-floor bay goes over its rating (heavier racks plus coolant).
   - Water: with the note "water is scarce", evaporative cooling is ruled out, so dry coolers are chosen.
   - On hot hours the dry coolers need trim cooling, cooling power rises, and the grid cap is exceeded for some hours of the year, so usable compute drops.
6. Ask the agent in chat to fix the floor. It moves racks or changes the floor zone through its tools, and the camera follows.
7. Ask for a simulation brief. The agent generates the OpenFOAM brief, and you open it.
8. Export the plan as JSON, re-import it, and get the identical result.

## Build priority (builder's call, for ordering work; nothing is planned to be cut)

Everything in this document is in scope. If time runs short, the order in which work gets protected is:
1. Engine with the cooling model, the command layer, the agent with proposals and tools, the 3D hall with the cooling overlays, and the demo script above.
2. Camera choreography and the rack and GPU detail levels, revision clouds, the inspector, import/export, the knowledge base.
3. Power and network depth, N-1, the hourly charts, custom-entry forms, the all-variables drawer.
4. The simulation brief, the external MCP server, two-phase immersion and the second climate presets.

### Camera choreography

- Each layer has a **shot**: camera position, target, level of detail and active overlay.
- Switching layers animates along a path through every level of detail in between: GPU → tray → rack → row → hall → site. A jump from GPU to Site is one continuous zoom out that passes the rack closing and the hall receding.
- The GPU and rack shots center on the **selected** rack (or the rack the agent is discussing). Without a selection, they pick the rack with the worst check.
- Transitions last about 0.8–1.6 s depending on distance, use eased motion and can be interrupted. A new click redirects the camera from where it is. Selection and overlays are never lost.
- The rack and GPU models are built procedurally in code at clean, simple fidelity (chassis, doors, trays, cold plates, quick disconnects, manifolds), not imported CAD.
- `prefers-reduced-motion`: cut transitions to short cross-fades.
- Other layers can add their own transitions in the same spirit. Examples: Power traces the feed from the utility to the busway, Network draws cables in. **(builder's call:** the cooling transition also "fills" the pipes from the plant to the racks.)

### Flow visualization (illustrative, data-driven)

- **Liquid:** particles move along pipe curves. Speed scales with computed flow, color shifts from supply temperature to return temperature, and starved racks visibly get fewer, slower particles.
- **Air:** particles leave CRAH/CRAC units along the cold aisles, pass through the racks and rise from the hot aisles. Particle density scales with computed airflow, and racks over their air limit show heat shimmer.
- **Temperature:** racks and aisles are colored on a sequential scale from computed inlet and outlet temperatures.
- **Floor load:** a heatmap per floor bay against its rating.
- A visible label on the scene reads "Illustrative flow, scaled from computed values". The rendering must never imply CFD.

## Plan file and catalogs

### Plan (one JSON document)

The plan is the single source of truth: site inputs, every layer's decisions, rack placements, zones, notes and the selected catalog entries (copied into the plan so it stays self-contained). It has a `schemaVersion`. Import validates against the schema and reports errors as `path: problem`. Export writes the same document. Undo and redo cover every command.

**Notes:** any decision field, rack group or layer can carry a note with an importance of `must`, `prefer` or `fyi` and an author role. The agent reads notes before suggesting anything, and its proposals state which notes they respect or violate.

### Catalogs (JSON, built-in plus custom)

Kinds: GPU/accelerator, rack type, rack cooling method, heat rejection method, coolant, equipment (CDU, CRAH, chiller, dry cooler, cooling tower, buffer tank, busway, UPS, transformer, network switch, optics), and climate presets.

- Every number in an entry is `{ value | low+high, unit, source?, basis }`. `basis` is one of `vendor`, `oem`, `press`, `textbook`, `estimate` or `user`. `vendor` and `oem` values need a source URL; `estimate` needs a note saying how it was estimated **(builder's call:** a simplified version of the earlier provenance labels).
- The inspector shows the basis of each number. Computed values show "calculated from" with their inputs.
- **Custom entries** come from a form generated from the same schema the built-in entries use, or from a JSON import of a catalog pack. Custom values get basis `user`.
- Built-in content **(builder's call)**, researched with sources during the build:
  - **GPU and rack types:** NVIDIA HGX B300-class air-cooled 8-GPU server racks, GB300 NVL72, Vera Rubin NVL72 (estimates flagged), AMD MI355X air and liquid racks, AMD Helios (weight conflict noted), plus network and storage racks.
  - **Rack cooling methods:** air with hot/cold aisle containment, rear-door heat exchanger (passive and active), single-phase direct-to-chip, two-phase direct-to-chip, single-phase immersion. Two-phase immersion is included but flagged as stalled (PFAS fluids).
  - **Heat rejection:** air-cooled chiller with economizer, dry cooler, adiabatic dry cooler, evaporative cooling tower, buffer tanks.
  - **Coolants:** water, PG25, PG40, dielectric oil, two-phase refrigerant.
  - **Climate presets:** 4 locations with hourly dry-bulb and wet-bulb temperatures for a typical year, e.g. Dallas, Phoenix, Frankfurt, Stockholm. **(builder's call:** a real typical-year file if one is quick to source; otherwise a deterministic 8760-hour series synthesized from monthly normals, with basis `estimate`.)

## Evaluation engine

A pure function `evaluate(plan, catalogs) → Evaluation`. It is deterministic, has no I/O, and runs the default plan in under 100 ms so the browser can also run it for previews and what-ifs. The output holds:

- **Metrics:** numbers with units, origin and inputs, grouped by layer.
- **Checks:** `{ id, layer, subject, metric, value, limit, utilization, status (pass, warn, fail, unknown), explanation, causes[] }`. A check with a missing input is `unknown`, never `pass`.
- **Cause chains:** each failing check links back to the decisions that drive it, across layers. Example: "Floor bay D3 at 112% ← DLC racks 1,580 kg ← GB300 NVL72 chosen in Compute".
- **Hourly series:** 8,760 hours of outdoor temperature, cooling power, total facility power vs the grid cap, PUE and water use.

Model formulas and coefficients live in data (a rules file) where a user or the agent can see them, not hidden in code. Builder's calls on fidelity, all textbook-level:

### Heat and compute

- Rack heat = rack IT power (nominal for energy, peak for capacity checks).
- Each rack cooling method defines a liquid heat fraction (for example 0.80–0.90 for direct-to-chip, about 1.0 for immersion, 0 for air), a per-rack heat limit (air with containment about 30–40 kW, rear-door heat exchangers about 50–70 kW) and its parameters (supply temperature range, ΔT, pressure drop, weight added, floor footprint for immersion tanks).
- **Headline:** usable compute under the cap = the compute of placed racks, limited by what the grid can carry at the worst hour. It is reported in PFLOPS (FP8), with GPU count beside it, plus the number of hours per year the plan would exceed the cap.

### Cooling (deepest)

- **Air side:** airflow = Q_air / (ρ·c_p·ΔT_air). CRAH/CRAC count and load per zone, rack-level air limit checks, containment effect on usable ΔT.
- **Liquid side:**
  - Flow per rack: ṁ = Q_liq / (c_p·ΔT). Coolant properties (c_p, density, viscosity) come from the coolant entry.
  - CDU load per zone: heat and flow vs capacity, with redundancy.
  - Row manifold flow balance: without balancing valves, flow falls along the header with a simple pressure-drop model, and the last racks get less flow than they need. Balancing valves fix this at a pump-head cost.
  - A technical loop separate from the facility loop through the CDU heat exchanger (approach temperature), with filtration and glycol share as parameters.
- **Heat rejection, hour by hour:**
  - Chiller: power = Q / COP(T_out), with free-cooling hours when outdoor air is cold enough.
  - Dry cooler: works while T_out + approach ≤ the facility supply setpoint; otherwise trim cooling is needed or the check fails. Fan power rises with T_out.
  - Adiabatic dry cooler: sprays water only above a threshold.
  - Cooling tower: works to wet-bulb + approach. Water ≈ evaporation (about 1.5 L per kWh of heat) plus blowdown.
- **Pumps and fans:** CDU pump, facility pump, CRAH fan and dry-cooler fan power, from rules coefficients.
- **Water:** per hour, per day and per year, against the site allowance. Peak-day water is a check.
- **Buffer tank ride-through:** t = V·ρ·c_p·ΔT_allowed / Q_liquid, reported in minutes, against chiller restart time.
- **Risks surfaced as checks or notes:** leak exposure by piping route (raised floor with leak detection vs overhead), filtration and biological growth for low-glycol loops, coolant supply temperature vs each rack's maximum.
- **PUE:** hourly, annual and at the worst hour.

### Power

- **Facility budget each hour:** IT + cooling + distribution losses (UPS/transformer efficiency from rules) ≤ grid cap.
- **Redundancy** changes equipment counts and cost, not the grid budget.
- **Busway load per row** vs rating, with the oversubscription allowance. For training workloads, synchronized load swings raise the effective peak (the peak-to-average factor comes from the Workload purpose), which shows as breaker-trip risk on busways near their limit.

### Layout and floor

- Placement on a slot grid. Floor load per bay = rack weights (including coolant and the method's added weight) over the bay area, plus point load per rack foot, against the bay rating.
- Raised floors have lower ratings than slab.
- Cooling zones assign slots to CDUs or CRAHs. Racks far from their CDU add pipe length, which affects pressure drop, cost and build time.

### Network (shallow)

- Rack-to-leaf distance comes from the layout (routed along rows).
- Media: passive copper (DAC) up to about 3 m, active electrical cable (AEC) up to about 7 m, optics beyond that. Optics add power that counts against the grid budget.
- Outputs: link count by media, total cable length, optics power, base latency (about 5 ns/m plus hops), and the fabric's oversubscription.

### Cost and build-out

- **Capex** per item from catalog cost fields, with basis shown (mostly `estimate` or `textbook`).
- **Build-out weeks:** the longest of the equipment lead times plus installation time. The piping route changes installation time (overhead is faster than raised floor).
- **Cost of delay:** build-out weeks × an editable value of compute per GPU-hour. The Jane Street point: opportunity cost often outweighs hardware cost.

### Demand problems (builder's call, as delegated)

These are checks or warnings with explanations:
- grid headroom on hot hours
- synchronized training power swings against busway and breaker ratings
- oversubscription beyond the allowance
- long lead times on CDUs, chillers and transformers that set the critical path
- water allowance on peak days
- coolant temperature limits of next-generation racks

## The design agent

### Runtime

- It runs in the local Node server and calls the Claude API through `@anthropic-ai/sdk`.
- The agent has only the app's own tools, defined from the command registry's schemas.
- Replies and tool calls stream into the chat as they happen.
- There is one persistent, append-only conversation per plan session. Starting a new plan or importing one offers to start a new conversation.
- The system prompt and the tool list are frozen and cached. Observations about the user's changes are appended as mid-conversation system messages, so the cache is never broken.
- Refusal and fallback handling, and the API's typed errors, are surfaced in the chat in plain language.

### One command layer

Every state change in the app is a typed **command**, for example `placeRacks`, `moveRack`, `setCoolingMethod`, `setSiteInput`, `addNote`, `addCatalogEntry`, `importPlan`, `undo`. Commands are defined once in a registry with a schema, and every command is undoable. The UI, the agent's tools and the external MCP server all call this same registry. **Parity is structural:** the agent's tool list is generated from the command registry, so a new UI capability is automatically an agent capability.

### Agent tools

- **Read:**
  - `get_plan` (whole plan or a section)
  - `get_evaluation` (summary or full)
  - `explain_check` (a check with its cause chain)
  - `get_hourly` (a series over a range)
  - `list_catalog` and `get_catalog_entry`
  - `get_notes`
  - `search_knowledge` and `read_knowledge`
- **Act:** one tool per command from the registry. These apply immediately when the user asked for the action in chat, and every action is undoable and shows in the thread as a compact change record.
- **Propose:** `propose_change(title, rationale, commands[], respects_notes[], violates_notes[])`. Shown as a proposal card with the evaluation diff (headline, checks, cost, build time, water). The user can preview it on the plan (a ghost overlay in 3D), apply it or dismiss it.
- **What-if:** `what_if(commands[])` evaluates without applying and returns the diff.
- **View:** `set_layer`, `focus` (camera to a rack, row, zone or piece of equipment), `set_overlay`, `annotate` (place a revision cloud with a numbered tag on objects, linked to the message). The agent can show the user what it's talking about.
- **Documents:** `generate_simulation_brief(target)` and `export_plan`.

### Proactive behavior

- After each user command, the server compares the check statuses and the headline against the previous evaluation.
- If a check gets worse (new fail or warning) or the headline moves by more than a threshold, the server queues an observation for the agent. Observations are debounced (about 1.5 s) and combined, so a burst of edits makes one turn.
- The agent speaks only if there's something worth saying. Severity sets the style: problems in red with a revision cloud on the 3D view, information in neutral.
- **The agent never applies a change on its own initiative.** It proposes. When the user asks for something in chat, it acts. Proposals respect notes; when a fix would break a `must` note, the agent says so instead of proposing it silently.
- **Grounding rule:** every number the agent states must come from a tool result (engine, catalog or knowledge base). The system prompt says so and the tools make it easy. The message renderer marks numbers it can match to a tool result **(builder's call:** best-effort, for the inspector).

### Knowledge base

Markdown files in the server, written during the build with sources, searchable by the agent:
- one file per **layer**
- one per **rack cooling method** and per **heat rejection method**
- one per **coolant**
- one per **GPU/rack family**
- one per **layout pattern** (hot/cold aisle, containment types, row lengths, raised floor vs slab vs overhead services)
- topic files: demand problems, water, cost and lead times, leaks and liquid-cooling operations (incl. the Jane Street tour lessons), network media and reach, and the illustrative-vs-simulation boundary

Each file covers how the thing works, textbook numbers with ranges and sources, what to watch for, typical failure modes, and how it interacts with other layers. Writing these files and the agent's system prompt is part of the build. The `humanizer` skill and a domain review pass apply to them.

### Simulation brief

`generate_simulation_brief(target)` produces a detailed Markdown brief for setting up a real simulation in a named tool. **(builder's call:** OpenFOAM, `buoyantSimpleFoam` for room air, as the default target. A second target such as a commercial data-center CFD tool is optional.)
- The geometry, heat loads, boundary conditions, flows and temperatures are filled in **deterministically from the plan**, not written by the model.
- The agent adds the narrative: what to simulate first, mesh guidance, which results to compare against the app's estimates, and what to watch for.
- The brief can be downloaded and is meant to be handed to another AI agent or an engineer.

### External MCP server

A stdio MCP server exposes the same tools to outside clients such as Claude Code, so a developer or a build agent can drive the running app. It connects to the local server over HTTP.

## Default plan

Ordinary, nothing extreme, all checks passing at the start **(builder's call** on the exact values):
- **Site:** Dallas climate preset, 10 MW grid, a modest water allowance, a 48 × 30 m hall on raised floor.
- **Hall:** 8 rows of slots, half of them filled with air-cooled 8-GPU racks at about 25–30 kW, CRAHs with hot-aisle containment, an air-cooled chiller at an 18 °C supply.
- **Power and network:** N+1 redundancy, 54 V AC, a rail-optimized fabric.

The plan is reachable from "New plan", and import/export round-trips it.

## Quality bar (applies to every task)

The product owner's #1 rule is no AI slop anywhere: visuals, copy and code.

1. **Skills step first, in every task.** Decide which skills would make this task excellent. Check what's installed. If a needed skill is missing, search for one (skill marketplaces, GitHub), rank the candidates by GitHub stars and judgment, read the skill's files before installing (a skill is instructions the agent will follow, so prefer official or widely used sources), install it at project scope, and use it. Record what was used in the task's report.
2. **UI work** follows `frontend-design`: plan tokens, review the plan against the generic-default list, build, then screenshot with Playwright and critique the screenshots before calling the task done. Charts and number panels use `dataviz`. Copy and agent messages use `humanizer`.
3. **Code work** follows superpowers test-driven development (engine, commands, schemas and agent tools are test-first), then a `simplify` or code-simplifier pass, then code review, then verification before completion: tests run and output shown, and the app launched and checked in a browser for anything visible.
4. **Agent work** loads the `claude-api` skill before writing any API code (current model ids, tool runner, streaming, caching, effort, fallbacks), and uses `mcp-server-dev` for the external MCP server. Prompts and tool descriptions get the same writing discipline as UI copy.
5. **No placeholder numbers in the shipped app.** Anything unsourced is labeled `estimate` with a note.

## Architecture (builder's call)

```
packages/
  schema/     zod schemas and TypeScript types: plan, catalog entries, commands, evaluation, agent messages
  engine/     pure evaluate(); rules coefficients; hourly model; cause chains; what-if diff
  catalog/    built-in catalog JSON, climate presets, rules.json; loader and validator
  commands/   command registry: schema, apply, inverse (undo); used by server, web and agent
apps/
  server/     Node: plan state, command dispatch, undo/redo, evaluation, WebSocket push,
              agent runtime (@anthropic-ai/sdk, tools from the command registry), observation queue,
              knowledge base (knowledge/*.md), simulation brief generator, import/export
  web/        Vite + React + React Three Fiber (+ drei): scene, camera rig, LOD models,
              overlays, flow particles, annotations; layer panels; totals; checks; inspector;
              agent thread and proposal cards; import/export; custom-entry forms
  mcp/        stdio MCP server proxying the same tools to the local server
```

- **State:** the server holds the plan. The web client sends commands and receives the new plan and evaluation over a WebSocket. The client runs `evaluate` locally only for previews and what-ifs.
- **Tests:** Vitest for packages, Playwright for end-to-end flows and screenshots.
- **Monorepo:** npm workspaces (Node 20 is installed; pnpm and bun are not).

## Left to the builder

Module layout inside each package, exact coefficients and catalog values (sourced), the visual token system within the approved direction, the procedural model detail, the particle implementation, the observation-turn wording, and how the work is split across parallel agents.

## Calls made in this document (for review)

- TypeScript monorepo instead of the Python core
- The agent runs on the Claude API with an API key, not the Agent SDK on the Claude Code login
- `claude-opus-5-5` for the agent, with effort set per turn
- Simplified number origin (`basis`) instead of the 8-label provenance lattice
- 4 climate presets
- Default plan values
- The shape of the cooling model and its formulas
- A row-manifold balance model
- Downstream equipment auto-sized into hall-defined positions, with user overrides
- A light N-1 pass for cooling and power
- A build-priority order for protecting work if time runs short
- "Demand problems" defined as listed above
- OpenFOAM as the simulation-brief target
- An "all variables" drawer
- A cooling transition that fills the pipes
- An external stdio MCP server
- Proposals for agent-started changes, direct action for chat requests
- A best-effort grounding marker for numbers in agent messages
