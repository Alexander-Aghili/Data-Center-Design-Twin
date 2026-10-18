# AI Data Center Design Twin — Product & Technical Spec

Source: Claude Doc "AI Data Center Design Twin — Product & Technical Spec" (rev 15, 2026-10-18). Links to sources are in the original doc.

## Overview

We are building a design tool for AI data centers: a user places racks in a 3D hall, and the tool sizes everything downstream (power, cooling, network, structure) and reports what breaks. The only manual design step is rack and row placement, and even that has an optimizer that suggests improvements.

The reason it is needed now: rack power went from about 40 kW (Hopper) to 130–155 kW (GB300 NVL72) to 190–245 kW (Vera Rubin NVL72, AMD Helios), with 600 kW racks on NVIDIA's 2027 roadmap. Most existing halls cannot host these racks, and every hardware generation changes the power, cooling and weight envelope.

Goals
- Answer "what happens if I put this rack here?" in under a second for power, liquid, floor load and network.
- Answer it in seconds for airflow and thermal questions, using ML surrogates of CFD.
- Show every number's provenance (vendor spec, measured, estimated, surrogate).
- Make failure scenarios (lose a CDU, a feed, a spine switch) first-class checks.
- Produce exports a design firm or operator can act on: bills of materials, single-line diagrams, cooling schedules.

