"""Bundle the catalog into one JSON file: catalog/dist/catalog.json.

Run from the repo root:  uv run --with jsonschema python catalog/build.py
The catalog must validate first. The bundle's "hash" is the sha256 of its
canonical content (sorted keys, no whitespace), so any change to any entry
changes it; projects record this hash to detect catalog changes.
"""

import hashlib
import json
import sys
from pathlib import Path

from validate import ROOT, validate

OUT = ROOT / "dist" / "catalog.json"


def load_entries(root: Path) -> dict:
    content = {
        folder: {f.stem: json.loads(f.read_text()) for f in sorted((root / folder).glob("*.json"))}
        for folder in ("racks", "systems", "equipment")
    }
    content["rules"] = json.loads((root / "rules.json").read_text())
    return content


def canonical_hash(content: dict) -> str:
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def build(root: Path = ROOT) -> dict:
    content = load_entries(root)
    return {
        "format": "dctwin.catalog/v1",
        "hash": canonical_hash(content),
        "counts": {k: len(content[k]) for k in ("racks", "systems", "equipment")},
        **content,
    }


if __name__ == "__main__":
    problems = validate()
    if problems:
        print("\n".join(problems))
        print("catalog is invalid; not building")
        sys.exit(1)
    bundle = build()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=1, sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(ROOT.parent)}: {bundle['counts']} hash {bundle['hash'][:12]}")
