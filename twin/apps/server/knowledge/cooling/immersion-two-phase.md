# Immersion cooling, two phase

Servers sit in a sealed tank of engineered fluid that boils on the hot chips. The vapour rises, condenses on a water-cooled coil under the lid and drips back. All IT heat goes to the facility water through that coil.

## What it is

The fluid is chosen to boil at a temperature just above where chips like to run, for example 50 °C at atmospheric pressure for 3M's Fluorinert FC-3284 [4]. Boiling holds every chip close to that temperature regardless of its power, without pumps in the tank. The condenser coil sits in the vapour space and is fed with facility water. The tank must stay closed in operation because the fluid evaporates readily and is expensive.

## When to use it

- Very high chip heat flux where single-phase immersion cannot keep up.
- Research and pilot deployments. Uptime Institute reports renewed interest in two-phase cooling [3], but the fluid supply situation (below) makes it a risky choice for a new production hall in 2026.
- Not for vendor rack-scale GPU systems built for cold plates.

## Textbook numbers

- Fluid supply: 3M announced in December 2022 that it would stop making PFAS by the end of 2025, which ended its Novec dielectric fluids for liquid cooling [1].
- Chemours positioned Opteon 2P50, a hydrofluoroolefin, as a two-phase immersion fluid and expected it on the market in 2025, after regulatory approvals. Its claims of more than 90% lower cooling energy and near-zero water use are vendor claims [2].
- Heat transfer per kilogram is set by the fluid's latent heat, not by a temperature rise, so in-tank flow is driven by buoyancy, not pumps.
- FC-3284 boils at 50 °C and has a 100-year global warming potential above 5,000 [4]. 3M lists it as discontinued.
- Liquid heat fraction is about 1.0, as for single-phase immersion.

## Interactions with other layers

- Coolant: the fluid's boiling point fixes the chip-side temperature. The condenser needs facility water a margin below it, which still allows warm water and dry coolers for most hours.
- Layout and floor: horizontal tanks like single-phase immersion, with similar floor area per server and heavy fluid (fluorinated fluids are much denser than oil).
- Cost: fluid purchase, vapour losses and slower servicing add to capex and operating cost.
- Water: none at the IT; heat rejection still sets site water use.

## What to watch for

- Regulation of fluorinated chemicals (US EPA and EU PFAS restrictions) and the future price and availability of replacement fluids.
- Vapour loss when the lid opens for service. Tanks need a lid interlock and a slow-open procedure.
- Breakdown products if the fluid overheats, and the ventilation needed in the hall.
- Hardware qualification: boiling surfaces, thermal interfaces and plastics must be compatible.

## Typical failure modes

- Condenser water loss: vapour pressure rises and the tank vents fluid through its relief path.
- Fluid level dropping over months from service losses, exposing the tops of boards.
- Contamination (moisture, plasticisers) that changes boiling behaviour.
- Supply risk: a fluid discontinued by its maker leaves the operator unable to top up.

## Sources

1. Data Center Dynamics, "Two-phase cooling will be hit by EPA rules and 3M's exit from PFAS forever chemicals". https://www.datacenterdynamics.com/en/news/two-phase-cooling-will-be-hit-by-epa-rules-and-3ms-exit-from-pfas-forever-chemicals
2. Data Center Dynamics, "Chemours launches two-phase immersion cooling fluid". https://www.datacenterdynamics.com/en/news/chemours-launches-two-phase-immersion-cooling-fluid/
3. Uptime Institute, "Interest in two-phase cooling warms up". https://intelligence.uptimeinstitute.com/resource/interest-two-phase-cooling-warms
4. 3M, Fluorinert Electronic Liquid FC-3284 product page. https://www.3m.com/3M/en_US/p/d/b10144228
