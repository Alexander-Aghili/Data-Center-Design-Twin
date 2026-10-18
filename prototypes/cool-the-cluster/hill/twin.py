"""cool-the-cluster digital twin.

A reduced-order model of one AI data hall, fast enough (well under a second per
scenario) for an agent to evaluate thousands of designs. Pure standard library.

Six coupled dimensions:
  1. rack layout      - which slot every rack sits in, which racks form a job
  2. heat and cooling - air recirculation, containment, CRAH fans, chillers, free cooling
  3. pipes            - liquid branch length, diameter, material, pressure drop, pumps, aging
  4. network gear     - spine type (packet / CPO / OCS), leaf module per rack, reach, optics power
  5. latency          - rack-to-rack latency from cable length, modules and switch hops
  6. work             - throttling and exposed communication turn into slower training steps

Every number this file uses comes from challenge_spec.json. Nothing is hidden.
"""

from __future__ import annotations

import json
import math
import random
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC_PATH = HERE / "challenge_spec.json"

TOP_LEVEL_KEYS = {
    "placements", "jobs", "network", "liquid", "containment",
    "setpoints", "setpoints_by_scenario",
}


def load_spec(path: Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def _reject_constant(name):
    raise ValueError(f"non-finite number {name} is not allowed")


def parse_submission_text(text: str) -> dict:
    return json.loads(text, parse_constant=_reject_constant)


def _key(v, table) -> bool:
    """True when v is a string naming an entry of table (never raises on unhashable v)."""
    return isinstance(v, str) and v in table


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


# --------------------------------------------------------------------------- geometry

def slot_xy(spec, col, row):
    h = spec["hall"]
    return (h["x_offset_m"] + h["slot_pitch_m"] * (col + 0.5), h["row_center_y_m"][row])


def cable_length(spec, a_xy, b_xy):
    h = spec["hall"]
    return abs(a_xy[0] - b_xy[0]) + abs(a_xy[1] - b_xy[1]) + h["cable_riser_m"] + h["cable_slack_m"]


def pipe_one_way(spec, rack_xy, cdu):
    return abs(rack_xy[0] - cdu["x_m"]) + abs(rack_xy[1] - cdu["y_m"]) + spec["hall"]["pipe_riser_m"]


def friction_factor(eps, d, re):
    if re < 2300.0:
        return 64.0 / max(re, 1e-9)
    return 0.25 / (math.log10(eps / (3.7 * d) + 5.74 / re ** 0.9)) ** 2


# --------------------------------------------------------------------------- validation

def validate(spec: dict, sub: dict):
    """Check every static constraint. Returns (errors, ctx). ctx is None if errors."""
    errs = []
    if not isinstance(sub, dict):
        return ["submission.json must be a JSON object"], None
    unknown = set(sub) - TOP_LEVEL_KEYS
    if unknown:
        errs.append(f"unknown top-level keys: {sorted(unknown)}")
    for k in ("placements", "jobs", "network", "liquid", "containment", "setpoints"):
        if k not in sub:
            errs.append(f"missing required key '{k}'")
    if errs:
        return errs, None

    hall = spec["hall"]
    inv = spec["inventory"]
    gpu_ids = list(inv["gpu_racks"])
    spine_ids = list(inv["spine_racks"])
    stor_ids = list(inv["storage_racks"])
    all_ids = gpu_ids + spine_ids + stor_ids
    blocked = {tuple(s) for s in hall["blocked_slots"]}

    # ---- placements
    pl = sub["placements"]
    pos = {}
    if not isinstance(pl, dict):
        errs.append("placements must be an object {rack_id: [col, row]}")
        pl = {}
    for rid in pl:
        if rid not in all_ids:
            errs.append(f"placements: unknown rack '{rid}'")
    used = {}
    for rid in all_ids:
        v = pl.get(rid)
        if v is None:
            errs.append(f"placements: rack '{rid}' is missing")
            continue
        if (not isinstance(v, list) or len(v) != 2
                or not all(isinstance(t, int) and not isinstance(t, bool) for t in v)):
            errs.append(f"placements: '{rid}' must be [col, row] integers, got {v!r}")
            continue
        c, r = v
        if not (0 <= c < hall["cols"] and 0 <= r < hall["rows"]):
            errs.append(f"placements: '{rid}' slot {v} is outside the {hall['cols']}x{hall['rows']} grid")
            continue
        if (c, r) in blocked:
            errs.append(f"placements: '{rid}' slot {v} is blocked")
            continue
        if (c, r) in used:
            errs.append(f"placements: '{rid}' and '{used[(c, r)]}' share slot {v}")
            continue
        used[(c, r)] = rid
        pos[rid] = (c, r)

    # ---- jobs
    jobs_in = sub["jobs"]
    job_racks = {}
    if not isinstance(jobs_in, dict):
        errs.append("jobs must be an object {job: [gpu rack ids]}")
        jobs_in = {}
    seen = {}
    for j in jobs_in:
        if j not in spec["jobs"]:
            errs.append(f"jobs: unknown job '{j}'")
    for j, jd in spec["jobs"].items():
        lst = jobs_in.get(j)
        if not isinstance(lst, list) or not all(isinstance(x, str) for x in lst):
            errs.append(f"jobs: '{j}' must be a list of GPU rack ids")
            continue
        if len(lst) != jd["racks"]:
            errs.append(f"jobs: '{j}' needs exactly {jd['racks']} racks, got {len(lst)}")
        for x in lst:
            if x not in gpu_ids:
                errs.append(f"jobs: '{j}' lists '{x}', which is not a GPU rack")
            elif x in seen:
                errs.append(f"jobs: '{x}' is in both '{seen[x]}' and '{j}'")
            else:
                seen[x] = j
        job_racks[j] = list(lst)
    for g in gpu_ids:
        if g not in seen and not any("jobs:" in e for e in errs):
            errs.append(f"jobs: GPU rack '{g}' is not assigned to any job")

    # ---- containment
    cont = sub["containment"]
    n_aisles = max(hall["hot_aisle_of_row"]) + 1
    if not (isinstance(cont, list) and len(cont) == n_aisles and all(isinstance(b, bool) for b in cont)):
        errs.append(f"containment must be a list of {n_aisles} booleans (one per hot aisle)")
        cont = [False] * n_aisles

    # ---- setpoints
    bounds = spec["setpoint_bounds"]

    def check_sp(sp, where, partial):
        if not isinstance(sp, dict):
            errs.append(f"{where} must be an object")
            return
        for k in sp:
            if k not in bounds:
                errs.append(f"{where}: unknown setpoint '{k}'")
        for k, (lo, hi) in bounds.items():
            if k not in sp:
                if not partial:
                    errs.append(f"{where}: missing '{k}'")
                continue
            v = sp[k]
            if not _num(v):
                errs.append(f"{where}.{k} must be a finite number")
            elif not (lo <= v <= hi):
                errs.append(f"{where}.{k}={v} outside [{lo}, {hi}]")

    check_sp(sub["setpoints"], "setpoints", partial=False)
    sbs = sub.get("setpoints_by_scenario", {})
    if not isinstance(sbs, dict):
        errs.append("setpoints_by_scenario must be an object")
        sbs = {}
    for sname, sp in sbs.items():
        if sname not in spec["scenarios"]:
            errs.append(f"setpoints_by_scenario: unknown scenario '{sname}'")
        else:
            check_sp(sp, f"setpoints_by_scenario.{sname}", partial=True)

    # ---- network
    net = sub["network"]
    nspec = spec["network"]
    modules = nspec["modules"]
    leaf_mod = {}
    spine_type = None
    if not isinstance(net, dict):
        errs.append("network must be an object")
        net = {}
    else:
        unknown = set(net) - {"spine_type", "leaf_module"}
        if unknown:
            errs.append(f"network: unknown keys {sorted(unknown)}")
    spine_type = net.get("spine_type")
    if not _key(spine_type, nspec["spine_types"]):
        errs.append(f"network.spine_type must be one of {sorted(nspec['spine_types'])}, got {spine_type!r}")
    lm = net.get("leaf_module")
    if isinstance(lm, str):
        lm = {"default": lm}
    if not isinstance(lm, dict):
        errs.append("network.leaf_module must be a module name or {\"default\": name, rack: name}")
        lm = {}
    for k in lm:
        if k != "default" and k not in gpu_ids:
            errs.append(f"network.leaf_module: unknown GPU rack '{k}'")
    for g in gpu_ids:
        m = lm.get(g, lm.get("default"))
        if not _key(m, modules):
            errs.append(f"network.leaf_module: '{g}' has no valid module (got {m!r}); options {sorted(modules)}")
        else:
            leaf_mod[g] = m

    # ---- liquid
    liq = sub["liquid"]
    pspec = spec["pipes"]
    branch = {}
    if not isinstance(liq, dict):
        errs.append("liquid must be an object")
        liq = {}
    for k in liq:
        if k != "default" and k not in gpu_ids:
            errs.append(f"liquid: unknown GPU rack '{k}'")
    default = liq.get("default", {})
    if not isinstance(default, dict):
        errs.append("liquid.default must be an object")
        default = {}
    for g in gpu_ids:
        over = liq.get(g, {})
        if not isinstance(over, dict):
            errs.append(f"liquid.{g} must be an object")
            continue
        b = dict(default)
        b.update(over)
        bad = set(b) - {"cdu", "dn", "material"}
        if bad:
            errs.append(f"liquid.{g}: unknown keys {sorted(bad)}")
        if not _key(b.get("cdu"), spec["cdus"]):
            errs.append(f"liquid.{g}.cdu must be one of {sorted(spec['cdus'])}")
        elif not _key(b.get("dn"), pspec["diameters"]):
            errs.append(f"liquid.{g}.dn must be one of {sorted(pspec['diameters'])}")
        elif not _key(b.get("material"), pspec["materials"]):
            errs.append(f"liquid.{g}.material must be one of {sorted(pspec['materials'])}")
        else:
            branch[g] = {"cdu": b["cdu"], "dn": b["dn"], "material": b["material"]}

    if errs:
        return errs, None

    # ===== derived geometry + physical constraints =====
    xy = {rid: slot_xy(spec, *pos[rid]) for rid in all_ids}
    st = nspec["spine_types"][spine_type]
    gr = spec["gpu_rack"]

    # links, reach, capex
    capex = {"containment": 0.0, "pipes": 0.0, "optics_and_cables": 0.0, "fiber": 0.0, "spine_premium": 0.0}
    capex["containment"] = sum(cont) * spec["air"]["containment_cost"]
    links = []  # (gpu, spine_rack, length, module)
    for g in gpu_ids:
        m = leaf_mod[g]
        md = modules[m]
        if st["requires_single_mode"] and not md["single_mode"]:
            errs.append(f"network: spine_type '{spine_type}' needs single-mode optics; '{g}' uses '{m}'")
            continue
        reach = md["reach_m"] * st["reach_factor"].get(m, 1.0) * md["aging_reach_factor"]
        for n in spine_ids:
            L = cable_length(spec, xy[g], xy[n])
            if L > reach + 1e-9:
                errs.append(f"network: link {g}->{n} is {L:.2f} m but '{m}' reaches {reach:.2f} m "
                            f"(after spine and 5-year aging derating)")
            for _ in range(gr["uplinks_per_spine_rack"]):
                links.append((g, n, L, m))
                if md["optical"]:
                    capex["optics_and_cables"] += md["cost_per_module"]
                    capex["fiber"] += md["fiber_cost_per_m"] * L
                    if st["spine_end"] == "mirror":
                        capex["optics_and_cables"] += md["cost_per_module"]
                    else:
                        capex["optics_and_cables"] += st["cost_per_port"]
                else:
                    capex["optics_and_cables"] += md["cost_per_link"]
    capex["spine_premium"] = st["premium_per_switch"] * st["switches_per_rack"] * len(spine_ids)

    # pipes
    cool = spec["coolant"]
    cdu_c = spec["cdu_common"]
    rho, mu = cool["rho"], cool["mu"]
    qv = gr["design_flow_kg_s"] / rho
    pipe_rows = {}
    for g in gpu_ids:
        b = branch[g]
        cdu = spec["cdus"][b["cdu"]]
        d = pspec["diameters"][b["dn"]]["id_m"]
        mat = pspec["materials"][b["material"]]
        L = 2.0 * pipe_one_way(spec, xy[g], cdu)
        area = math.pi * d * d / 4.0
        v = qv / area
        re = rho * v * d / mu
        dyn = rho * v * v / 2.0
        dp = {}
        for age, eps in (("new", mat["roughness_new_m"]), ("aged", mat["roughness_aged_m"])):
            f = friction_factor(eps, d, re)
            dp[age] = (f * (L / d) * dyn + cool["minor_loss_k"] * dyn) / 1000.0 + gr["manifold_dp_kpa"]
        if not (pspec["velocity_min_m_s"] <= v <= pspec["velocity_max_m_s"]):
            errs.append(f"liquid: branch {g} velocity {v:.2f} m/s outside "
                        f"[{pspec['velocity_min_m_s']}, {pspec['velocity_max_m_s']}] (pick another DN)")
        joints = 4 + int(L // 3.0)
        pipe_rows[g] = {"cdu": b["cdu"], "dn": b["dn"], "material": b["material"], "length_m": L,
                        "velocity_m_s": v, "reynolds": re, "dp_new_kpa": dp["new"], "dp_aged_kpa": dp["aged"],
                        "joints": joints, "leak_risk_per_yr": joints * mat["leak_risk_per_joint"]}
        capex["pipes"] += L * pspec["diameters"][b["dn"]]["cost_per_m"] * mat["cost_mult"]

    # design (u=1) power: row busways and CDU capacity
    def gpu_rack_design(m):
        p_gpu = gr["gpus"] * gr["gpu_tdp_w"]
        p_oh = gr["server_overhead_w"]
        optics = 2 * gr["uplinks_per_spine_rack"] * modules[m]["w_per_end"]
        p_liq = gr["liquid_capture_gpu"] * p_gpu + gr["liquid_capture_overhead"] * p_oh
        return p_gpu + p_oh + gr["leaf_switch_w"] + optics, p_liq

    spine_design = spine_rack_power(spec, st, links, spine_ids, modules)
    row_kw = [0.0] * hall["rows"]
    cdu_kw = {k: 0.0 for k in spec["cdus"]}
    for g in gpu_ids:
        it, pl_ = gpu_rack_design(leaf_mod[g])
        row_kw[pos[g][1]] += it / 1000.0
        cdu_kw[branch[g]["cdu"]] += pl_ / 1000.0
    for n in spine_ids:
        row_kw[pos[n][1]] += spine_design[n] / 1000.0
    for s in stor_ids:
        row_kw[pos[s][1]] += spec["storage_rack_w"] / 1000.0
    for r, kw in enumerate(row_kw):
        if kw > hall["row_busway_kw"] + 1e-9:
            errs.append(f"power: row {r} design load {kw:.1f} kW exceeds busway {hall['row_busway_kw']} kW")
    for k, kw in cdu_kw.items():
        if kw > spec["cdus"][k]["capacity_kw"] + 1e-9:
            errs.append(f"liquid: {k} design heat {kw:.1f} kW exceeds capacity {spec['cdus'][k]['capacity_kw']} kW")

    pumps = {}
    for age in ("new", "aged"):
        total_w = 0.0
        heads = {}
        for k in spec["cdus"]:
            mine = [g for g in gpu_ids if branch[g]["cdu"] == k]
            if not mine:
                heads[k] = 0.0
                continue
            head = max(pipe_rows[g][f"dp_{age}_kpa"] for g in mine) + cdu_c["internal_dp_kpa"]
            heads[k] = head
            total_w += len(mine) * qv * head * 1000.0 / cdu_c["pump_eff"]
            if age == "aged" and head > cdu_c["max_head_kpa"] + 1e-9:
                errs.append(f"liquid: {k} needs {head:.0f} kPa pump head with 5-year-aged pipes; "
                            f"max is {cdu_c['max_head_kpa']} kPa")
        pumps[age] = {"total_w": total_w, "head_kpa": heads}

    # latency
    def leg_latency(g, n, L):
        md = modules[leaf_mod[g]]
        if st["spine_end"] == "mirror":
            spine_end = md["latency_us"]
        else:
            spine_end = st["spine_end_latency_us"]
        return md["latency_us"] + spine_end + L * nspec["propagation_ns_per_m"] / 1000.0

    def pair_latency(a, b):
        tot = 0.0
        for n in spine_ids:
            tot += (2 * nspec["leaf_latency_us"] + st["latency_us"]
                    + leg_latency(a, n, cable_length(spec, xy[a], xy[n]))
                    + leg_latency(b, n, cable_length(spec, xy[b], xy[n])))
        return tot / len(spine_ids)

    job_latency = {}
    for j, racks in job_racks.items():
        lats = [pair_latency(a, b) for i, a in enumerate(racks) for b in racks[i + 1:]]
        job_latency[j] = {"max_us": max(lats), "mean_us": sum(lats) / len(lats)}
        sla = spec["jobs"][j].get("latency_sla_us")
        if sla is not None and job_latency[j]["max_us"] > sla + 1e-9:
            errs.append(f"latency: job '{j}' worst rack-to-rack latency {job_latency[j]['max_us']:.3f} us "
                        f"exceeds SLA {sla} us")

    capex_total = sum(capex.values())
    if capex_total > spec["budget_usd"] + 1e-6:
        errs.append(f"budget: capex ${capex_total:,.0f} exceeds ${spec['budget_usd']:,.0f} "
                    f"(breakdown {{{', '.join(f'{k}: {v:,.0f}' for k, v in capex.items())}}})")

    if errs:
        return errs, None

    ctx = {
        "pos": pos, "xy": xy, "job_racks": job_racks, "rack_job": seen, "containment": cont,
        "spine_type": spine_type, "leaf_mod": leaf_mod, "branch": branch, "links": links,
        "pipe_rows": pipe_rows, "pumps": pumps, "job_latency": job_latency,
        "capex": capex, "capex_total": capex_total, "row_design_kw": row_kw, "cdu_design_kw": cdu_kw,
        "setpoints": dict(sub["setpoints"]), "setpoints_by_scenario": sbs,
        "recirc": recirculation_matrix(spec, all_ids, pos, cont),
        "all_ids": all_ids, "gpu_ids": gpu_ids, "spine_ids": spine_ids, "stor_ids": stor_ids,
    }
    return [], ctx


def spine_rack_power(spec, st, links, spine_ids, modules):
    out = {}
    for n in spine_ids:
        p = st["switches_per_rack"] * st["body_w"]
        for (_, nn, _, m) in links:
            if nn != n:
                continue
            if st["spine_end"] == "mirror":
                p += modules[m]["w_per_end"]
            else:
                p += st.get("spine_end_w", 0.0)
        out[n] = p
    return out


def recirculation_matrix(spec, ids, pos, cont):
    """D[i][j] in kelvin of inlet rise at rack i per kW of air heat from rack j."""
    a = spec["air"]
    h = spec["hall"]
    aisle = h["hot_aisle_of_row"]
    xy = {r: slot_xy(spec, *pos[r]) for r in ids}
    D = {}
    for i in ids:
        ci, ri = pos[i]
        ai = aisle[ri]
        row = {}
        for j in ids:
            cj, rj = pos[j]
            aj = aisle[rj]
            if i == j:
                c = a["recirc_self_contained_k_per_kw"] if cont[ai] else a["recirc_self_k_per_kw"]
            elif ai == aj:
                c = a["recirc_same_aisle_k_per_kw"] * math.exp(-abs(xy[i][0] - xy[j][0]) / a["recirc_same_aisle_length_m"])
                if cont[ai]:
                    c *= a["containment_same_aisle_factor"]
            else:
                d = abs(xy[i][0] - xy[j][0]) + abs(xy[i][1] - xy[j][1])
                c = a["recirc_cross_k_per_kw"] * math.exp(-d / a["recirc_cross_length_m"])
                if cont[aj]:
                    c *= a["containment_cross_factor"]
            if ci in (0, h["cols"] - 1):
                c *= a["end_of_row_contained_factor"] if cont[ai] else a["end_of_row_factor"]
            row[j] = c
        D[i] = row
    return D


# --------------------------------------------------------------------------- scenario traces

def weather_at(w, hour):
    ph = math.cos(2.0 * math.pi * (hour - 15.0) / 24.0)
    return w["db_mean"] + w["db_amp"] * ph, w["wb_mean"] + w["wb_amp"] * ph


def util_at(spec, js, m0, step_min):
    if js["util"] == "training":
        dip = spec["checkpoint_dip"]
        period = dip["every_h"] * 60
        overlap = 0.0
        k0 = int(m0 // period)
        for k in (k0 - 1, k0, k0 + 1):
            a, b = k * period, k * period + dip["duration_min"]
            overlap += max(0.0, min(b, m0 + step_min) - max(a, m0))
        f = overlap / step_min
        return js["base"] * (1.0 - f) + dip["util"] * f
    hour = (m0 + step_min / 2.0) / 60.0
    return js["base"] + js["amp"] * math.sin(2.0 * math.pi * (hour - 8.0) / 24.0)


# --------------------------------------------------------------------------- physics per step

def _gpu_rack_state(spec, u, speed, cdu_supply, foul, leaf_w_per_end):
    gr = spec["gpu_rack"]
    p_each = gr["gpu_idle_w"] + (gr["gpu_tdp_w"] - gr["gpu_idle_w"]) * u * speed
    p_gpu = gr["gpus"] * p_each
    p_oh = gr["server_overhead_w"] * (gr["server_overhead_idle_frac"] + (1 - gr["server_overhead_idle_frac"]) * u * speed)
    p_liq = gr["liquid_capture_gpu"] * p_gpu + gr["liquid_capture_overhead"] * p_oh
    dT = p_liq / (gr["design_flow_kg_s"] * spec["coolant"]["cp"])
    tj = cdu_supply + 0.5 * dT + p_each * gr["cold_plate_r_k_per_w"] * foul
    optics = 2 * gr["uplinks_per_spine_rack"] * leaf_w_per_end
    p_air = (p_gpu - gr["liquid_capture_gpu"] * p_gpu) + (p_oh - gr["liquid_capture_overhead"] * p_oh) \
        + gr["leaf_switch_w"] + optics
    return {"it": p_gpu + p_oh + gr["leaf_switch_w"] + optics, "liq": p_liq, "air": p_air, "tj": tj,
            "network": gr["leaf_switch_w"] + optics}


def _throttle_speed(spec, u, cdu_supply, foul, w_end):
    gr = spec["gpu_rack"]

    def rule(tj):
        if tj <= gr["throttle_start_c"]:
            return 1.0
        return max(gr["min_speed"], 1.0 - gr["throttle_slope_per_k"] * (tj - gr["throttle_start_c"]))

    if rule(_gpu_rack_state(spec, u, 1.0, cdu_supply, foul, w_end)["tj"]) >= 1.0:
        return 1.0
    lo, hi = gr["min_speed"], 1.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if mid - rule(_gpu_rack_state(spec, u, mid, cdu_supply, foul, w_end)["tj"]) > 0:
            hi = mid
        else:
            lo = mid
    return lo


def _plant_chiller(spec, q_w, t_need, wb):
    p = spec["plant"]
    t_tower = wb + p["tower_approach_k"]
    margin = t_need - t_tower
    if margin >= p["free_cooling_full_margin_k"]:
        frac = 0.0
    elif margin <= -p["free_cooling_none_margin_k"]:
        frac = 1.0
    else:
        frac = (p["free_cooling_full_margin_k"] - margin) / (p["free_cooling_full_margin_k"] + p["free_cooling_none_margin_k"])
    t_evap = t_need - p["evap_approach_k"]
    t_cond = wb + p["tower_approach_k"] + p["condenser_lift_k"]
    cop = p["chiller_eta"] * (t_evap + 273.15) / max(0.5, t_cond - t_evap)
    cop = min(p["cop_max"], max(p["cop_min"], cop))
    return frac * q_w / cop, frac, cop


def _fouling(spec, ctx, g, aged, measured):
    if g in measured:
        return 1.0 + measured[g]
    if aged:
        return 1.0 + spec["pipes"]["materials"][ctx["branch"][g]["material"]]["cold_plate_fouling"]
    return 1.0


def simulate(spec: dict, ctx: dict, final: bool = False, state: dict | None = None,
             scenarios: list | None = None) -> dict:
    """Run the scenarios. The hill always calls this with state=None.

    state is the tracker's calibrated view of a real hall (see twin-tracker/): measured
    cold-plate fouling per GPU rack, and a recirculation multiplier per rack inlet
    (a missing blanking panel or a leaking containment door). When given, measured
    fouling replaces the scenario's generic 5-year aging.
    """
    state = state or {}
    meas_foul = state.get("fouling", {})
    recirc_scale = state.get("recirc_scale", {})
    mode = "final" if final else "validation"
    ts = spec["timesteps"][mode]
    step = ts["step_min"]
    n_steps = int(24 * 60 // step)
    strat = spec["air"]["top_of_rack_stratification"]
    gr = spec["gpu_rack"]
    air = spec["air"]
    plant = spec["plant"]
    nspec = spec["network"]
    st = nspec["spine_types"][ctx["spine_type"]]
    modules = nspec["modules"]
    spine_w = spine_rack_power(spec, st, ctx["links"], ctx["spine_ids"], modules)
    hall_len = spec["hall"]["hall_length_m"]
    aisle = spec["hall"]["hot_aisle_of_row"]

    results = {}
    violations = []
    for sname, sc in spec["scenarios"].items():
        if scenarios is not None and sname not in scenarios:
            continue
        sp = dict(ctx["setpoints"])
        sp.update(ctx["setpoints_by_scenario"].get(sname, {}))
        t_sa, t_cdu = sp["crah_supply_c"], sp["cdu_supply_c"]
        aged = sc["aged"]
        pump_w = ctx["pumps"]["aged" if aged else "new"]["total_w"]
        rng = random.Random(ts["seed"] * 1000003 + zlib.crc32(sname.encode()))

        acc = {k: 0.0 for k in ("energy_kwh", "work", "it_kwh", "chiller_air_kwh", "chiller_liq_kwh",
                                "fans_kwh", "pumps_kwh", "tower_kwh", "loss_kwh", "network_kwh", "lighting_kwh")}
        worst_inlet = -1e9
        worst_inlet_rack = None
        worst_tj = -1e9
        min_speed = 1.0
        throttled_steps = 0
        peak_kw = 0.0
        free_frac_liq = 0.0
        job_step = {j: 0.0 for j in ctx["job_racks"]}
        for k in range(n_steps):
            m0 = k * step
            hour = (m0 + step / 2.0) / 60.0
            db, wb = weather_at(sc["weather"], hour)
            dt_h = step / 60.0

            rack_air, rack_it = {}, {}
            p_liq_total = 0.0
            net_w = 0.0
            work = 0.0
            for j, racks in ctx["job_racks"].items():
                js = sc["jobs"][j]
                u = util_at(spec, js, m0, step)
                if ts["noise"] > 0:
                    u += ts["noise"] * (2.0 * rng.random() - 1.0)
                u = min(1.0, max(0.05, u))
                speeds = []
                for g in racks:
                    foul = _fouling(spec, ctx, g, aged, meas_foul)
                    speeds.append(_throttle_speed(spec, u, t_cdu, foul, modules[ctx["leaf_mod"][g]]["w_per_end"]))
                s_job = min(speeds)
                min_speed = min(min_speed, s_job)
                if s_job < 1.0:
                    throttled_steps += 1
                for g in racks:
                    foul = _fouling(spec, ctx, g, aged, meas_foul)
                    r = _gpu_rack_state(spec, u, s_job, t_cdu, foul, modules[ctx["leaf_mod"][g]]["w_per_end"])
                    rack_air[g], rack_it[g] = r["air"], r["it"]
                    p_liq_total += r["liq"]
                    net_w += r["network"]
                    if r["tj"] > worst_tj:
                        worst_tj = r["tj"]
                    if r["tj"] > gr["junction_limit_c"] + 1e-9 and len(violations) < 5:
                        violations.append(f"{sname}: GPU junction in {g} reaches {r['tj']:.1f} C at "
                                          f"{hour:.2f} h even after throttling (limit {gr['junction_limit_c']} C)")
                # work: synchronous job, exposed communication
                R = len(racks)
                lat = ctx["job_latency"][j]["max_us"] * 1e-6
                bw = nspec["rack_uplink_bytes_s"]
                if js["pattern"] == "all_to_all":
                    lat_steps, bw_frac = (R - 1), (R - 1) / R
                    if ctx["spine_type"] == "ocs":
                        bw *= st["all_to_all_bandwidth_factor"]
                        lat += st["all_to_all_extra_latency_us"] * 1e-6
                else:
                    lat_steps, bw_frac = 2 * (R - 1), 2 * (R - 1) / R
                t_comp = js["t_comp_s"] / s_job
                t_lat = js["n_latency"] * lat_steps * lat
                t_bw = bw_frac * js["bytes"] / bw
                exposed = t_lat + max(0.0, t_bw - js["overlap"] * t_comp)
                step_t = t_comp + exposed
                job_step[j] += step_t / n_steps
                work += R * u * js["t_comp_s"] / step_t

            for n in ctx["spine_ids"]:
                rack_air[n] = rack_it[n] = spine_w[n]
                net_w += spine_w[n]
            for s in ctx["stor_ids"]:
                rack_air[s] = rack_it[s] = spec["storage_rack_w"]

            # inlet temperatures
            D = ctx["recirc"]
            for i in ctx["all_ids"]:
                x = ctx["xy"][i][0]
                drift = air["supply_drift_k_per_m"] * min(x, hall_len - x)
                rise = recirc_scale.get(i, 1.0) * sum(D[i][j] * rack_air[j] / 1000.0 for j in ctx["all_ids"])
                t_in = t_sa + drift + strat * rise
                if t_in > worst_inlet:
                    worst_inlet, worst_inlet_rack = t_in, i
                if t_in > air["inlet_limit_c"] + 1e-9 and len(violations) < 5:
                    violations.append(f"{sname}: inlet of {i} reaches {t_in:.2f} C at {hour:.2f} h "
                                      f"(limit {air['inlet_limit_c']} C)")

            # air side
            q_air = sum(rack_air.values())
            q_cont = sum(rack_air[i] for i in ctx["all_ids"] if ctx["containment"][aisle[ctx["pos"][i][1]]])
            frac_c = q_cont / q_air if q_air > 0 else 0.0
            dT_crah = air["crah_dt_open_k"] + (air["crah_dt_contained_k"] - air["crah_dt_open_k"]) * frac_c
            flow = q_air / (air["rho_cp"] * dT_crah)
            spd = max(air["crah_min_speed"], flow / air["crah_units"] / air["crah_rated_flow_m3_s"])
            fans_w = air["crah_units"] * air["crah_rated_kw"] * 1000.0 * spd ** 3
            q_air_total = q_air + fans_w
            ch_air, _, _ = _plant_chiller(spec, q_air_total, t_sa - air["coil_approach_k"], wb)

            # liquid side
            q_liq = p_liq_total + pump_w
            ch_liq, frac_liq, _ = _plant_chiller(spec, q_liq, t_cdu - spec["cdu_common"]["hx_approach_k"], wb)
            free_frac_liq += (1.0 - frac_liq) / n_steps

            it = sum(rack_it.values())
            loss = it / (plant["ups_eff"] * plant["pdu_eff"]) - it
            tower = plant["tower_and_pumps_frac"] * (q_air_total + q_liq + ch_air + ch_liq)
            light = plant["lighting_kw"] * 1000.0
            fac = it + loss + fans_w + ch_air + ch_liq + tower + pump_w + light
            peak_kw = max(peak_kw, fac / 1000.0)

            for key, w in (("it_kwh", it), ("chiller_air_kwh", ch_air), ("chiller_liq_kwh", ch_liq),
                           ("fans_kwh", fans_w), ("pumps_kwh", pump_w), ("tower_kwh", tower),
                           ("loss_kwh", loss), ("network_kwh", net_w), ("lighting_kwh", light)):
                acc[key] += w / 1000.0 * dt_h
            acc["energy_kwh"] += fac / 1000.0 * dt_h
            acc["work"] += work * dt_h

        results[sname] = {
            "kwh_per_rack_hour": acc["energy_kwh"] / acc["work"],
            "energy_kwh": acc["energy_kwh"],
            "work_rack_hours": acc["work"],
            "pue": acc["energy_kwh"] / acc["it_kwh"],
            "peak_facility_kw": peak_kw,
            "breakdown_kwh": {k: v for k, v in acc.items() if k not in ("energy_kwh", "work")},
            "network_kw_avg": acc["network_kwh"] / 24.0,
            "worst_inlet_c": worst_inlet,
            "worst_inlet_rack": worst_inlet_rack,
            "worst_junction_c": worst_tj,
            "min_job_speed": min_speed,
            "throttled_job_steps": throttled_steps,
            "liquid_free_cooling_frac": free_frac_liq,
            "job_step_time_s": job_step,
            "setpoints": sp,
        }
    return {"mode": mode, "scenarios": results, "violations": violations}


def details_static(ctx: dict) -> dict:
    """The tracked asset view: everything derived from the layout alone."""
    return {
        "capex_usd": {k: round(v, 2) for k, v in ctx["capex"].items()},
        "capex_total_usd": round(ctx["capex_total"], 2),
        "row_design_kw": [round(v, 2) for v in ctx["row_design_kw"]],
        "cdu_design_kw": {k: round(v, 2) for k, v in ctx["cdu_design_kw"].items()},
        "job_latency_us": {j: {k: round(v, 4) for k, v in d.items()} for j, d in ctx["job_latency"].items()},
        "pumps": {age: {"total_kw": round(d["total_w"] / 1000.0, 3),
                        "head_kpa": {k: round(v, 1) for k, v in d["head_kpa"].items()}}
                  for age, d in ctx["pumps"].items()},
        "pipes": {g: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in row.items()}
                  for g, row in ctx["pipe_rows"].items()},
        "pipe_leak_risk_per_yr": round(sum(r["leak_risk_per_yr"] for r in ctx["pipe_rows"].values()), 4),
        "link_lengths_m": {"max": round(max(l[2] for l in ctx["links"]), 2),
                           "mean": round(sum(l[2] for l in ctx["links"]) / len(ctx["links"]), 2)},
    }


def annual_kwh_per_rack_hour(spec: dict, sim: dict) -> float:
    """Weighted year: sum(w * energy) / sum(w * work) over the scenarios."""
    e = sum(spec["scenarios"][s]["weight"] * v["energy_kwh"] for s, v in sim["scenarios"].items())
    w = sum(spec["scenarios"][s]["weight"] * v["work_rack_hours"] for s, v in sim["scenarios"].items())
    return e / w
