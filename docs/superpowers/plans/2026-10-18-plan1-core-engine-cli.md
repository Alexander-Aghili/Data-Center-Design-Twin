# Plan 1: Core engine and CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python package `dctwin` that loads a hall and a catalog, records attributed edits in a branchable journal, evaluates the design with exact power, liquid, air, structural and network solvers including N-1 failures, and exposes all of it through a `dctwin` command line with JSON output, ending in a self-contained HTML report that shows the hall and what the twin found.

**Architecture:** Pure evaluation: `replay(project, branch) -> DesignState`, then `evaluate(state) -> Result`. Solvers run in the fixed order network → liquid → air → power → structural → rollups, because each later one consumes loads the earlier ones produce. Every physical number is a `Quantity` carrying provenance; arithmetic goes through `derive()` so labels propagate and unknowns never become zero.

**Tech Stack:** Python 3.12, uv, pydantic 2, typer, pytest. No graph library: tray routing uses a hand-written Dijkstra on a small graph.

**Spec:** `docs/superpowers/specs/2026-10-18-phase1-design.md` (product spec: `docs/spec/product-spec.md`).

Later plans: Plan 2 (FastAPI + web viewer), Plan 3 (Sculptured design desk). They consume this plan's `evaluate`, `Result`, project file and CLI unchanged.

## Global Constraints

- Python 3.12, managed with `uv`; package lives in `core/` (`core/pyproject.toml`, `core/src/dctwin/`, `core/tests/`). Run tests from `core/`: `uv run pytest`.
- SI units internally: W, kg, m, kg/s, Pa (kPa allowed in field names that say `_kpa`), K, °C only for temperatures named `_c`.
- Provenance labels, strongest to weakest: `measured` > `vendor_spec` > `oem_datasheet` > `user_input` > `derived` > `estimated` > `surrogate` > `unknown`.
- A computed value's label = weakest of (`derived`, all inputs). Unknown in → unknown out, never zero.
- A check with any unknown input has status **Unknown** and names the missing input.
- Status thresholds: Pass < `warning_threshold` (default 0.8) ≤ Warning ≤ 1.0 < Fail.
- Ranges (`low`/`high`) resolve by `rules.range_policy`, default `high`.
- Sub-second evaluation for 500 racks.
- All coefficients and limits live in `catalog/rules.json` or catalog entries, never as literals in solver code (physical constants like g = 9.80665 excepted).
- Results never change silently: projects evaluate against the catalog bundle stored in the project file.
- Every journal entry records `author`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A rack placed over an occupied slot or past a row end (a double-wide Helios in the last slot) → the edit is rejected with a message naming the slot, and the journal is unchanged. Test in Task 5.
2. A row holding liquid-cooled racks with no CDU positions → the CDU check fails with advice; nothing divides by zero. Test in Task 8.
3. A rack type with unknown weight → only the bays it touches report Unknown, naming `weight_kg`; other bays still compute. Test in Task 10.
4. An empty hall → `evaluate` returns zero IT load, PUE unknown (not a crash or infinity), and checks for capacity-only equipment pass. Test in Task 12.
5. A hand-edited catalog JSON or project file with a missing or misspelled field → an error naming the file and the field path, no traceback. Tests in Task 2 and Task 13.

---

## File structure

```
core/pyproject.toml
core/src/dctwin/__init__.py
core/src/dctwin/quantity.py          Provenance, Quantity, derive, qsum
core/src/dctwin/catalog/schema.py    RackType, SystemType, EquipmentType, Rules, Presets
core/src/dctwin/catalog/loader.py    load_catalog -> CatalogBundle, CatalogError
core/src/dctwin/hall.py              Hall schema + geometry (Rect, slot positions)
core/src/dctwin/project.py           edits, journal, branches, replay, undo, file IO
core/src/dctwin/state.py             DesignState, Placement, Pin, effective_rack
core/src/dctwin/graph.py             AssetGraph, Node, Edge
core/src/dctwin/checks.py            Status, Check, make_check, rank
core/src/dctwin/context.py           EvalContext
core/src/dctwin/surrogate.py         Surrogate protocol, NotModeled, SurrogateRegistry
core/src/dctwin/solvers/network.py
core/src/dctwin/solvers/liquid.py
core/src/dctwin/solvers/air.py
core/src/dctwin/solvers/power.py
core/src/dctwin/solvers/structural.py
core/src/dctwin/solvers/rollups.py
core/src/dctwin/evaluate.py          evaluate, compare, facility_deltas, Result
core/src/dctwin/cli.py               typer app `dctwin`
core/tests/...                       one test file per module + fixtures/
catalog/racks/*.json catalog/systems/*.json catalog/equipment/*.json catalog/rules.json
examples/halls/sample-hall.json
```

---

### Task 1: Package scaffold and `Quantity`

**Files:**
- Create: `core/pyproject.toml`, `core/src/dctwin/__init__.py`, `core/src/dctwin/quantity.py`, `.gitignore` (`.venv/`, `__pycache__/`, `*.lock` for project locks, `node_modules/`, `dist/`)
- Test: `core/tests/test_quantity.py`

**Interfaces:**
- Produces:
  - `class Provenance(str, Enum)` with members `MEASURED, VENDOR_SPEC, OEM_DATASHEET, USER_INPUT, DERIVED, ESTIMATED, SURROGATE, UNKNOWN` (values are the lowercase labels).
  - `weakest(*labels: Provenance) -> Provenance`
  - `class Quantity(BaseModel, frozen=True)`: `value: float | None = None`, `low: float | None = None`, `high: float | None = None`, `unit: str`, `provenance: Provenance`, `source: str | None = None`, `note: str | None = None`. Validation: `provenance == UNKNOWN` iff no value and no range; a range needs both `low <= high`.
  - `Quantity.known -> bool`; `Quantity.resolve(policy: Literal["high","low","mid"] = "high") -> float | None`; `Quantity.unknown(unit: str, note: str) -> Quantity` (classmethod); `Quantity.of(value: float, unit: str, provenance: Provenance = DERIVED, note: str | None = None)` (classmethod).
  - `derive(fn: Callable[..., float], unit: str, policy: str = "high", **inputs: Quantity | float) -> Quantity` — calls `fn(**resolved)` with floats; plain floats count as exact; label = `weakest(DERIVED, *input labels)`; if any input unknown, returns `Quantity.unknown(unit, note="unknown input: <name>[, <name>]")`; `ZeroDivisionError` → unknown with note `"division by zero: <fn qualname>"`.
  - `qsum(items: Iterable[Quantity], unit: str, name: str = "item") -> Quantity` — empty sum is `0.0` with label `DERIVED`; an unknown item gives unknown with note naming `name[i]`.

- [ ] **Step 1: Write `core/pyproject.toml`** with project `dctwin`, `requires-python = ">=3.12"`, dependencies `pydantic>=2.7`, `typer>=0.12`; dev group `pytest>=8`; script `dctwin = "dctwin.cli:app"`; src layout. Run `cd core && uv sync` — expected: creates `.venv`, exit 0.

- [ ] **Step 2: Write failing tests**

```python
def test_weakest_orders_labels():
    assert weakest(Provenance.MEASURED, Provenance.ESTIMATED) is Provenance.ESTIMATED
    assert weakest(Provenance.VENDOR_SPEC, Provenance.USER_INPUT) is Provenance.USER_INPUT

def test_derive_floor_is_derived():
    q = derive(lambda a, b: a * b, "W", a=Quantity.of(2, "A", Provenance.MEASURED), b=3.0)
    assert q.value == 6 and q.provenance is Provenance.DERIVED

def test_derive_takes_weakest_input():
    q = derive(lambda a: a, "W", a=Quantity.of(1, "W", Provenance.ESTIMATED))
    assert q.provenance is Provenance.ESTIMATED

def test_unknown_propagates_with_name():
    q = derive(lambda w, n: w / n, "kg", w=Quantity.unknown("kg", "not published"), n=4.0)
    assert not q.known and q.value is None and "w" in q.note

def test_range_resolves_by_policy():
    r = Quantity(low=190e3, high=230e3, unit="W", provenance=Provenance.ESTIMATED)
    assert r.resolve("high") == 230e3 and r.resolve("low") == 190e3 and r.resolve("mid") == 210e3

def test_division_by_zero_is_unknown():
    assert not derive(lambda a, b: a / b, "x", a=1.0, b=0.0).known

def test_qsum_empty_is_zero_and_unknown_item_named():
    assert qsum([], "W").value == 0.0
    q = qsum([Quantity.of(1, "W"), Quantity.unknown("W", "x")], "W", name="rack")
    assert not q.known and "rack[1]" in q.note

def test_unknown_label_requires_no_value():
    with pytest.raises(ValidationError):
        Quantity(value=1.0, unit="W", provenance=Provenance.UNKNOWN)
```

