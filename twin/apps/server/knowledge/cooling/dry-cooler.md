# Dry cooler

A finned coil with fans, outdoors, that cools facility water with outdoor air and no compressor and no water spray. It can only cool the water to some kelvin above the outdoor dry-bulb temperature.

## What it is

Warm facility water (usually a glycol mix, to survive freezing nights) flows through a large air-to-liquid coil. Fans pull outdoor air across it. Heat leaves as sensible heat into the air, so no water is consumed. The difference between the water leaving the coil and the outdoor air entering it is the approach. The app treats the approach as a catalog parameter and runs the rule each hour:

- the dry cooler alone is enough while T_out + approach ≤ facility supply setpoint;
- otherwise a trim chiller or adiabatic assist must make up the difference, or the supply-temperature check fails.

Fan power rises with outdoor temperature, because the fans speed up as the air gets closer to the water temperature.

## When to use it

- Warm-water liquid cooling (ASHRAE W32 to W45 classes, see `cooling/coolants`). Every kelvin of warmer supply raises the outdoor temperature up to which the dry cooler works alone by the same kelvin (see the hour rule below).
- Cool climates for any load: a dry cooler can carry an air-cooled hall for most of the year in Stockholm or Frankfurt.
- Sites with no water allowance.
- Not alone in hot climates for low supply setpoints. Data Center Knowledge describes plain dry cooling as working best where outdoor temperatures stay below about 27 °C, unless the loop runs warmer [1].

## Textbook numbers

- Hour rule (calculated example): with a 40 °C facility supply and an 8 K approach set in the catalog, the dry cooler carries the load whenever outdoor air is at or below 32 °C. Above that, trim is needed. For racks taking 45 °C coolant (NVIDIA's stated Vera Rubin supply temperature [2]), a 4 °C CDU approach [3] leaves 41 °C at the facility side, and the threshold becomes 33 °C.
- Heat per unit airflow follows the same balance as inside the hall: Q = ρ·c_p·V·ΔT_air. Rejecting 1 MW with a 10 K air temperature rise takes about 83 m³/s of outdoor air (calculated with ρ = 1.2 kg/m³, c_p = 1.005 kJ/(kg·K)), so dry cooler yards cover a large area.
- Water use: zero at the site, except for any adiabatic option (see `cooling/adiabatic-dry-cooler`).

## Interactions with other layers

- Coolant: the supply setpoint and the rack maximum decide how many hours the dry cooler works alone. The CDU approach sits between the rack supply and the facility supply (4 °C for Vertiv's 2,300 kW CDU [3]).
- Site: hourly outdoor temperature from the climate file drives the hours that need trim.
- Power: fan power is small per kW of heat but peaks on hot hours, on top of any trim chiller.
- Layout: the yard or roof area is large; fans must not recirculate their own warm exhaust.
- Water: glycol in the facility loop lowers c_p and raises pumping power (see `cooling/coolants`).

## What to watch for

- Design dry bulb, not average temperature. One hot afternoon decides whether racks throttle.
- Air recirculation between closely spaced units, and heat from neighbouring chillers or generators, raises the effective inlet temperature.
- Glycol share: needed against freezing, but lowers heat capacity.
- Noise from many fans at full speed on hot days, which some permits limit.

## Typical failure modes

- Supply temperature above the rack limit during heat waves when there is no trim.
- Fouled coils (dust, pollen, cottonwood seeds), which raise the approach over a season.
- Fan or VFD failure without N+1 units.
- Freezing a coil that was filled with too little glycol.

## Sources

1. Data Center Knowledge, "The pros and cons of dry coolers for data centers". https://datacenterknowledge.com/cooling/the-pros-and-cons-of-dry-coolers-for-data-centers
2. Data Center Dynamics, "Vera Rubin hot water cooling reveal triggers HVAC share drop". https://www.datacenterdynamics.com/en/news/vera-rubin-hot-water-cooling-reveal-triggers-hvac-share-drop
3. Vertiv, CoolChip CDU 2300 kW datasheet. https://www.vertiv.cn/4a480e/globalassets/shared/vertiv-coolchipcdu-2300kw-_datasheet_global-english_sl-80607.pdf
