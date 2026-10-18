# cool-the-cluster

Lay out and configure a 1 MW liquid-cooled AI hall (racks, cooling, pipes, optics, switches) to cut annual facility energy per unit of training work.

## Task

A digital twin of one data hall decides the score. You place 30 racks on a 12 by 6 slot floor: 24 GPU racks, 2 spine network racks and 4 storage racks. You then choose:

- how the GPU racks split into three jobs
- the spine switch type and the optical module on each GPU rack's uplinks
- the CRAH supply-air and CDU coolant setpoints
- which hot aisles get containment
- for every GPU rack, its CDU, pipe diameter and pipe material

The twin runs five fixed 24-hour scenarios and returns facility energy per rack-hour of useful compute.

Six dimensions are coupled, and every one of them moves the score:

| dimension | what you control | what it costs or buys |
|---|---|---|
| rack layout | slot of every rack | hot air recirculates between neighbours and pools at row ends; distance sets cable and pipe length |
| heat and cooling | setpoints, containment | warmer air and coolant mean more free-cooling hours and better chiller COP, but hotter rack inlets and GPU junctions |
| pipes | CDU, DN25/32/40, copper/stainless/pex per rack | pressure drop and pump energy; pump-head and velocity limits; 5-year fouling of cold plates raises GPU temperature |
| network gear | packet / packet_cpo / ocs spine, module per rack | optics watts, reach, capex; OCS halves bandwidth for all-to-all traffic |
| latency | follows from layout and gear | rack-to-rack latency adds exposed communication time to every training step; the serving job has a hard SLA |
| work | follows from all of the above | GPUs throttle above 87 C junction, and a job runs at its slowest rack |

The metric is energy per unit of work, not raw power. Throttling GPUs or slowing the network to save watts loses more work than it saves energy.

## Submission format

A submission is a directory holding one UTF-8 JSON file, `submission.json`:

```json
{
  "placements": {"G00": [3, 1], "...": "every rack id once, [col, row]",
                 "N0": [5, 2], "N1": [6, 4], "S0": [0, 0], "...": "..."},
  "jobs": {"train_a": ["12 GPU rack ids"], "train_b": ["8 ids"], "serve": ["4 ids"]},
  "network": {"spine_type": "packet",
              "leaf_module": {"default": "sr8", "G07": "lpo_sr8"}},
  "liquid": {"default": {"cdu": "CDU0", "dn": "DN32", "material": "copper"},
             "G05": {"cdu": "CDU1"}},
  "containment": [false, true, false],
  "setpoints": {"crah_supply_c": 20.0, "cdu_supply_c": 32.0},
  "setpoints_by_scenario": {"winter_training": {"crah_supply_c": 24.0}}
}
```

- Rack ids are `G00`–`G23` (GPU), `N0`, `N1` (spine) and `S0`–`S3` (storage). Slots are integer `[col, row]` with col 0–11 and row 0–5. Slots `[6,2] [6,3] [0,5] [11,0]` are blocked by building columns.
- `network.leaf_module` is a module name, or `{"default": name, rack: name}`. `liquid` takes a `default` object with per-rack overrides.
- `containment` has one boolean per hot aisle. Rows 0 and 1 share hot aisle 0, rows 2 and 3 share aisle 1, and rows 4 and 5 share aisle 2.
- `setpoints_by_scenario` is optional. It overrides setpoints in individual scenarios, like an operator adjusting by season.

Unknown keys are rejected. Any other file in the directory is ignored. `examples/baseline/submission.json` is a legal starting point.

## Metric

| metric | direction | meaning |
|---|---|---|
| `score` | min | annual facility kWh per rack-hour of work, divided by the baseline's |
| `worst_scenario_ratio` | min | the largest per-scenario ratio to the baseline (tie-break) |
| `worst_inlet_c` | min | hottest rack inlet in any scenario (tie-break) |

`annual = Σ w·energy / Σ w·work` over the scenarios, with weights summer 0.25, winter 0.25, inference_peak 0.20, moe_all_to_all 0.15 and aged_5yr_summer 0.15. Work is `racks × utilization × t_compute / step_time` per job. Facility energy covers:

- IT load, with optics and switches inside the racks
- UPS/PDU losses
- CRAH fans
- chillers for the air loop and the liquid loop
- the cooling tower and condenser pumps
- CDU pumps
- lighting

The baseline is a seeded random legal layout. It uses packet spines, sr8 optics, DN32 copper pipes, no containment, and setpoints of 18 C air and 30 C coolant. It scores 1.0 by construction:

| mode | baseline annual kWh per rack-hour |
|---|---|
| validation (60-min steps) | 51.4229 |
| final (15-min steps + utilization bursts) | 51.4562 |

A plain local search reaches about 0.967. Realistic gains are a few percent, as in real facilities, where the IT load dominates.

## Hard constraints (illegal → `passed: false`, no score)

Checked before simulation:

- **Geometry.** Every rack is placed exactly once, in a free, unblocked slot. Every GPU rack is in exactly one job, with 12 / 8 / 4 racks.
- **Power.** The design load of each row at 100% utilization must not exceed its 230 kW busway.
- **Reach.** Each GPU rack has 8 links to N0 and 8 to N1. A cable's length is the Manhattan slot distance plus 1.0 m of risers and 0.5 m of slack. It must be within the module's reach multiplied by:
  - the 5-year aging factor: 0.85 for DSP optics, 0.6 for LPO, 1.0 for copper
  - the spine factor: OCS insertion loss is 0.8 for dr8 and 0.6 for lpo_dr8
