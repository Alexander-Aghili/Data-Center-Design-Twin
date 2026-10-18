# NVIDIA HGX B300 (8-GPU servers)

HGX B300 is NVIDIA's 8-GPU Blackwell Ultra server board, sold inside OEM servers and as the DGX B300. In this app it stands for the air-coolable server rack: a few 8-GPU boxes per rack, fans in each chassis, and no rack-scale NVLink domain.

## What it is

Eight Blackwell Ultra SXM GPUs share an NVLink switch on the baseboard. The DGX B300 version is a 10U system with 2.1 TB of GPU memory, 72 PFLOPS of sparse FP8 (about 36 PFLOPS dense), 108 PFLOPS dense FP4, and about 14 kW of system power [1]. Networking is eight 800 Gb/s OSFP ports on ConnectX-8 plus two BlueField-3 DPUs [1]. NVIDIA offers AC and DC power options and an MGX-rack variant [1].

## When to use it

- Halls built for air, with hot or cold aisle containment and CRAHs.
- Inference or mid-size training where an 8-GPU NVLink domain is enough.
- Retrofits where the floor, power and cooling cannot take 130 kW racks.

## Textbook numbers

- System power: about 14 kW per 8-GPU system [1].
- Two systems per rack: about 28 kW per rack (calculated), the default plan's rack.
- Three systems: about 42 kW (calculated), at or past the 30 to 40 kW practical limit for air with containment (see `air-containment`).
- Airflow for a 28 kW rack at 12 K: about 1.9 m³/s (calculated, V = Q / (ρ·c_p·ΔT)).
- Rack compute at two systems: about 72 PFLOPS dense FP8 (2 × 36, calculated).

## Interactions with other layers

- Cooling: all heat goes to air unless the OEM build is liquid cooled. Rear-door heat exchangers extend a rack to roughly 50 to 70 kW (see `rear-door-heat-exchanger`).
- Layout: low weight per rack compared with NVL72 systems, so raised floors usually pass.
- Power: 14 kW per system makes busways easy; the grid cap, not the busway, usually binds.
- Network: eight 800 G NIC ports per system. Rack-to-leaf runs often exceed DAC reach, so expect AEC or optics.

## What to watch for

- Density creep: adding a third system per rack breaks the air limit.
- Hot hours: air-cooled racks need colder supply air than liquid racks need water, so they get fewer free-cooling hours.
- The NVLink domain ends at eight GPUs; larger models spill traffic onto the scale-out fabric.

## Typical failure modes

- Racks at 40 kW+ on air with poor containment, causing recirculation and inlet temperatures above the ASHRAE recommended range.
- Too few CRAHs per zone for the airflow.
- Optics power on many 800 G links left out of the facility budget.

## Sources

1. NVIDIA, "DGX B300", https://www.nvidia.com/en-us/data-center/dgx-b300/ (vendor)
