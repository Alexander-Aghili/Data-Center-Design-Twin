# NVIDIA GB300 NVL72

GB300 NVL72 is a liquid-cooled rack-scale system: 72 Blackwell Ultra GPUs and 36 Grace CPUs in one NVLink domain. It is the rack behind the app's demo cascade, where rack power jumps from about 28 kW to well over 100 kW.

## What it is

Eighteen 1U compute trays and the NVLink switch trays sit in a 48U MGX rack [2]. The rack has 20 TB of HBM at up to 576 TB/s, 130 TB/s of NVLink bandwidth, 720 PFLOPS FP8 and 1,440 PFLOPS FP4 as listed by NVIDIA, and 800 Gb/s of ConnectX-8 networking per GPU [1]. In the GB200 NVL72 the NVLink spine is about 5,000 copper cables, which NVIDIA says saves about 20 kW of optics per rack [3]. Power comes from up to eight 33 kW power shelves feeding a 48 V DC busbar [2]. The shelves hold 65 J of capacitor storage per GPU to smooth training swings [4].

## When to use it

- Large training jobs that benefit from a 72-GPU NVLink domain.
- Halls with liquid cooling (CDUs and a facility water loop) and floors rated for heavy racks.
- Not for air-only halls: about 18 kW of each rack still goes to air, but the other 118 kW needs liquid [5].

## Textbook numbers

- Rack heat: 118 kW to liquid and 18 kW to air, 85% liquid overall; compute trays are 90% liquid and switch trays 100% [5]. Another listing gives 142 kW total [6].
- Coolant: PG25 or DI water, 18 to 45 °C supply [2].
- Liquid flow: about 2.8 kg/s per rack at a 10 K rise (calculated from 118 kW).
- Weight: about 1,360 kg, roughly 21 kN/m² over the footprint; NVIDIA publishes no floor-loading spec [7].
- Current at 54 V for 136 kW: about 2,520 A (calculated).
- Power smoothing: storage plus ramp limits cut the grid-side peak by 30% in an NVIDIA Megatron test [4].

## Interactions with other layers

- Cooling: needs CDUs sized for 118 kW per rack plus redundancy, and CRAH capacity for the 18 kW air share.
- Layout: 21 kN/m² exceeds a 12 kN/m² raised-floor specification, so bays need checking or slab placement.
- Power: busways near their rating in training halls risk breaker trips on synchronized swings.
- Network: 72 scale-out ports per rack, one per GPU.

## What to watch for

- Peak vs nominal: listings differ by several kW; size busways on the higher figure.
- Coolant quality and filtration in the technical loop (see `liquid-cooling-operations`).
- Power smoothing settings. They are configurable through nvidia-smi or Redfish [4]; with smoothing off, the grid sees the full swing.
- Install time: about 100 minutes per compute tray, per a CES 2026 comparison with Vera Rubin [8].

## Typical failure modes

- Racks placed on raised-floor bays rated for air racks.
- CDU positions exhausted when several rows switch to NVL72 at once.
- Air share forgotten, so CRAH capacity falls short even with liquid cooling working.
- Breakers tripping during training on a busway that passed on average load.

## Sources

1. NVIDIA, "GB300 NVL72", https://www.nvidia.com/en-us/data-center/gb300-nvl72/ (vendor)
2. Lenovo Press, GB300 NVL72 datasheet DS0207, https://lenovopress.lenovo.com/ds0207 (oem)
3. SemiAnalysis, "Nvidia's Optical Boogeyman: NVL72, Infiniband", https://newsletter.semianalysis.com/p/nvidias-optical-boogeyman-nvl72-infiniband (press)
4. NVIDIA Developer Blog, "How New GB300 NVL72 Features Provide Steady Power for AI", https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ (vendor)
5. Lenovo Press, GB300 NVL72 3D tour, https://lenovopress.lenovo.com/3dtours/gb300nvl72 (oem)
6. Flopper, "NVIDIA GB300 NVL72", https://flopper.io/system/nvidia-gb300-nvl72 (press)
7. Introl, "Why NVIDIA GB300 NVL72 (Blackwell Ultra) matters", https://introl.com/blog/why-nvidia-gb300-nvl72-blackwell-ultra-matters (press)
8. StorageReview, "NVIDIA launches Vera Rubin architecture at CES 2026", https://www.storagereview.com/news/nvidia-launches-vera-rubin-architecture-at-ces-2026-the-vr-nvl72-rack (press)
