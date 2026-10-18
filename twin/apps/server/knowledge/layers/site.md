# Site layer

The site layer holds the inputs nobody in the hall can change: the climate, the grid connection, the water allowance, the hall's dimensions, the floor type and rating per bay, and the ceiling height. Every other layer is checked against them.

## What it is

In this app the site is fixed. The location is legal, the utility delivers a fixed capacity in MW, and the water allowance is a fixed volume per day. The location preset supplies 8,760 hourly dry-bulb and wet-bulb temperatures, which drive heat rejection hour by hour. The hall geometry and floor ratings bound how many racks fit and how heavy they can be.

## When to use it

- At the start of a plan, to set the envelope.
- When a check fails on grid headroom, peak-day water or floor load. The fix is almost never on the site layer itself, but the site value tells you how far over you are.
- For what-if comparisons between climate presets (for example Dallas and Stockholm) with the same hall.

## Textbook numbers

- Grid connection lead time: the median project built in the US in 2023 took about 5 years from interconnection request to commercial operation, up from under 2 years for projects built in 2000 to 2007 [1]. That figure is for generators joining the grid; it is the best public proxy for how slow new transmission capacity is.
- US data centers used about 176 TWh in 2023 (about 4.4% of US electricity), with 2028 scenarios between 325 and 580 TWh [2].
- Raised access floors in data centers are commonly specified around 12 kN/m² uniform load and 4.5 kN point load [3]; panels are rated by concentrated load, typically 1,000 to 3,000 lb (about 4.4 to 13.3 kN) [4]. A structural slab is usually rated higher, but the actual value comes from the structural engineer.
- Heat-rejection performance depends on the hottest hours, not the annual mean. A dry cooler with a 7 K approach serving 30 °C facility water stops working without trim cooling above about 23 °C outdoor dry bulb (30 − 7, calculated).

## Interactions with other layers

- Cooling: the climate sets free-cooling hours, chiller COP, dry-cooler trim hours and tower water use.
- Power: the grid cap is the ceiling for IT plus cooling plus distribution losses in every hour.
- Layout: hall dimensions set row count and length; floor rating per bay limits rack weight.
- Compute: usable compute is whatever the grid can carry at the worst hour.

## What to watch for

- A plan that passes on the annual average but fails on the hottest few hundred hours.
- Water allowance stated per day while evaporative use peaks on the hottest days, so peak-day use, not the annual mean, decides compliance.
- Raised-floor bays rated for air-cooled racks receiving liquid-cooled racks that weigh 1,300 to 1,600 kg.
- Ceiling height limiting hot-aisle plenums and overhead pipe and busway routing.

## Typical failure modes

- Grid cap exceeded on hot afternoons because cooling power rises exactly when IT load is already at its peak.
- A bay over its rating because the floor was specified for 10 to 15 kW racks.
- Evaporative heat rejection chosen where the water allowance cannot cover peak days.

## Sources

1. Lawrence Berkeley National Laboratory, "Queued Up: 2024 Edition", https://eta-publications.lbl.gov/bibcite/reference/36234 (textbook)
2. US Department of Energy, "DOE Releases New Report Evaluating Increase in Electricity Demand from Data Centers", https://www.energy.gov/articles/doe-releases-new-report-evaluating-increase-electricity-demand-data-centers (textbook)
3. Wikipedia, "Raised floor", https://en.wikipedia.org/wiki/Raised_floor (textbook)
4. TechTarget, "Selecting raised floors, panels for the data center", https://www.techtarget.com/searchdatacenter/tip/Selecting-raised-floors-panels-for-the-data-center (press)
