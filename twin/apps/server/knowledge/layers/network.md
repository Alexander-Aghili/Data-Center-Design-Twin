# Network layer

The network layer chooses the scale-out fabric (rail-optimized or fat tree), its oversubscription, and where leaf switches sit. From the layout it derives cable lengths, which media each link needs, optics power and base latency.

## What it is

Rack-scale systems have two networks. Scale-up runs inside the rack: a GB300 NVL72 joins 72 GPUs over NVLink at 130 TB/s aggregate [1]; in the GB200 NVL72 that spine is about 5,000 copper cables [2]. Scale-out connects racks: each GB300 GPU gets 800 Gb/s through ConnectX-8 [1]. The app models scale-out. In a rail-optimized fabric, GPU *n* of every server connects to leaf *n*, which keeps most collective traffic one hop away. A fat tree gives every port equal bandwidth upward.

## When to use it

- After layout, to see how many links need optics.
- When moving leaves: shorter runs can switch from optics to copper.
- When the grid cap is tight, since optics power counts against it.

## Textbook numbers

- Passive copper (DAC): up to 3 m at 800 G. NVIDIA's 800 G splitter DAC comes in 1 to 3 m lengths, 30 AWG up to 1.5 m and 26 AWG from 2 to 3 m, at 0.1 W per end [3].
- Active electrical cable (AEC): 4 to 7 m at 800 G, up to 50% less power than optics [4].
- Optics beyond about 7 m.
- Propagation: single-mode fiber has a refractive index of about 1.467, so light covers a mile in about 8 µs [5], which is about 5 ns/m (converted). 100 m of fiber adds about 0.5 µs one way.
- Copper in the scale-up domain saved about 20 kW per NVL72 rack that transceivers and retimers would have drawn [2].
- The app uses about 5 ns/m plus per-hop switch latency for base latency.

## Interactions with other layers

- Layout: routed distance along rows sets media per link. Long rows push links to optics.
- Power: optics add watts per link against the grid budget.
- Compute: GPUs per rack and NIC speed set the number of links.
- Workload: training wants low oversubscription; inference tolerates more.

## What to watch for

- Leaf placement. Putting leaves mid-row instead of at row ends can keep more links within AEC reach.
- Fiber volume. Jane Street's Texas hall, 56 racks and 4,032 GPUs, has about 8,000 km of fiber [6]. Cable trays, bend-radius limits and labelling take space and installation time.
- Latency. Jane Street's fastest links are copper, because light in fiber is slower [6]. Within copper reach there is also no optical conversion to pay for.

## Typical failure modes

- Links planned as copper that exceed reach after racks move.
- Optics power not counted in the facility budget.
- A fat tree oversubscribed at the spine, slowing all-reduce in training.

## Sources

1. NVIDIA, "GB300 NVL72", https://www.nvidia.com/en-us/data-center/gb300-nvl72/ (vendor)
2. SemiAnalysis, "Nvidia's Optical Boogeyman: NVL72, Infiniband", https://newsletter.semianalysis.com/p/nvidias-optical-boogeyman-nvl72-infiniband (press)
3. NVIDIA, MCP7Y00-Nxxx 800 Gb/s passive DAC splitter specifications, https://networking-docs.nvidia.com/MCP7Y00NXXX800pub (vendor)
4. Credo, "800G OSFP to OSFP-RHS AEC", https://credosemi.com/products/zeroflapaec/800g-span-osfp-to-osfp-rhs/ (vendor)
5. ADTRAN, "Speed of Light in Fiber", https://www.blog.adtran.com/en/speed-light-fiber-first-building-block-low-latency-trading-infrastructure (vendor)
6. Jane Street, "A look inside our newest data center", https://www.janestreet.com/culture/street-view/a-look-inside-our-newest-data-center/; Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), https://www.youtube.com/watch?v=8J-GUnfSqeE (press)
