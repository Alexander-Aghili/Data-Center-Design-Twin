# Cooling layer

The cooling layer chooses how each rack group is cooled, how the heat leaves the building, which coolant runs in the loops, the facility supply temperature, the piping route, flow balancing and buffer tank volume. It is the deepest layer in the app; the method files in `cooling/` hold the detail.

## What it is

Heat moves through a chain. At the rack it goes into air, a cold plate, a rear-door coil or an immersion bath. A CDU moves liquid heat from the technical loop (the rack side) to the facility loop across a heat exchanger. CRAHs move air heat into chilled or facility water. The plant (chiller, dry cooler, adiabatic dry cooler or cooling tower) rejects it outdoors, hour by hour against the climate.

## When to use it

- Whenever rack power changes. Air with containment tops out around 30 to 40 kW per rack; above that the rack needs rear-door, direct-to-chip or immersion cooling (see `air-containment`, `direct-to-chip-single-phase`).
- When the water allowance or the climate rules out a heat-rejection method.
- When a rack's coolant temperature limit is lower than the plant can deliver on hot hours.

## Textbook numbers

- Liquid flow per rack: ṁ = Q / (c_p·ΔT). The GB300 NVL72 sends 118 kW to liquid and 18 kW to air [1]; at a 10 K rise that is about 2.8 kg/s of water (calculated, c_p = 4.186 kJ/(kg·K)).
- Airflow for the same rack's 18 kW at 12 K: about 1.2 m³/s (calculated).
- Supply temperatures: GB300 NVL72 runs on 18 to 45 °C warm water with PG25 or DI water [2]; Vera Rubin NVL72 lists a 45 °C inlet [3].
- Evaporative water: about 1.5 L per kWh of heat rejected (calculated from a latent heat of about 2.4 MJ/kg against 3.6 MJ per kWh), plus blowdown.
- Containment: hot and cold aisle layout alone saves 10 to 35% of cooling energy; hot-aisle containment can save 40% more than cold-aisle [4].
- Global average PUE was 1.56 in 2024 and has sat between 1.55 and 1.59 through the 2020s [5].

## Interactions with other layers

- Compute: rack power, liquid fraction and maximum coolant temperature are inputs.
- Layout: zones set CDU load and pipe length; liquid-cooled racks add coolant weight to the floor.
- Power: pumps, fans, chillers and trim cooling count against the grid cap every hour.
- Site: climate sets free-cooling hours and trim hours; water allowance limits evaporative options.

## What to watch for

- Hot hours. Dry coolers lose capacity exactly when IT load and grid demand peak.
- Flow balance along row manifolds. Without balancing valves the last racks get less flow.
- Piping route. A raised floor hides leaks and slows installation; overhead routing is faster to build and easier to inspect (see `liquid-cooling-operations`).
- Ride-through. Buffer tank minutes must cover a chiller restart.

## Typical failure modes

- Racks above the air limit left on air.
- CDU positions exhausted in a zone.
- Dry coolers that need trim cooling for hundreds of hours, pushing the facility over the grid cap.
- Evaporative cooling chosen where peak-day water exceeds the allowance.

## Sources

1. Lenovo Press, GB300 NVL72 3D tour, https://lenovopress.lenovo.com/3dtours/gb300nvl72 (oem)
2. Lenovo Press, GB300 NVL72 datasheet DS0207, https://lenovopress.lenovo.com/ds0207 (oem)
3. NVIDIA, "Vera Rubin NVL72", https://www.nvidia.com/en-in/data-center/vera-rubin-nvl72/ (vendor)
4. ENERGY STAR, "Containment/enclosures", https://www.energystar.gov/products/data_center_equipment/16-more-ways-cut-energy-waste-data-center/containmentenclosures (textbook)
5. Upsite Technologies, citing Uptime Institute's 2024 survey, https://www.upsite.com/blog/data-center-trends-rack-density-rises-while-pue-and-outage-frequency-remain-flat/ (press)
