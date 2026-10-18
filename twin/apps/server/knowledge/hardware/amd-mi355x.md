# AMD Instinct MI355X and MI350X

The MI350 series is AMD's CDNA 4 accelerator generation, sold as 8-GPU servers. The MI355X is the liquid-cooled part at 1.4 kW per GPU; the MI350X is the air-cooled part at about 1 kW. The catalog carries both an air rack and a liquid rack.

## What it is

Both chips have 288 GB of HBM3E at 8 TB/s and 256 MB of Infinity Cache [1]. Eight GPUs connect all-to-all over Infinity Fabric on one board; each system adds two x86 CPUs and up to eight 400 Gb/s NICs over PCIe 5.0 switches [1]. An 8-GPU system has up to 2.25 TB of HBM3E and 147 to 160 PFLOPS sparse FP4, depending on cooling [1]. AMD says the MI355X needs a liquid loop for full performance; the MI350X is about 8% slower on paper and closer to 20% slower in AMD's own real-world figures, because the liquid part can hold boost longer [1].

## When to use it

- MI350X air racks: halls built for air with containment, at moderate density.
- MI355X liquid racks: halls with CDUs and facility water, where density per rack matters.
- Inference with large models, where 288 GB per GPU lets a model fit on fewer GPUs.

## Textbook numbers

- GPU power: MI355X 1.4 kW; MI350X about 1 kW [1].
- System power: AMD has not published it; The Register estimates 14 to 18 kW per 8-GPU system, air or liquid [1].
- Maximum density: up to 16 nodes and 128 GPUs per liquid-cooled rack; up to 8 nodes and 64 GPUs per air-cooled rack, which will likely need rear-door heat exchangers [1].
- Rack power at maximum density, using the 14 to 18 kW estimate: 224 to 288 kW liquid, 112 to 144 kW air (calculated). Both are far above what most halls can feed, so practical racks hold fewer nodes.
- Two air-cooled systems per rack: 28 to 36 kW (calculated), comparable to the default HGX rack.

## Interactions with other layers

- Cooling: the air-cooled MI350X at full density is far beyond the 30 to 40 kW air-with-containment limit; rear-door heat exchangers or fewer nodes per rack are needed.
- Power: the 14 to 18 kW per-system range is an estimate, so the busway check carries `estimate` basis.
- Network: up to eight 400 G NICs per system, half the per-port speed of the 800 G NICs on HGX B300.
- Compute: no rack-scale scale-up domain; NVLink-style 72-GPU domains arrive with AMD Helios.

## What to watch for

- The gap between maximum and practical density. Use the node count the hall can feed and cool.
- Liquid-cooled MI355X racks bring the same floor-load and CDU questions as other liquid racks.
- Performance claims are AMD's; independent benchmarks vary by workload.

## Typical failure modes

- Air racks planned at the 64-GPU maximum without rear-door cooling.
- Rack power taken from GPU board power alone, ignoring CPUs, NICs, fans and conversion losses.

## Sources

1. The Register, "AMD's MI355X is a 1.4 kW liquid-cooled monster built to battle Nvidia's Blackwell", https://www.theregister.com/2025/06/12/amd_mi355x/ (press)
