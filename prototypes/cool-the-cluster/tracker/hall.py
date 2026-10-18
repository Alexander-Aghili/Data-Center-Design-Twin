"""Shared helpers: load the cool-the-cluster twin and evaluate one instant of the hall.

The hill's twin answers "what does a design cost over a scenario". The tracker also
needs "what should each sensor read right now", per rack, so it can compare a reading
against the model. snapshot() gives that, from the same physics.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The hill lives next to this folder in the repo (../hill); in an AutoLab workspace it is
# registered under .autolab/hills/cool-the-cluster.
HILL = next((p for p in (HERE.parent / "hill", HERE.parent / ".autolab" / "hills" / "cool-the-cluster")
             if (p / "twin.py").is_file()), HERE.parent / "hill")


def load_twin():
    spec = importlib.util.spec_from_file_location("ctc_twin", HILL / "twin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


twin = load_twin()
SPEC = twin.load_spec()


def load_design(path=HERE / "hall_design.json"):
    sub = json.loads(Path(path).read_text())
    errs, ctx = twin.validate(SPEC, sub)
    if errs:
        raise SystemExit("design is not legal:\n  " + "\n  ".join(errs))
    return sub, ctx


def branch_dp_kpa(ctx, g, roughness_m):
    """Pressure drop of one GPU rack's liquid branch at design flow, for a given roughness."""
    gr, cool = SPEC["gpu_rack"], SPEC["coolant"]
    row = ctx["pipe_rows"][g]
    d = SPEC["pipes"]["diameters"][row["dn"]]["id_m"]
    v = gr["design_flow_kg_s"] / cool["rho"] / (math.pi * d * d / 4.0)
    re = cool["rho"] * v * d / cool["mu"]
    dyn = cool["rho"] * v * v / 2.0
    f = twin.friction_factor(roughness_m, d, re)
    return (f * row["length_m"] / d * dyn + cool["minor_loss_k"] * dyn) / 1000.0 + gr["manifold_dp_kpa"]


def roughness_from_dp(ctx, g, dp_kpa):
    """Invert branch_dp_kpa for roughness (bisection on a monotone function)."""
    lo, hi = 1e-8, 5e-3
    if dp_kpa <= branch_dp_kpa(ctx, g, lo):
        return lo
    for _ in range(60):
        mid = math.sqrt(lo * hi)
        if branch_dp_kpa(ctx, g, mid) < dp_kpa:
            lo = mid
        else:
            hi = mid
    return math.sqrt(lo * hi)


def snapshot(ctx, util, t_sa, t_cdu, fouling=None, recirc_scale=None):
    """Per-rack readings at one instant: GPU power/junction, liquid dT, inlet temperature."""
    fouling = fouling or {}
    recirc_scale = recirc_scale or {}
    modules = SPEC["network"]["modules"]
    st = SPEC["network"]["spine_types"][ctx["spine_type"]]
    spine_w = twin.spine_rack_power(SPEC, st, ctx["links"], ctx["spine_ids"], modules)
    gr = SPEC["gpu_rack"]
    out, air = {}, {}
    for j, racks in ctx["job_racks"].items():
        for g in racks:
            r = twin._gpu_rack_state(SPEC, util[j], 1.0, t_cdu, 1.0 + fouling.get(g, 0.0),
                                     modules[ctx["leaf_mod"][g]]["w_per_end"])
            p_each = gr["gpu_idle_w"] + (gr["gpu_tdp_w"] - gr["gpu_idle_w"]) * util[j]
            out[g] = {"gpu_power_w": p_each, "gpu_junction_c": r["tj"], "liq_w": r["liq"],
                      "liq_dt_k": r["liq"] / (gr["design_flow_kg_s"] * SPEC["coolant"]["cp"])}
            air[g] = r["air"]
    for n in ctx["spine_ids"]:
        air[n] = spine_w[n]
    for s in ctx["stor_ids"]:
        air[s] = SPEC["storage_rack_w"]
    hall_len = SPEC["hall"]["hall_length_m"]
    strat = SPEC["air"]["top_of_rack_stratification"]
    for i in ctx["all_ids"]:
        x = ctx["xy"][i][0]
        drift = SPEC["air"]["supply_drift_k_per_m"] * min(x, hall_len - x)
        rise = sum(ctx["recirc"][i][k] * air[k] / 1000.0 for k in ctx["all_ids"])
        out.setdefault(i, {})
        out[i]["inlet_model_rise_k"] = strat * rise
        out[i]["inlet_c"] = t_sa + drift + strat * rise * recirc_scale.get(i, 1.0)
    return out


def season(day):
    """Day 0 = 1 April, day 120 = 30 July: wet bulb climbs from spring to summer."""
    frac = min(1.0, day / 120.0)
    return {"db": 16.0 + 16.0 * frac, "wb": 10.0 + 13.0 * frac}
