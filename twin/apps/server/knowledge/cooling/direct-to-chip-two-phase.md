# Direct-to-chip liquid cooling, two phase

Cold plates on the chips carry a low-pressure refrigerant that boils at the chip surface. The vapour returns to a condensing unit, which passes the heat to facility water. No water enters the rack.

## What it is

The plumbing looks like single-phase DLC: cold plates, rack manifolds, a CDU. The difference is the fluid. A dielectric refrigerant enters the cold plate as liquid and partly boils. Boiling absorbs latent heat at almost constant temperature, so the chip sees a nearly uniform plate temperature and the loop needs much less mass flow per kW than water. The CDU condenses the vapour against facility water and pumps the liquid back.

## When to use it

- Chips whose heat flux pushes single-phase plates to their limit. Two-phase boiling has dissipated heat fluxes on the order of 1 kW/cm² in lab work [3].
- Sites that want no water in the white space, or warm facility water.
- Racks where pump power and pipe size matter: latent heat moves more heat per kilogram than a 10 K rise in water.
- Less suited when the operator has no refrigerant handling experience, or when the rack vendor only warrants single-phase cold plates (NVIDIA's rack-scale reference designs use single-phase plates).

## Textbook numbers

- Accelsius NeuCool MR250: a row CDU supporting 250 kW per rack (one 250 kW rack or two 125 kW racks), generally available October 2025, using R-1233zd(E) or R-515B, with facility water up to 45 °C [1][2].
- Accelsius cooled a 4,500 W GPU-socket test vehicle; the limit was the test rig's power, not the cooling [1]. That is a test result, not a product rating.
- ZutaCore with Rittal (2021): up to 70 kW per rack with a water-cooled in-rack unit [4].
- Exit quality (the vapour fraction leaving each cold plate) is the design limit. In Accelsius's 34-sled rack model, the design target was 70% and the acceptable limit 85% [3].

## Interactions with other layers

- Compute: the liquid heat fraction is similar to single-phase DLC; the remaining air load still needs CRAHs.
- Cooling: the condensing CDU replaces the water CDU. Facility water can run warm because the refrigerant condenses well above typical water temperatures.
- Coolant: the refrigerant choice sets the boiling point at loop pressure, the pressure rating of hoses, and regulatory exposure (see `cooling/coolants`).
- Layout: vapour return lines are larger than liquid lines; pipe routing and slope matter.
- Cost and lead time: fewer vendors and less installed base than single-phase DLC.

## What to watch for

- Flow maldistribution. Sleds with more heat make more vapour, which raises their pressure drop and diverts liquid away from the sleds that need it most. Without restrictors the hottest sled in the Accelsius model reached a predicted 176% exit quality, which means dry-out [3]. Orifices or flow regulators upstream of each plate fix it at a pump-head cost.
- Refrigerant regulation. Some earlier two-phase fluids were fluorinated chemicals affected by 3M's PFAS exit; ZutaCore announced a move to an interim lower-fluorine fluid [5].
- Hardware warranty. Confirm the server vendor supports the cold plates and fluid.

## Typical failure modes

- Dry-out on the hottest plate, with sudden temperature rise and throttling.
- Refrigerant loss through a fitting. The fluid is dielectric, so a leak does not short the electronics, but the loop loses charge and capacity.
- Non-condensable gases (air) in the loop, which raise condenser pressure.
- Condenser capacity loss on hot days if facility water exceeds the design inlet.

## Sources

1. Data Center Dynamics, "Accelsius tests ability to cool 4,500 W chips". https://datacenterdynamics.com/en/news/accelsius-tests-ability-to-cool-4500-watt-chips
2. Converge Digest, "Accelsius advances its two-phase direct-to-chip cooling" (MR250, refrigerants, 45 °C facility water). https://convergedigest.com/accelsius-advances-its-two-phase-direct-to-chip-cooling/
3. Ozguc, Wang, Narayanan, Bonner, "Mitigating flow maldistribution in data center two-phase cooling systems with flow restrictors", Electronics Cooling (2025). https://www.electronics-cooling.com/2025/02/mitigating-flow-maldistribution-in-data-center-two-phase-cooling-systems-with-flow-restrictors/
4. Rittal and ZutaCore, OCP Global Summit 2021 press material. https://www.industrial-production.de/electromechanics/ocp-standards-with-two-phase-direct-chip-cooling.htm
5. Data Center Dynamics, "Two-phase cooling will be hit by EPA rules and 3M's exit from PFAS forever chemicals". https://www.datacenterdynamics.com/en/news/two-phase-cooling-will-be-hit-by-epa-rules-and-3ms-exit-from-pfas-forever-chemicals
