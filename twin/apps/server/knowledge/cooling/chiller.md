# Chiller (mechanical cooling)

A vapour-compression machine that cools the facility water below outdoor temperature. It is the only heat rejection option that works at any outdoor condition, and it pays for that in electricity.

## What it is

A chiller moves heat from the facility water (evaporator side) to outdoor air or to condenser water (condenser side) using a compressor. Air-cooled chillers reject heat through fans and finned coils on the roof or yard. Water-cooled chillers reject it into a condenser loop that runs to cooling towers (see `cooling/cooling-tower`). Many chillers include a free-cooling coil: when the outdoor air is cold enough, the compressor stops and the water is cooled by the coil and fans alone.

The app models chiller power each hour as P = Q / COP(T_out), with free-cooling hours when the outdoor temperature plus the coil approach is below the facility supply setpoint.

## When to use it

- Air-cooled halls that need supply air near 18 to 27 °C in a warm climate.
- Liquid-cooled halls in hot climates, as trim cooling for the hours when dry coolers cannot reach the setpoint.
- Sites with no water allowance, where cooling towers are not an option.
- Less needed for warm-water racks: NVIDIA says Vera Rubin's 45 °C supply needs no water chillers [3].

## Textbook numbers

- Minimum efficiency: ASHRAE 90.1 Table 6.8.1-3 (as replicated in Washington State's energy code) requires a full-load EER of about 10.1 Btu/(W·h) for air-cooled chillers of 150 tons and above (Path A) [1]. That is a COP of 10.1 / 3.412 = 2.96 (calculated).
- Ideal (Carnot) COP = T_evap / (T_cond − T_evap) in kelvin. With a 12 °C evaporator and a 45 °C condenser it is 285.15 / 33 = 8.6; raising the evaporator to 20 °C gives 293.15 / 25 = 11.7 (calculated). Real machines reach a fraction of Carnot, but the trend holds: every kelvin of warmer chilled water or cooler outdoor air raises COP.
- Restart after a power interruption: Trane states mechanical cooling returns within 120 seconds and about 3 minutes to 80% load with its rapid restart option [2]. Carrier claims 2 to 7 minutes from power loss to full capacity [4]. RagingWire reported going from 13 minutes to under 3 minutes with a quick-start retrofit (2009) [5].

## Interactions with other layers

- Power: chiller power is the largest swing term in facility power. It peaks on the hottest hours, the same hours the grid cap is tightest. PUE at the worst hour is usually set by the chillers.
- Coolant: the facility supply setpoint drives COP. A loop held at 18 °C for air units (as at Jane Street's hall, where air units share the loop with the CDUs [6]) needs far more chiller hours than a 32 to 45 °C loop for cold plates only.
- Buffer tanks: restart time sets how much stored cold water is needed (see `cooling/buffer-tanks`).
- Cost and lead time: large chillers are long-lead equipment and often sit on the build's critical path (see `topics/cost-and-lead-times`).
- Redundancy: N+1 chillers change equipment count and cost, not the energy per hour.

## What to watch for

- Peak-hour chiller power against the grid cap; annual PUE averages it away.
- Free-cooling hours depend on the setpoint; a small rise in setpoint can remove most chiller hours in a cool climate.
- Air-cooled chiller capacity falls at high ambient; the selection must hold capacity at the site's design dry bulb, not at a rating point.
- Refrigerant regulation (low-GWP refrigerant transitions) can change available models.

## Typical failure modes

- Compressor trip on a power blip. Without rapid restart or buffer storage, liquid-cooled racks throttle before the chiller is back.
- High-pressure trip on very hot days when condenser coils are dirty or recirculate their own exhaust.
- Control failure that leaves free cooling and compressors fighting each other.
- Low flow trip from a closed valve or failed pump.

## Sources

1. Washington State Energy Code, WAC 51-11C-403323, replica of ASHRAE 90.1 Table 6.8.1-3. https://lawfilesext.leg.wa.gov/law/WACArchive/2022/htm/WAC%20%2051%20%20TITLE/WAC%20%2051%20-%2011C%20CHAPTER/WAC%20%2051%20-%2011C-403323.htm
2. Trane, rapid restart sales literature AC-SLB003. https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature/Sales/AC-SLB003-EN_10302024.pdf
3. Data Center Dynamics, "Vera Rubin hot water cooling reveal triggers HVAC share drop". https://www.datacenterdynamics.com/en/news/vera-rubin-hot-water-cooling-reveal-triggers-hvac-share-drop
4. Carrier, "Capacity recovery: reliable uptime for mission critical facilities". https://www.carrier.co.id/images/pdf/Capacity%20Recovery%20-%20Reliable%20Uptime%20for%20Mission%20Critical%20Facilities.pdf
5. Data Center Knowledge, "Speeding up those chiller restarts" (2009). https://datacenterknowledge.com/business/speeding-up-those-chiller-restarts
6. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), basis press. https://www.youtube.com/watch?v=8J-GUnfSqeE
