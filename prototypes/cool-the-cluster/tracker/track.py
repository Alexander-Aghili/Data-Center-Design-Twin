"""Track -> predict -> suggest, for the hall in hall_design.json.

Reads telemetry/*.csv (never the injected-fault file), calibrates the digital twin
to what the sensors say, projects it forward, and ranks fixes: first anything that clears
a limit violation, then by how soon something breaks, then by annual energy saved.

    python3 track.py            # writes tracker_report.md and tracker_state.json
"""

from __future__ import annotations

import copy
import csv
import json
from collections import defaultdict
from statistics import mean

from hall import HERE, SPEC, load_design, roughness_from_dp, snapshot, twin

TEL = HERE / "telemetry"
BASE_DAYS = 14          # first two weeks = commissioning baseline
RECENT_DAYS = 14        # "now" = mean of the last two weeks
TREND_DAYS = 30         # slope window
HORIZON_DAYS = [30, 90]

THROTTLE_C = SPEC["gpu_rack"]["throttle_start_c"]
BIAS_ALARM_RATIO = 1.25          # laser bias 25% over commissioning = wear-out alarm
RX_MIN_DBM = -7.5                # receiver margin floor
RX_STEP_DB = 2.0                 # sudden drop = connector event
DP_RISE_KPA = 3.0
INLET_RESID_K = 0.25


def read(name):
    with open(TEL / name) as f:
        return list(csv.DictReader(f))


def slope(xs, ys):
    mx, my = mean(xs), mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return 0.0 if den == 0 else sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def window(series, last_day, n):
    return [(d, v) for d, v in series if last_day - n < d <= last_day]


def annual_kwh(spec, ctx, state):
    """Annual facility kWh, kWh per rack-hour of work, and the sim. Rank fixes by the second:
    a throttled hall burns fewer kWh because it does less work."""
    sim = twin.simulate(spec, ctx, state=state)
    day = sum(spec["scenarios"][s]["weight"] * v["energy_kwh"] for s, v in sim["scenarios"].items())
    return day * 365.0, twin.annual_kwh_per_rack_hour(spec, sim), sim


def saved_mwh(kpr_before, kpr_after, sim_after, spec):
    """MWh/yr saved at equal output: (kWh per rack-hour drop) x annual rack-hours of work."""
    work_day = sum(spec["scenarios"][s]["weight"] * v["work_rack_hours"] for s, v in sim_after["scenarios"].items())
    return (kpr_before - kpr_after) * work_day * 365.0 / 1000.0