- [ ] **Step 3: Run** `uv run pytest tests/test_quantity.py -v` — expected: FAIL (import error).
- [ ] **Step 4: Implement `quantity.py`.**
- [ ] **Step 5: Run** the same command — expected: 8 passed.
- [ ] **Step 6: Commit** `feat(core): package scaffold and provenance-carrying Quantity`.

---

### Task 2: Catalog schema and loader

**Files:**
- Create: `core/src/dctwin/catalog/__init__.py`, `core/src/dctwin/catalog/schema.py`, `core/src/dctwin/catalog/loader.py`
- Create fixtures: `core/tests/fixtures/catalog/` (minimal valid catalog: 2 racks, 1 system, one equipment entry per category, rules.json)
- Test: `core/tests/test_catalog.py`

**Interfaces:**
- Consumes: `Quantity`, `Provenance`.
- Produces (pydantic models, `extra="forbid"` everywhere so misspelled fields fail):
  - The models mirror `catalog/schema/catalog.schema.json` exactly (it already exists, with `catalog/validate.py` and `catalog/FORMAT.md`): every entry has `kind` (`rack`|`system`|`equipment`), `as_of`, optional `description`, and the optional Quantity fields listed in the schema. The fields named below are the required ones solvers use.
  - `Source(id: str, title: str, url: str)`
  - `RackType`: `id, name, vendor, model, generation, availability: str`; `role: Literal["compute","network","storage"]`; `electrical: RackElectrical(nominal_power_w, peak_power_w, power_shelves, shelf_rating_w: Quantity; supported_power_input: list[Literal["ac_54v","dc_800v"]])`; `thermal: RackThermal(liquid_fraction, max_coolant_supply_c, rack_pressure_drop_kpa: Quantity)`; `mechanical: RackMechanical(width_mm, depth_mm, height_mm, weight_kg, feet: Quantity)`; `network: RackNetwork(scale_out_ports, port_speed_gbps, scale_up_domain, switch_slots: Quantity)`; `compute: RackCompute(accelerators, fp4_pflops: Quantity)`; `overridable: list[str] = []` (dotted paths, e.g. `"electrical.peak_power_w"`); `sources: list[Source]`. Every `Quantity.source` that is set must match a `Source.id` in the same entry.
  - `SystemMember(key: str, rack_type: str, slot_offset: int)`, `SystemLink(a: str, b: str, media: Literal["copper","optics"], count: int)`, `SystemType(id, name: str, members: list[SystemMember], links: list[SystemLink], notes: str = "", sources: list[Source] = [])`.
  - `EquipmentCategory = Literal["cdu","busway","ups_module","rectifier","transformer","switchgear","dry_cooler","chiller","air_handler","leaf_switch","spine_switch","cable"]`; `EquipmentType(id, name: str, category: EquipmentCategory, params: dict[str, Quantity], attrs: dict[str, str] = {}, sources: list[Source] = [])`, validated against `REQUIRED_PARAMS`:
    - cdu: `capacity_w, max_flow_kg_s, approach_k, pump_head_kpa, power_w, weight_kg`
    - busway, switchgear: `capacity_w`; attrs `power_input` (`ac_54v`|`dc_800v`)
    - ups_module, rectifier, transformer: `capacity_w, efficiency`
    - dry_cooler: `capacity_w, approach_k, power_w`; chiller: `capacity_w, cop`
    - air_handler: `capacity_w, power_w`
    - leaf_switch, spine_switch: `ports, port_speed_gbps, hop_latency_ns, power_w`
    - cable: `reach_m, power_per_end_w, weight_kg_per_m`; attrs `media` (`copper`|`optics`)
  - `FabricPreset(topology: Literal["fat_tree","rail_optimized"], oversubscription: float, leaf_model: str, spine_model: str)`
  - `Presets(redundancy: Literal["N+1","2N"], power_input: Literal["ac_54v","dc_800v"], facility_supply_c: float, rack_delta_t_k: float, coolant: str, fabric: FabricPreset, models: dict[EquipmentCategory, str])` — `models` maps every category except `cable`, `leaf_switch` and `spine_switch` (those come from `fabric`) to a catalog equipment id; `dc_models: dict[Literal["busway","switchgear","transformer"], str]` replaces those three when `power_input` is `dc_800v`; `cable` uses all cable entries sorted by `reach_m`.
  - `Coolant(cp_j_kgk: Quantity, density_kg_m3: Quantity)`
  - `Rules`: `warning_threshold: float = 0.8`, `range_policy: Literal["high","low","mid"] = "high"`, `derate: Quantity`, `spares: dict[Literal["cdu","air_handler","heat_rejection","ups_module","rectifier","transformer","switchgear"], int]`, `coolants: dict[str, Coolant]`, `facility_delta_t_k: Quantity`, `pipe: PipeRules(nominal_diameters_m: list[float], max_velocity_m_s, roughness_m, fittings_factor, facility_pump_head_kpa, rack_manifold_drop_kpa: Quantity)`, `network: NetworkRules(slack_fraction, drop_m, propagation_ns_per_m, message_bytes, nic_overhead_ns, max_oversubscription: Quantity)`, `default_presets: Presets`.
  - `CatalogBundle(racks: dict[str, RackType], systems: dict[str, SystemType], equipment: dict[str, EquipmentType], rules: Rules, hash: str)`; `hash` = sha256 of the canonical JSON (sorted keys) of everything else.
  - `class CatalogError(Exception)` with message `"<relative file>: <field.path>: <problem>"`.
  - `load_catalog(root: Path) -> CatalogBundle` reads `racks/*.json`, `systems/*.json`, `equipment/*.json`, `rules.json`; filename stem must equal `id`; cross-checks: system members reference known racks, link keys reference member keys, every preset model id exists with the right category.
  - `bundle_from_json(data: dict) -> CatalogBundle` and `CatalogBundle.to_json() -> dict` (used by project files; hash is recomputed and must match).

- [ ] **Step 1: Write failing tests**

```python
def test_loads_fixture_catalog(fixture_catalog):
    b = load_catalog(fixture_catalog)
    assert set(b.racks) == {"rack-a", "rack-b"} and b.rules.warning_threshold == 0.8
    assert len(b.hash) == 64

def test_hash_stable_and_content_sensitive(fixture_catalog, tmp_path):
    a = load_catalog(fixture_catalog).hash
    assert load_catalog(fixture_catalog).hash == a
    # copy, change one number, hash changes
    ...
    assert load_catalog(changed).hash != a

def test_misspelled_field_names_file_and_path(fixture_catalog_copy):
    # rename electrical.peak_power_w -> peak_powr_w in racks/rack-a.json
    with pytest.raises(CatalogError, match=r"racks/rack-a.json: electrical\.peak_powr_w"):
        load_catalog(fixture_catalog_copy)

def test_missing_required_equipment_param(fixture_catalog_copy):
    # delete params.max_flow_kg_s from equipment/cdu-x.json
    with pytest.raises(CatalogError, match=r"equipment/cdu-x.json: params\.max_flow_kg_s: missing"):
        load_catalog(fixture_catalog_copy)

def test_system_member_must_exist(fixture_catalog_copy):
    with pytest.raises(CatalogError, match="unknown rack type"):
        load_catalog(fixture_catalog_copy)

def test_source_reference_must_exist(fixture_catalog_copy):
    with pytest.raises(CatalogError, match="unknown source"):
        load_catalog(fixture_catalog_copy)

def test_bundle_json_roundtrip(fixture_catalog):
    b = load_catalog(fixture_catalog)
    assert bundle_from_json(b.to_json()).hash == b.hash
```

- [ ] **Step 2: Run** `uv run pytest tests/test_catalog.py -v` — expected: FAIL.
- [ ] **Step 3: Implement schema and loader.** Convert pydantic `ValidationError` locations into the dotted path in `CatalogError`.
- [ ] **Step 4: Run** — expected: all pass.
- [ ] **Step 5: Commit** `feat(core): catalog schema, loader and content hash`.

---

### Task 3: Real catalog content (research task)

**Files:**
- Create: `catalog/racks/{gb300-nvl72,vera-rubin-nvl72,amd-helios,hgx-b300-air,network-rack,storage-rack}.json`
- Create: `catalog/systems/{gb300-su8,amd-helios-pod4,single-*}.json` — `gb300-su8` = 8 × gb300-nvl72 + network racks (count `estimated`); `amd-helios-pod4` = 4 × amd-helios + 1 network rack; one `single-<rack>` system per rack type.
- Create: `catalog/equipment/*.json` — at least one model per category; two cable copper classes (passive DAC, active copper) and one optics class at 800 Gb/s.
- Create: `catalog/rules.json`, `catalog/README.md` (what each provenance label means here and how estimates were made)
- Test: `core/tests/test_real_catalog.py`

