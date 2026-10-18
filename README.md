# Data-Center-Design-Twin

A design tool for AI data centers. You place racks in a 3D hall; the twin sizes everything downstream — power, liquid cooling, air, floor structure and network — and reports what breaks, in normal operation and when any one component fails. A team of AI agents running on [Sculptured](https://github.com/Sculptured/Sculptured) can act as the designer, using the twin as its engineering tool.

**Why now:** rack power went from about 40 kW (Hopper) to 130–155 kW (GB300 NVL72) to 190–245 kW (Vera Rubin NVL72, AMD Helios), with 600 kW racks on NVIDIA's 2027 roadmap. Most existing halls cannot host these racks, and every hardware generation changes the power, cooling and weight envelope.

## Status

Early. What exists today:

| Part | State |
|---|---|
| Product spec and Phase 1 design | Written — see [Docs](#docs) |
| Component catalog (JSON) | In progress: racks, systems and equipment researched with sources |
| Core engine and `dctwin` CLI (Python) | Planned — [Plan 1](docs/superpowers/plans/2026-10-18-plan1-core-engine-cli.md) |
| API and 3D web viewer (TypeScript, Three.js) | Planned — Plan 2 |
| Sculptured design desk team | Planned — Plan 3 |

## What Phase 1 does

- **Catalog-driven racks and systems.** Rack types (GB300 NVL72, Vera Rubin NVL72, AMD Helios, air-cooled HGX, network and storage racks) and multi-rack systems such as an 8-rack scalable unit are data, not code.
- **Provenance on every number.** Each value is labeled `vendor_spec`, `oem_datasheet`, `measured`, `user_input`, `derived`, `estimated`, `surrogate` or `unknown`. A computed result inherits the weakest label of its inputs, and a check with an unknown input reports **Unknown**, never Pass.
- **Exact solvers, under a second.** Power chain (2N or N+1, 54 V busbar or 800 V DC), liquid loop and CDUs, heat rejection, air handlers, slab bay and point loads, and the network fabric with cable routing, copper vs optics and base latency.
- **N-1 failures as first-class checks.** Loss of a CDU, a power feed, a UPS module, a power shelf, a dry cooler or chiller, an air handler, or a spine switch.
- **Branches and an attributed journal.** Every edit records who made it (a person or a named agent); branches can be compared side by side.
- **Reports people can read without the tool.** `dctwin report` writes one self-contained HTML file per design: a to-scale floor plan, power/liquid/structural/network plans, facility summary, ranked headroom, failure scenarios, provenance and who changed what. A comparison mode puts two designs side by side.
- **CFD and ML surrogates later.** Room airflow is a Phase 2 surrogate behind an interface that already exists; until then air-temperature checks report "not modeled".

## The design desk

A Sculptured team that designs a hall from a brief such as "20 MW of Vera Rubin in Hall B, 2N power, existing 14 kN/m² slab":

1. **Lead designer** — splits the brief into candidate approaches, one twin branch each.
2. **Catalog researcher** — fills estimated or unknown catalog values with sourced ones.
3. **Layout designer** — places systems through the `dctwin` CLI.
4. **Power, cooling, structural and network engineers** — fix their domain's failing checks on each branch.
5. **Independent checker** — re-runs the twin, including N-1, and rejects any claim the twin does not back.
6. **Report writer** — compares the candidates and lists remaining failures and assumptions.

You watch the work on the Sculptured board and review the branches in the twin's 3D view.

## Repository layout

```
catalog/      component catalog (JSON) — racks/, systems/, equipment/, rules.json
  schema/     JSON Schema for catalog entries
  FORMAT.md   how to write an entry
  validate.py schema + cross-file validation
docs/
  spec/product-spec.md                 full product and technical spec
  superpowers/specs/                   Phase 1 design
  superpowers/plans/                   implementation plans
core/         Python engine and CLI (planned)
web/          TypeScript + Three.js viewer (planned)
sculptured/   design-desk team files (planned)
examples/     sample hall, project and brief (planned)
```

## Working with the catalog

Each entry is one JSON file; every physical value is a quantity with a unit, a provenance label and, for vendor figures, a cited source:

```json
{ "value": 132000, "unit": "W", "provenance": "oem_datasheet", "source": "hpe-gb300-quickspecs" }
```

Validate the whole catalog (requires [uv](https://docs.astral.sh/uv/)):

```bash
uv run --with jsonschema python catalog/validate.py
```

It prints each problem as `<file>: <field.path>: <problem>` and exits non-zero if any exist. See [catalog/FORMAT.md](catalog/FORMAT.md) for the full rules.

## Docs

- [Product and technical spec](docs/spec/product-spec.md)
- [Phase 1 design](docs/superpowers/specs/2026-10-18-phase1-design.md)
- [Plan 1: core engine and CLI](docs/superpowers/plans/2026-10-18-plan1-core-engine-cli.md)

## Scope note

Outputs are design-stage estimates, not permitting-grade engineering. Vendor figures change and sometimes conflict; check the provenance and source of any number before relying on it.