def main():
    sub, ctx = load_design()
    gr = SPEC["gpu_rack"]
    cooling, air, optics = read("cooling.csv"), read("air.csv"), read("optics.csv")
    last = max(int(r["day"]) for r in cooling)
    findings = []

    # ------------------------------------------------------------------ cold plates
    foul_series = defaultdict(list)
    util_by_day = defaultdict(dict)
    for r in cooling:
        d, g = int(r["day"]), r["rack"]
        p_each = float(r["gpu_power_w"])
        t_cool = float(r["cdu_supply_c"]) + 0.5 * float(r["liquid_dt_k"])
        f = (float(r["gpu_junction_c"]) - t_cool) / (p_each * gr["cold_plate_r_k_per_w"]) - 1.0
        foul_series[g].append((d, f))
        util_by_day[d][ctx["rack_job"][g]] = float(r["util"])
    sp_summer = dict(sub["setpoints"])
    sp_summer.update(sub.get("setpoints_by_scenario", {}).get("summer_training", {}))
    p_full = gr["gpu_idle_w"] + (gr["gpu_tdp_w"] - gr["gpu_idle_w"]) * 0.95
    full = twin._gpu_rack_state(SPEC, 0.95, 1.0, sp_summer["cdu_supply_c"], 1.0, 8.0)
    dT_full = full["liq"] / (gr["design_flow_kg_s"] * SPEC["coolant"]["cp"])
    f_max = (THROTTLE_C - sp_summer["cdu_supply_c"] - 0.5 * dT_full) / (p_full * gr["cold_plate_r_k_per_w"]) - 1.0
    fouling_now, fouling_slope = {}, {}
    for g, ser in foul_series.items():
        base = mean(v for d, v in ser if d < BASE_DAYS)
        now = mean(v for d, v in window(ser, last, RECENT_DAYS))
        tr = window(ser, last, TREND_DAYS)
        sl = slope([d for d, _ in tr], [v for _, v in tr])
        fouling_now[g] = max(0.0, now - base)
        fouling_slope[g] = max(0.0, sl)
        tj_recent = max(float(r["gpu_junction_c"]) for r in cooling if r["rack"] == g and int(r["day"]) > last - 7)
        if fouling_now[g] > 0.05 or tj_recent > THROTTLE_C:
            days = (f_max - fouling_now[g]) / fouling_slope[g] if fouling_slope[g] > 1e-6 else None
            findings.append({
                "kind": "cold_plate_fouling", "asset": g, "severity": "high" if tj_recent > THROTTLE_C else "medium",
                "evidence": f"cold-plate resistance +{fouling_now[g]*100:.0f}% vs commissioning, rising "
                            f"{fouling_slope[g]*100*30:.1f}%/month; junction peaked {tj_recent:.1f} C last week",
                "prediction": ("throttling now (junction over 87 C)" if tj_recent > THROTTLE_C else
                               f"summer-peak throttling in ~{days:.0f} days" if days is not None and days > 0 else
                               "throttles at summer peak already"),
                "material": ctx["branch"][g]["material"],
            })

    # ------------------------------------------------------------------ pipes
    dp_series = defaultdict(list)
    for r in cooling:
        dp_series[r["rack"]].append((int(r["day"]), float(r["branch_dp_kpa"])))
    head_limit = SPEC["cdu_common"]["max_head_kpa"] - SPEC["cdu_common"]["internal_dp_kpa"]
    for g, ser in dp_series.items():
        base = mean(v for d, v in ser if d < BASE_DAYS)
        now = mean(v for d, v in window(ser, last, RECENT_DAYS))
        tr = window(ser, last, TREND_DAYS)
        sl = slope([d for d, _ in tr], [v for _, v in tr])
        if now - base > DP_RISE_KPA:
            eps = roughness_from_dp(ctx, g, now)
            mat = SPEC["pipes"]["materials"][ctx["branch"][g]["material"]]
            days = (head_limit - now) / sl if sl > 1e-6 else None
            findings.append({
                "kind": "pipe_scaling", "asset": g, "severity": "medium",
                "evidence": f"branch dP {base:.1f} -> {now:.1f} kPa (+{sl*30:.2f} kPa/month); inferred roughness "
                            f"{eps*1e6:.0f} um vs {mat['roughness_new_m']*1e6:.1f} um new / "
                            f"{mat['roughness_aged_m']*1e6:.0f} um 5-yr spec",
                "prediction": (f"{ctx['branch'][g]['cdu']} hits its {SPEC['cdu_common']['max_head_kpa']:.0f} kPa pump-head "
                               f"limit in ~{days:.0f} days" if days else "stable"),
            })

    # ------------------------------------------------------------------ optics
    lanes = defaultdict(list)
    for r in optics:
        lanes[(r["rack"], r["spine"], int(r["lane"]))].append(
            (int(r["day"]), float(r["tx_bias_ma"]), float(r["rx_power_dbm"])))
    for key, ser in lanes.items():
        b0 = mean(b for d, b, _ in ser if d < BASE_DAYS)
        r0 = mean(x for d, _, x in ser if d < BASE_DAYS)
        rec = [(d, b, x) for d, b, x in ser if d > last - RECENT_DAYS]
        b_now, r_now = mean(b for _, b, _ in rec), mean(x for _, _, x in rec)
        tr = [(d, b) for d, b, _ in ser if d > last - TREND_DAYS]
        sl = slope([d for d, _ in tr], [b for _, b in tr])
        name = f"{key[0]}->{key[1]} lane {key[2]}"
        if b_now / b0 > BIAS_ALARM_RATIO or (sl > 0 and (b0 * BIAS_ALARM_RATIO - b_now) / sl < 60):
            days = max(0.0, (b0 * BIAS_ALARM_RATIO - b_now) / sl) if sl > 1e-6 else 0.0
            findings.append({
                "kind": "laser_wear", "asset": name, "severity": "high" if days < 14 else "medium",
                "evidence": f"Tx bias {b0:.2f} -> {b_now:.2f} mA (+{sl*30:.2f} mA/month)",
                "prediction": "past wear-out alarm now" if days == 0 else f"crosses the +25% wear-out alarm in ~{days:.0f} days",
            })
        if r_now - r0 < -RX_STEP_DB or r_now < RX_MIN_DBM:
            step_day = next((d for d, _, x in ser if x < r0 - RX_STEP_DB), None)
            findings.append({
                "kind": "dirty_connector", "asset": name, "severity": "medium",
                "evidence": f"Rx power {r0:.1f} -> {r_now:.1f} dBm, step change on day {step_day}",
                "prediction": "link margin cut; errors and flaps likely as optics age",
            })

    # ------------------------------------------------------------------ air recirculation
    inlet = defaultdict(list)
    for r in air:
        inlet[r["rack"]].append((int(r["day"]), float(r["inlet_c"])))
    sp = sub["setpoints"]
    model = {}
    for d in range(last + 1):
        model[d] = snapshot(ctx, util_by_day[d], sp["crah_supply_c"], sp["cdu_supply_c"],
                            {g: max(0.0, v) for g, v in ((g, dict(s).get(d, 0.0)) for g, s in foul_series.items())})
    recirc_scale = {}
    for i, ser in inlet.items():
        res = [(d, v - model[d][i]["inlet_c"]) for d, v in ser]
        base = mean(v for d, v in res if d < BASE_DAYS)
        now = mean(v for d, v in window(res, last, RECENT_DAYS))
        if now - base > INLET_RESID_K:
            rise = mean(model[d][i]["inlet_model_rise_k"] for d, _ in window(res, last, RECENT_DAYS))
            k = 1.0 + (now - base) / rise
            recirc_scale[i] = k
            jump = next((d for d, v in res if v - base > INLET_RESID_K * 1.5), None)
            findings.append({
                "kind": "recirculation", "asset": i, "severity": "medium",
                "evidence": f"inlet runs {now - base:+.2f} K over the twin since ~day {jump}; recirculation x{k:.1f}",
                "prediction": "check blanking panels / containment door on this rack",
            })

    # ------------------------------------------------------------------ calibrated twin: predict
    state_now = {"fouling": fouling_now, "recirc_scale": recirc_scale}
    nominal = {"fouling": {g: 0.0 for g in ctx["gpu_ids"]}, "recirc_scale": {}}
    preds = []
    for label, st in [("as designed", nominal), ("today (calibrated)", state_now)] + [
            (f"+{h} days", {"fouling": {g: fouling_now[g] + fouling_slope[g] * h for g in ctx["gpu_ids"]},
                            "recirc_scale": recirc_scale}) for h in HORIZON_DAYS]:
        kwh, kpr, sim = annual_kwh(SPEC, ctx, st)
        s = sim["scenarios"]["summer_training"]
        preds.append({"when": label, "annual_mwh": kwh / 1000.0, "kwh_per_rack_hour": kpr,
                      "summer_min_job_speed": s["min_job_speed"], "summer_worst_junction_c": s["worst_junction_c"],
                      "summer_worst_inlet_c": s["worst_inlet_c"], "violations": sim["violations"][:2]})

    # ------------------------------------------------------------------ suggest
    base_kwh, base_kpr, _ = annual_kwh(SPEC, ctx, state_now)
    actions = []
    fouled = [f["asset"] for f in findings if f["kind"] == "cold_plate_fouling"]
    if fouled:
        st = copy.deepcopy(state_now)
        for g in fouled:
            st["fouling"][g] = 0.0
        _, kpr, sim = annual_kwh(SPEC, ctx, st)
        actions.append({"action": f"Flush loop + clean cold plates on {', '.join(fouled)}; "
                                  f"move {'/'.join(sorted({ctx['branch'][g]['material'] for g in fouled}))} branches to stainless at next window",
                        "saves_mwh_yr": saved_mwh(base_kpr, kpr, sim, SPEC), "urgency": "now"})
        # stop-gap: colder summer coolant until the flush happens
        best = None
        for drop in [x * 0.5 for x in range(1, 17)]:
            sub2 = copy.deepcopy(sub)
            sbs = sub2.setdefault("setpoints_by_scenario", {})
            for sc in ("summer_training", "aged_5yr_summer", "moe_all_to_all"):
                cur = sbs.get(sc, {}).get("cdu_supply_c", sub["setpoints"]["cdu_supply_c"])
                sbs.setdefault(sc, {})["cdu_supply_c"] = cur - drop
            e2, ctx2 = twin.validate(SPEC, sub2)
            if e2:
                break
            _, kpr, sim = annual_kwh(SPEC, ctx2, state_now)
            if any("junction" in v for v in sim["violations"]):
                continue
            if best is None or kpr < best[1]:
                best = (drop, kpr, sim)
        if best and best[1] < base_kpr:
            actions.append({"action": f"Stop-gap until the flush: run warm-season coolant {best[0]:.1f} C colder "
                                      f"(setpoints_by_scenario) so fouled racks stop throttling",
                            "saves_mwh_yr": saved_mwh(base_kpr, best[1], best[2], SPEC), "urgency": "this week"})
    if recirc_scale:
        st = copy.deepcopy(state_now)
        st["recirc_scale"] = {}
        _, kpr, sim_fix = annual_kwh(SPEC, ctx, st)
        _, _, sim_now = annual_kwh(SPEC, ctx, state_now)
        actions.append({"action": f"Re-install blanking panels / fix containment at {', '.join(recirc_scale)}",
                        "saves_mwh_yr": saved_mwh(base_kpr, kpr, sim_fix, SPEC),
                        "urgency": "now" if sim_now["violations"] else "next walk-through",
                        "clears_violation": bool(sim_now["violations"]) and not sim_fix["violations"],
                        "note": (sim_now["violations"][0] if sim_now["violations"] else "restores inlet margin")})
    for f in findings:
        if f["kind"] == "pipe_scaling":
            actions.append({"action": f"Descale / chemically treat branch {f['asset']}; add a strainer and water-quality sampling",
                            "saves_mwh_yr": 0.0, "urgency": "before " + f["prediction"].split("in ~")[-1] if "in ~" in f["prediction"] else "monitor"})
        if f["kind"] == "laser_wear":
            actions.append({"action": f"Replace transceiver {f['asset']} (pre-emptive)", "saves_mwh_yr": 0.0,
                            "urgency": f["prediction"]})
        if f["kind"] == "dirty_connector":
            actions.append({"action": f"Inspect and clean connector on {f['asset']}", "saves_mwh_yr": 0.0,
                            "urgency": "next walk-through"})
    # Safety and reliability first: a fix that clears a limit violation, then anything due now
    # (including parts past a failure alarm), then by schedule; energy saved breaks ties.
    actions.sort(key=lambda a: (not a.get("clears_violation", False), urgency_tier(a["urgency"]),
                                -a["saves_mwh_yr"]))

    state = {"as_of_day": last, "fouling": {g: round(v, 4) for g, v in fouling_now.items()},
             "fouling_per_day": {g: round(v, 6) for g, v in fouling_slope.items()},
             "recirc_scale": {k: round(v, 3) for k, v in recirc_scale.items()},
             "findings": findings, "predictions": preds, "actions": actions}
    (HERE / "tracker_state.json").write_text(json.dumps(state, indent=1))
    write_report(state, base_kwh, base_kpr)
    print(f"{len(findings)} findings, {len(actions)} actions -> tracker_report.md")