- **Spine compatibility.** `packet_cpo` and `ocs` spines require single-mode leaf optics (`dr8` or `lpo_dr8`).
- **Pipes.** The branch length is 2 × (Manhattan distance from rack to CDU + 3 m). At the fixed design flow of 0.75 kg/s, branch velocity must be within 0.5–2.0 m/s.
- **Pump head.** Each CDU's pump head, computed with 5-year-aged pipe roughness, must be at most 185 kPa. Head is the worst branch plus 40 kPa inside the CDU, where a branch is its pipe friction plus K=10 of fittings plus the 110 kPa rack manifold.
- **CDU capacity.** Design liquid heat must be at most 420 kW per CDU.
- **Latency SLA.** The serving job's worst rack-to-rack latency must be at most 1.95 µs.
- **Budget.** Capex must be at most $1,050,000. Capex covers containment, pipes, optics and cables, fiber, and the spine switch premium.
- **Setpoint bounds.** Supply air must be in [16, 27] C and coolant in [18, 45] C.

Checked during simulation, at every timestep of every scenario:

- Every rack inlet stays at or below 27.0 C (the ASHRAE recommended limit), measured at the top of the rack.
- Every GPU junction stays at or below 92 C after throttling.

The final run adds ±4% utilization bursts at 15-minute resolution. Keep a little margin below 27 C at validation.

## The model (everything is in `twin.py` and `challenge_spec.json`)

- **Inlet temperature.**
  `T_in(i) = T_supply + 0.08 K/m × distance from the nearest CRAH wall + 1.15 × Σ_j D[i][j] × P_air(j)`.
  - Same hot aisle: `D = 0.10 K/kW × exp(−|dx|/1.5 m)`.
  - Other aisles: `D = 0.006 K/kW × exp(−d/4 m)`.
  - Self: 0.012 K/kW.
  - Containment multiplies same-aisle terms by 0.15 and leakage out of the aisle by 0.3.
  - End-of-row slots (col 0 or 11) receive ×1.6 recirculation, or ×1.15 when contained.
- **GPU racks.**
  - Power per GPU is `150 + 850 × u × speed` W. The other server load is 4.8 kW × (0.6 + 0.4·u·speed).
  - Leaf switch: 1.2 kW, plus 16 leaf-end optics.
  - Liquid captures 95% of GPU heat and 50% of the other server heat.
  - `T_junction = T_cdu + ½ΔT_rack + P_gpu × 0.045 K/W × (1 + fouling)`. Fouling is the pipe material's value, and applies only in the aged scenario.
  - Above 87 C, speed is `1 − 0.04/K` (floor 0.5). A job runs at its slowest rack.
- **Air plant.**
  - CRAH ΔT is 10 K open and 16 K contained, weighted by air heat. Eight fans follow the cube law.
  - Chilled water runs 3 K below the supply-air setpoint.
- **Liquid plant.** Facility water runs 3 K below the CDU setpoint.
- **Free cooling and chillers.**
  - Free cooling is complete when `wet_bulb + 4 K` is at least 1 K under the water temperature needed. It fades out linearly until 2 K over.
  - Chiller COP is `0.45 × T_evap/(T_cond − T_evap)`, clamped to [2.5, 9].
- **Network.**
  - Spine racks hold 4 switches each. Body power is 1.6 kW for packet and CPO switches, and 0.15 kW for OCS.
  - The spine end of a link mirrors the leaf module (packet), draws 5 W/port (CPO), or draws 0 W (OCS).
  - Latency per path is `2 × 0.5 µs (leaf) + spine latency + module latencies + 4.9 ns/m`, averaged over the two spine racks. A job uses its worst pair.
- **Step time.**
  `t_compute/speed + n_latency × hops × latency + max(0, bytes_term − overlap × t_compute/speed)`.
  - Ring: `hops = 2(R−1)` and `bytes_term = 2(R−1)/R × bytes / 1.6 TB/s`.
  - All-to-all: `hops = R−1`. On OCS, bandwidth is ×0.5 and latency is +0.5 µs.
- **Scenarios.** Weather follows a daily cosine peaking at 15:00. Training jobs take a checkpoint dip to 55% utilization for 20 minutes every 6 hours. The serving job follows a diurnal sine.

## Parameters

None. The mode follows from `--final`, and every other quantity is fixed in `challenge_spec.json`.

## Test mode

`hills eval <dir> -H cool-the-cluster --final` re-runs the identical physics at 15-minute resolution with seeded ±4% utilization bursts. Iterate on validation and treat final as the claim. The mode and the SHA-256 of the spec and the twin are primary config, so validation and final scores never rank against each other.

## Honesty about the model

These are relative benchmark values, not a calibrated model of a real facility. The following are simplified:

- Recirculation is an abstract heat-flow matrix, not CFD.
- Chillers use a Carnot-fraction COP.
- Optics power and cost are rounded public figures.
- Pipe aging is a roughness and fouling step change.

The twin ignores humidity, redundancy (N+1), failures and part-load chiller curves. What the hill does measure honestly is the coupled trade: density against recirculation, warm water against GPU throttling, optics reach against layout, latency against cable distance, and capex against all of it. Every design is judged the same way.

## What the evaluator will not do

- It will not run code from your submission. `submission.json` is parsed as data, and NaN and Infinity are rejected.
- It will not read a temperature, power or score your search produced. It regenerates every trace from `challenge_spec.json`.
- It will not accept a design that breaks a constraint. An illegal design is rejected, not penalized.
