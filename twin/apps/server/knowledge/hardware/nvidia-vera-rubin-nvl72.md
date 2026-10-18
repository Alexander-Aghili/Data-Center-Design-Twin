# NVIDIA Vera Rubin NVL72

Vera Rubin NVL72 is the generation after GB300: 72 Rubin GPUs and 36 Vera CPUs in one rack, fully liquid cooled. NVIDIA has published performance and a 45 °C inlet temperature but not a rack power figure, so power values here are press estimates and the catalog marks them `estimate`.

## What it is

Per NVIDIA, the rack has 20.7 TB of HBM4 at 1,400 TB/s, 216 TB/s of sixth-generation NVLink, 3,600 PFLOPS NVFP4 inference (sparse), 2,520 PFLOPS NVFP4 training (dense) and 1,260 PFLOPS FP8/FP6 training [1]. Each GPU has 288 GB of HBM4 [1]. Press coverage of the CES 2026 launch reports NVLink 6 at 3.6 TB/s per GPU and 260 TB/s per rack, which differs from NVIDIA's page [2]. Trays are cable-free and fanless, with liquid hoses to the cold plates [2], [3].

## When to use it

- New builds planned for 2026 and later with liquid cooling and warm-water heat rejection.
- Halls where the grid, not floor space, limits compute: per-rack power rises again.
- Not for retrofits whose busways and CDUs were sized for 130 kW racks.

## Textbook numbers

- Rack power: about 190 kW in the Max-Q profile and up to about 230 kW in Max-P (press, not final) [3].
- GPU TDP: about 2,300 W (press) [3].
- Coolant inlet: 45 °C [1]. ASHRAE class W45 presumes 45 °C supply [4].
- Liquid flow: CUDO reports flow requirements nearly double Blackwell's [3]. At 190 kW and a 10 K rise, water needs about 4.5 kg/s per rack (calculated).
- Current at 54 V for 230 kW: about 4,260 A (calculated). NVIDIA puts the practical 54 V limit at about 200 kW per rack [5].
- Assembly and servicing: NVIDIA claims 18 times faster than GB300 NVL72 [2].

## Interactions with other layers

- Cooling: with a 45 °C supply and a 7 K dry-cooler approach (an assumption), dry coolers work without trim cooling up to about 38 °C outdoor dry bulb (calculated). That removes most chiller hours and evaporative water.
- Power: racks at 190 to 230 kW sit at the edge of 54 V distribution, which is why NVIDIA is moving to 800 V DC [5].
- Layout: fewer, heavier racks; hall space goes unused when the grid runs out first.
- Network: NVIDIA lists 32.4 TB/s of bidirectional rack networking [1], about 450 GB/s per GPU (calculated).

## What to watch for

- Every power figure is provisional. Re-check against NVIDIA or OEM data before committing busways.
- Mixed halls: a 45 °C loop cannot serve older racks that need colder water. Separate loops or CDUs are needed.
- CDU flow per rack roughly doubles against GB300 [3], so CDU counts per row rise even if rack count falls.

## Typical failure modes

- Busways and breakers sized for GB300 reused for Vera Rubin.
- Facility loop designed for cold water, which wastes the 45 °C capability on chillers.
- Planning on Max-Q power while operating at Max-P.

## Sources

1. NVIDIA, "Vera Rubin NVL72", https://www.nvidia.com/en-in/data-center/vera-rubin-nvl72/ (vendor)
2. StorageReview, "NVIDIA launches Vera Rubin architecture at CES 2026", https://www.storagereview.com/news/nvidia-launches-vera-rubin-architecture-at-ces-2026-the-vr-nvl72-rack (press)
3. CUDO Compute, "NVIDIA Vera Rubin", https://www.cudocompute.com/products/nvidia-vera-rubin (press)
4. The Green Grid, glossary entry W45, https://www.thegreengrid.org/resources/glossary/W (textbook)
5. NVIDIA Developer Blog, "NVIDIA 800 V HVDC Architecture Will Power the Next Generation of AI Factories", https://developer.nvidia.com/blog/nvidia-800-v-hvdc-architecture-will-power-the-next-Generation-of-ai-factories (vendor)
