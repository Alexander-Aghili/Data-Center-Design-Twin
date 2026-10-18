# Power distribution

How power gets from the utility to the GPU, how much redundancy sits in the path, and why rack-scale systems are pushing from 54 V DC busbars toward 800 V DC. Covers N, N+1 and 2N, the two distribution schemes the app offers, and busways and breakers.

## What it is

The conventional path is utility medium voltage, transformers, switchgear, UPS, then 415 V AC distribution to overhead busways, then rack power shelves that rectify to 54 V or 12 V DC, then conversion to GPU core voltage [1]. A GB300 NVL72 rack holds up to eight 33 kW power shelves feeding a 48 V DC busbar [2]. In NVIDIA's 800 V DC design, 13.8 kV AC is converted once to 800 V DC at the facility perimeter and racks step down with DC/DC conversion [1].

Redundancy terms:
- N: exactly enough capacity, no spare.
- N+1: one spare unit (UPS module, transformer) per group. Uptime Tier II adds N+1 capacity components on one path [3].
- 2N: two complete, independent paths, each able to carry the load. Tier IV uses simultaneously active independent paths [3].

## When to use it

- 54 V AC-fed busbar: today's racks up to about 200 kW, where NVIDIA puts the physical limit [1].
- 800 V DC: racks from about 200 kW to 1 MW, with production systems from 2027 [1].
- N+1 for most AI training halls; 2N where a single path failure is unacceptable.

## Textbook numbers

- Current for a 136 kW rack: about 2,520 A at 54 V and 170 A at 800 V (I = P / V, calculated).
- A 1 MW rack at 54 V needs up to 200 kg of copper busbar, and Kyber-class power shelves at 54 V would take up to 64 U [1].
- 800 V DC claims: up to 5% better end-to-end efficiency than 54 V systems, 45% less copper and 85% more power through the same conductor than 415 V AC [1].
- Tier reference availability: II 99.741%, III 99.982%, IV 99.995% [3].

## Interactions with other layers

- Workload: training swings raise effective busway load.
- Layout: busways follow rows; moving racks rebalances load between feeds.
- Cooling: chillers, pumps and fans share the facility's distribution and grid cap.
- Cost: transformers, switchgear and breakers set the electrical critical path (see `cost-and-lead-times`).

## What to watch for

- Busway balancing. Jane Street balances load across busways so a breaker does not trip mid-training-run [4].
- Oversubscription. An allowance planned at about 10% can reach 15 to 20% and trip breakers [4].
- Fungibility. Power is less fungible than cooling: pipes can be oversized cheaply at build time, but a breaker rating is fixed [4].
- Monitoring. Topology-aware monitoring knows which nodes sit behind which breaker and sheds nodes before it trips [4].
- Smoothing. NVIDIA's GB300 power shelves add bulk capacitance (65 J per GPU) to flatten training load swings; peak grid demand fell 30% in NVIDIA's test [5].

## Typical failure modes

- A redundant path counted as extra capacity, so a single failure overloads the survivor.
- Breakers that trip on synchronized peaks while average load looks safe.
- 54 V busbar copper and shelf space running out in the next rack generation.
- Unbalanced busways where one row carries a training cluster and its neighbour sits idle.

## Sources

1. NVIDIA Developer Blog, "NVIDIA 800 V HVDC Architecture Will Power the Next Generation of AI Factories", https://developer.nvidia.com/blog/nvidia-800-v-hvdc-architecture-will-power-the-next-Generation-of-ai-factories (vendor)
2. Lenovo Press, GB300 NVL72 datasheet DS0207, https://lenovopress.lenovo.com/ds0207 (oem)
3. AKCP, "Data Center Tier Classification", https://www.akcp.com/articles/tier-level-significance-for-data-centers/ (press)
4. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), https://www.youtube.com/watch?v=8J-GUnfSqeE (press)
5. NVIDIA Developer Blog, "How New GB300 NVL72 Features Provide Steady Power for AI", https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ (vendor)