Non-goals for v1
- Live operations twin with telemetry ingestion (planned for a later phase).
- Replacing certified engineering tools for permitting; outputs are design-stage estimates.
- Building-shell design (we import the shell, we don't design it).

## User workflow

The user places racks; everything else is generated, and any generated item can be pinned to override it.
- Set up the hall. Import or sketch the shell: dimensions, slab rating per bay, column grid, utility capacity, heat-rejection limits.
- Pick presets. A few clicks: redundancy (N+1 or 2N), power distribution (54 V busbar, 800 V DC), facility water temperature, network fabric (fat tree or rail-optimized, oversubscription, switch model).
- Place racks in 3D. Drag catalog racks into row slots. Every drag has a keyboard path.
- Read the result. The tool auto-sizes the power chain, cooling chain, network and structure, then shows a headroom report with traffic-light overlays.
- Optimize. An "optimize placement" button proposes moves as a reviewable diff, never a silent rearrangement.
- Branch and compare. Save scenarios as branches ("Rubin in Hall B" vs "Helios in Hall B") and compare side by side.
- Export. Bill of materials, single-line diagram, cooling schedule, cable schedule, report.

Pinning: every generated item is labeled auto-sized. When a user pins one (for example, a CDU fixed at a specific position), the engine designs around it instead of overwriting it.

## Rack catalog and data model

A rack type is a catalog entry with a full load profile, never hand-typed numbers. Swapping a rack's type swaps its profile, and every network recomputes.

Fields per catalog entry
- Identity: vendor, model, generation, availability date.
- Electrical: nominal power, peak power (EDPp), power shelf count and rating, input voltage, PSU efficiency, transient behavior.
- Thermal: share of heat to liquid vs air, coolant supply temperature, flow per kW, pressure drop, quick-disconnect type.
- Mechanical: footprint (width × depth × height), rack units, weight, point loads per foot, service clearances.
- Network: scale-up domain size and bandwidth, scale-out ports (count, speed, media), switch trays.
- Compute: accelerator count, HBM capacity, FP4/FP8 peak (for per-MW metrics).

Provenance on every value. Each number carries a label: vendor spec, OEM datasheet, measured on site, estimated, derived, or surrogate. Missing values stay "unknown", never zero. Every computed result inherits the weakest label among its inputs, so a headroom check built on an estimate says so.

Starting catalog (vendor or reseller figures, October 2026):

| Rack | Accelerators | Power, nominal / peak | Weight | Footprint | Status |
| --- | --- | --- | --- | --- | --- |
| NVIDIA GB300 NVL72 | 72 GPUs, 36 Grace CPUs | 132 kW / ~155 kW | ~1,580 kg (source) | 48U, standard width | Shipping |
| NVIDIA Vera Rubin NVL72 | 72 Rubin GPUs, 36 Vera CPUs | ~190–230 kW, estimated (source) | unknown | 600 × 1,200 × 2,300 mm (source) | Early access since Sept 2026 |
| AMD Helios | 72 MI455X, EPYC Venice CPUs | ~225–245 kW (source) | ~2,270–3,170 kg (reports conflict) | Double-wide ORW, 1,200 mm wide | Shipping from late Q3 2026 |
| NVIDIA Rubin Ultra (Kyber) | 576 GPU dies | ~600 kW | unknown | Rack plus power/cooling sidecar | 2027 roadmap |
| Air-cooled 8-GPU servers (e.g. HGX B300) | 8 GPUs per chassis | ~14 kW per chassis (source) | per chassis | Standard rack | Shipping |
| Network and storage racks | none | user-defined | user-defined | Standard rack | n/a |

AWS Trainium3 and Google TPU racks are cloud-only and not purchasable, so they enter the catalog only as reference designs if needed.

Equipment catalog. The same structure covers CDUs, power shelves, busways, PDUs, UPS, switchgear, transformers, chillers, dry coolers, air handlers, switches, optics and cables.

## Asset graph

The model is one typed graph: every physical thing is a node, and every way load passes between things is an edge. Five overlapping networks meet at each rack.
[EMBED: asset graph · five networks feeding each rack]

Each node has a capacity, an efficiency or loss, a redundancy group (A/B feeds, N+1), a position in the hall and provenance on its values. Cross-network links matter: cable tray weight feeds structural loads, optics power feeds power and air cooling, and a CDU's power draw feeds the electrical network.
- Power: utility → transformer → switchgear → UPS and batteries → busway or PDU → rack power shelves.
- Liquid: heat rejection (dry cooler or chiller) → facility water loop → CDU → rack loop → cold plates.
- Air: residual rack heat, plus network and storage racks → aisle containment → air handlers.
- Network: spine → leaf → cables and optics → rack ports, with routed lengths per link.
- Structural: rack feet → floor or plinth → slab bay → columns.

## Auto-sizing engine

The engine works backward from rack placements and presets to size every upstream component, then flags anything at or over its limit. It reruns on every edit.

Power chain. Sum rack peak power (EDPp, not nominal) per busway or PDU, then size UPS, switchgear and transformers with the chosen redundancy. Apply efficiency losses at each stage. Support both 54 V in-rack busbars and 800 V DC distribution, which carries over 150% more power through the same copper (source).

Cooling chain. Split each rack's heat into liquid and air shares. The liquid share sets the required flow:
```
m_dot = Q_liquid / (c_p * ΔT)
```

For a 130 kW rack in water at a 10 K temperature rise, that is about 3.1 kg/s, roughly 190 L/min; glycol mixes need more. Rack flows sum to CDU flow, which sets CDU count and position per row, then facility loop pipe sizes and heat-rejection capacity. The air share sizes air handlers and containment.

Network fabric. From the fabric preset and rack count, derive leaf and spine counts, port maps, cable routes along trays, cable lengths, the copper vs optics split by reach, and optics power.

Structural. Floor load per bay from rack weights, point loads and cable tray weight, using precomputed influence matrices (see the fidelity section).

Rollups. Total IT load, PUE estimate, water use, total weight, cable bill of materials, cost estimate, and each result's provenance label.

Rules over magic. Sizing rules (redundancy, derating, spare ports, safety margins) are visible, editable configuration, not hidden code, so an engineer can audit why the engine chose four CDUs instead of three.

## Physics fidelity ladder

Use the cheapest solver that is accurate enough. Most of the model is exact and instant; ML surrogates are reserved for room airflow and transients.

| Domain | Method | Speed | Surrogate needed? |
| --- | --- | --- | --- |
| Energy and heat balance | Algebra | Instant | No |
| Electrical | Load flow, capacity and breaker checks | Instant | No |
| Liquid loop | 1D pipe-network solver (Modelica-style) | Sub-second | Rarely |
| Structural | Linear FEA, solved once into influence matrices | Instant after precompute | No: superposition is exact |
| Room airflow (CFD) | Full CFD takes minutes to hours | Slow | Yes, the main ML target |
| Transients (pump trip, GPU power swings) | Time-domain simulation | Slow | Yes, for interactive use | Structural without ML. Precompute the slab's response to a unit load at each rack position. Any layout is then a weighted sum of those responses, which is exact for linear static analysis. Re-solve only when the slab, columns or rack slot grid change. |

CFD surrogates.
- Training data: parametric CFD sweeps over rack layouts, residual air heat, supply temperatures and containment options, using OpenFOAM or a commercial data center CFD tool.
- Gaussian processes or polynomial chaos for a few scalar outputs (max rack inlet temperature, hot-spot margin), with uncertainty built in.
- Graph neural networks on the CFD mesh (MeshGraphNets-style) for full temperature fields that generalize to new layouts.
- Neural operators (FNO, DeepONet) or POD reduced-order models for a single fixed hall geometry.

Guardrails. Every surrogate answer carries a confidence value and an out-of-distribution flag. A design outside the training envelope queues a full CFD run, and the result joins the training set (active learning). Surrogate results are labeled "surrogate" in provenance until a full solve confirms them.

## Network and latency modeling

The layout sets the latency floor exactly; the tail comes from traffic and congestion, so tail numbers are always shown with their assumptions.

Base latency (exact, from the layout). Sum along each routed path:
- Propagation: about 5 ns per meter in fiber, slightly less in copper, using routed cable lengths along trays including slack.
- Switch hops: a few hundred ns per cut-through Ethernet hop, lower for InfiniBand and NVLink switches. A 3-tier fat tree crosses 1 switch on the same leaf, 3 in the same pod, 5 across the spine.
- Serialization: message size ÷ link rate (a 4 KB message at 800 Gb/s takes about 41 ns), plus NIC and software overhead, typically a microsecond or more.

These per-component values are approximate placeholders until replaced with datasheet figures in the catalog.

Why the tail is different. Across a whole hall, extra cable adds about 0.5 µs. Queuing under load adds tens to hundreds of microseconds. Layout changes the floor; traffic, oversubscription and congestion control set the tail.

Tail latency ladder
- Analytical: per-link utilization from a traffic matrix plus queuing approximations. Fast, good for comparing layouts, weak at p99.9.
- Flow-level simulation: max-min fair sharing across flows. Job completion times for thousands of flows in seconds.
- Packet-level discrete-event simulation (ns-3, OMNeT++, or ASTRA-sim for AI collectives). Real tail distributions with incast, ECN/DCQCN and adaptive routing, but slow, so it is a surrogate candidate like CFD.

Headline metric for AI clusters: collective completion time. A training step waits for the slowest participant, so report results like "all-reduce of 1 GB across 8 racks: p50 and p99 under these assumptions".

Assumption presets, visible and editable: workload (training all-reduce, MoE all-to-all, inference request/response, storage incast), topology and oversubscription, congestion control, background load %, and a degraded mode with one spine switch down.

Other network outputs from the layout
- Cable reach: high-speed copper reaches only a few meters, which keeps NVLink inside the rack. Links beyond copper reach are flagged as needing optics.
- Cable plant: count, total length, tray fill %, tray weight (fed into structural).
- Optics power per row (fed into power and air cooling).
- Bisection bandwidth and oversubscription per pod and hall.
- Failure domains: what one switch, feed or CDU failure takes offline.
- Placement advice: which pod keeps a job under one spine with fewer hops.

## 3D placement optimization

Rack and row placement is the one real design decision, so it gets a solver that suggests moves; the user always approves them.

Formulation. The hall is a grid of rack slots in rows. Decision variables assign each rack (or rack group, such as one training job's racks) to slots.

Hard constraints
- Floor load per bay under the slab rating.
- CDU and pipe reach, and cooling-zone capacity.
- Power feed capacity per busway or PDU, including the failure scenario.
- Copper reach for links that must stay copper; service clearances; containment rules.
- Pinned items stay where the user put them.

Objectives (weighted, user-adjustable)
- Minimize total cable length and hop count for racks that talk to each other (same job, same rail).
- Balance load across power feeds and cooling zones.
- Minimize the blast radius of any single failure.
- Keep headroom for planned future racks.

Solver. Mixed-integer programming for small halls and exact answers; simulated annealing or genetic search for large halls and nonlinear objectives (for example, surrogate airflow scores). Warm-start from the user's current layout so suggestions stay close to it.

Output is a diff. For example: "Move these 4 racks: −18% cable length, bay D7 back under its floor limit, CDU-3 drops from 104% to 88%." The user accepts all, some or none.

## Headroom and failure scenarios

Every edit produces a ranked list of constraint checks with remaining headroom, in normal operation and under each failure scenario.

Example report after adding a Helios rack at row 4, position 7 (illustrative values):

| Check | Normal | Worst failure case | Result |
| --- | --- | --- | --- |
| CDU-3 flow | 104% | n/a | Fail: add a CDU or move to row 5 |
| Slab bay D7 | 15.2 kN/m² vs 14 rated | n/a | Fail |
| PDU-B load | 64% | 91% with feed A lost | Warning |
| Hot-aisle peak temperature | 38°C | 41°C with one air handler lost | Pass |
| Spine oversubscription | 1:1 | 1.33:1 with one spine lost | Pass |

Facility deltas are shown beside it: +240 kW IT, added cooling load, PUE change, water use.

Failure scenarios (N-1 by default)
- Loss of one CDU, power feed, power shelf, UPS module, chiller or dry cooler, air handler, or spine switch.
- User-defined combinations (N-2) for critical halls.

Transients worth modeling
- Synchronized GPU training load swings: thousands of GPUs stepping together create megawatt-scale power oscillations. Model the interaction with UPS, battery storage and the utility.
- Cooling ride-through: after a CDU pump trip, seconds until GPUs throttle, given coolant volume and rack heat.
- Startup sequencing of power and cooling loops.

## UX

The 3D floor plan is the entry point; every result is one click from the rack or component it concerns.
- 3D floor plan with drag-and-drop racks into row slots, plus a 2D plan view for precision work.
- Overlays per network: power (feed loading), liquid (flow and temperature), air (surrogate temperature field), structural (bay loading), network (cable routes, copper vs optics, hop counts).
- Status as shape plus text, never color alone. Stable layout: updates never move cards or reset the viewport or selection.
- Inspect panel: click any item to see its inputs, computed values, headroom and provenance labels.
- Scenario branches: git-style branches with side-by-side comparison of headroom, cost, PUE and latency.
- Time axis: load vendor roadmaps to see when a hall is stranded by the next rack generation (NVIDIA ships a new rack platform roughly every 12 months).
- Reverse sizing: "Give me 20 MW of Vera Rubin in this building" returns the minimum infrastructure and a starting layout.
- Exports: bill of materials, single-line diagram, cooling schedule, cable schedule, PDF report, and a machine-readable model file.
- Event journal: every edit is logged append-only, which powers undo, branching and audit history.

## Build approach and tooling

Build the exact solvers and the graph first, keep the expensive physics behind a common surrogate interface, and treat outside tools as integrations rather than foundations.

Suggested components
- Model core: typed asset graph plus catalog schema with provenance; versioned, append-only edit journal.
- Solvers: power and liquid network solvers, structural influence matrices, cable router, latency calculator, placement optimizer (an MIP solver such as OR-Tools or HiGHS).
- Physics backends: OpenFOAM or a commercial CFD tool for training data; ns-3 or ASTRA-sim for network ground truth.
- Surrogate service: one interface for every surrogate (inputs, outputs, confidence, out-of-distribution flag, fallback to full solve).
- Front end: web 3D viewer (Three.js-class) plus 2D plan.

Sculptured (github.com/Sculptured/Sculptured): honest assessment. It is a visual workspace for running teams of AI coding agents (Claude Code or Codex) on a board, written in Rust and React under Apache 2.0.
- Inside the product: no. It has no physics, network simulation, geometry or data center modeling, and embedding it would add an unrelated runtime.
- For building the product: possible. A team of agents could split catalog research, solver work, tests and review. Any agent harness can do this, agent runs consume plan usage, and its maturity (hosted beta) was not assessed, so trial it on a small slice first.
- Ideas worth borrowing: provenance labels that separate reported, observed, verified and heuristic results; an append-only event journal; board rules such as stable layout, keyboard paths for every drag, and status shown as shape plus text.

Existing tools to benchmark against: data center twin and CFD offerings from Cadence, NVIDIA's Omniverse work for AI data centers, and Schneider Electric and Vertiv design tools. Our intended edge is the fast surrogate layer combined with catalog-driven what-if analysis across all domains at once.

## Roadmap, risks and open questions

Ship the exact cross-domain graph first; it proves the product before any CFD or packet simulation is built.
[EMBED: roadmap · 4 phases, 3 gates]

Phase 1 is the MVP: a catalog of 4–5 rack types, the graph with exact solvers, and headroom checks with N-1 failures. Dates are open until the primary user and team size are settled.

Risks
- Catalog data quality: vendor figures change and conflict (Helios weight is reported as both ~5,000 and ~7,000 lb). Mitigation: provenance labels and a source link on every value.
- Surrogate trust: users may over-trust ML answers. Mitigation: confidence values, out-of-distribution flags, automatic fallback to full solves.
- Scope creep into a full CAD or BIM tool. Mitigation: import the shell, don't design it.
- Fast hardware cadence: a new rack platform roughly every year. Mitigation: catalog-driven design so new racks are data, not code.

Open questions
- Primary user: operator planning its own halls, design or engineering firm, or hardware vendor?
- Which hall sizes and rack counts must v1 handle interactively?
- Commercial CFD license or OpenFOAM for surrogate training data?
- Which export formats do target users need first (DWG, IFC, PDF, spreadsheets)?
- Is a live operations twin (telemetry ingestion) on the 12-month roadmap?

## Sources
- HPE: NVIDIA GB300 NVL72 QuickSpecs
- Moduledge: GB300 NVL72, what one rack demands
- Moduledge: NVIDIA Vera Rubin for data center providers
- Cisco: AI Rack for NVIDIA Vera Rubin NVL72 datasheet
- Civo: Vera Rubin NVL72 rack details
- Introl: Vera Rubin and 600 kW racks
- DCD: 800 V DC and 1 MW racks
- DCD: AMD launches Helios
- remio: Helios power load
- TBR: AMD Helios shipments and partners
- The Next Platform: Helios manufacturing model
- ABI Research: AMD and Schneider Helios reference design
- The Register: Trainium3 and the NVL72 mold
- Sculptured repository