**Interfaces:**
- Consumes: `load_catalog`.
- Produces: the catalog Plan 1's golden test and Plans 2–3 use. Ids above are fixed.

Content rules:
- Start from the spec's table (`docs/spec/product-spec.md`, "Starting catalog") and its sources; research the missing fields on the web (liquid/air heat split, coolant supply limit, rack pressure drop, power shelves and ratings, feet, scale-out ports and speed, switch slots for network racks). Each `vendor_spec`/`oem_datasheet` value cites a `Source` with a URL you opened. Values without a public figure are `estimated` with a `note` saying how (e.g. Rubin weight from GB300 plus stated differences). `unknown` only where no defensible estimate exists.
- Helios weight: range 2270–3170 kg, note "reports conflict".
- `hgx-b300-air`: 4 chassis × ~14 kW per chassis; `overridable: ["electrical.nominal_power_w","electrical.peak_power_w","mechanical.weight_kg"]` with a note on chassis count. Network and storage racks: power and weight `user_input`-style defaults labeled `estimated`, overridable.
- Network rack `switch_slots`: number of leaf/spine switches it holds (estimated, e.g. 16).
- Generic equipment values: `estimated` with notes; real models where a public datasheet exists.
- `rules.json` defaults (all `estimated` unless noted): `warning_threshold 0.8`, `range_policy high`, `derate 0.8`, spares 1 for cdu/air_handler/heat_rejection/ups_module/rectifier/transformer/switchgear, coolants `water` (cp 4186, ρ 998), `pg25` (cp 3900, ρ 1020), `pg40` (cp 3600, ρ 1035), `facility_delta_t_k 8`, pipe `nominal_diameters_m [0.05,0.065,0.08,0.1,0.125,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5]`, `max_velocity_m_s 2.5`, `roughness_m 4.5e-5`, `fittings_factor 1.5`, `facility_pump_head_kpa 300`, `rack_manifold_drop_kpa 30`, network `slack_fraction 0.1`, `drop_m 3.0`, `propagation_ns_per_m 5.0`, `message_bytes 4096`, `nic_overhead_ns 1000`, `max_oversubscription 1.5`; default presets: `2N`, `ac_54v`, supply 30 °C, rack ΔT 10 K, coolant `water`, fabric fat tree 1.0, models = the largest-capacity entry per category.

- [ ] **Step 1: Write failing tests**

```python
CATALOG = Path(__file__).parents[2] / "catalog"

def test_real_catalog_loads():
    b = load_catalog(CATALOG)
    assert {"gb300-nvl72","vera-rubin-nvl72","amd-helios","hgx-b300-air","network-rack","storage-rack"} <= set(b.racks)
    assert {"gb300-su8","amd-helios-pod4"} <= set(b.systems)

def test_spec_figures_present():
    r = load_catalog(CATALOG).racks
    assert r["gb300-nvl72"].electrical.nominal_power_w.resolve() == pytest.approx(132e3)
    assert r["gb300-nvl72"].mechanical.weight_kg.resolve() == pytest.approx(1580, rel=0.02)
    h = r["amd-helios"].mechanical.weight_kg
    assert (h.low, h.high) == (2270, 3170)
    assert r["amd-helios"].mechanical.width_mm.resolve() == 1200

def test_sourced_labels_cite_urls():
    for rack in load_catalog(CATALOG).racks.values():
        for path, q in iter_quantities(rack):
            if q.provenance in (Provenance.VENDOR_SPEC, Provenance.OEM_DATASHEET):
                assert q.source, f"{rack.id}.{path} has no source"

def test_estimates_explain_themselves():
    for entry_id, path, q in iter_all_quantities(load_catalog(CATALOG)):
        if q.provenance is Provenance.ESTIMATED:
            assert q.note, f"{entry_id}.{path} estimated without note"
```

(`iter_quantities` / `iter_all_quantities`: small helpers in the test file walking pydantic models for `Quantity` fields.)

- [ ] **Step 2: Run** `uv run pytest tests/test_real_catalog.py -v` — expected: FAIL.
- [ ] **Step 3: Research and write the JSON files** per the content rules. (Done ahead of the plan on 2026-10-18 by parallel research agents; this task now only adds `rules.json` checks and the test file. `catalog/validate.py` must also pass.)
- [ ] **Step 4: Run** — expected: all pass.
- [ ] **Step 5: Commit** `feat(catalog): Phase 1 racks, systems, equipment and rules with sources`.

---

### Task 4: Hall schema, geometry and sample hall

**Files:**
- Create: `core/src/dctwin/hall.py`, `examples/halls/sample-hall.json`
- Test: `core/tests/test_hall.py`

**Interfaces:**
- Produces:
  - `Rect(x0, y0, x1, y1: float)` with `area`, `overlap(other) -> float`, `center -> tuple[float,float]`.
  - `Row(id: str, origin_x: float, origin_y: float, slots: int, slot_pitch_m: float, depth_m: float, cold_aisle: Literal["+y","-y"])`. Rows run along +x; slot `i` spans `x ∈ [origin_x + i·pitch, origin_x + (i+1)·pitch]`, `y ∈ [origin_y, origin_y + depth_m]`.
  - `Bay(id: str, rect: Rect, rated_kn_m2: float, point_limit_kn: float)`
  - `Tray(id: str, points: list[tuple[float,float]], height_m: float, weight_kg_per_m: float)`
  - `CduPosition(id: str, row: str, x: float, y: float)`, `AhuPosition(id: str, x: float, y: float)`
  - `HallLimits(busway_runs_per_row: int, ups_modules_max: int, rectifiers_max: int, transformers_max: int, switchgear_max: int, heat_rejection_units_max: int)` — `_max` counts are per chain (A or B) under 2N and total under N+1.
  - `ExistingEquipment(position_id: str, equipment_type: str)`
  - `Hall(name: str, width_m, depth_m, height_m: float, rows: list[Row], bays: list[Bay], columns: list[tuple[float,float]], utility_kw: float, heat_rejection_kw: float, outdoor_design_c: float, plant_xy: tuple[float,float], trays: list[Tray], cdu_positions: list[CduPosition], ahu_positions: list[AhuPosition], limits: HallLimits, existing: list[ExistingEquipment] = [])`, `extra="forbid"`.
  - `Hall.row(id) -> Row`; `slots_needed(width_mm: float, pitch_m: float) -> int` (ceil with 1 mm tolerance); `rack_rect(row: Row, slot: int, slots_used: int, depth_mm: float) -> Rect`; `load_hall(path: Path) -> Hall` raising `HallError("<file>: <field.path>: <problem>")`.
  - Validation: bays tile the hall without overlap (sum of areas equals hall area within 1e-6), every CDU position's row exists, rows lie inside the hall.
- Sample hall (fixed values, used by golden tests): 24 m × 30 m × 6 m; 8 rows `R1..R8`, `origin_x 6.0`, `origin_y 3.0 + 3.0·k`, 20 slots, pitch 0.6, depth 1.2, alternating cold aisle; 20 bays of 6 × 6 m named `A1..D5` (column letter by x, number by y); bays with `y0 >= 24` rated 9 kN/m², all others 12; point limit 6 kN; utility 30000 kW; heat rejection 28000 kW; outdoor 35 °C; `plant_xy (0, 15)`; one tray per row along `y = row center`, from x 4.8 to 19.2, height 3.5 m, 25 kg/m; two cross trays at x 3.0 and x 21.0 spanning y 3.0–27.0 that the row trays join; CDU positions `CDU-Rk-S` at (4.8, row center) and `CDU-Rk-E` at (18.6, row center) for each row; 8 AHU positions along the two long walls; limits: busway runs 2, UPS 12, rectifiers 24, transformers 6, switchgear 6, heat rejection 12.

- [ ] **Step 1: Write failing tests**

