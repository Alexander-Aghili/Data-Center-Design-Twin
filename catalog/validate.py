"""Validate every catalog JSON file.

Run from the repo root:  uv run --with jsonschema python catalog/validate.py
Exit code 0 means the catalog is valid; otherwise each problem is printed as
"<file>: <field.path>: <problem>".
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / "schema" / "catalog.schema.json").read_text())

REQUIRED_PARAMS = {
    "cdu": ["capacity_w", "max_flow_kg_s", "approach_k", "pump_head_kpa", "power_w", "weight_kg"],
    "busway": ["capacity_w"],
    "switchgear": ["capacity_w"],
    "ups_module": ["capacity_w", "efficiency"],
    "rectifier": ["capacity_w", "efficiency"],
    "transformer": ["capacity_w", "efficiency"],
    "dry_cooler": ["capacity_w", "approach_k", "power_w"],
    "chiller": ["capacity_w", "cop"],
    "air_handler": ["capacity_w", "power_w"],
    "leaf_switch": ["ports", "port_speed_gbps", "hop_latency_ns", "power_w"],
    "spine_switch": ["ports", "port_speed_gbps", "hop_latency_ns", "power_w"],
    "cable": ["reach_m", "power_per_end_w", "weight_kg_per_m"],
}
REQUIRED_ATTRS = {
    "busway": {"power_input": {"ac_54v", "dc_800v"}},
    "switchgear": {"power_input": {"ac_54v", "dc_800v"}},
    "cable": {"media": {"copper", "optics"}},
}
DIR_KIND = {"racks": "rack", "systems": "system", "equipment": "equipment"}
SOURCED = {"vendor_spec", "oem_datasheet", "measured"}


def iter_quantities(node, path=""):
    if isinstance(node, dict):
        if "provenance" in node and "unit" in node:
            yield path, node
            return
        for k, v in node.items():
            if k != "sources":
                yield from iter_quantities(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from iter_quantities(v, f"{path}.{i}")


def check_quantity(q):
    has_value = q.get("value") is not None
    has_range = q.get("low") is not None or q.get("high") is not None
    if q["provenance"] == "unknown":
        if has_value or has_range:
            return "unknown quantity must not carry a value or range"
        if not q.get("note"):
            return "unknown quantity needs a note saying why"
        return None
    if not (has_value or has_range):
        return "missing value (use provenance 'unknown' with a note instead)"
    if has_range and (q.get("low") is None or q.get("high") is None or q["low"] > q["high"]):
        return "range needs low <= high"
    if q["provenance"] in SOURCED and not q.get("source"):
        return f"{q['provenance']} value needs a source"
    if q["provenance"] == "estimated" and not q.get("note"):
        return "estimated value needs a note saying how it was estimated"
    return None


def validate_rules(root: Path, validator, entries) -> list[str]:
    f = root / "rules.json"
    if not f.exists():
        return ["rules.json: (root): missing"]
    try:
        data = json.loads(f.read_text())
    except json.JSONDecodeError as e:
        return [f"rules.json: line {e.lineno}: invalid JSON: {e.msg}"]
    problems = [f"rules.json: {'.'.join(str(x) for x in e.absolute_path) or '(root)'}: {e.message[:200]}"
                for e in validator.iter_errors(data)]
    if problems:
        return problems
    source_ids = {s["id"] for s in data.get("sources", [])}
    for p, q in iter_quantities(data):
        msg = check_quantity(q)
        if msg:
            problems.append(f"rules.json: {p}: {msg}")
        if q.get("source") and q["source"] not in source_ids:
            problems.append(f"rules.json: {p}.source: unknown source '{q['source']}'")
    presets = data["default_presets"]
    if presets["coolant"] not in data["coolants"]:
        problems.append(f"rules.json: default_presets.coolant: unknown coolant '{presets['coolant']}'")
    wanted = dict(presets["models"])
    wanted["leaf_switch"] = presets["fabric"]["leaf_model"]
    wanted["spine_switch"] = presets["fabric"]["spine_model"]
    for cat, eid in wanted.items():
        e = entries["equipment"].get(eid)
        if e is None:
            problems.append(f"rules.json: default_presets: unknown equipment '{eid}' for {cat}")
        elif e["category"] != cat:
            problems.append(f"rules.json: default_presets: '{eid}' is a {e['category']}, not a {cat}")
    return problems


def validate(root: Path = ROOT) -> list[str]:
    problems: list[str] = []
    validators = {
        kind: Draft202012Validator({"$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{name}"})
        for kind, name in (("rack", "RackType"), ("system", "SystemType"), ("equipment", "EquipmentType"), ("rules", "Rules"))
    }
    entries: dict[str, dict[str, dict]] = {k: {} for k in DIR_KIND}
    for folder, kind in DIR_KIND.items():
        for f in sorted((root / folder).glob("*.json")):
            rel = f.relative_to(root)
            try:
                data = json.loads(f.read_text())
            except json.JSONDecodeError as e:
                problems.append(f"{rel}: line {e.lineno}: invalid JSON: {e.msg}")
                continue
            errs = sorted(validators[kind].iter_errors(data), key=lambda e: list(e.absolute_path))
            if errs:
                for e in errs:
                    p = ".".join(str(x) for x in e.absolute_path) or "(root)"
                    msg = e.message if len(e.message) < 200 else e.message[:200] + "..."
                    problems.append(f"{rel}: {p}: {msg}")
                continue
            if data["kind"] != kind:
                problems.append(f"{rel}: kind: expected '{kind}' in {folder}/")
            if data["id"] != f.stem:
                problems.append(f"{rel}: id: '{data['id']}' must equal the file name '{f.stem}'")
            source_ids = {s["id"] for s in data.get("sources", [])}
            for p, q in iter_quantities(data):
                msg = check_quantity(q)
                if msg:
                    problems.append(f"{rel}: {p}: {msg}")
                if q.get("source") and q["source"] not in source_ids:
                    problems.append(f"{rel}: {p}.source: unknown source '{q['source']}'")
            if kind == "equipment":
                cat = data["category"]
                for name in REQUIRED_PARAMS[cat]:
                    if name not in data["params"]:
                        problems.append(f"{rel}: params.{name}: missing (required for {cat})")
                for name, allowed in REQUIRED_ATTRS.get(cat, {}).items():
                    v = data.get("attrs", {}).get(name)
                    if v not in allowed:
                        problems.append(f"{rel}: attrs.{name}: must be one of {sorted(allowed)}")
            if kind == "rack":
                for path in data.get("overridable", []):
                    node = data
                    for part in path.split("."):
                        node = node.get(part) if isinstance(node, dict) else None
                    if node is None:
                        problems.append(f"{rel}: overridable: '{path}' is not a field")
            entries[folder][data["id"]] = data
    problems += validate_rules(root, validators["rules"], entries)
    for sid, s in entries["systems"].items():
        keys = {m["key"] for m in s["members"]}
        for i, m in enumerate(s["members"]):
            if m["rack_type"] not in entries["racks"]:
                problems.append(f"systems/{sid}.json: members.{i}.rack_type: unknown rack type '{m['rack_type']}'")
        for i, link in enumerate(s["links"]):
            for end in ("a", "b"):
                if link[end] not in keys:
                    problems.append(f"systems/{sid}.json: links.{i}.{end}: unknown member key '{link[end]}'")
    return problems


if __name__ == "__main__":
    probs = validate()
    for p in probs:
        print(p)
    counts = {k: len(list((ROOT / k).glob("*.json"))) for k in DIR_KIND}
    print(f"{'FAIL' if probs else 'OK'}: {counts['racks']} racks, {counts['systems']} systems, "
          f"{counts['equipment']} equipment, {len(probs)} problems")
    sys.exit(1 if probs else 0)
