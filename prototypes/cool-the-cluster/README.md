# cool-the-cluster: operations twin prototype

A working prototype built at the hackathon, alongside the Phase 1 design. It is a fast simulator of one AI data hall that scores any design on **facility energy per unit of useful GPU work**. The same simulator is used three ways:

| Use | What it does | Where |
|---|---|---|
| **Optimize** | An [AutoLab](https://app.autolab.ai) hill: agents edit one `submission.json` and climb the score | [`hill/`](hill/) |
| **Track + predict** | Reads daily telemetry (cooling, air, optics), finds what is degrading, calibrates the twin and projects +30 and +90 days | [`tracker/`](tracker/) |
| **Suggest** | Re-runs the calibrated twin for each candidate fix and ranks them: limit violations first, then urgency, then MWh/yr saved at equal output | [`tracker/track.py`](tracker/track.py) |

**Read first:** [`explainer.html`](explainer.html) is a one-page explanation with the floor plan, results and tracker demo. GitHub shows HTML as source, so download it and open it in a browser.

## What it models

Six coupled dimensions. Every constant is in [`hill/challenge_spec.json`](hill/challenge_spec.json), and the physics is in [`hill/twin.py`](hill/twin.py).

| Dimension | Tracked from sensors | Modeled as | A design can change |
|---|---|---|---|
| Rack layout | slot, rack type, row power | 12 × 6 slot hall, 230 kW row busways; distance sets cable length, pipe length and recirculation | slot of all 30 racks; which racks form each job |
| Heat & cooling | rack inlet °C, CRAH fans, chiller kW, outdoor wet bulb | inlet = supply + Σ recirculation matrix × air heat; containment, end-of-row hot spots, cube-law fans, free cooling vs chiller (Carnot-fraction COP) | air and coolant setpoints (per season), containment per hot aisle |
| Pipes | branch ΔP, coolant °C, GPU junction °C | Darcy–Weisbach per branch, pump head ≤ 185 kPa, 0.5–2.0 m/s; 5-year aging fouls cold plates (copper 6%, stainless 2%, PEX 15%) | CDU, pipe size and material per rack |
| Network & fiber | optic Tx bias, Rx power, module temp | DAC / AEC / SR8 / DR8 / LPO-SR8 / LPO-DR8 with reach, W and $; spine is packet, CPO or OCS; aging derates reach | module per rack, spine type, $1.05M capex budget |
| Latency | link latency, step time | 2 leaf hops + spine + module DSP + 4.9 ns/m; serving SLA ≤ 1.95 µs | follows from layout and gear |
| Work | throttle events, step time | throttle above 87 °C junction; a job runs at its slowest rack; communication time not hidden by compute adds to each step | follows from all of the above |

## Results

| Check | Result |
|---|---|
| `autolab hills check cool-the-cluster` | 21/21 tests pass |
| Seeded random baseline | score 1.000 (51.42 kWh per rack-hour) |
| 2,000-step random local search, 3 seeds | 0.967–0.968, validation and final agree within 0.0002 |
| What the search changed | LPO/AEC optics, all hot aisles contained, 26 °C supply air, 33.5 °C coolant |
| 3,000 fuzzed garbage submissions | 0 crashes |
| Tracker vs 5 planted faults | 5/5 found: cold-plate fouling (+21% est. vs +22%), pipe scale (673 vs 656 µm), recirculation (×3.3 vs ×3.5), laser wear, dirty connector |

## Run it

```bash
curl -fsSL https://app.autolab.ai/install.sh | sh        # autolab CLI (needs uv; installs it if missing)

# from the repo root: register the hill and run its checks
mkdir -p .autolab/hills && cp -r prototypes/cool-the-cluster/hill .autolab/hills/cool-the-cluster
autolab hills check cool-the-cluster
autolab hills eval .autolab/hills/cool-the-cluster/examples/baseline -H cool-the-cluster --final

# tracker (plain Python 3.9+, no dependencies)
cd prototypes/cool-the-cluster/tracker
python3 synth_telemetry.py   # 120 days of synthetic telemetry with 5 planted faults
python3 track.py             # -> tracker_report.md, tracker_state.json
```

## How it relates to Phase 1

Phase 1 sizes a hall from a sourced catalog and checks it, including N-1 failures. This prototype answers a different question: **across a year of weather and workloads, which layout, setpoints, pipes and optics use the least energy for the same work, and what is degrading in a running hall.** The two connect naturally:

- **Catalog → spec.** The numbers in `challenge_spec.json` (rack power, optics W, reach and cost, CDU capacity) are benchmark assumptions. In this repo's provenance terms, all of them are `estimated`. Sourcing them from `catalog/` would turn them into `vendor_spec` or `oem_datasheet` values.
- **Tracker → design desk.** `tracker_state.json` (findings, forecasts and ranked actions) is the kind of input the independent checker or report writer could consume.

## Limits

- **Rack density is below this repo's target.** Each GPU rack is about 38 kW at full load (32 GPUs × 1 kW plus 4.8 kW server, 1.2 kW leaf switch and optics), on 230 kW row busways and 420 kW CDUs. The rest of this repo is built for rack-scale systems of 130–245 kW (GB300 NVL72, Vera Rubin NVL72, AMD Helios) and up to 600 kW. At those densities almost all heat goes to liquid, CDU, busway and floor limits bind far earlier, and the trade-offs and best setpoints shift, so do not carry results such as the 3–4% ceiling over to a rack-scale hall. Rebuilding `challenge_spec.json` from `catalog/` (rack power, liquid share, CDU capacity, optics) is the step that would make it representative.
- Benchmark coefficients, not a calibrated facility. Use it to compare designs, not to quote a real PUE.
- Recirculation is a heat-flow matrix, not CFD. Humidity, N+1 redundancy and chiller part-load curves are not modeled.
- Telemetry is synthetic. A real hall would feed the same CSV columns from its BMS/DCIM and optic diagnostics (CMIS/DDM).
- Gains top out around 3–4% in this benchmark hall because server power dominates (see the density note above).
