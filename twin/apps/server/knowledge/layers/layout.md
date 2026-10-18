# Layout layer

The layout layer places racks on the slot grid, groups them into rows, sets containment (hot or cold aisle) and assigns cooling zones: which CDU or CRAH serves which slots. It is where rack weight meets the floor and where pipe and cable lengths come from.

## What it is

Each slot sits in a floor bay with a rating in kN/m². Floor load per bay is the sum of rack weights (including coolant and any weight the cooling method adds) over the bay area, plus a point-load check per rack foot. Rows set containment geometry. Zones set the distance from each rack to its CDU, which drives pipe length, pressure drop, installation time and cost.

## When to use it

- After choosing rack types, to see whether the floor and positions can take them.
- When a floor-load check fails. Spreading heavy racks across bays, leaving empty slots between them, or moving them to slab bays are layout fixes.
- When a zone runs out of CDU or CRAH positions.

## Textbook numbers

- Raised floor requirement for data centers: 12 kN/m² uniform load and 4.5 kN point load, each with a 3× safety factor; void heights trend toward 80 to 100 cm [1].
- Panel concentrated-load ratings: typically 1,000 to 3,000 lb (about 4.4 to 13.3 kN, converted). A 2,500 lb cabinet on four feet puts about 625 lb on each foot [2].
- A GB300 NVL72 at about 1,360 kg on a 0.64 m² footprint is about 21 kN/m²; there is no official NVIDIA floor-loading spec [3].
- Average installed rack density is still below 8 kW [4], so many existing floors were rated for racks a tenth as heavy in power and much lighter in mass.
- Air side: airflow V = Q / (ρ·c_p·ΔT). A 30 kW rack at 12 K needs about 2.1 m³/s (calculated with ρ = 1.2 kg/m³, c_p = 1.005 kJ/(kg·K)).

## Interactions with other layers

- Compute: rack type sets weight and footprint. Double-wide racks (AMD Helios on Open Rack Wide) take two slots.
- Cooling: containment type sets usable air ΔT; zone assignment sets CDU load and pipe runs.
- Power: rows map to busways, so moving racks moves load between busways.
- Network: rack-to-leaf distance comes from routed length along rows, which decides copper or optics.

## What to watch for

- Point loads. A heavy rack on four feet can pass the bay average and still overload one panel. Weight sits toward the front of a cabinet [2].
- Rolling loads during installation. Moving a 1.4 t rack across tiles rated for 10 passes is a separate check from the static load [2].
- Partial rows with containment. Gaps must be blanked or the containment leaks.
- Racks far from their CDU, which add pipe length and pressure drop.

## Typical failure modes

- A raised-floor bay over its rating after a GPU swap.
- More CDUs needed in a row than there are positions at the row end.
- Heavy racks clustered in one bay when the same racks spread over two would pass.
- Containment broken by a double-wide rack or an empty slot.

## Sources

1. Wikipedia, "Raised floor", https://en.wikipedia.org/wiki/Raised_floor (textbook)
2. TechTarget, "Selecting raised floors, panels for the data center", https://www.techtarget.com/searchdatacenter/tip/Selecting-raised-floors-panels-for-the-data-center (press)
3. Introl, "Why NVIDIA GB300 NVL72 (Blackwell Ultra) matters", https://introl.com/blog/why-nvidia-gb300-nvl72-blackwell-ultra-matters (press)
4. Upsite Technologies, "Data Center Trends: Rack Density Rises While PUE and Outage Frequency Remain Flat", https://www.upsite.com/blog/data-center-trends-rack-density-rises-while-pue-and-outage-frequency-remain-flat/ (press)
