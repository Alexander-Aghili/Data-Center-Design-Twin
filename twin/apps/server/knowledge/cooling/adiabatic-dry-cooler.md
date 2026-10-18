# Adiabatic dry cooler

A dry cooler with wetted pads or spray nozzles on the air inlet. It runs dry for most hours and wets the incoming air only when it is hot, cooling that air toward its wet-bulb temperature before it reaches the coil.

## What it is

The coil and fans are the same as a dry cooler (see `cooling/dry-cooler`). In front of the coil sits an evaporative pad or a row of nozzles. When the outdoor dry bulb passes a set threshold, water is applied; some of it evaporates, the air cools, and the coil sees a lower inlet temperature. The water does not touch the facility loop, so the loop stays closed and clean.

The app models it as a dry cooler whose inlet temperature drops on spray hours:

T_air,in = T_db − ε · (T_db − T_wb)

where ε is the pad or spray effectiveness, and it counts water only for hours above the spray threshold.

## When to use it

- Climates with hot, dry summers where a plain dry cooler fails the supply check for a few hundred hours a year but water is scarce.
- Liquid-cooled halls with warm supply: spraying is needed only on the hottest hours.
- As an alternative to trim chillers, trading some water for a lower peak electrical load on hot hours.
- Less useful in humid climates, where the wet bulb is close to the dry bulb and evaporation gains little.

## Textbook numbers

- Pad effectiveness: a study of a dry cooler with evaporative pads measured pad efficiency falling from 97% to 88% as face velocity rose from 2 to 3 m/s [1].
- Example (calculated): at 38 °C dry bulb and 22 °C wet bulb with ε = 0.88, the coil sees 38 − 0.88 × 16 = 23.9 °C air, 14 K cooler than the outdoor air.
- Water per spray hour (calculated): cooling 1 m³/s of air by 14 K removes 1.2 × 1.005 × 14 = 16.9 kW of sensible heat from the air, which evaporates 16.9 / 2,430 = 0.007 kg/s of water (latent heat of water near 30 °C about 2,430 kJ/kg). Overspray and drain water come on top.
- Annual water: a vendor quotes about 0.2 to 0.5 L per kWh for adiabatic systems against 1.5 to 3.0 L/kWh for a cooling tower plant [2]. Uptime Institute research, as reported by Data Center Frontier, says adiabatic approaches can cut water use compared with evaporative heat rejection by half or more [3]. Both depend strongly on climate and the spray threshold.

## Interactions with other layers

- Site: the hourly wet bulb from the climate file sets how much the spray helps; the water allowance caps how many hours it may run.
- Water: peak-day water use is the binding check, not the annual total. Spray hours bunch together in heat waves.
- Power: fans can slow down on spray hours, and the trim chiller can be smaller or absent.
- Coolant: the higher the facility supply setpoint, the fewer hours need spray at all.

## What to watch for

- Water quality. Spray nozzles scale in hard water; pads clog. Some designs need softened or treated water, which adds blowdown.
- Legionella risk where water sits in sumps or pads; drain-down and treatment rules apply.
- The threshold setting: a low threshold wastes water on hours a dry coil could handle.
- Pad face velocity: higher airflow lowers effectiveness [1].

## Typical failure modes

- Spray failure on the one day it is needed (blocked nozzles, failed solenoid, frozen line from winter).
- Scale on the coil fins from spray carry-over, which permanently raises the approach.
- Water supply interruption during a heat wave.
- Exceeding a daily water permit in a long hot spell.

## Sources

1. Energy Reports (November 2023), experimental study of a dry cooler with evaporative pads. https://doaj.org/article/3f463fe481c04e0a90a921d137dbee52
2. Frigel, "Data center adiabatic cooling systems" (vendor figures). https://www.frigel.com/data-center-adiabatic-cooling-systems
3. Data Center Frontier, "The hidden variable in every adiabatic water budget: climate" (citing Uptime Institute). https://www.datacenterfrontier.com/sponsored/article/55406929/the-hidden-variable-in-every-adiabatic-water-budget-climate
4. Latent heat of water: steam tables (textbook). Example values above are calculated.
