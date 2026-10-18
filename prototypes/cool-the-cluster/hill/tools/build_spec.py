"""Build challenge_spec.json from the repo catalog.

    python3 tools/build_spec.py           # write ../challenge_spec.json
    python3 tools/build_spec.py --check   # exit 1 if challenge_spec.json is out of date

challenge_spec.json = tools/spec_base.json (twin-owned values, all `estimated`)
                      + every value in MAPPINGS below, read from catalog/dist/catalog.json.

Every numeric value in the output gets an entry in `_provenance`, keyed by its dotted
path, using the catalog's labels (vendor_spec, oem_datasheet, derived, estimated, ...).
A mapped value carries the catalog's own label and source; an unmapped one is labeled
`estimated` with source `cool-the-cluster`. The evaluator ignores keys starting with `_`.

The hill ships challenge_spec.json, not the catalog, so an AutoLab copy still scores on
its own. tests/test_hill.py fails when this file falls out of sync with the catalog.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

HILL = Path(__file__).resolve().parents[1]
BASE = HILL / "tools" / "spec_base.json"
OUT = HILL / "challenge_spec.json"
CATALOG = HILL.parents[2] / "catalog" / "dist" / "catalog.json"


def eq(item, param, scale=1.0):
    return ("equipment", item, "params", param, scale)


def rule(*path, scale=1.0):
    return ("rules", *path, scale)


# spec path -> catalog location. Only clean one-to-one matches belong here; anything that
# needs a judgment call stays in spec_base.json as `estimated` and is listed in GAPS.
MAPPINGS = {
    # optics and cables (all 800G)
    "network.modules.dac.reach_m":        eq("nvidia-mcp4y10-800g-dac", "reach_m"),
    "network.modules.dac.w_per_end":      eq("nvidia-mcp4y10-800g-dac", "power_per_end_w"),
    "network.modules.acc.reach_m":        eq("nvidia-mca4j80-800g-acc", "reach_m"),
    "network.modules.acc.w_per_end":      eq("nvidia-mca4j80-800g-acc", "power_per_end_w"),
    "network.modules.aec.reach_m":        eq("credo-span-800g-aec", "reach_m"),
    "network.modules.aec.w_per_end":      eq("credo-span-800g-aec", "power_per_end_w"),
    "network.modules.sr8.reach_m":        eq("nvidia-mma4z00-800g-sr8", "reach_m"),
    "network.modules.sr8.w_per_end":      eq("nvidia-mma4z00-800g-sr8", "power_per_end_w"),
    "network.modules.dr8.reach_m":        eq("nvidia-mms4x00-800g-dr8", "reach_m"),
    "network.modules.dr8.w_per_end":      eq("nvidia-mms4x00-800g-dr8", "power_per_end_w"),
    "network.modules.fr4_2x.reach_m":     eq("nvidia-mms4x50-800g-2xfr4", "reach_m"),
    "network.modules.fr4_2x.w_per_end":   eq("nvidia-mms4x50-800g-2xfr4", "power_per_end_w"),
    # Ethernet leaf in every GPU rack and packet spines: Spectrum-4 SN5600
    "gpu_rack.leaf_switch_w":             eq("nvidia-sn5600-leaf", "power_w"),
    "network.leaf_latency_us":            eq("nvidia-sn5600-leaf", "hop_latency_ns", 1e-3),
    "network.spine_types.packet.body_w":  eq("nvidia-sn5600-spine", "power_w"),
    "network.spine_types.packet.latency_us": eq("nvidia-sn5600-spine", "hop_latency_ns", 1e-3),
    "network.propagation_ns_per_m":       rule("network", "propagation_ns_per_m"),
    # coolant, power chain, air handlers, CDU (the catalog's default preset models)
    "coolant.rho":                        rule("coolants", "pg25", "density_kg_m3"),
    "coolant.cp":                         rule("coolants", "pg25", "cp_j_kgk"),
    "plant.ups_eff":                      eq("vertiv-liebert-trinergy-cube-1600kw", "efficiency"),
    "air.crah_rated_flow_m3_s":           eq("stulz-cyberair-3pro-asr-cw-2410", "airflow_m3_s"),
    "air.crah_rated_kw":                  eq("stulz-cyberair-3pro-asr-cw-2410", "power_w", 1e-3),
    "cdu_common.hx_approach_k":           eq("boyd-rol4000-48u65", "approach_k"),
    # racks
    "storage_rack_w":                     ("racks", "storage-rack", "electrical", "nominal_power_w", 1.0),
}

# Values that stay twin-owned on purpose, and why. Printed into the hill README section.
GAPS = {
    "network.modules.lpo_*": "no LPO module in the catalog yet",
    "network.spine_types.packet_cpo / ocs": "no Ethernet CPO or OCS switch in the catalog (Q3450-LD is InfiniBand)",
    "network.modules.*.cost_*, budget_usd": "the catalog has no prices",
    "gpu_rack.*": "a ~38 kW benchmark rack; catalog racks are 120-600 kW (rebuild planned)",
    "plant.chiller_*, tower_*": "the catalog has air-cooled chillers and dry coolers; the twin models a cooling tower",
    "cdus.*.capacity_kw, cdu_common.max_head_kpa": "sized for this 1 MW benchmark hall; catalog CDUs are 1.35-3 MW",
}


def catalog_value(cat, loc):
    *path, scale = loc
    node = cat
    for k in path:
        node = node[k]
    if "value" not in node:
        raise SystemExit(f"catalog {'/'.join(path)} has no single value: {node}")
    label = {"provenance": node.get("provenance", "unknown"), "catalog": "/".join(path)}
    if node.get("source"):
        label["source"] = node["source"]
    if scale != 1.0:
        label["scale"] = scale
    return node["value"] * scale, label


def set_path(d, dotted, value):
    keys = dotted.split(".")
    for k in keys[:-1]:
        d = d[k]
    if keys[-1] not in d:
        raise SystemExit(f"spec has no {dotted}")
    d[keys[-1]] = value


def numeric_paths(d, prefix=""):
    for k, v in d.items():
        if k.startswith("_"):
            continue
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            yield from numeric_paths(v, p)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            yield p


def build() -> str:
    cat = json.loads(CATALOG.read_text())
    spec = copy.deepcopy(json.loads(BASE.read_text()))
    spec.pop("_about", None)
    prov = {}
    for path, loc in MAPPINGS.items():
        value, label = catalog_value(cat, loc)
        set_path(spec, path, value)
        prov[path] = label
    for path in numeric_paths(spec):
        prov.setdefault(path, {"provenance": "estimated", "source": "cool-the-cluster"})
    sourced = sum(1 for v in prov.values() if v["provenance"] != "estimated")
    out = {
        "_about": "GENERATED by tools/build_spec.py from tools/spec_base.json + catalog/dist/catalog.json. "
                  "Do not edit by hand. Coefficients labeled 'estimated' are benchmark assumptions.",
        "_catalog_hash": cat.get("hash"),
        "_provenance_summary": {"numeric_values": len(prov), "from_catalog": sourced,
                                "estimated": len(prov) - sourced},
        "_gaps": GAPS,
        **spec,
        "_provenance": dict(sorted(prov.items())),
    }
    return json.dumps(out, indent=1) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if not CATALOG.is_file():
        raise SystemExit(f"catalog not found at {CATALOG}; run from the Data-Center-Design-Twin repo")
    text = build()
    if args.check:
        if OUT.read_text() != text:
            print("challenge_spec.json is out of date; run python3 tools/build_spec.py")
            sys.exit(1)
        print("challenge_spec.json matches the catalog")
        return
    OUT.write_text(text)
    s = json.loads(text)["_provenance_summary"]
    print(f"wrote challenge_spec.json: {s['from_catalog']} of {s['numeric_values']} values from the catalog")


if __name__ == "__main__":
    main()
