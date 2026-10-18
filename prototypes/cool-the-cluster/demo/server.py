"""Local demo for cool-the-cluster: score a design, watch an agent search, track a running hall.

    python3 demo/server.py            # then open http://localhost:8000
    python3 demo/server.py --port 8080

Standard library only. Everything is computed live by the same twin.py and eval.py the
AutoLab hill uses; nothing on the page is a canned number.
"""

from __future__ import annotations

import argparse
import copy
import csv
import importlib.util
import io
import json
import random
import sys
import tempfile
import threading
import time
from collections import Counter
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HILL = ROOT / "hill"
TRACKER = ROOT / "tracker"
sys.path.insert(0, str(TRACKER))

import floorplan  # noqa: E402
from hall import SPEC, twin  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


EVAL = _load("ctc_eval", HILL / "eval.py")
REF = json.loads((HILL / "private" / "reference.json").read_text())
DESIGNS = {
    "baseline": json.loads((HILL / "examples" / "baseline" / "submission.json").read_text()),
    "best": json.loads((TRACKER / "hall_design.json").read_text()),
}


# ------------------------------------------------------------------ scoring

def leaf_mix(sub):
    lm = sub["network"]["leaf_module"]
    lm = lm if isinstance(lm, dict) else {"default": lm}
    return dict(Counter(lm.get(g, lm.get("default")) for g in SPEC["inventory"]["gpu_racks"]))


def build_scene(sub, ctx, flagged=()):
    """Geometry + live physics for the 3D view: every number comes from the twin at the
    summer-training peak (15:00), the scenario that binds the inlet limit."""
    from hall import snapshot
    sc = SPEC["scenarios"]["summer_training"]
    sp = dict(sub["setpoints"])
    sp.update(sub.get("setpoints_by_scenario", {}).get("summer_training", {}))
    util = {j: twin.util_at(SPEC, js, 15 * 60, 60) for j, js in sc["jobs"].items()}
    snap = snapshot(ctx, util, sp["crah_supply_c"], sp["cdu_supply_c"])
    modules = SPEC["network"]["modules"]
    racks = []
    for rid, (c, r) in ctx["pos"].items():
        x, y = ctx["xy"][rid]
        if rid in ctx["rack_job"]:
            kind, job = "gpu", ctx["rack_job"][rid]
            g = twin._gpu_rack_state(SPEC, util[job], 1.0, sp["cdu_supply_c"], 1.0,
                                     modules[ctx["leaf_mod"][rid]]["w_per_end"])
            kw = g["it"] / 1000.0
        elif rid in ctx["spine_ids"]:
            kind, job, kw = "spine", None, None
        else:
            kind, job, kw = "storage", None, SPEC["storage_rack_w"] / 1000.0
        racks.append({"id": rid, "kind": kind, "job": job, "x": x, "y": y, "kw": kw,
                      "inlet_c": snap[rid]["inlet_c"], "junction_c": snap[rid].get("gpu_junction_c"),
                      "module": ctx["leaf_mod"].get(rid), "flagged": rid in flagged})
    links = [{"from": g, "to": n, "module": ctx["leaf_mod"][g]} for g in ctx["gpu_ids"] for n in ctx["spine_ids"]]
    pipes = [{"rack": g, "cdu": b["cdu"], "dn": b["dn"], "material": b["material"]} for g, b in ctx["branch"].items()]
    hot = [{"y0": 2.4 + 4.8 * i, "contained": bool(sub["containment"][i])} for i in range(len(sub["containment"]))]
    return {"racks": racks, "links": links, "pipes": pipes, "hot_aisles": hot,
            "cdus": [{"id": k, "x": v["x_m"], "y": v["y_m"]} for k, v in SPEC["cdus"].items()],
            "hall": {"length_m": SPEC["hall"]["hall_length_m"], "depth_m": 15.6, "x0": SPEC["hall"]["x_offset_m"]},
            "inlet_limit_c": SPEC["air"]["inlet_limit_c"], "setpoints": sp,
            "module_groups": {m: ("copper" if not d["optical"] else "single_mode" if d["single_mode"] else "multi_mode")
                              for m, d in modules.items()}}