```python
def test_slots_needed():
    assert slots_needed(600, 0.6) == 1 and slots_needed(1200, 0.6) == 2 and slots_needed(601.5, 0.6) == 2

def test_rack_rect():
    row = Row(id="R1", origin_x=6.0, origin_y=3.0, slots=20, slot_pitch_m=0.6, depth_m=1.2, cold_aisle="+y")
    assert rack_rect(row, 2, 2, 1200) == Rect(7.2, 3.0, 8.4, 4.2)

def test_sample_hall_loads():
    h = load_hall(EXAMPLES / "halls/sample-hall.json")
    assert len(h.rows) == 8 and len(h.bays) == 20 and len(h.cdu_positions) == 16
    assert sum(b.rect.area for b in h.bays) == pytest.approx(24 * 30)

def test_overlapping_bays_rejected(tmp_path): ...  # match "bays overlap"
def test_unknown_row_in_cdu_position(tmp_path): ...  # match r"cdu_positions\.0\.row"
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** implement and write `sample-hall.json` (generate it with a small script in the test fixtures folder if convenient, but commit the JSON). **Step 4:** run — pass. **Step 5: Commit** `feat(core): hall schema, geometry and sample hall`.

---

### Task 5: Design state, journal, branches, undo

**Files:**
- Create: `core/src/dctwin/state.py`, `core/src/dctwin/project.py`
- Test: `core/tests/test_project.py`

**Interfaces:**
- Consumes: `Hall`, `CatalogBundle`, `Presets`, `Quantity`, `slots_needed`.
- Produces:
  - `Placement(id: str, rack_type: str, row: str, slot: int, slots_used: int, system_instance: str | None, member_key: str | None, overrides: dict[str, Quantity] = {})`
  - `Pin(target: str, attribute: Literal["count","model","positions"], value: int | str | list[str])`. Targets are group ids: `cdu:<row>`, `air_handler`, `heat_rejection`, `ups_module:A|B|shared`, `rectifier:A|B|shared`, `transformer:A|B|shared`, `switchgear:A|B|shared`, `busway:<row>`.
  - `DesignState(hall: Hall, catalog: CatalogBundle, presets: Presets, placements: dict[str, Placement], system_instances: dict[str, SystemInstance(id, system_type, row, slot)], pins: list[Pin])`
  - `effective_rack(state, placement) -> RackType` — catalog entry with overrides applied by dotted path.
  - Edits (pydantic discriminated union on `type`): `Place(row, slot, rack_type)`, `PlaceSystem(row, slot, system_type)`, `Remove(placement_id)` (removing a system member removes the whole system instance), `Swap(placement_id, rack_type)`, `Override(placement_id, field, value: Quantity)` (field must be in `overridable`; value label must not be `unknown`), `SetPreset(key: str, value: Any)` (dotted path into `Presets`), `SetPin(pin: Pin)`, `Unpin(target, attribute)`, `UpdateCatalog(bundle_hash: str)`, `Undo(entry_index: int)`.
  - `JournalEntry(index: int, timestamp: str, author: str, edit: Edit)`
  - `Branch(name: str, parent: str | None, base_index: int, journal: list[JournalEntry])` — state of a branch = replay of `parent` up to `base_index` entries, then its own journal.
  - `Project(format: Literal["dctwin.project/v1"], hall: Hall, catalog_bundles: dict[str, dict], initial_bundle: str, branches: dict[str, Branch])`
  - `new_project(hall: Hall, catalog: CatalogBundle) -> Project` (one branch `main`).
  - `replay(project, branch: str) -> DesignState`
  - `apply_edit(project, branch: str, edit: Edit, author: str, now: str | None = None) -> JournalEntry` — validates by replaying with the new edit; raises `EditError(message)` and leaves the project unchanged on failure. Placement ids: `p-<branch>-<entry index>`; system members `p-<branch>-<entry index>-<member key>`; system instances `s-<branch>-<entry index>`.
  - `undo(project, branch, author) -> JournalEntry` — appends `Undo(entry_index=<latest entry not already undone>)`; `Undo` of an `Undo` re-applies (redo). Replay skips undone entries.
  - `create_branch(project, name: str, from_branch: str) -> Branch`
  - `add_bundle(project, bundle: CatalogBundle) -> str` (stores `bundle.to_json()` under its hash)
  - `load_project(path) -> Project` (raises `ProjectError("<file>: <field.path>: <problem>")`), `save_project(project, path)` (write to temp file then `os.replace`).

- [ ] **Step 1: Write failing tests**

```python
def test_place_and_replay(project):
    e = apply_edit(project, "main", Place(row="R1", slot=0, rack_type="gb300-nvl72"), author="user")
    s = replay(project, "main")
    assert s.placements[f"p-main-{e.index}"].slots_used == 1 and e.author == "user"

def test_overlap_rejected_journal_unchanged(project):
    apply_edit(project, "main", Place(row="R1", slot=0, rack_type="gb300-nvl72"), author="user")
    n = len(project.branches["main"].journal)
    with pytest.raises(EditError, match=r"R1 slot 0 is occupied"):
        apply_edit(project, "main", Place(row="R1", slot=0, rack_type="gb300-nvl72"), author="user")
    assert len(project.branches["main"].journal) == n

def test_double_wide_past_row_end_rejected(project):
    with pytest.raises(EditError, match=r"R1 slots 19-20 exceed the row's 20 slots"):
        apply_edit(project, "main", Place(row="R1", slot=19, rack_type="amd-helios"), author="user")

def test_place_system_expands_members(project):
    apply_edit(project, "main", PlaceSystem(row="R2", slot=0, system_type="gb300-su8"), author="layout")
    members = [p for p in replay(project, "main").placements.values() if p.system_instance]
    assert sum(p.rack_type == "gb300-nvl72" for p in members) == 8

def test_remove_member_removes_system(project): ...
def test_override_requires_overridable_field(project): ...  # EditError match "not overridable"
def test_undo_and_redo(project):
    apply_edit(project, "main", Place(row="R1", slot=0, rack_type="gb300-nvl72"), author="user")
    undo(project, "main", author="user"); assert not replay(project, "main").placements
    undo(project, "main", author="user"); assert len(replay(project, "main").placements) == 1

def test_branch_isolated_from_parent(project):
    apply_edit(project, "main", Place(row="R1", slot=0, rack_type="gb300-nvl72"), author="user")
    create_branch(project, "alt", from_branch="main")
    apply_edit(project, "alt", Place(row="R1", slot=1, rack_type="gb300-nvl72"), author="a")
    apply_edit(project, "main", Place(row="R1", slot=5, rack_type="gb300-nvl72"), author="user")
    assert len(replay(project, "alt").placements) == 2 and len(replay(project, "main").placements) == 2

def test_update_catalog_changes_only_later_state(project, changed_bundle): ...
def test_save_load_roundtrip(project, tmp_path): ...
def test_corrupt_project_names_field(tmp_path):
    # write a project JSON whose branches.main.journal.0.edit.type is "plase"
    with pytest.raises(ProjectError, match=r"branches\.main\.journal\.0\.edit"):
        load_project(path)
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** implement `state.py` then `project.py`. **Step 4:** run — pass. **Step 5: Commit** `feat(core): journal with attributed edits, branches and undo`.

---

### Task 6: Graph, checks, context, surrogate seam, evaluate skeleton

**Files:**
- Create: `core/src/dctwin/graph.py`, `checks.py`, `context.py`, `surrogate.py`, `evaluate.py`, `solvers/__init__.py`
- Test: `core/tests/test_checks.py`, `core/tests/test_surrogate.py`

**Interfaces:**
- Produces:
  - `Node(id: str, kind: str, network: Literal["power","liquid","air","network","structural"], position: tuple[float,float] | None, capacity: Quantity | None, load: Quantity | None, redundancy_group: str | None, pinned: bool = False, attrs: dict[str, Any] = {})`, `Edge(src, dst: str, network: str)`, `AssetGraph(nodes: dict[str, Node], edges: list[Edge])` with `add(node)`, `link(src, dst, network)`, `merge(other)`, `count(kind: str) -> int`.
  - `Status(str, Enum)`: `PASS, WARNING, FAIL, UNKNOWN` (values `"pass"`, …).
  - `Check(id, subject, metric: str, normal: Quantity, worst_failure: Quantity | None, failure_name: str | None, limit: Quantity, utilization_normal: float | None, utilization_worst: float | None, status: Status, provenance: Provenance, explanation: str, advice: str | None, inputs: dict[str, Quantity])`.
  - `make_check(id, subject, metric, normal, limit, explanation, inputs, warning_threshold, worst_failure=None, failure_name=None, advice=None) -> Check` — utilization = value/limit; status from the larger of normal and worst; unknown if `normal`, `limit`, or `worst_failure` (when given) is unknown, explanation then gets `" Missing: <notes>"`; `advice` is kept only when status is Warning or Fail; provenance = weakest of all inputs and results.
  - `rank(checks) -> list[Check]`: Fail, Unknown, Warning, Pass; within a status, by `max(utilization)` descending; ties by id.
  - `EvalContext(state: DesignState, rules: Rules, presets: Presets, policy: str, surrogates: SurrogateRegistry)` with `equipment(category) -> EquipmentType` (preset model, or pinned model for that group via `model_for(group, category)`) and `pin(target, attribute) -> Pin | None`.
  - `class Surrogate(Protocol)`: `domain: str`; `predict(inputs: dict[str, Quantity]) -> SurrogatePrediction(outputs: dict[str, Quantity], confidence: float | None, out_of_distribution: bool)`.
  - `NotModeled(domain: str, phase: str = "Phase 2")` returns every requested output as `Quantity.unknown(unit, note="not modeled until Phase 2")`, `confidence None`, `out_of_distribution False`.
  - `SurrogateRegistry.default()` registers `NotModeled("room_airflow")`; `get(domain) -> Surrogate`.
  - `Result(checks: list[Check], graph: AssetGraph, rollups: Rollups, latency: LatencySummary, scenarios: list[ScenarioSummary], notices: list[str])`, `ScenarioSummary(name: str, worst_status: Status, failing_checks: list[str])`. `Rollups` and `LatencySummary` are defined in Task 11/12; until then use placeholders in `evaluate.py`.
  - `evaluate(state: DesignState, surrogates: SurrogateRegistry | None = None) -> Result` — Task 12 wires the solvers in; here it returns an empty result.

