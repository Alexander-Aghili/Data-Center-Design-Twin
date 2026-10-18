"""Generate the seeded random baseline and the reference values the score divides by.

    python3 tools/make_baseline.py            # writes examples/baseline/submission.json and private/reference.json

The baseline is the first legal layout drawn from a fixed seed: random slots, random job
split, packet spine with sr8 pluggables everywhere, DN32 copper pipes to a random CDU,
no containment, and conservative operator setpoints (18 C supply air, 30 C coolant).
It scores 1.0 by construction.
"""

import json
import random
import sys
from pathlib import Path

HILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HILL))
import twin  # noqa: E402

SEED = 7


def random_layout(spec, rng):
    h = spec["hall"]
    inv = spec["inventory"]
    blocked = {tuple(s) for s in h["blocked_slots"]}
    slots = [[c, r] for r in range(h["rows"]) for c in range(h["cols"]) if (c, r) not in blocked]
    rng.shuffle(slots)
    ids = inv["gpu_racks"] + inv["spine_racks"] + inv["storage_racks"]
    placements = {rid: slots[i] for i, rid in enumerate(ids)}
    gpus = list(inv["gpu_racks"])
    rng.shuffle(gpus)
    jobs, i = {}, 0
    for j, jd in spec["jobs"].items():
        jobs[j] = sorted(gpus[i:i + jd["racks"]])
        i += jd["racks"]
    cdus = sorted(spec["cdus"])
    liquid = {"default": {"dn": "DN32", "material": "copper", "cdu": cdus[0]}}
    for g in inv["gpu_racks"]:
        liquid[g] = {"cdu": rng.choice(cdus)}
    return {
        "placements": placements,
        "jobs": jobs,
        "network": {"spine_type": "packet", "leaf_module": "sr8"},
        "liquid": liquid,
        "containment": [False] * (max(h["hot_aisle_of_row"]) + 1),
        "setpoints": {"crah_supply_c": 18.0, "cdu_supply_c": 30.0},
    }


def legal_everywhere(spec, sub):
    errs, ctx = twin.validate(spec, sub)
    if errs:
        return False, errs
    for final in (False, True):
        r = twin.simulate(spec, ctx, final=final)
        if r["violations"]:
            return False, r["violations"]
    return True, []


def main():
    spec = twin.load_spec()
    rng = random.Random(SEED)
    for attempt in range(10000):
        sub = random_layout(spec, rng)
        ok, why = legal_everywhere(spec, sub)
        if ok:
            break
    else:
        raise SystemExit("no legal random layout found")
    errs, ctx = twin.validate(spec, sub)
    assert not errs, errs
    ref = {}
    for final in (False, True):
        r = twin.simulate(spec, ctx, final=final)
        assert not r["violations"], r["violations"]
        ref[r["mode"]] = {
            "annual_kwh_per_rack_hour": twin.annual_kwh_per_rack_hour(spec, r),
            "scenarios": {s: v["kwh_per_rack_hour"] for s, v in r["scenarios"].items()},
        }
    (HILL / "examples" / "baseline").mkdir(parents=True, exist_ok=True)
    (HILL / "examples" / "baseline" / "submission.json").write_text(json.dumps(sub, indent=1) + "\n")
    (HILL / "private").mkdir(exist_ok=True)
    (HILL / "private" / "reference.json").write_text(json.dumps(ref, indent=1) + "\n")
    print(f"attempt {attempt}: setpoints {sub['setpoints']}, capex ${ctx['capex_total']:,.0f}")
    print(json.dumps(ref, indent=1))


if __name__ == "__main__":
    main()
