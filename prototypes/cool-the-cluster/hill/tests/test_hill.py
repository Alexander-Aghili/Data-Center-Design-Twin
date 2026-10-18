"""Checks on the hill itself, run by `hills check`.

The baseline must score exactly 1.0 in both modes, a sensible engineering change
must beat it, and every class of illegal design must be rejected with a clear
reason instead of a traceback.
"""

import copy
import json
from pathlib import Path

import pytest

HILL = Path(__file__).resolve().parents[1]

try:
    from hills import run_evaluator
except ImportError:  # plain `pytest` without the AutoLab CLI: call eval.py directly
    import importlib.util

    def run_evaluator(hill, submission, final=False):
        spec = importlib.util.spec_from_file_location("cool_the_cluster_eval", Path(hill) / "eval.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.eval(Path(submission), final=final)
BASELINE = HILL / "examples" / "baseline"


def base():
    return json.loads((BASELINE / "submission.json").read_text())


def run(tmp_path, sub, final=False, raw=None):
    d = tmp_path / "sub"
    d.mkdir(exist_ok=True)
    (d / "submission.json").write_text(raw if raw is not None else json.dumps(sub))
    return run_evaluator(HILL, d, final=final)


def assert_rejected(result, needle):
    assert not result["passed"], result
    reasons = [result["details"]["error"]] + result["details"].get("violations", [])
    assert any(needle in r for r in reasons), reasons


@pytest.mark.parametrize("final", [False, True])
def test_baseline_scores_one(final):
    r = run_evaluator(HILL, BASELINE, final=final)
    assert r["passed"], r["details"]
    assert [m["name"] for m in r["metrics"]] == ["score", "worst_scenario_ratio", "worst_inlet_c"]
    assert r["metrics"][0]["value"] == pytest.approx(1.0, abs=1e-12)
    assert r["metrics"][1]["value"] == pytest.approx(1.0, abs=1e-12)


def test_engineering_improvement_beats_baseline(tmp_path):
    sub = base()
    sub["containment"] = [True, True, True]
    sub["setpoints"] = {"crah_supply_c": 22.0, "cdu_supply_c": 34.0}
    for final in (False, True):
        r = run(tmp_path, sub, final=final)
        assert r["passed"], r["details"]
        assert r["metrics"][0]["value"] < 0.99


def test_deterministic(tmp_path):
    a = run_evaluator(HILL, BASELINE, final=True)
    b = run_evaluator(HILL, BASELINE, final=True)
    assert a["metrics"] == b["metrics"]


def test_missing_file_rejected(tmp_path):
    assert_rejected(run_evaluator(HILL, tmp_path), "submission.json")


def test_bad_json_and_nan_rejected(tmp_path):
    assert_rejected(run(tmp_path, None, raw="{not json"), "not valid JSON")
    text = json.dumps(base()).replace('"crah_supply_c": 18.0', '"crah_supply_c": NaN')
    assert_rejected(run(tmp_path, None, raw=text), "not valid JSON")


def test_unknown_key_rejected(tmp_path):
    sub = base()
    sub["score"] = 0.1
    assert_rejected(run(tmp_path, sub), "unknown top-level keys")


def test_shared_slot_rejected(tmp_path):
    sub = base()
    sub["placements"]["G01"] = list(sub["placements"]["G00"])
    assert_rejected(run(tmp_path, sub), "share slot")


def test_blocked_slot_rejected(tmp_path):
    sub = base()
    sub["placements"]["G00"] = [6, 2]
    assert_rejected(run(tmp_path, sub), "blocked")


def test_missing_rack_rejected(tmp_path):
    sub = base()
    del sub["placements"]["S3"]
    assert_rejected(run(tmp_path, sub), "missing")


def test_job_sizes_enforced(tmp_path):
    sub = base()
    moved = sub["jobs"]["train_a"].pop()
    sub["jobs"]["train_b"].append(moved)
    assert_rejected(run(tmp_path, sub), "exactly")


def test_copper_reach_enforced(tmp_path):
    sub = base()
    sub["network"]["leaf_module"] = "dac"
    assert_rejected(run(tmp_path, sub), "reaches")


def test_cpo_needs_single_mode(tmp_path):
    sub = base()
    sub["network"]["spine_type"] = "packet_cpo"
    assert_rejected(run(tmp_path, sub), "single-mode")


def test_budget_enforced(tmp_path):
    sub = base()
    sub["network"] = {"spine_type": "ocs", "leaf_module": "dr8"}
    sub["containment"] = [True, True, True]
    assert_rejected(run(tmp_path, sub), "budget")


def test_pipe_velocity_enforced(tmp_path):
    sub = base()
    sub["liquid"]["default"]["dn"] = "DN40"
    sub["liquid"]["G00"] = {"cdu": sub["liquid"]["G00"]["cdu"], "dn": "DN25", "material": "copper"}
    r = run(tmp_path, sub)
    assert r["passed"], r["details"]  # DN25 and DN40 both sit inside 0.5-2.0 m/s
    sub["liquid"]["default"]["dn"] = "DN99"
    assert_rejected(run(tmp_path, sub), "dn must be one of")


def test_pump_head_enforced(tmp_path):
    # The baseline's random CDU assignment has long runs; shrinking every branch to
    # DN25 pushes the worst branch past the 185 kPa aged-pipe head limit.
    sub = base()
    sub["liquid"]["default"]["dn"] = "DN25"
    assert_rejected(run(tmp_path, sub), "pump head")


def test_setpoint_bounds_enforced(tmp_path):
    sub = base()
    sub["setpoints"]["cdu_supply_c"] = 60.0
    assert_rejected(run(tmp_path, sub), "outside")


def test_hot_inlet_rejected(tmp_path):
    sub = base()
    sub["setpoints"]["crah_supply_c"] = 27.0
    assert_rejected(run(tmp_path, sub), "inlet")


def test_seasonal_override_applies(tmp_path):
    sub = base()
    sub["setpoints_by_scenario"] = {"summer_training": {"crah_supply_c": 27.0}}
    assert_rejected(run(tmp_path, sub), "summer_training: inlet")


def test_details_carry_tracked_views(tmp_path):
    r = run_evaluator(HILL, BASELINE)
    d = r["details"]
    assert set(d["scenarios"]) == {"summer_training", "winter_training", "inference_peak",
                                   "moe_all_to_all", "aged_5yr_summer"}
    st = d["static"]
    for key in ("capex_usd", "job_latency_us", "pumps", "pipes", "row_design_kw", "link_lengths_m"):
        assert key in st
    assert st["job_latency_us"]["serve"]["max_us"] <= 1.95


def test_power_breakdown_is_additive():
    """avg_kw terms sum to facility power; network power is inside IT, reported on its own."""
    sc = run_evaluator(HILL, BASELINE)["details"]["scenarios"]["summer_training"]
    assert "network" not in sc["avg_kw"]
    assert 0 < sc["network_kw_within_it"] < sc["avg_kw"]["it"]
    assert sum(sc["avg_kw"].values()) / sc["avg_kw"]["it"] == pytest.approx(sc["pue"], rel=1e-3)


def test_garbage_values_never_crash(tmp_path):
    """Type-garbage anywhere in the submission is rejected, never a traceback."""
    import random

    junk = [None, True, 1, -1, 1.5, "x", [], [1], {}, {"a": 1}, [[1, 2]], "G00", 1e308]

    def paths(o, p=()):
        yield p
        if isinstance(o, dict):
            for k, v in o.items():
                yield from paths(v, p + (k,))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                yield from paths(v, p + (i,))

    b = base()
    every = [p for p in paths(b) if p]
    rng = random.Random(0)
    for _ in range(150):
        s = copy.deepcopy(b)
        p = rng.choice(every)
        o = s
        for k in p[:-1]:
            o = o[k]
        o[p[-1]] = rng.choice(junk)
        r = run(tmp_path, s)
        assert isinstance(r["passed"], bool)
