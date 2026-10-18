# Power layer

The power layer sets redundancy (N, N+1, 2N), the distribution scheme (54 V DC busbar fed from AC, or 800 V DC), which busway feeds each row, and the oversubscription allowance. It checks two things: the facility stays under the grid cap every hour, and no busway or breaker sees more than its rating.

## What it is

Power runs from the utility through transformers and switchgear to UPS modules, then to overhead busways along the rows, then into rack power shelves. In a GB300 NVL72 those shelves convert to a 48 to 54 V DC busbar inside the rack; Lenovo's build uses up to eight 33 kW shelves [1]. Redundancy changes how many transformers, UPS modules and busway feeds exist, not how much the grid delivers. See `power-distribution` for the topology detail.

## When to use it

- After compute and cooling are set, to confirm the facility fits under the cap on the worst hour.
- When busway load per row approaches its rating, especially in training halls.
- When choosing between 54 V and 800 V DC for racks above about 200 kW.

## Textbook numbers

- Current at 54 V for a 132 kW rack: about 2,440 A; at 800 V: 165 A (I = P / V, calculated).
- NVIDIA says 54 V distribution hits physical limits as racks exceed 200 kW; a 1 MW rack at 54 V would need up to 200 kg of copper busbar. 800 V DC is claimed to raise end-to-end efficiency by up to 5% and cut copper by 45% against 415 V AC, with production systems from 2027 [2].
- Uptime Tier reference availability: Tier II (N+1 capacity components, one path) 99.741%; Tier III (concurrently maintainable) 99.982%; Tier IV (fault tolerant, 2N active paths) 99.995% [3].
- Training swings: GB300 power-shelf storage (65 J per GPU) cut the grid-side peak by 30% in an NVIDIA training test [4].

## Interactions with other layers

- Workload: training sets a higher peak-to-average factor than inference, which raises effective busway load.
- Cooling: chillers, pumps and fans share the same grid cap. Cooling power peaks on hot hours.
- Layout: busways follow rows, so moving racks moves load.
- Network: optics power counts against the grid budget.
- Cost: transformers, switchgear and breakers have the longest lead times in the build (see `cost-and-lead-times`).

## What to watch for

- Oversubscription: an allowance planned at about 10% can reach 15 to 20% in practice and trip breakers (Jane Street tour [5]).
- Busway balance: rows fed from one busway should carry similar load, so a training job does not push one feed past its breaker.
- Power is less fungible than cooling. Pipes can be oversized at build time; breakers and busway ratings cannot be stretched later [5].
- Distribution losses: UPS and transformer efficiency add to the facility load every hour.

## Typical failure modes

- Breakers tripping mid-training-run on a busway that passed on average load.
- The grid cap exceeded on hot hours because cooling rises with IT at its peak.
- N+1 equipment counted as extra grid capacity.
- 54 V busbars or power shelves running out of rack space at the next rack generation.

## Sources

1. Lenovo Press, GB300 NVL72 datasheet DS0207, https://lenovopress.lenovo.com/ds0207 (oem)
2. NVIDIA Developer Blog, "NVIDIA 800 V HVDC Architecture Will Power the Next Generation of AI Factories", https://developer.nvidia.com/blog/nvidia-800-v-hvdc-architecture-will-power-the-next-Generation-of-ai-factories (vendor)
3. AKCP, "Data Center Tier Classification", https://www.akcp.com/articles/tier-level-significance-for-data-centers/ (press)
4. NVIDIA Developer Blog, "How New GB300 NVL72 Features Provide Steady Power for AI", https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ (vendor)
5. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), https://www.youtube.com/watch?v=8J-GUnfSqeE; tour summary at https://www.janestreet.com/culture/street-view/a-look-inside-our-newest-data-center/ (press)