- [ ] **Step 1: Write failing tests**

```python
def test_status_bands():
    lim = Quantity.of(100, "W", Provenance.VENDOR_SPEC)
    s = lambda v, w=None: make_check("c", "s", "m", Quantity.of(v, "W"), lim, "e", {}, 0.8,
                                     worst_failure=None if w is None else Quantity.of(w, "W"), failure_name="x").status
    assert s(79) is Status.PASS and s(80) is Status.WARNING and s(100) is Status.WARNING and s(101) is Status.FAIL
    assert s(50, 101) is Status.FAIL

def test_unknown_input_never_passes():
    c = make_check("c", "s", "m", Quantity.unknown("W", "unknown input: weight_kg"),
                   Quantity.of(1, "W"), "e", {}, 0.8)
    assert c.status is Status.UNKNOWN and "weight_kg" in c.explanation

def test_rank_order(): ...  # Fail > Unknown > Warning > Pass, then utilization desc

def test_not_modeled_surrogate_is_unknown():
    p = SurrogateRegistry.default().get("room_airflow").predict({})
    assert p.out_of_distribution is False and p.confidence is None
```

- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(core): asset graph, checks, eval context and surrogate seam`.

---

### Task 7: Network solver

Runs first because it produces network-rack IT loads, optics heat and cable weight.

**Files:**
- Create: `core/src/dctwin/solvers/network.py`, `core/src/dctwin/solvers/routing.py` (tray graph + Dijkstra)
- Test: `core/tests/test_network.py`, `core/tests/test_routing.py`

**Interfaces:**
- Consumes: `EvalContext`, `effective_rack`, `make_check`, `AssetGraph`, `Hall.trays`.
- Produces:
  - `TrayGraph.from_hall(hall) -> TrayGraph`; `attach(point) -> str` (projects a point to the nearest tray segment, adds a node there, returns its id); `distances_from(node_id) -> dict[str, float]`; `segment_lengths_by_tray(path) ` not needed — instead `path_length(a, b) -> float` and `tray_usage` accumulation via `route(a, b) -> list[tuple[tray_id, length_m]]`.
  - `CableClass(id, media, reach_m, power_per_end_w, weight_kg_per_m)` from cable equipment, sorted by reach.
  - `NetworkResult(checks, graph, it_loads: dict[str, Quantity], air_heat_w: Quantity, cable_weight_by_tray: dict[str, Quantity], cables: dict[str, CableTotals(count: int, length_m: float)], latency: LatencySummary(p50_ns, max_ns: Quantity, same_leaf_ns, cross_leaf_ns: Quantity))`
  - `solve_network(ctx: EvalContext) -> NetworkResult`

Method (decisions the tests pin):
- Host ports = Σ `scale_out_ports` over compute and storage racks. Leaf downlinks = `floor(ports · r / (1 + r))` with r = preset oversubscription (down:up); uplinks = `ports − downlinks`. Leaves = `ceil(host_ports / downlinks)`; spines = `ceil(leaves · uplinks / spine_ports)`. If leaves > spine ports → check `fabric:tiers` Fail, "exceeds a 2-tier fabric".
- Fat tree: assign rack ports to leaves in placement order (row, slot), filling each leaf. Rail-optimized: rails = max `scale_out_ports` per rack; port k of every rack goes to rail leaf group k, splitting a rail across more leaves when its ports exceed `downlinks`.
- Switches occupy network-rack `switch_slots`: leaves go to the network rack nearest (Euclidean, rack centers) to their racks' centroid with free slots, spines to remaining slots in placement order. No network racks, or not enough slots → check `fabric:switch-space` Fail with advice "place N more network racks".
- Each link (rack port → leaf, leaf → spine) routes through trays: length = `2·drop_m + tray path`, times `1 + slack_fraction`. Media = the shortest-reach cable class whose `reach_m` ≥ length; none → longest optics class. Racks in the same row within 2 slots of each other use horizontal distance + `2·drop_m` without the tray.
- Optics power = 2 · `power_per_end_w` per optical link; switch-side end + switch `power_w` go to the hosting network rack's IT load (`derived`); rack-side ends are inside the rack's vendor power. Network racks without switches use their catalog power.
- `air_heat_w` = all switch power + switch-side optics.
- Cable weight per tray = Σ (length on that tray × `weight_kg_per_m`).
- System links with `media: copper` (e.g. NVL36×2-style members) must fit the longest copper class reach; otherwise check `system:<instance>:copper-reach` Fail.
- Oversubscription check `fabric:oversubscription`: normal = r; worst = `r · s / (s − 1)` with failure "loss of one spine switch" (s = spines; s = 1 → unknown? no: worst = infinite → report Fail with "single spine"). Limit = `rules.network.max_oversubscription`.
- Leaf port check `fabric:leaf-ports`: normal = host ports / (leaves · downlinks).
- Latency: same leaf = `hop_latency_ns + propagation_ns_per_m · 2·len + serialization + nic_overhead_ns`; cross leaf = 3 hops and the leaf–spine–leaf lengths; serialization = `message_bytes · 8 / port_speed_gbps` ns. Constants are `estimated`.

- [ ] **Step 1: Write failing tests** (`ctx_with(placements, presets)` fixture builds a state on a test hall with a straight tray)

```python
def test_dijkstra_path_on_l_shaped_tray(): ...  # length = sum of legs

def test_fat_tree_counts():
    # 4 compute racks × 72 ports, leaf/spine 64 ports, r = 1.0
    r = solve_network(ctx_with(compute=4, ports=72, leaf_ports=64, spine_ports=64, network_racks=1, switch_slots=16))
    assert r.graph.count(kind="leaf_switch") == 9 and r.graph.count(kind="spine_switch") == 5
    c = by_id(r.checks, "fabric:oversubscription")
    assert c.normal.value == pytest.approx(1.0) and c.worst_failure.value == pytest.approx(1.25)

def test_no_network_rack_fails_with_advice():
    c = by_id(solve_network(ctx_with(compute=2, network_racks=0)).checks, "fabric:switch-space")
    assert c.status is Status.FAIL and "network rack" in c.advice

def test_cable_media_by_reach():
    # classes: dac 2.5 m, aec 7 m, optics 500 m
    assert pick_class(2.0, CLASSES).id == "dac" and pick_class(6.0, CLASSES).id == "aec" and pick_class(30, CLASSES).media == "optics"

