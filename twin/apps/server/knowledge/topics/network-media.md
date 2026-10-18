# Network media and reach

Which cable carries each link: passive copper (DAC), active electrical cable (AEC) or optics. The choice follows from distance, and it decides power, cost and a little latency.

## What it is

- DAC: twinax copper with no active electronics in the cable. Lowest power (0.1 W per end on NVIDIA's 800 G DAC [2]) and shortest reach.
- AEC: copper with retiming chips in the connector ends. Longer reach than DAC at lower power than optics.
- Optics: transceivers convert to light; fiber carries it as far as needed. Highest power per link.

In a rack-scale system the scale-up network stays inside the rack on copper. The GB200 NVL72 NVLink spine is about 5,000 copper cables, and NVIDIA says optics there would have cost about 20 kW per rack in transceivers and retimers [1]. Scale-out links between racks and leaves are where the media choice happens.

## When to use it

- DAC within a rack or to a switch in the same or adjacent rack.
- AEC for neighbouring racks in a row, 4 to 7 m.
- Optics for runs to leaves at row ends or in other rows, and anything beyond 7 m.

## Textbook numbers

- DAC at 800 G: up to 3 m; NVIDIA's 800 G splitter DAC uses 30 AWG up to 1.5 m and 26 AWG from 2 to 3 m, at 0.1 W per end [2].
- AEC at 800 G: 4 to 7 m, up to 50% less power than optics [3].
- Fiber propagation: refractive index about 1.467, so about 8 µs per mile [4], or about 5 ns/m (converted). A 50 m run adds about 0.25 µs one way.
- Per-GPU scale-out on GB300 NVL72: 800 Gb/s [5], so 72 links per rack.
- Fiber volume at scale: Jane Street's Texas hall, 4,032 GPUs in 56 racks (72 per rack, calculated), has about 8,000 km of fiber [6].

## Interactions with other layers

- Layout: routed rack-to-leaf distance sets which medium each link needs. Moving a rack can push a link past reach.
- Power: optics power counts against the grid budget and adds heat to the air side.
- Network layer: rail-optimized fabrics put many links to the same leaf, which concentrates long runs.

## What to watch for

- Latency. Jane Street's fastest links are copper, because light in fiber is slower [6]. For latency-critical paths keep runs short and on copper.
- Cable mass and tray fill. 8,000 km of fiber in one hall needs real tray space, bend-radius control and labelling [6].
- Copper bulk. Thicker 26 AWG cable at 2 to 3 m [2] adds weight and blocks airflow at the rear of the rack.

## Typical failure modes

- Links planned as DAC that end up 4 m after leaves move.
- Optics power missing from the facility budget.
- Overhead trays shared by fiber, copper, busways and pipes without a separation plan.

## Sources

1. SemiAnalysis, "Nvidia's Optical Boogeyman: NVL72, Infiniband", https://newsletter.semianalysis.com/p/nvidias-optical-boogeyman-nvl72-infiniband (press)
2. NVIDIA, MCP7Y00-Nxxx 800 Gb/s passive DAC splitter specifications, https://networking-docs.nvidia.com/MCP7Y00NXXX800pub (vendor)
3. Credo, "800G OSFP to OSFP-RHS AEC", https://credosemi.com/products/zeroflapaec/800g-span-osfp-to-osfp-rhs/ (vendor)
4. ADTRAN, "Speed of Light in Fiber", https://www.blog.adtran.com/en/speed-light-fiber-first-building-block-low-latency-trading-infrastructure (vendor)
5. NVIDIA, "GB300 NVL72", https://www.nvidia.com/en-us/data-center/gb300-nvl72/ (vendor)
6. Jane Street, "A look inside our newest data center", https://www.janestreet.com/culture/street-view/a-look-inside-our-newest-data-center/; Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), https://www.youtube.com/watch?v=8J-GUnfSqeE (press)
