# AMD Helios

Helios is AMD's first rack-scale AI system: 72 MI450-series GPUs (AMD's product pages name the MI455X), EPYC "Venice" CPUs and Pensando networking in a double-wide, liquid-cooled rack built on Meta's Open Rack Wide (ORW) design for the Open Compute Project [1], [2]. AMD has not published rack power, and reported weights disagree.

## What it is

Per AMD, a Helios rack delivers up to 1.4 exaFLOPS FP8 and 2.9 exaFLOPS FP4, with 31 TB of HBM4 and 1.4 PB/s of aggregate memory bandwidth [1]. Scale-up bandwidth is up to 260 TB/s and Ethernet scale-out is 43 TB/s [1]. The rack is built on OCP Open Rack Wide, UALink and Ultra Ethernet [1]. ORW is a double-wide rack; AMD says the double-wide layout reduces weight density and improves serviceability, and the rack uses backside quick-disconnect liquid cooling [2]. Volume deployment through OEM and ODM partners is expected in 2026 [2].

## When to use it

- Halls planned around open-rack (OCP) infrastructure.
- Large training or inference where a 72-GPU scale-up domain is wanted from a second vendor.
- Only where floors are rated for very heavy racks and layouts can take double-wide slots.

## Textbook numbers

- Weight: AMD CEO Lisa Su said at CES 2026 that the rack weighs "nearly 7,000 pounds" (about 3,175 kg) [3]. Other reporting gives a range of about 5,000 to 7,000 lb (about 2,270 to 3,175 kg) [4]. The catalog flags this as a weight conflict and uses the higher figure for floor checks.
- Width: double-wide, so it occupies two standard slots in the app.
- Floor load: about 31.1 kN per rack at 3,175 kg (calculated). The double-wide frame spreads that over roughly twice the width of a single rack, but the depth is not published, so the load per square metre stays unknown.
- Memory per GPU: up to 432 GB of HBM4 [2]. AMD's own pages give different per-GPU bandwidth figures: 19.6 TB/s in the launch blog [2] and 23.3 TB/s in the product spec table [1].
- Rack power: not published by AMD. One press analysis estimates about 140 kW per rack [4]; carry it as `estimate`, or `null` until an OEM figure exists.
- Price: analysts estimate $5 to 5.5 million per rack; AMD publishes no list price [4].

## Interactions with other layers

- Layout: double-wide racks change row length, containment panel sizes and slot counts. They also concentrate up to 3.2 t on one footprint.
- Cooling: fully liquid cooled; size CDUs once AMD or an OEM publishes heat load.
- Power: with no vendor figure, busway checks stay `unknown` unless the estimate is entered.
- Network: scale-out runs on Ethernet with Pensando NICs [1], so the fabric choice is Ethernet.

## What to watch for

- The weight conflict. Use the 7,000 lb figure until an OEM datasheet settles it.
- Rolling loads during delivery and placement, which are separate from the static floor check.
- Spec drift between AMD pages; re-check before committing.

## Typical failure modes

- Placing Helios on a raised-floor bay sized for single-width liquid racks.
- Treating missing power data as zero, so the grid and busway checks pass falsely.
- Containment designed for single-width racks that does not fit an ORW frame.

## Sources

1. AMD, "Helios" rack-scale solution, https://www.amd.com/en/products/rackscale-solutions/helios.html (vendor)
2. AMD, "AMD Helios: Advancing Openness in AI Infrastructure Built on Meta's 2025 OCP Open Rack for AI Design", https://amd.com/en/blogs/2025/amd-helios-ai-rack-built-on-metas-2025-ocp-design.html (vendor)
3. TechCrunch, "AMD's Helios rack weighs the same as two compact cars", https://techcrunch.com/?p=3080157 (press)
4. ai2.work, "Inside AMD's $5.25M Helios Rack and Its 12 Gigawatts of Demand", https://ai2.work/blog/inside-amd-s-5-25m-helios-rack-and-its-12-gigawatts-of-demand (press)
