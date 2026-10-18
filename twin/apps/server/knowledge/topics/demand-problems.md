# Demand problems

The checks that fail when a plan meets real demand: grid headroom on hot hours, synchronized training swings against busways and breakers, oversubscription beyond the allowance, long lead times, peak-day water, and the coolant temperatures next-generation racks expect.

## What it is

Each item is a check in the engine with an explanation and a cause chain. They share a pattern: the plan passes on averages and fails at the edge, on the hottest hour, the largest swing, the driest day or the slowest delivery.

## When to use it

- After any change to compute, cooling or power.
- Before committing a build schedule.
- When the agent reports a warning that only appears for some hours of the year.

## Textbook numbers

- Hot hours: cooling power peaks when outdoor temperature peaks, and IT load does not drop. A dry cooler with a 7 K approach (an assumption) serving 30 °C water needs trim cooling above 23 °C outdoor (calculated).
- Training swings: tens of megawatts in one data center, mostly between 0.2 and 3 Hz [1]. GB300 NVL72 storage of 65 J per GPU cut grid-side peak by 30% in NVIDIA's test [2].
- Oversubscription: Jane Street plans about 10% and has seen it reach 15 to 20%, enough to trip breakers [3].
- Lead times: high-voltage breakers reached 125 weeks in the second half of 2025, up from 77 weeks in 2023; generator step-up transformers passed 160 weeks by Q1 2026 [4]. Pad-mounted transformers run 68 to 113 weeks, generators 60 to 100, medium-voltage switchgear 38 to 63 [5].
- Peak-day water: evaporative cooling uses about 1.5 L per kWh of heat rejected plus blowdown (calculated from latent heat), and the hottest day sets the peak.
- Coolant temperature: Vera Rubin NVL72 lists a 45 °C inlet [6]; GB300 NVL72 accepts 18 to 45 °C [7]. Older racks may need colder water than a dry cooler can give in summer.

## Interactions with other layers

- Site: climate and grid cap set the hot-hour limit; water allowance sets the peak-day limit.
- Workload: training sets the swing; inference is smoother.
- Power: busway balance and the oversubscription allowance decide breaker margin.
- Cooling: heat rejection choice moves load between electricity (chillers, trim) and water (towers, adiabatic).
- Cost: lead times set build-out weeks and the cost of delay.

## What to watch for

- Busway balancing, so no single breaker trips mid-training-run [3].
- Power is less fungible than cooling: pipes can be oversized at build time, breakers cannot be stretched later [3].
- Topology-aware monitoring that knows which nodes sit on which breaker and sheds nodes before the breaker trips [3].
- Denser compute does not fill the hall. Grid power runs out first and floor space stays empty; at Jane Street, racks using a small fraction of the planned space take the whole grid interconnect [3].

## Typical failure modes

- Grid cap exceeded for a few hundred hot hours, cutting usable compute.
- A breaker trip that stops a training run that passed every average check.
- A transformer or switchgear order placed late, setting the critical path by a year.
- Evaporative heat rejection that exceeds the water allowance on the hottest days.

## Sources

1. Microsoft, OpenAI and NVIDIA, "Power Stabilization for AI Training Datacenters", https://arxiv.org/html/2508.14318v1 (textbook)
2. NVIDIA Developer Blog, "How New GB300 NVL72 Features Provide Steady Power for AI", https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ (vendor)
3. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), https://www.youtube.com/watch?v=8J-GUnfSqeE; summary at https://www.janestreet.com/culture/street-view/a-look-inside-our-newest-data-center/ (press)
4. Reuters via Kitco, "US power companies scramble to secure equipment as surging data center demand strains supplies" (July 9, 2026), https://www.kitco.com/news/off-the-wire/2026-07-09/us-power-companies-scramble-secure-equipment-surging-data-center (press)
5. CRE Daily, "Data Center Construction Costs Jump 21% Since 2024", citing Cushman & Wakefield, https://www.credaily.com/briefs/data-center-construction-costs-jump-21-since-2024/ (press)
6. NVIDIA, "Vera Rubin NVL72", https://www.nvidia.com/en-in/data-center/vera-rubin-nvl72/ (vendor)
7. Lenovo Press, GB300 NVL72 datasheet DS0207, https://lenovopress.lenovo.com/ds0207 (oem)