def score_design(sub, final=False):
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "submission.json").write_text(json.dumps(sub))
        r = EVAL.eval(Path(d), final=final)
    out = {"passed": r["passed"], "mode": "final" if final else "validation"}
    if not r["passed"]:
        out["error"] = r["details"].get("error")
        return out
    det = r["details"]
    sc = det["scenarios"]
    summer = sc["summer_training"]
    errs, ctx = twin.validate(SPEC, sub)
    out.update({
        "score": r["metrics"][0]["value"],
        "annual_kwh_per_rack_hour": det["annual_kwh_per_rack_hour"],
        "scenarios": {k: {"ratio": v["ratio_to_baseline"], "pue": v["pue"],
                          "worst_inlet_c": v["worst_inlet_c"], "worst_junction_c": v["worst_junction_c"],
                          "min_job_speed": v["min_job_speed"]} for k, v in sc.items()},
        "summer_kw": summer["avg_kw"],
        "network_kw": summer["network_kw_within_it"],
        "serve_latency_us": det["static"]["job_latency_us"]["serve"]["max_us"],
        "latency_sla_us": SPEC["jobs"]["serve"]["latency_sla_us"],
        "capex_usd": det["static"]["capex_total_usd"],
        "budget_usd": SPEC["budget_usd"],
        "setpoints": sub["setpoints"],
        "containment": sub["containment"],
        "spine_type": sub["network"]["spine_type"],
        "leaf_mix": leaf_mix(sub),
        "svg": floorplan.render(ctx),
        "scene": build_scene(sub, ctx),
    })
    return out


def quick_score(sub):
    errs, ctx = twin.validate(SPEC, sub)
    if errs:
        return None
    sim = twin.simulate(SPEC, ctx)
    if sim["violations"]:
        return None
    return twin.annual_kwh_per_rack_hour(SPEC, sim) / REF["validation"]["annual_kwh_per_rack_hour"]


# ------------------------------------------------------------------ live agent search

INV = SPEC["inventory"]
IDS = INV["gpu_racks"] + INV["spine_racks"] + INV["storage_racks"]
BLOCKED = {tuple(s) for s in SPEC["hall"]["blocked_slots"]}
SLOTS = [[c, r] for r in range(SPEC["hall"]["rows"]) for c in range(SPEC["hall"]["cols"]) if (c, r) not in BLOCKED]
MODS = list(SPEC["network"]["modules"])
SPINES = list(SPEC["network"]["spine_types"])


def mutate(s, rng):
    s = copy.deepcopy(s)
    k = rng.randrange(9)
    if k == 0:
        a, b = rng.sample(IDS, 2)
        s["placements"][a], s["placements"][b] = s["placements"][b], s["placements"][a]
    elif k == 1:
        used = {tuple(v) for v in s["placements"].values()}
        s["placements"][rng.choice(IDS)] = rng.choice([x for x in SLOTS if tuple(x) not in used])
    elif k in (2, 8):
        lm = s["network"]["leaf_module"]
        lm = lm if isinstance(lm, dict) else {"default": lm}
        lm[rng.choice(INV["gpu_racks"]) if k == 2 else "default"] = rng.choice(MODS)
        s["network"]["leaf_module"] = lm
    elif k == 3:
        s["network"]["spine_type"] = rng.choice(SPINES)
    elif k == 4:
        i = rng.randrange(len(s["containment"]))
        s["containment"][i] = not s["containment"][i]
    elif k == 5:
        key = rng.choice(["crah_supply_c", "cdu_supply_c"])
        s["setpoints"][key] = round(s["setpoints"][key] + rng.choice([-1, -0.5, 0.5, 1]), 1)
    elif k == 6:
        g = rng.choice(INV["gpu_racks"])
        s["liquid"].setdefault(g, {})
        f = rng.choice(["cdu", "dn", "material"])
        s["liquid"][g][f] = rng.choice({"cdu": list(SPEC["cdus"]), "dn": list(SPEC["pipes"]["diameters"]),
                                        "material": list(SPEC["pipes"]["materials"])}[f])
    else:
        ja, jb = rng.sample(list(SPEC["jobs"]), 2)
        a, b = rng.randrange(len(s["jobs"][ja])), rng.randrange(len(s["jobs"][jb]))
        s["jobs"][ja][a], s["jobs"][jb][b] = s["jobs"][jb][b], s["jobs"][ja][a]
    return s


SEARCH = {"running": False, "step": 0, "total": 0, "history": [], "best": None, "best_score": None,
          "tried": 0, "rejected": 0, "started": 0.0}
LOCK = threading.Lock()