def test_optics_power_lands_on_network_rack(): ...  # it_loads[network rack id] > catalog power, label derived
def test_latency_serialization():
    assert serialization_ns(4096, 800) == pytest.approx(40.96)
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(core): network fabric sizing, tray routing, media and latency`.

---

### Task 8: Liquid solver and heat rejection

**Files:**
- Create: `core/src/dctwin/solvers/liquid.py`, `core/src/dctwin/solvers/hydraulics.py`
- Test: `core/tests/test_liquid.py`, `core/tests/test_hydraulics.py`

**Interfaces:**
- Consumes: `EvalContext`, `NetworkResult.it_loads`.
- Produces:
  - `mass_flow(q_w: Quantity, cp: Quantity, dt_k: Quantity | float) -> Quantity` (kg/s)
  - `friction_factor(re: float, rel_roughness: float) -> float` (laminar 64/Re below 2300, Swamee–Jain above)
  - `pick_diameter(flow_m3_s: float, diameters: list[float], v_max: float) -> tuple[float, float]` (diameter, velocity); if none fits, largest and its velocity.
  - `pressure_drop_pa(flow_m3_s, d_m, length_m, density, viscosity=1.0e-3, roughness, fittings_factor) -> float` (Darcy–Weisbach)
  - `LiquidResult(checks, graph, liquid_heat_w: Quantity, mech_loads: dict[str, Quantity], cdu_masses: list[PointMass], heat_rejection_kind: Literal["dry_cooler","chiller"])` — `mech_loads` keys `cdu_pumps` (on UPS) and `heat_rejection` (non-UPS).
  - `PointMass(id: str, rect: Rect, mass_kg: Quantity, feet: Quantity)` (shared with Task 10; define in `solvers/__init__.py`).
  - `solve_liquid(ctx, it_loads: dict[str, Quantity]) -> LiquidResult`

Method:
- Rack heat = peak power × `liquid_fraction` (cooling is sized on peak). Rack flow = `mass_flow(heat, cp(coolant), presets.rack_delta_t_k)`.
- Per row: CDUs needed = `max(ceil(heat / capacity_w), ceil(flow / max_flow_kg_s)) + spares.cdu`; positions available = that row's `cdu_positions` (minus none; existing equipment there counts as placed); a `count` pin on `cdu:<row>` fixes the count. Count used = `min(needed, available)` unless pinned. Ids = the position ids used, in hall order.
- CDU check `cdu:<row>:heat` and `cdu:<row>:flow`: normal = row total / (n · capacity); worst = row total / ((n − 1) · capacity), failure "loss of one CDU (<id>)". With n = 0 and nonzero heat → Fail, normal = row total vs limit 0 handled as utilization ∞ with advice "add CDU positions to row <row> or move liquid-cooled racks". Advice when n < needed: "row <row> needs <needed> CDUs, has <available> positions".
- Rack loop head check `cdu:<row>:head`: rack_pressure_drop_kpa + rack_manifold_drop_kpa vs CDU pump_head_kpa.
- Coolant temperature check `rack:<id>:coolant-temp` per rack type group: rack supply = facility_supply_c + CDU approach_k vs `max_coolant_supply_c`.
- Facility loop: primary flow per CDU = CDU heat / (cp_water · facility_delta_t_k). Tree: plant → header along x = plant x to each row's CDU positions (Manhattan, header at `plant_xy` y then branch along y then x). Each segment carries the sum of downstream flows; diameter by velocity; drop by Darcy–Weisbach; path drop to the farthest CDU × 2 (supply + return) vs `facility_pump_head_kpa` → check `facility-loop:head`; worst segment velocity vs `max_velocity_m_s` → check `facility-loop:velocity`.
- Heat rejection: total = liquid heat + air-side heat (passed from Task 9 via `evaluate`, so heat rejection lives in `solve_heat_rejection(ctx, total_heat_w) -> HeatRejectionResult(checks, graph, mech_load_w, kind)` in the same file). Kind = dry cooler if `facility_supply_c ≥ outdoor_design_c + dry_cooler approach_k`, else chiller. Units = `ceil(total / capacity) + spares.heat_rejection`, capped by `heat_rejection_units_max`. Checks `heat-rejection:units` (normal n, worst n − 1) and `heat-rejection:hall-limit` vs `hall.heat_rejection_kw`. Mech load: dry cooler = units_active · power_w; chiller = total / cop.

- [ ] **Step 1: Write failing tests**

```python
def test_spec_flow_case():
    q = mass_flow(Quantity.of(130e3, "W"), Quantity.of(4186, "J/kgK"), 10.0)
    assert q.value == pytest.approx(3.106, rel=1e-3)
    assert q.value / 998 * 60000 == pytest.approx(186.7, rel=1e-2)   # ~190 L/min

def test_swamee_jain_turbulent():
    assert friction_factor(1e5, 1e-4) == pytest.approx(0.0185, rel=0.02)

def test_cdu_count_capped_by_positions():
    # row of 20 × 230 kW liquid 100%, CDU 2300 kW, 2 positions
    r = solve_liquid(ctx_row(racks=20, rack_kw=230, liquid=1.0, cdu_kw=2300, positions=2), it_loads={})
    c = by_id(r.checks, "cdu:R1:heat")
    assert c.normal.value == pytest.approx(4600e3 / (2 * 2300e3)) and c.status is Status.FAIL
    assert "needs 4 CDUs, has 2 positions" in c.advice

def test_row_without_cdu_positions_fails_cleanly():
    c = by_id(solve_liquid(ctx_row(racks=2, rack_kw=130, liquid=0.85, positions=0), {}).checks, "cdu:R1:heat")
    assert c.status is Status.FAIL and "add CDU positions" in c.advice

def test_n_minus_one_cdu():
    c = by_id(solve_liquid(ctx_row(racks=10, rack_kw=130, liquid=1.0, cdu_kw=1000, positions=4), {}).checks, "cdu:R1:heat")
    # needs ceil(1300/1000)+1 = 3; normal 1300/3000, worst 1300/2000
    assert c.utilization_normal == pytest.approx(0.4333, rel=1e-3) and c.utilization_worst == pytest.approx(0.65)

def test_pinned_count_respected(): ...
def test_dry_cooler_vs_chiller():
    assert pick_rejection(supply_c=30, outdoor_c=35, approach_k=5) == "chiller"
    assert pick_rejection(supply_c=40, outdoor_c=35, approach_k=5) == "dry_cooler"

def test_coolant_temp_incompatible_fails(): ...
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(core): liquid chain, facility loop hydraulics and heat rejection`.

---

### Task 9: Air solver

**Files:**
- Create: `core/src/dctwin/solvers/air.py`
- Test: `core/tests/test_air.py`

**Interfaces:**
- Consumes: `EvalContext`, `it_loads`, `NetworkResult.air_heat_w`, `SurrogateRegistry`.
- Produces: `AirResult(checks, graph, air_heat_w: Quantity, mech_load_w: Quantity)`; `solve_air(ctx, it_loads, network_air_heat_w: Quantity) -> AirResult`.

Method: air heat = Σ rack peak × (1 − liquid_fraction) for racks without overriding IT loads + `it_loads` of network racks + `network_air_heat_w` already counted in those loads (don't double count: use `it_loads` where present, catalog peak otherwise). AHUs = `ceil(heat / capacity) + spares.air_handler`, capped by `len(ahu_positions)` or pinned. Check `air-handlers:capacity` normal n, worst n − 1 ("loss of one air handler"). Check `air:hot-aisle-temp` from `surrogates.get("room_airflow").predict(...)` → Unknown with explanation "not modeled until Phase 2". Mech load = active units · power_w.

- [ ] **Step 1: Write failing tests**

```python
def test_air_heat_from_residual_fraction():
    r = solve_air(ctx_racks([("gb300-nvl72", 0.85, 155e3)] * 2), {}, Quantity.of(0, "W"))
    assert r.air_heat_w.value == pytest.approx(2 * 155e3 * 0.15)

def test_hot_aisle_check_unknown_until_phase_2():
    c = by_id(solve_air(ctx_racks(...), {}, Quantity.of(0, "W")).checks, "air:hot-aisle-temp")
    assert c.status is Status.UNKNOWN and "Phase 2" in c.explanation

def test_ahu_n_minus_one(): ...
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(core): air handler sizing and Phase 2 airflow seam`.

---

### Task 10: Structural solver

**Files:**
- Create: `core/src/dctwin/solvers/structural.py`
- Test: `core/tests/test_structural.py`

**Interfaces:**
- Consumes: `PointMass`, `Hall.bays`, `Hall.trays`, `cable_weight_by_tray`.
- Produces:
  - `InfluenceMatrix` protocol: `bay_loads(masses: list[PointMass]) -> dict[str, Quantity]` (kN/m²).
  - `TributaryArea(hall)` implementation: for each mass, `g · mass · overlap(rect, bay) / rect.area / bay.area / 1000`.
  - `StructuralResult(checks, graph, bay_loads: dict[str, Quantity])`; `solve_structural(ctx, masses: list[PointMass], cable_weight_by_tray: dict[str, Quantity], matrix: InfluenceMatrix | None = None) -> StructuralResult`.

Method: masses = all placements (rack rect from `rack_rect`, `weight_kg`, `feet`) + CDU masses + tray self-weight and cable weight distributed along each tray polyline and split by bay by length inside the bay (treat as a line load spread over the bay). Check `slab:<bay>` vs `rated_kn_m2`; `rack:<id>:point-load` = g · weight / feet / 1000 vs `point_limit_kn` of the bay containing the rack center. An unknown mass makes only the bays it overlaps Unknown.

- [ ] **Step 1: Write failing tests**

```python
def test_twenty_racks_in_one_bay():
    # 20 × 1580 kg, all inside a 6×6 m bay rated 12
    r = solve_structural(ctx_bay(rated=12), masses_in_bay(20, 1580), {})
    assert r.bay_loads["A1"].value == pytest.approx(20 * 1580 * 9.80665 / 36 / 1000, rel=1e-6)  # 8.607
    assert by_id(r.checks, "slab:A1").status is Status.PASS

