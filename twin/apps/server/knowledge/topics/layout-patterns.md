# Layout patterns

How racks are arranged and where services run: hot and cold aisles, containment, row length, and whether air, pipes, power and cable go under a raised floor, on the slab or overhead.

## What it is

- Hot aisle / cold aisle: racks face each other across a cold aisle and back onto a hot aisle, so exhaust does not blow into the next row's intakes.
- Cold aisle containment (CAC) closes the supply aisle with doors and a roof. Hot aisle containment (HAC) closes the exhaust aisle and ducts it back to the cooling units or a ceiling plenum.
- Raised floor: a void under removable panels carries supply air and, often, pipes and cable. Data center voids trend toward 80 to 100 cm [1].
- Slab: racks stand on the structural floor; air, power, pipes and cable run overhead.
- Overhead services: busways, cable trays and liquid pipes hung above the rows.

## When to use it

- Air-cooled halls: always run hot and cold aisles, and contain one of them.
- Retrofits with an existing raised-floor air supply: CAC works with the perforated tiles already in place.
- New builds: HAC, with slab and overhead services for liquid-cooled racks.
- Liquid-cooled halls still need containment for the air share (18 kW of a 136 kW GB300 NVL72 [3]).

## Textbook numbers

- Hot and cold aisle layout alone: 10 to 35% cooling energy savings [2].
- Cold aisle containment: up to 30% lower cooling energy cost; hot aisle containment can save 40% more than cold aisle [2].
- Raised floor loading for data centers: 12 kN/m² uniform and 4.5 kN point load, each with a 3× safety factor [1].
- Panel concentrated-load ratings: about 1,000 to 3,000 lb [4].
- Warmer supply air: one ENERGY STAR case raised supply air from 50 to 60 °F to 70 to 80 °F, and chilled water from 44 to 55 °F for about 20% better efficiency [2].

## Interactions with other layers

- Cooling: containment sets usable air ΔT and how warm the supply can run, which sets free-cooling hours.
- Layout: row length sets CDU and CRAH reach and the number of row-end positions.
- Power: overhead busways need ceiling height and clear routes above containment roofs.
- Network: cable trays share the overhead space with busways and pipes.
- Site: ceiling height and floor rating decide whether overhead routing and heavy racks are possible.

## What to watch for

- Leak exposure. Pipes under a raised floor hide leaks and need leak detection; overhead pipes drip onto racks unless trays and drip pans are used (see `liquid-cooling-operations`).
- Installation time: overhead routing is faster to build than under-floor in the app's build-out model.
- Gaps in contained rows. Every empty slot needs blanking.
- Long rows. Flow balance and pressure drop along the row manifold worsen with length.

## Typical failure modes

- Heavy liquid racks placed on a raised floor specified for air racks.
- Containment roofs blocking sprinkler coverage or overhead service access.
- CAC in a hall where the rest of the room becomes the hot aisle, overheating equipment outside the containment.
- Pipes, busways and cable trays all routed in the same overhead zone with no clearance plan.

## Sources

1. Wikipedia, "Raised floor", https://en.wikipedia.org/wiki/Raised_floor (textbook)
2. ENERGY STAR, "Containment/enclosures", https://www.energystar.gov/products/data_center_equipment/16-more-ways-cut-energy-waste-data-center/containmentenclosures (textbook)
3. Lenovo Press, GB300 NVL72 3D tour, https://lenovopress.lenovo.com/3dtours/gb300nvl72 (oem)
4. TechTarget, "Selecting raised floors, panels for the data center", https://www.techtarget.com/searchdatacenter/tip/Selecting-raised-floors-panels-for-the-data-center (press)
