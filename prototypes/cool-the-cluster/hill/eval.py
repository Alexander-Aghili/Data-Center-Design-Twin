"""Evaluator for cool-the-cluster.

The climber can read this file and twin.py. Everything the score depends on is in
challenge_spec.json; the only thing under private/ is the baseline's reference
energy that the score divides by, which is also printed in the README.

The submission is read as JSON data. No code from the submission is executed, and
no file other than submission.json is read.
"""

import hashlib
import importlib.util
import json
from pathlib import Path

HILL = Path(__file__).resolve().parent
MAX_BYTES = 1_000_000


def _load_twin():
    spec = importlib.util.spec_from_file_location("cool_the_cluster_twin", HILL / "twin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _fail(reason, config, **details):
    return {"passed": False, "metrics": [], "config": config,
            "details": {"error": reason, **details}}


def eval(submission: Path, *, final: bool = False) -> dict:
    submission = Path(submission)
    twin = _load_twin()
    mode = "final" if final else "validation"
    config = [
        {"name": "mode", "value": mode, "primary": True},
        {"name": "spec_sha256", "value": _sha(HILL / "challenge_spec.json"), "primary": True},
        {"name": "twin_sha256", "value": _sha(HILL / "twin.py"), "primary": True},
    ]

    path = submission / "submission.json"
    if not path.is_file():
        return _fail("submission must contain submission.json", config)
    if path.stat().st_size > MAX_BYTES:
        return _fail(f"submission.json is larger than {MAX_BYTES} bytes", config)
    try:
        sub = twin.parse_submission_text(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError) as e:
        return _fail(f"submission.json is not valid JSON: {e}", config)

    spec = twin.load_spec()
    errors, ctx = twin.validate(spec, sub)
    if errors:
        return _fail("illegal layout: " + errors[0], config, violations=errors[:25])

    sim = twin.simulate(spec, ctx, final=final)
    if sim["violations"]:
        return _fail("illegal operation: " + sim["violations"][0], config,
                     violations=sim["violations"], static=twin.details_static(ctx))

    ref = json.loads((HILL / "private" / "reference.json").read_text())[mode]
    annual = twin.annual_kwh_per_rack_hour(spec, sim)
    score = annual / ref["annual_kwh_per_rack_hour"]
    ratios = {s: v["kwh_per_rack_hour"] / ref["scenarios"][s] for s, v in sim["scenarios"].items()}
    worst_ratio = max(ratios.values())
    worst_inlet = max(v["worst_inlet_c"] for v in sim["scenarios"].values())

    per_scenario = {}
    for s, v in sim["scenarios"].items():
        per_scenario[s] = {
            "ratio_to_baseline": round(ratios[s], 6),
            "kwh_per_rack_hour": round(v["kwh_per_rack_hour"], 6),
            "pue": round(v["pue"], 5),
            "peak_facility_kw": round(v["peak_facility_kw"], 2),
            # Additive facility breakdown; network power is already inside "it", so it is
            # reported separately rather than as another term of the sum.
            "avg_kw": {k.replace("_kwh", ""): round(x / 24.0, 3)
                       for k, x in v["breakdown_kwh"].items() if k != "network_kwh"},
            "network_kw_within_it": round(v["breakdown_kwh"]["network_kwh"] / 24.0, 3),
            "worst_inlet_c": round(v["worst_inlet_c"], 3),
            "worst_inlet_rack": v["worst_inlet_rack"],
            "worst_junction_c": round(v["worst_junction_c"], 3),
            "min_job_speed": round(v["min_job_speed"], 5),
            "liquid_free_cooling_frac": round(v["liquid_free_cooling_frac"], 4),
            "job_step_time_s": {j: round(t, 6) for j, t in v["job_step_time_s"].items()},
            "setpoints": v["setpoints"],
        }

    return {
        "passed": True,
        "metrics": [
            {"name": "score", "value": score, "direction": "min"},
            {"name": "worst_scenario_ratio", "value": worst_ratio, "direction": "min"},
            {"name": "worst_inlet_c", "value": worst_inlet, "direction": "min"},
        ],
        "config": config,
        "details": {
            "annual_kwh_per_rack_hour": round(annual, 6),
            "reference_annual_kwh_per_rack_hour": round(ref["annual_kwh_per_rack_hour"], 6),
            "scenarios": per_scenario,
            "static": twin.details_static(ctx),
        },
    }