def run_search(steps, seed):
    rng = random.Random(seed)
    cur = copy.deepcopy(DESIGNS["baseline"])
    cs = quick_score(cur)
    best, bs = cur, cs
    with LOCK:
        SEARCH.update(running=True, step=0, total=steps, history=[[0, cs]], best=None, best_score=cs,
                      tried=0, rejected=0, started=time.time())
    for it in range(1, steps + 1):
        cand = cur
        for _ in range(rng.choice([1, 1, 2, 3])):
            cand = mutate(cand, rng)
        sc = quick_score(cand)
        with LOCK:
            SEARCH["tried"] += 1
            if sc is None:
                SEARCH["rejected"] += 1
        if sc is not None and sc <= cs:
            cur, cs = cand, sc
        if cs < bs:
            best, bs = cur, cs
        if it % 5 == 0 or it == steps:
            with LOCK:
                SEARCH["step"] = it
                SEARCH["best_score"] = bs
                SEARCH["history"].append([it, bs])
    DESIGNS["searched"] = best
    with LOCK:
        SEARCH.update(running=False, best=score_design(best))


# ------------------------------------------------------------------ tracker

def run_tracker():
    synth = _load("ctc_synth", TRACKER / "synth_telemetry.py")
    track = _load("ctc_track", TRACKER / "track.py")
    with redirect_stdout(io.StringIO()):
        synth.main()
        track.main()
    state = json.loads((TRACKER / "tracker_state.json").read_text())
    tel = TRACKER / "telemetry"

    def rows(name):
        with open(tel / name) as f:
            return list(csv.DictReader(f))

    cooling, air, optics = rows("cooling.csv"), rows("air.csv"), rows("optics.csv")
    series = []
    for f in state["findings"]:
        a, k = f["asset"], f["kind"]
        if k == "cold_plate_fouling":
            pts = [(int(r["day"]), float(r["gpu_junction_c"])) for r in cooling if r["rack"] == a]
            series.append({"asset": a, "label": "GPU junction °C", "limit": 87.0, "points": pts})
        elif k == "pipe_scaling":
            pts = [(int(r["day"]), float(r["branch_dp_kpa"])) for r in cooling if r["rack"] == a]
            series.append({"asset": a, "label": "branch ΔP kPa", "points": pts})
        elif k == "recirculation":
            pts = [(int(r["day"]), float(r["inlet_c"])) for r in air if r["rack"] == a]
            series.append({"asset": a, "label": "inlet °C", "points": pts})
        elif k in ("laser_wear", "dirty_connector"):
            rack, rest = a.split("->")
            spine, lane = rest.split(" lane ")
            col = "tx_bias_ma" if k == "laser_wear" else "rx_power_dbm"
            pts = [(int(r["day"]), float(r[col])) for r in optics
                   if r["rack"] == rack and r["spine"] == spine and r["lane"] == lane]
            series.append({"asset": a, "label": "Tx bias mA" if k == "laser_wear" else "Rx power dBm", "points": pts})
    errs, ctx = twin.validate(SPEC, DESIGNS["best"])
    flagged = {f["asset"].split("->")[0] for f in state["findings"]}
    return {"state": state, "series": series, "svg": floorplan.render(ctx, highlight=flagged),
            "scene": build_scene(DESIGNS["best"], ctx, flagged),
            "days": 1 + max(int(r["day"]) for r in cooling), "racks": len(ctx["all_ids"]),
            "lanes": len({(r["rack"], r["spine"], r["lane"]) for r in optics})}


# ------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = (HERE / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/search/status":
            with LOCK:
                s = {k: v for k, v in SEARCH.items()}
            s["elapsed_s"] = round(time.time() - s["started"], 1) if s["started"] else 0
            self._json(s)
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        try:
            if self.path == "/api/score":
                sub = DESIGNS.get(req.get("design", "baseline"))
                if sub is None:
                    return self._json({"error": "unknown design"}, 400)
                self._json(score_design(sub, final=bool(req.get("final"))))
            elif self.path == "/api/search/start":
                with LOCK:
                    if SEARCH["running"]:
                        return self._json({"error": "a search is already running"}, 409)
                steps = max(50, min(3000, int(req.get("steps", 400))))
                threading.Thread(target=run_search, args=(steps, int(req.get("seed", 3))), daemon=True).start()
                self._json({"started": steps})
            elif self.path == "/api/track":
                self._json(run_tracker())
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:  # surface the reason on the page instead of a dead button
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    for port in range(args.port, args.port + 20):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        except OSError:
            try:  # is it this demo, already running?
                import urllib.request
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/search/status", timeout=1) as r:
                    if "history" in json.loads(r.read()):
                        print(f"cool-the-cluster demo is already running: open http://localhost:{port}")
                        return
            except Exception:
                pass
            continue
        print(f"cool-the-cluster demo on http://localhost:{port}")
        srv.serve_forever()
        return
    raise SystemExit(f"ports {args.port}-{args.port + 19} are all busy; pass --port")


if __name__ == "__main__":
    main()
