# Catalog format

The catalog is plain JSON: one file per entry, validated by `catalog/schema/catalog.schema.json` plus cross-file rules in `catalog/validate.py`.

```
catalog/racks/<id>.json        kind "rack"       rack types (GB300 NVL72, Helios, ...)
catalog/systems/<id>.json      kind "system"     multi-rack bundles placed as one unit
catalog/equipment/<id>.json    kind "equipment"  CDUs, busways, UPS, switches, cables, ...
catalog/rules.json                               sizing rules and default presets
```

Validate from the repo root:

```bash
uv run --with jsonschema python catalog/validate.py
```

## Rules for every value

Every physical number is a **Quantity**:

```json
{ "value": 132000, "unit": "W", "provenance": "vendor_spec", "source": "hpe-gb300-quickspecs" }
{ "low": 190000, "high": 230000, "unit": "W", "provenance": "estimated", "note": "vendor range; no datasheet yet" }
{ "unit": "kg", "provenance": "unknown", "note": "not published as of 2026-10" }
```

- **SI units** in the unit string: `W`, `kg`, `mm` (dimensions only), `m`, `kg/s`, `kPa`, `K`, `C` (temperatures), `Gb/s`, `ns`, `1` (dimensionless: fractions, counts, efficiency, COP), `W/end`, `kg/m`, `L/min/kW`, `PFLOPS`, `TB`, `Tb/s`.
- **Provenance labels**, strongest to weakest:
  - `measured`: measured on site.
  - `vendor_spec`: the manufacturer's own datasheet or spec page.
  - `oem_datasheet`: an OEM or reseller's spec sheet, such as HPE, Supermicro, Dell or Cisco for NVIDIA racks.
  - `user_input`: entered by the user.
  - `derived`: computed from other values; say how in `note`.
  - `estimated`: no published figure; `note` must say how it was estimated.
  - `surrogate`: produced by an ML model.
  - `unknown`: needs a `note`.
- `vendor_spec`, `oem_datasheet` and `measured` values **must** cite a `source` id from the file's `sources` list. Each source has a URL you actually opened.
- Use press coverage (DCD, The Next Platform, ServeTheHome, Tom's Hardware) as `estimated` with the source cited and a note such as "press report". It is not `vendor_spec`.
- **Never use zero for "don't know".** Use a range when sources conflict, and put the conflict in `note`.
- `as_of` is the date you researched the entry (YYYY-MM-DD).

## Required fields

**Racks:**
- `electrical`: `nominal_power_w`, `peak_power_w`, `power_shelves`, `shelf_rating_w`, `supported_power_input`. The input list holds one or both of `ac_54v` (AC-fed 54 V in-rack busbar) and `dc_800v` (800 V DC fed).
- `thermal`: `liquid_fraction`, the share of heat to liquid, from 0 to 1; `max_coolant_supply_c`; `rack_pressure_drop_kpa`.
- `mechanical`: `width_mm`, `depth_mm`, `height_mm`, `weight_kg`, `feet`.
- `network`: `scale_out_ports`, `port_speed_gbps`, `scale_up_domain`, and `switch_slots` (switches the rack can host, 0 for compute racks).
- `compute`: `accelerators`, `fp4_pflops`.

Optional extras are in the schema: `flow_lpm_per_kw`, `rack_units`, `hbm_tb`, `fp8_pflops` and others.

**Equipment `params` by `category`:**

| category | required params | required attrs |
|---|---|---|
| cdu | capacity_w, max_flow_kg_s, approach_k, pump_head_kpa, power_w, weight_kg | |
| busway | capacity_w | power_input: ac_54v or dc_800v |
| switchgear | capacity_w | power_input |
| ups_module | capacity_w, efficiency | |
| rectifier | capacity_w, efficiency | |
| transformer | capacity_w, efficiency | |
| dry_cooler | capacity_w, approach_k, power_w | |
| chiller | capacity_w, cop | |
| air_handler | capacity_w, power_w | |
| leaf_switch, spine_switch | ports, port_speed_gbps, hop_latency_ns, power_w | |
| cable | reach_m, power_per_end_w, weight_kg_per_m | media: copper or optics |

Add any other useful params, such as `weight_kg`, `footprint_w_mm`, `voltage_v`, `rating_a`, `flow_lpm`, `noise_dba` or `rack_units`, each as a Quantity.

## Systems

A system lists member racks with `slot_offset`s in 0.6 m slot units: a 1,200 mm double-wide rack takes 2 slots. `links` lists only links that must stay inside the system, such as copper scale-up cables between member racks. The twin's network solver checks them for copper reach. Do not list scale-out links to leaf switches here; the network solver derives them from each rack's `scale_out_ports` and routes them.

## Example (a rack, abbreviated values)

```json
{
  "kind": "rack",
  "id": "example-rack",
  "name": "Example NVL rack",
  "vendor": "NVIDIA",
  "model": "Example",
  "generation": "Blackwell Ultra",
  "availability": "Shipping",
  "as_of": "2026-10-18",
  "role": "compute",
  "electrical": {
    "nominal_power_w": { "value": 132000, "unit": "W", "provenance": "oem_datasheet", "source": "s1" },
    "peak_power_w": { "value": 155000, "unit": "W", "provenance": "estimated", "source": "s2", "note": "press report of EDPp" },
    "power_shelves": { "value": 8, "unit": "1", "provenance": "oem_datasheet", "source": "s1" },
    "shelf_rating_w": { "value": 33000, "unit": "W", "provenance": "oem_datasheet", "source": "s1" },
    "supported_power_input": ["ac_54v"]
  },
  "thermal": {
    "liquid_fraction": { "value": 0.85, "unit": "1", "provenance": "estimated", "note": "typical for NVL72 direct-to-chip; vendor gives no split" },
    "max_coolant_supply_c": { "value": 45, "unit": "C", "provenance": "estimated", "note": "..." },
    "rack_pressure_drop_kpa": { "unit": "kPa", "provenance": "unknown", "note": "not published" }
  },
  "mechanical": {
    "width_mm": { "value": 600, "unit": "mm", "provenance": "oem_datasheet", "source": "s1" },
    "depth_mm": { "value": 1200, "unit": "mm", "provenance": "oem_datasheet", "source": "s1" },
    "height_mm": { "value": 2236, "unit": "mm", "provenance": "oem_datasheet", "source": "s1" },
    "weight_kg": { "value": 1580, "unit": "kg", "provenance": "oem_datasheet", "source": "s1" },
    "feet": { "value": 4, "unit": "1", "provenance": "estimated", "note": "standard leveling feet" }
  },
  "network": {
    "scale_out_ports": { "value": 72, "unit": "1", "provenance": "oem_datasheet", "source": "s1" },
    "port_speed_gbps": { "value": 800, "unit": "Gb/s", "provenance": "oem_datasheet", "source": "s1" },
    "scale_up_domain": { "value": 72, "unit": "1", "provenance": "vendor_spec", "source": "s1" },
    "switch_slots": { "value": 0, "unit": "1", "provenance": "derived", "note": "compute rack" }
  },
  "compute": {
    "accelerators": { "value": 72, "unit": "1", "provenance": "vendor_spec", "source": "s1" },
    "fp4_pflops": { "value": 1440, "unit": "PFLOPS", "provenance": "vendor_spec", "source": "s1" }
  },
  "overridable": [],
  "sources": [
    { "id": "s1", "title": "HPE GB300 NVL72 QuickSpecs", "url": "https://...", "accessed": "2026-10-18" },
    { "id": "s2", "title": "Press article", "url": "https://...", "accessed": "2026-10-18" }
  ]
}
```
