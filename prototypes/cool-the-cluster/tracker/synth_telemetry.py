"""Generate 120 days of daily telemetry for the hall in hall_design.json.

Stands in for the real feeds (BMS/DCIM for cooling, CMIS/DDM for optics) until a
real hall is connected. Five faults are injected so the tracker has something to find.
The ground truth goes to telemetry/_injected_faults.json, which track.py never reads.

    python3 synth_telemetry.py
"""

import csv
import json
import math
import random

from hall import HERE, SPEC, branch_dp_kpa, load_design, season, snapshot

DAYS = 120
OUT = HERE / "telemetry"

FAULTS = {
    "cold_plate_fouling": {"rack": "G21", "start_day": 20, "per_day": 0.0022,
                           "why": "pex loop, oxygen ingress -> corrosion particulate on cold plates"},
    "pipe_scaling": {"rack": "G08", "start_day": 10, "roughness_m_per_day": 6.0e-6,
                     "why": "scale/biofilm in a branch -> rising pressure drop"},
    "laser_wear": {"rack": "G03", "spine": "N1", "lane": 5, "start_day": 40, "bias_ma_per_day": 0.045,
                   "why": "transmitter laser wearing out -> bias current climbs to hold power"},
    "dirty_connector": {"rack": "G19", "spine": "N0", "lane": 2, "day": 75, "rx_drop_db": 3.2,
                        "why": "connector contaminated during a re-patch"},
    "missing_blanking": {"rack": "S2", "start_day": 60, "recirc_scale": 3.5,
                         "why": "blanking panel removed during maintenance -> hot air recirculates"},
}


def main():
    sub, ctx = load_design()
    rng = random.Random(42)
    OUT.mkdir(exist_ok=True)
    sp = sub["setpoints"]
    modules = SPEC["network"]["modules"]
    optical = [g for g in ctx["gpu_ids"] if modules[ctx["leaf_mod"][g]]["optical"]]

    base_eps = {g: SPEC["pipes"]["materials"][ctx["branch"][g]["material"]]["roughness_new_m"] for g in ctx["gpu_ids"]}
    links = [(g, n, lane) for g in optical for n in ctx["spine_ids"] for lane in range(8)]
    bias0 = {l: 7.0 + rng.gauss(0, 0.25) for l in links}
    rx0 = {l: -2.0 + rng.gauss(0, 0.4) for l in links}

    with open(OUT / "cooling.csv", "w", newline="") as fc, open(OUT / "air.csv", "w", newline="") as fa, \
            open(OUT / "optics.csv", "w", newline="") as fo, open(OUT / "site.csv", "w", newline="") as fs:
        wc, wa, wo, ws = csv.writer(fc), csv.writer(fa), csv.writer(fo), csv.writer(fs)
        wc.writerow(["day", "rack", "util", "cdu_supply_c", "branch_dp_kpa", "gpu_power_w", "gpu_junction_c", "liquid_dt_k"])
        wa.writerow(["day", "rack", "crah_supply_c", "inlet_c"])
        wo.writerow(["day", "rack", "spine", "lane", "module_temp_c", "tx_bias_ma", "tx_power_dbm", "rx_power_dbm"])
        ws.writerow(["day", "outdoor_db_c", "outdoor_wb_c"])
        for day in range(DAYS):
            w = season(day)
            ws.writerow([day, round(w["db"], 2), round(w["wb"], 2)])
            util = {j: min(1.0, max(0.05, (0.93 if j != "serve" else 0.55) + rng.gauss(0, 0.02))) for j in ctx["job_racks"]}
            f = FAULTS["cold_plate_fouling"]
            foul = {g: 0.004 * day / DAYS for g in ctx["gpu_ids"]}  # everyone ages a little
            foul[f["rack"]] += max(0, day - f["start_day"]) * f["per_day"]
            m = FAULTS["missing_blanking"]
            rs = {m["rack"]: m["recirc_scale"]} if day >= m["start_day"] else {}
            snap = snapshot(ctx, util, sp["crah_supply_c"], sp["cdu_supply_c"], foul, rs)
            for g in ctx["gpu_ids"]:
                eps = base_eps[g]
                p = FAULTS["pipe_scaling"]
                if g == p["rack"]:
                    eps += max(0, day - p["start_day"]) * p["roughness_m_per_day"]
                s = snap[g]
                wc.writerow([day, g, round(util[ctx["rack_job"][g]], 4), sp["cdu_supply_c"],
                             round(branch_dp_kpa(ctx, g, eps) + rng.gauss(0, 0.6), 2),
                             round(s["gpu_power_w"] + rng.gauss(0, 4), 1),
                             round(s["gpu_junction_c"] + rng.gauss(0, 0.25), 2),
                             round(s["liq_dt_k"] + rng.gauss(0, 0.05), 3)])
            for i in ctx["all_ids"]:
                wa.writerow([day, i, sp["crah_supply_c"], round(snap[i]["inlet_c"] + rng.gauss(0, 0.12), 2)])
            for l in links:
                g, n, lane = l
                bias = bias0[l] + 0.002 * day
                rx = rx0[l]
                lw = FAULTS["laser_wear"]
                if (g, n, lane) == (lw["rack"], lw["spine"], lw["lane"]) and day >= lw["start_day"]:
                    bias += (day - lw["start_day"]) * lw["bias_ma_per_day"]
                dc = FAULTS["dirty_connector"]
                if (g, n, lane) == (dc["rack"], dc["spine"], dc["lane"]) and day >= dc["day"]:
                    rx -= dc["rx_drop_db"]
                wo.writerow([day, g, n, lane, round(48 + rng.gauss(0, 1.0), 1), round(bias + rng.gauss(0, 0.05), 3),
                             round(1.0 + rng.gauss(0, 0.05), 2), round(rx + rng.gauss(0, 0.08), 2)])
    (OUT / "_injected_faults.json").write_text(json.dumps(FAULTS, indent=1))
    print(f"wrote {DAYS} days for {len(ctx['all_ids'])} racks and {len(links)} optical lanes to {OUT.name}/")


if __name__ == "__main__":
    main()
