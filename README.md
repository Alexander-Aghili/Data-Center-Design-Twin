# Data-Center-Design-Twin

A design tool for AI data centers. You place racks in a 3D hall; the twin sizes everything downstream — power, liquid cooling, air, floor structure and network — and reports what breaks, in normal operation and when any one component fails. A team of AI agents running on [Sculptured](https://github.com/Sculptured/Sculptured) can act as the designer, using the twin as its engineering tool.

**Why now:** rack power went from about 40 kW (Hopper) to 130–155 kW (GB300 NVL72) to 190–245 kW (Vera Rubin NVL72, AMD Helios), with 600 kW racks on NVIDIA's 2027 roadmap. Most existing halls cannot host these racks, and every hardware generation changes the power, cooling and weight envelope.

## Status

Early. What exists today:

| Part | State |
|---|---|
| Product spec and Phase 1 design | Written — see [Docs](#docs) |
| Component catalog (JSON) | Done for Phase 1: 8 racks, 9 systems, 46 equipment models, sizing rules; every value sourced or labeled — see [Catalog](#catalog) |
| Core engine and `dctwin` CLI (Python) | Planned — [Plan 1](docs/superpowers/plans/2026-10-18-plan1-core-engine-cli.md) |
| API and 3D web viewer (TypeScript, Three.js) | Planned — Plan 2 |
| Sculptured design desk team | Planned — Plan 3 |
| Operations twin prototype (energy per unit of work, telemetry tracker, AutoLab hill) | Working — [prototypes/cool-the-cluster](prototypes/cool-the-cluster/) |

## What Phase 1 does

- **Catalog-driven racks and systems.** Rack types (GB300 NVL72, Vera Rubin NVL72, AMD Helios, air-cooled HGX, network and storage racks) and multi-rack systems such as an 8-rack scalable unit are data, not code.
- **Provenance on every number.** Each value is labeled `vendor_spec`, `oem_datasheet`, `measured`, `user_input`, `derived`, `estimated`, `surrogate` or `unknown`. A computed result inherits the weakest label of its inputs, and a check with an unknown input reports **Unknown**, never Pass.
- **Exact solvers, under a second.** Power chain (2N or N+1, 54 V busbar or 800 V DC), liquid loop and CDUs, heat rejection, air handlers, slab bay and point loads, and the network fabric with cable routing, copper vs optics and base latency.
- **N-1 failures as first-class checks.** Loss of a CDU, a power feed, a UPS module, a power shelf, a dry cooler or chiller, an air handler, or a spine switch.
- **Branches and an attributed journal.** Every edit records who made it (a person or a named agent); branches can be compared side by side.
- **Reports people can read without the tool.** `dctwin report` writes one self-contained HTML file per design: a to-scale floor plan, power/liquid/structural/network plans, facility summary, ranked headroom, failure scenarios, provenance and who changed what. A comparison mode puts two designs side by side.
- **CFD and ML surrogates later.** Room airflow is a Phase 2 surrogate behind an interface that already exists; until then air-temperature checks report "not modeled".

## Catalog

Researched on 2026-10-18 from vendor datasheets, OEM spec sheets and, where nothing official exists, press reports. A `~` marks a value whose provenance is `estimated`; ranges mean sources conflict or the vendor gives a range. Open any entry in `catalog/` for its sources, notes and the full field set.

| Rack | Peak power | Weight | Liquid share | Scale-out ports | Power input |
|---|---|---|---|---|---|
| NVIDIA GB300 NVL72 | 155 kW | 1,360–1,580 kg~ | 90% | 72 × 800G | ac_54v |
| NVIDIA Vera Rubin NVL72 | 240 kW | 1,800 kg~ | 95–98%~ | 144 × 800G | ac_54v, dc_800v |
| NVIDIA Rubin Ultra Kyber rack (NVL576 / NVL144) | 660 kW~ | unknown | 95–100%~ | 576–1,152~ × 800G~ | dc_800v |
| AMD Helios (72x MI455X) | 246 kW~ | 2,267–3,175 kg~ | 84–95%~ | 216 × 800G | ac_54v |
| AMD Instinct MI355X DLC rack (8x 8-GPU, 48U) | 120–135 kW~ | 800–1,100 kg~ | 75–85%~ | 64 × 400G~ | ac_54v |
| Air-cooled HGX B300 rack (4 x 8-GPU servers) | 76 kW | 1,122 kg | 0% | 32 × 800G | ac_54v |
| Network rack (InfiniBand leaf/spine, 48U, 800 mm) | 56 kW~ | 800 kg~ | 0% | 0 × 800G | ac_54v |
| AI storage rack (10 x DDN AI400X3M class appliances) | 24 kW~ | 700 kg~ | 0% | 40~ × 800G~ | ac_54v |

| Equipment | Models |
|---|---|
| CDUs | Boyd ROL4000-48U65 in-row CDU; CoolIT AHx240 liquid-to-air CDU; CoolIT CHx2000 row-based CDU; CoolIT CHx3000 row/facility CDU; Delta GoCool-1500 liquid-to-liquid CDU; LiquidStack CDU-1MW; Vertiv CoolChip CDU 2300kW |
| Busways | Delta 800 VDC DC Busway (announced); Siemens SIVACON 8PS LData 2500 A; Starline T5 Track Busway 1200/1250 A; Vertiv Powerbar iMPB 1000 A (aluminium) |
| Switchgear | ABB Infinitus 800 VDC distribution and protection (announced); ABB MNS LV switchgear, 6300 A main busbar; Eaton Magnum DS LV switchgear, 4000 A main bus |
| UPS modules | Huawei UPS5000-H 1200 kVA; Schneider Electric Galaxy VXL 1250 kW (400 V); Vertiv Liebert Trinergy Cube 1600 kW (480 V) |
| 800 V DC rectifiers | Delta 800 VDC In-Row Power Rack 660 kW; Schneider Electric 800 VDC sidecar (in development); Vertiv PowerDirect 5000 800 VDC sidecar (pre-release) |
| Transformers | Eaton (Cooper Power) Envirotran HDC 3000 kVA liquid-filled; Schneider Electric Trihal 2500 kVA cast-resin, 20 kV / 400 V; Siemens Energy CARECO 2500 kVA cast-resin, 11 kV / 400 V; Sungrow EnerNeo solid-state transformer 3 MW (MV AC to 800 VDC) |
| Dry coolers | EVAPCO eco-Air EAW-DD 1512XL017G7 double-stack dry/adiabatic cooler; Kelvion LF-PD203T4H-080Y06D flatbed dry cooler |
| Chillers | Carrier AquaForce 30XF variable-speed air-cooled screw chiller; Vertiv Liebert AFC FIZ150 free-cooling chiller |
| Air handlers | STULZ CyberAir 3PRO ASR 2410 CW; STULZ CyberHandler 2 size S11 indirect evaporative AHU; Vertiv Liebert CW181 chilled-water CRAH |
| Leaf switches | Arista 7060X6-64PE 800GbE switch (leaf); Cisco Nexus 9364E-SG2 800G AI switch (leaf); NVIDIA Quantum-X800 Q3400-RA XDR InfiniBand switch (leaf); NVIDIA Spectrum-X SN5600 800GbE switch (leaf) |
| Spine switches | Arista 7060XE7-64PS 102.4 Tb/s switch (spine); NVIDIA Quantum-X Photonics Q3450-LD co-packaged-optics InfiniBand switch (spine); NVIDIA Quantum-X800 Q3400-RA XDR InfiniBand switch (spine); NVIDIA Spectrum-X SN5600 800GbE switch (spine) |
| Cables and optics (800G) | 800G XDR single-mode DR4 optics link (half of NVIDIA MMS4A00 1.6T twin-port); 800G active copper cable (NVIDIA MCA4J80 ACC, OSFP twin-port 2x400G); 800G active electrical cable (Credo HiWire SPAN AEC, OSFP to OSFP-RHS); 800G multimode SR8 optics link (NVIDIA MMA4Z00-NS, 2xSR4); 800G passive copper DAC (NVIDIA MCP4Y10, OSFP twin-port 2x400G); 800G single-mode 2xFR4 optics link (NVIDIA MMS4X50-NM); 800G single-mode DR8 optics link (NVIDIA MMS4X00-NM, 2xDR4) |

Systems: AMD Helios pod (4 racks + 2 network racks), GB300 NVL72 scalable unit (8 racks + 2 network racks), plus a one-rack system for every rack type.


Default models for new projects (in `catalog/rules.json`) are the largest-capacity entry per category with every required value known, preferring shipping products over announced ones. Notable gaps: no 800 V DC busway or switchgear ratings have been published yet (those entries are estimates), several CDU weights and pump heads are unpublished, and Rubin Ultra (Kyber) figures are roadmap placeholders.

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
  build.py    bundles everything into dist/catalog.json
  dist/       catalog.json — the whole catalog in one file, with a content hash
docs/
  spec/product-spec.md                 full product and technical spec
  superpowers/specs/                   Phase 1 design
  superpowers/plans/                   implementation plans
core/         Python engine and CLI (planned)
web/          TypeScript + Three.js viewer (planned)
sculptured/   design-desk team files (planned)
examples/     sample hall, project and brief (planned)
prototypes/   working prototypes — cool-the-cluster/ (optimize + track twin, AutoLab hill)
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

Bundle the catalog into one file for tools and agents:

```bash
uv run --with jsonschema python catalog/build.py   # writes catalog/dist/catalog.json
```

The bundle carries a sha256 `hash` of its content; projects record it so a later catalog change never silently changes old results. `validate.py` notes when the bundle is stale.

## Docs

- [Product and technical spec](docs/spec/product-spec.md)
- [Phase 1 design](docs/superpowers/specs/2026-10-18-phase1-design.md)
- [Plan 1: core engine and CLI](docs/superpowers/plans/2026-10-18-plan1-core-engine-cli.md)

## Scope note

Outputs are design-stage estimates, not permitting-grade engineering. Vendor figures change and sometimes conflict; check the provenance and source of any number before relying on it.