def test_rack_straddling_bays_splits_by_area(): ...
def test_unknown_weight_isolated_to_its_bays():
    r = solve_structural(ctx_two_bays(), [known_in("A1"), unknown_in("B1")], {})
    assert by_id(r.checks, "slab:A1").status is not Status.UNKNOWN
    c = by_id(r.checks, "slab:B1"); assert c.status is Status.UNKNOWN and "weight_kg" in c.explanation

def test_point_load(): ...  # 1580 kg / 4 feet = 3.874 kN vs 6 → Pass
def test_matrix_is_swappable(): ...  # a stub InfluenceMatrix's numbers flow into checks
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(core): slab bay and point-load checks behind influence-matrix interface`.

---

### Task 11: Power solver

**Files:**
- Create: `core/src/dctwin/solvers/power.py`
- Test: `core/tests/test_power.py`

**Interfaces:**
- Consumes: `EvalContext`, `it_loads`, `mech_loads: dict[str, Quantity]` with keys `cdu_pumps` (critical, on UPS/rectifier) and `heat_rejection`, `air_handlers` (non-critical, mechanical board).
- Produces: `PowerResult(checks, graph, it_load_w: Quantity, facility_input_w: Quantity, losses_w: Quantity)`; `solve_power(ctx, it_loads, mech_loads) -> PowerResult`.

Method:
- Rack load = `it_loads[id]` if present else effective rack `peak_power_w`.
- Input compatibility check `rack:<id>:power-input` (one per rack type present, subject lists ids): Fail if `presets.power_input` ∉ `supported_power_input`.
- Rack shelves check `rack:<type>:shelves`: peak vs `power_shelves · shelf_rating_w`; worst = `(shelves − 1) · shelf_rating_w`, failure "loss of one power shelf". Racks with `power_shelves = 0` (network and storage racks fed by AC PDUs) get no shelf check; their load still counts on the busway.
- Busway runs: each row has `busway_runs_per_row` runs per feed (A, B); racks split into contiguous slot ranges of equal slot count; run capacity = busway `capacity_w × derate`. 2N and N+1 both give each run an A and B busway. Normal per-feed load = ½ of the run's racks; worst = all of it ("loss of feed B" for the A run, and vice versa). Check id `busway:<row>:<run>:<A|B>`.
- 2N: chain A and chain B each carry critical load (IT + `cdu_pumps`) in the worst case. Per chain: UPS modules (AC) or rectifiers (DC) count = `ceil(critical / capacity)`, capped by the chain's `_max` limit; switchgear and transformers count = `ceil(upstream / (capacity × derate))`, capped; upstream = critical / UPS efficiency (+ mechanical load on chain A and B halves). Normal = half of the load; worst = all of it ("loss of feed A/B").
- N+1: one shared chain. Count = `ceil(load / capacity) + spares[category]`, capped by `_max`; normal = load / (n · cap); worst = load / ((n − 1) · cap) ("loss of one UPS module", etc.).
- DC (`dc_800v`): rectifiers replace UPS modules and use DC busway models; AC: UPS modules. Conversion efficiencies multiply upstream (`efficiency` params).
- Utility check `utility`: facility input = critical / Π(efficiencies) + mechanical loads vs `hall.utility_kw`.
- Pins on `ups_module:A|B|shared` etc. fix counts; capping by limits produces advice "needs <n>, electrical room allows <m>".

- [ ] **Step 1: Write failing tests**

```python
def test_2n_busway_feed_loss():
    # one row, 10 × 100 kW, one run per feed, busway 1500 kW, derate 0.8
    r = solve_power(ctx_power("2N", racks=10, rack_kw=100, runs=1, busway_kw=1500), {}, {})
    c = by_id(r.checks, "busway:R1:1:A")
    assert c.utilization_normal == pytest.approx(500 / 1200) and c.utilization_worst == pytest.approx(1000 / 1200)
    assert c.status is Status.WARNING and c.failure_name == "loss of feed B"

def test_n_plus_1_ups_modules():
    r = solve_power(ctx_power("N+1", racks=10, rack_kw=100, ups_kw=500, ups_max=12), {}, {})
    c = by_id(r.checks, "ups_module:shared")
    assert c.utilization_normal == pytest.approx(1000 / 1500) and c.utilization_worst == pytest.approx(1.0)

def test_ups_capped_by_electrical_room():
    c = by_id(solve_power(ctx_power("N+1", racks=10, rack_kw=100, ups_kw=500, ups_max=2), {}, {}).checks, "ups_module:shared")
    assert c.status is Status.FAIL and "electrical room allows 2" in c.advice

def test_incompatible_input_fails():
    c = by_id(solve_power(ctx_power("2N", power_input="dc_800v", rack_supports=["ac_54v"]), {}, {}).checks, "rack:gb300-nvl72:power-input")
    assert c.status is Status.FAIL

def test_dc_chain_uses_rectifiers(): ...  # graph has rectifier nodes, no ups_module nodes
def test_cdu_pumps_on_critical_chain(): ...  # ups load includes mech_loads["cdu_pumps"]
def test_utility_includes_losses_and_mechanical(): ...
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(core): power chain sizing for 2N/N+1, AC and 800 V DC`.

---

### Task 12: Rollups, evaluate pipeline, scenarios, golden and performance tests

**Files:**
- Create: `core/src/dctwin/solvers/rollups.py`
- Modify: `core/src/dctwin/evaluate.py`
- Test: `core/tests/test_evaluate.py`, `core/tests/test_golden.py`, `core/tests/test_performance.py`, `core/tests/golden/sample-hall-checks.json`

**Interfaces:**
- Consumes: every solver above.
- Produces:
  - `Rollups(it_peak_w, it_nominal_w, facility_w: Quantity, pue: Quantity, total_weight_kg: Quantity, rack_count: int, accelerator_count: Quantity, cables: dict[str, CableTotals])`
  - `evaluate(state, surrogates=None) -> Result` — order: network → liquid → air → heat rejection (liquid + air heat) → power (mech loads from liquid, air, heat rejection) → structural (rack, CDU masses, cable weight) → rollups → rank → scenarios (group checks by `failure_name`).
  - `FacilityDeltas(it_w, cooling_w, facility_w: Quantity, pue: Quantity)`; `facility_deltas(before: Result, after: Result) -> FacilityDeltas`.
  - `Comparison(a: str, b: str, checks: list[CheckPair(id, a: Check | None, b: Check | None)], rollups_a: Rollups, rollups_b: Rollups, deltas: FacilityDeltas)`; `compare(name_a, result_a, name_b, result_b) -> Comparison`.
  - PUE = facility / IT peak; IT = 0 → `Quantity.unknown("1", "no IT load")`.

- [ ] **Step 1: Write failing tests**

```python
def test_empty_hall():
    r = evaluate(replay(new_project(sample_hall(), real_catalog()), "main"))
    assert r.rollups.it_peak_w.value == 0 and not r.rollups.pue.known
    assert all(c.status is not Status.FAIL for c in r.checks)

def test_spec_style_report_on_sample_hall():
    # gb300-su8 in R1, 3 helios in R8 (9 kN/m² bays), one network rack per row used
    r = evaluate(golden_state())
    ids = [c.id for c in r.checks]
    assert ids == sorted(ids, key=rank_key(r.checks))   # ranked
    assert any(c.id.startswith("slab:") and c.status is Status.FAIL for c in r.checks)
    assert any(s.name == "loss of feed B" for s in r.scenarios)

def test_golden_checks_match_file():
    got = [(c.id, c.status.value, round(c.utilization_normal or -1, 4), round(c.utilization_worst or -1, 4)) for c in evaluate(golden_state()).checks]
    assert got == load_golden("sample-hall-checks.json")

def test_facility_deltas_after_adding_a_helios(): ...  # it_w delta == helios peak (high)
def test_compare_pairs_checks_by_id(): ...

def test_500_racks_under_one_second():
    state = state_with_racks(500)   # 25 rows synthetic hall, 20 slots
    t = time.perf_counter(); evaluate(state); assert time.perf_counter() - t < 1.0
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** implement; generate the golden file once with a script `core/tests/make_golden.py`, inspect it by hand against the spec's expectations (CDU, slab, busway failures behave as the solvers' unit tests say), commit it. **Step 4:** run the whole suite `uv run pytest -q` — expected: all pass; performance test under 1 s (profile and fix routing first if not). **Step 5: Commit** `feat(core): evaluate pipeline, rollups, scenarios, golden and perf tests`.

---

### Task 13: `dctwin` CLI

**Files:**
- Create: `core/src/dctwin/cli.py`, `core/src/dctwin/lock.py`
- Test: `core/tests/test_cli.py`