def urgency_tier(urgency: str) -> int:
    """0 = act now, 1 = this week, 2 = before a forecast date, 3 = next walk-through, 4 = monitor."""
    u = urgency.lower()
    if "now" in u or "past" in u:
        return 0
    if "this week" in u:
        return 1
    if u.startswith("before"):
        return 2
    if "walk-through" in u:
        return 3
    return 4


def write_report(state, base_kwh, base_kpr):
    L = [f"# Hall tracker report: day {state['as_of_day']}", ""]
    L += ["## Findings (tracked)", "", "| kind | asset | severity | evidence | prediction |", "|---|---|---|---|---|"]
    for f in state["findings"]:
        L.append(f"| {f['kind']} | {f['asset']} | {f['severity']} | {f['evidence']} | {f['prediction']} |")
    L += ["", "## Twin prediction (calibrated to telemetry)", "",
          "| when | annual MWh | kWh per rack-hour | summer min job speed | summer worst GPU °C | summer worst inlet °C | violation |",
          "|---|---|---|---|---|---|---|"]
    for p in state["predictions"]:
        L.append(f"| {p['when']} | {p['annual_mwh']:,.0f} | {p['kwh_per_rack_hour']:.3f} | {p['summer_min_job_speed']:.3f} | "
                 f"{p['summer_worst_junction_c']:.1f} | {p['summer_worst_inlet_c']:.2f} | {(p['violations'] or ['—'])[0]} |")
    L += ["", "## Suggested changes (ranked by urgency, then MWh/yr saved at equal output)", "",
          "| # | action | saves MWh/yr | urgency | note |", "|---|---|---|---|---|"]
    for i, a in enumerate(state["actions"], 1):
        L.append(f"| {i} | {a['action']} | {a['saves_mwh_yr']:.1f} | {a['urgency']} | {a.get('note', '')} |")
    (HERE / "tracker_report.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
