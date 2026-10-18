# Cooling tower

An evaporative heat rejector. Warm condenser water is sprayed over fill while fans draw air through it; a small part of the water evaporates and cools the rest. It can cool water to a few kelvin above the outdoor wet-bulb temperature, below what any dry coil can reach.

## What it is

An open tower brings the circulating water into direct contact with outdoor air, so it is used on a condenser loop that serves water-cooled chillers or a plate heat exchanger, never directly on the technical loop to the racks. A closed-circuit tower (fluid cooler) runs the process water inside a coil and sprays separate water over it, at a slightly worse approach. The app models a tower as working to wet bulb plus approach, with water use as evaporation plus blowdown.

## When to use it

- Large plants in warm, dry climates where the wet bulb is well below the dry bulb.
- Water-cooled chiller plants: a lower condenser temperature raises chiller COP (see `cooling/chiller`).
- Sites with a secure water supply and a permit that covers peak days.
- Not where water is scarce or the permit is tight; then use dry or adiabatic coolers.

## Textbook numbers

- Standard tower rating point: 35 °C hot water, 29.4 °C cold water, 25.6 °C wet bulb (95/85/78 °F). That is a 5.6 K range and a 3.9 K approach to wet bulb (textbook, ASHRAE Handbook, HVAC Systems and Equipment).
- Evaporation (calculated): 1 kWh of heat = 3,600 kJ. With a latent heat of about 2,430 kJ/kg near 30 °C, fully evaporative rejection takes 3,600 / 2,430 = 1.48 kg, about 1.5 L of water per kWh of heat. In cold weather part of the heat leaves as sensible heat, so actual evaporation per kWh is lower.
- Make-up water = evaporation + blowdown + drift [1].
- Blowdown = evaporation / (cycles of concentration − 1) [2]. At 3 cycles, blowdown is half the evaporation; at 5 cycles, a quarter; at 7 cycles, a sixth.
- Example (calculated): a 10 MW heat load on a design day at 1.5 L/kWh evaporates 15 m³ per hour. At 4 cycles, blowdown adds 5 m³ per hour, so make-up is about 20 m³ per hour, or 480 m³ per day if the load and weather hold all day.

## Interactions with other layers

- Site: the wet-bulb series from the climate file sets the cold-water temperature each hour; the water allowance limits the peak day.
- Water: the tower is usually the largest water user on the site (see `cooling/water-use`).
- Power: fans and condenser pumps are modest, and the lower condenser temperature cuts chiller power on hot hours. On hot hours this gives a lower electrical peak than air-cooled chillers.
- Coolant: the open loop is dirty by design and must be separated from the technical loop by a heat exchanger.

## What to watch for

- Peak-day water against the permit. Evaporation tracks heat load and weather, so heat waves set the peak.
- Water treatment: scale, corrosion and biological control (Legionella) need a treatment program and sampling.
- Cycles of concentration are limited by make-up water hardness and silica; higher cycles save water but raise scaling risk [2].
- Plume and drift near air intakes, roads or neighbours.
- Freeze protection in winter for basins and make-up lines.

## Typical failure modes

- Scaling of fill and heat exchangers, which raises the approach over months.
- Biological growth in the basin, a health and compliance risk.
- Water supply interruption: without stored make-up water the tower runs dry within hours at full load.
- Fan or gearbox failure on a cell without redundancy.

## Sources

1. U.S. Department of Energy, Federal Energy Management Program, "Best management practice #10: cooling tower management". https://www.energy.gov/femp/best-management-practice-10-cooling-tower-management
2. Anglian Water, "Reducing water use in cooling towers". https://wholesale.anglianwater.co.uk/siteassets/resources/useful-documents/nhh-reducing-water-use-in-cooling-towers.pdf
3. Latent heat of water: steam tables (textbook). Examples above are calculated.