**Interfaces:**
- Consumes: everything above.
- Produces: the command line Plans 2–3 depend on. Global options on every command: `--project PATH` (default env `DCTWIN_PROJECT`), `--branch NAME` (default `main`), `--author NAME` (default env `DCTWIN_AUTHOR`, else `user`), `--json`. Exit codes: 0 ok; 1 input or edit error (with `--json`: `{"error": "<message>"}` on stdout); 2 only for `evaluate --exit-code` when any check is Fail.

| Command | Effect | `--json` output |
|---|---|---|
| `new --hall H --catalog DIR` | create project file | `{"project", "branch": "main", "catalog_hash"}` |
| `show` | state summary, catalog notice if `catalog/` hash differs from the branch's bundle | `{"placements": [...], "presets": {...}, "pins": [...], "notices": [...]}` |
| `place ROW SLOT TYPE` / `place-system ROW SLOT SYSTEM` | append edit | the `JournalEntry` + new placement ids |
| `remove ID`, `swap ID TYPE`, `override ID FIELD VALUE [--provenance user_input] [--note T]` | append edit | `JournalEntry` |
| `preset KEY VALUE` (VALUE parsed as JSON, else string) | append edit | `JournalEntry` |
| `pin TARGET ATTR VALUE`, `unpin TARGET ATTR`, `undo` | append edit | `JournalEntry` |
| `update-catalog --catalog DIR` | store bundle, append `UpdateCatalog` | `JournalEntry` |
| `evaluate [--exit-code] [--status fail,warning]` | evaluate | `Result` (filtered checks) |
| `explain CHECK_ID` | one check with inputs and provenance | `Check` |
| `branch NAME [--from B]`, `branches` | create / list | `Branch` / list of `{name, parent, base_index, entries}` |
| `compare A B` | compare | `Comparison` |
| `catalog list [--kind racks|systems|equipment]`, `catalog show ID` | read project's bundle | entries |
| `journal [--limit N]` | list entries | entries |

- Writes: `with project_lock(path):` (`fcntl.flock` on `<path>.lock`, timeout 10 s → error "project is locked by another writer") → `load_project` → `apply_edit` → `save_project`.
- Human output: a compact table for `evaluate` (status word + shape glyph `✕ ! ? ✓`, id, normal %, worst %, failure) and plain lines elsewhere.

- [ ] **Step 1: Write failing tests** (typer `CliRunner`, `tmp_path` project from the sample hall and real catalog)

```python
def test_new_place_evaluate_json(run):
    run("new", "--hall", SAMPLE, "--catalog", CATALOG)
    out = run("place", "R1", "0", "gb300-nvl72", "--author", "layout", "--json")
    assert out["author"] == "layout"
    res = run("evaluate", "--json")
    assert res["rollups"]["it_peak_w"]["value"] == pytest.approx(155e3, rel=0.05)

def test_edit_error_exit_1_json(run):
    run("new", ...); run("place", "R1", "0", "gb300-nvl72")
    r = run_raw("place", "R1", "0", "gb300-nvl72", "--json")
    assert r.exit_code == 1 and "occupied" in json.loads(r.stdout)["error"]

def test_exit_code_on_fail(run): ...  # evaluate --exit-code returns 2 when a slab check fails
def test_branch_compare(run): ...
def test_concurrent_writers_on_two_branches(tmp_path):
    # two processes, 20 places each on branches a and b; afterwards both journals have 20 entries
    ...

def test_catalog_notice_when_catalog_changes(run, tmp_path): ...
def test_corrupt_project_file_message(run_raw, tmp_path):
    r = run_raw("show", "--project", bad, "--json")
    assert r.exit_code == 1 and "branches.main" in json.loads(r.stdout)["error"]
```

- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** run the whole suite and `uv run dctwin --help` — expected: all pass; help lists every command above. **Step 6: Commit** `feat(core): dctwin CLI with JSON output and locked writes`.

---

### Task 14: `dctwin report` — visual HTML report

**Files:**
- Create: `core/src/dctwin/report/__init__.py`, `core/src/dctwin/report/floorplan.py` (SVG drawing), `core/src/dctwin/report/charts.py` (SVG charts), `core/src/dctwin/report/html.py` (page assembly, inline CSS), `core/src/dctwin/report/style.css` (packaged resource)
- Modify: `core/src/dctwin/cli.py` (add `report`)
- Test: `core/tests/test_report.py`

**Interfaces:**
- Consumes: `DesignState`, `Result`, `Comparison`, `Branch.journal`, `Hall` geometry, `rack_rect`.
- Produces:
  - `floorplan_svg(state: DesignState, result: Result, overlay: Literal["layout","power","liquid","structural","network"], width_px: int = 960) -> str` — a top-down SVG at a fixed scale. It draws hall outline, bays (shaded by utilization on `structural`), columns, rows and slots, racks to scale labeled with a short type code, system outlines, CDUs and AHUs at their positions, and trays (colored by dominant media on `network`). Every element carries `data-id` for the web viewer. Status markers use shapes (✕ fail, ! warning, ? unknown) plus a text label, never color alone.
  - `power_breakdown_svg(result) -> str` — one horizontal stacked bar: IT, cooling (CDU pumps, air handlers, heat rejection), conversion losses, in kW with values labeled.
  - `report_html(state, result, branch: Branch, title: str) -> str` and `compare_html(state_a, result_a, state_b, result_b, comparison: Comparison) -> str` — sections in the design's order: verdict, floor plan, domain plans (4 small multiples), facility summary, headroom table, failure scenarios, provenance, design history. The output is one file with inline CSS and SVG, no scripts required, light/dark via `prefers-color-scheme`, and print styles.
  - CLI: `dctwin report [--out PATH] [--title T]`, default `report-<branch>.html`; `dctwin report --compare A B [--out PATH]`; `--json` prints `{"path": ...}`.

Before writing chart or color code, load the `dataviz` skill and follow its palette and mark rules. Charts are hand-rolled SVG, with no charting library dependency.

- [ ] **Step 1: Write failing tests**

```python
def test_floorplan_draws_every_rack(golden):
    svg = floorplan_svg(golden.state, golden.result, "layout")
    ET.fromstring(svg)  # well-formed
    for pid in golden.state.placements:
        assert f'data-id="{pid}"' in svg

def test_failures_marked_with_shape_and_text(golden):
    svg = floorplan_svg(golden.state, golden.result, "structural")
    failing = [c for c in golden.result.checks if c.id.startswith("slab:") and c.status is Status.FAIL]
    assert failing and all(f'data-check="{c.id}"' in svg for c in failing)
    assert "Fail" in svg  # text label alongside the shape

def test_report_sections_in_order(golden):
    html = report_html(golden.state, golden.result, golden.branch, "Hall B")
    order = ["Verdict", "Floor plan", "Domain plans", "Facility summary", "Headroom", "Failure scenarios", "Provenance", "Design history"]
    idx = [html.index(f">{h}<") for h in order]
    assert idx == sorted(idx)

def test_report_is_self_contained(golden):
    html = report_html(golden.state, golden.result, golden.branch, "Hall B")
    assert "<script src" not in html and "<link" not in html and "http://" not in html.split("Provenance")[0]

def test_history_names_authors(golden):
    assert "layout" in report_html(golden.state, golden.result, golden.branch, "Hall B")

def test_empty_hall_report(empty):
    html = report_html(empty.state, empty.result, empty.branch, "Empty")
    assert "no IT load" in html  # PUE unknown explained, no crash

def test_compare_shows_only_changed_checks(run): ...
def test_cli_writes_file(run, tmp_path):
    out = run("report", "--out", str(tmp_path / "r.html"), "--json")
    assert Path(out["path"]).stat().st_size > 10_000
```

- [ ] **Step 2: Run** `uv run pytest tests/test_report.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** floorplan, charts, html, and the CLI command.
- [ ] **Step 4: Run** the full suite. Expected: all tests pass. Generate `report-main.html` from the golden project and open it in a browser for visual review: in light and dark mode, check that the plan is legible at 960 px, labels don't collide, and the print preview fits A4/Letter.
- [ ] **Step 5: Commit** `feat(core): self-contained HTML design report with floor plans`.

---

## Self-review notes

- Spec coverage: catalog (T2–3), hall (T4), journal/branches/attribution/catalog snapshot (T5), provenance (T1, T6), surrogate seam (T6, T9), network (T7), liquid + heat rejection (T8), air (T9), structural + influence matrix (T10), power incl. 2N/N+1/DC/compat (T11), rollups/scenarios/deltas/compare/perf (T12), CLI (T13), visual report (T14). API, web, design desk → Plans 2 and 3.
- Deviation recorded: the design says the engine uses "the largest suitable catalog model"; this plan uses the preset model per category, whose default is the largest-capacity entry, so the user can change it.
