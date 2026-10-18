# Compute layer

The compute layer picks the GPU or rack type for each rack group and the number of racks. It reaches more layers than any other decision: rack power sets cooling, weight sets floor load, and the sum sets grid use.

## What it is

Each rack type in the catalog carries its IT power (nominal for energy, peak for capacity checks), weight, footprint, cooling requirement, supply temperature limit and compute per rack. Swapping an air-cooled 8-GPU server rack for a rack-scale NVL72 system takes rack power from roughly 28 kW to about 132 kW and turns an air problem into a liquid one.

## When to use it

- First, to set what the hall is for.
- When comparing generations: same grid, different rack type, different usable compute.
- When adding custom GPU or rack entries for hardware not in the catalog.

## Textbook numbers

| Rack type | IT power per rack | Cooling | Source |
|---|---|---|---|
| DGX B300 (8 GPUs, 10U) | about 14 kW per system | air or liquid (not stated) | [1] |
| GB300 NVL72 | 136 kW (118 kW liquid, 18 kW air), 142 kW in another listing | liquid, 85% of heat | [2], [8] |
| Vera Rubin NVL72 | about 190 kW (Max-Q) to 230 kW (Max-P), not final | liquid, 45 °C inlet | [3], [4] |
| MI355X 8-GPU system | 14 to 18 kW (press estimate) | liquid; MI350X air | [5] |
| AMD Helios (72 GPUs) | not published | liquid, double-wide | [6] |

Two DGX B300-class systems per rack give about 28 kW (calculated), which is the default plan's air-cooled rack. The installed average across the industry is still below 8 kW per rack [7].

## Interactions with other layers

- Cooling: rack power times the method's liquid heat fraction sets coolant flow. The GB300 NVL72's 118 kW liquid share with a 10 K rise needs about 2.8 kg/s of water per rack (ṁ = Q / (c_p·ΔT), calculated). The other 18 kW still goes to air [2].
- Layout: a GB300 NVL72 weighs about 1,360 kg, which is about 21 kN/m² over its footprint; NVIDIA publishes no floor-loading spec [9]. A raised floor specified at 12 kN/m² [10] cannot take that without spreading the load.
- Power: rack power and the workload's peak factor set busway load.
- Network: GPUs per rack and NIC speed set the number of scale-out links.

## What to watch for

- Nominal vs peak: capacity checks use peak, energy uses nominal. Listings for the same GB300 rack range from 136 to 142 kW [2], [8], so carry the higher one for capacity.
- Supply temperature: next-generation racks accept warmer water (45 °C inlet for Vera Rubin [3]); older racks may need colder water than a dry cooler can deliver in summer.
- Vendor figures marked "not final" or press estimates. Carry them as `estimate`.

## Typical failure modes

- Swapping GPUs without revisiting cooling, so racks exceed the air limit.
- Rack weight exceeding a raised-floor bay rating.
- Placing more racks than the grid cap carries on the hottest hour, so the headline compute is overstated.

## Sources

1. NVIDIA, "DGX B300", https://www.nvidia.com/en-us/data-center/dgx-b300/ (vendor)
2. Lenovo Press, GB300 NVL72 3D tour (18 kW air, 118 kW liquid, 85% liquid), https://lenovopress.lenovo.com/3dtours/gb300nvl72 (oem)
3. NVIDIA, "Vera Rubin NVL72", https://www.nvidia.com/en-in/data-center/vera-rubin-nvl72/ (vendor)
4. CUDO Compute, "NVIDIA Vera Rubin", https://www.cudocompute.com/products/nvidia-vera-rubin (press)
5. The Register, "AMD's MI355X is a 1.4 kW liquid-cooled monster", https://www.theregister.com/2025/06/12/amd_mi355x/ (press)
6. TechCrunch, "AMD's Helios rack weighs the same as two compact cars", https://techcrunch.com/?p=3080157 (press)
7. Upsite Technologies, "Data Center Trends: Rack Density Rises While PUE and Outage Frequency Remain Flat", https://www.upsite.com/blog/data-center-trends-rack-density-rises-while-pue-and-outage-frequency-remain-flat/ (press)
8. Flopper, "NVIDIA GB300 NVL72", https://flopper.io/system/nvidia-gb300-nvl72 (press)
9. Introl, "Why NVIDIA GB300 NVL72 (Blackwell Ultra) matters", https://introl.com/blog/why-nvidia-gb300-nvl72-blackwell-ultra-matters (press)
10. Wikipedia, "Raised floor", https://en.wikipedia.org/wiki/Raised_floor (textbook)
