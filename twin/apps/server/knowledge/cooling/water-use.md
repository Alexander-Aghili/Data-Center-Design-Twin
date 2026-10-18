# Water use

How much water the site consumes, where it goes, and how the app checks it against the site allowance. Nearly all on-site water in a data center is evaporated by heat rejection; the closed technical and facility loops hold a fixed volume and consume almost nothing.

## What it is

Water use is set by the heat rejection method:

- Dry coolers and air-cooled chillers: no evaporation. Water is only needed to fill the loops and for domestic use.
- Adiabatic dry coolers: water only on spray hours, when the outdoor air is hot (see `cooling/adiabatic-dry-cooler`).
- Cooling towers: evaporation every hour the tower runs, plus blowdown to control dissolved solids (see `cooling/cooling-tower`).

The app computes water per hour, per day and per year from the hourly heat load and weather, and checks the peak day against the site's daily allowance.

## When to use it

Read this file when choosing heat rejection on a site with a water permit, a drought-exposed supply, or a community that tracks data center water use. The choice between a cooling tower and a dry cooler is usually a trade between water and peak electrical load.

## Textbook numbers

- WUE (water usage effectiveness) = annual site water consumption in litres / IT energy in kWh. The Green Grid introduced it in 2011 as a companion to PUE [1]; ISO/IEC 30134-9:2022 standardises it [2]. It counts on-site water only; water consumed at power plants is a separate figure.
- Evaporation per kWh of heat (calculated): 3,600 kJ / 2,430 kJ/kg = 1.48 kg, about 1.5 L per kWh of heat rejected fully by evaporation.
- Blowdown = evaporation / (cycles − 1); at 4 cycles that adds a third, for about 2.0 L per kWh of heat (calculated).
- WUE from heat (calculated): heat rejected is IT energy plus the cooling and distribution losses that also end up as heat. At a PUE of 1.3, each kWh of IT energy means about 1.3 kWh of heat, so a tower plant at 2.0 L per kWh of heat has a design-day WUE near 2.6 L/kWh. The annual figure is lower because cool hours evaporate less.
- Adiabatic systems: a vendor quotes 0.2 to 0.5 L/kWh against 1.5 to 3.0 L/kWh for cooling towers [3].
- US totals: Lawrence Berkeley National Laboratory's 2024 report estimates US data centers consumed about 17.4 billion gallons (66 billion litres) of water directly in 2023, and about 211 billion gallons (800 billion litres) indirectly through electricity generation [4].

## Interactions with other layers

- Site: the climate file sets wet bulb and dry bulb each hour; the water allowance is a site input.
- Cooling: a warmer facility supply setpoint cuts tower and spray hours. Each kelvin of warmer supply moves more hours onto dry coolers.
- Power: the method that uses no water usually draws the most electricity on hot hours, which is when the grid cap binds. The app shows both on the same hourly chart.
- Cost: water and sewer charges, treatment chemicals and blowdown disposal.

## What to watch for

- The peak day, not the annual total. Evaporation follows heat load and weather, so heat waves set the peak, and permits are often written per day.
- Water source and quality. Hard water limits cycles of concentration and raises blowdown.
- Indirect water. A dry plant consumes no water on site but draws more power, and power generation consumes water too [4].
- Reporting basis. WUE can be quoted as consumption or withdrawal; compare like with like.

## Typical failure modes

- Exceeding the daily permit during a heat wave, forcing a switch to trim chillers that the grid cap may not allow.
- Supply interruption with no on-site storage, so evaporative units stop.
- Blowdown discharge limits (temperature, chemistry) that cap how much the site can release.
- Underestimating spray hours on an adiabatic plant because the design used average rather than extreme weather.

## Sources

1. The Green Grid, WP#35, "Water usage effectiveness (WUE): a Green Grid data center sustainability metric" (2011). https://www.thegreengrid.org/en/resources/library-and-tools/238-WP
2. ISO/IEC 30134-9:2022, Data centres key performance indicators, part 9: water usage effectiveness. https://www.iso.org/standard/77692.html
3. Frigel, "Data center adiabatic cooling systems" (vendor figures). https://www.frigel.com/data-center-adiabatic-cooling-systems
4. Shehabi et al., "2024 United States data center energy usage report", Lawrence Berkeley National Laboratory, LBNL-2001637. https://eta-publications.lbl.gov/publications/2024-lbnl-data-center-energy-usage-report
5. Latent heat of water: steam tables (textbook). WUE examples above are calculated.
