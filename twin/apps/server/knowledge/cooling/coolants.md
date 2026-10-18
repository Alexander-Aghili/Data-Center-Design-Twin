# Coolants

The fluid in each loop sets how much flow a kilowatt needs, what temperatures are safe, and what goes wrong over years of operation. The app's coolant entries are water, PG25, PG40, dielectric oil, a two-phase refrigerant and a fluorocarbon two-phase fluid.

## What it is

Three families matter in a data center:

- Water-based fluids in the technical loop (CDU to cold plates or rear doors) and the facility loop (CDU to heat rejection): treated water, or water with propylene glycol (PG) for freeze protection and biological control. PG25 means about 25% glycol.
- Dielectric liquids that can touch electronics: hydrocarbon oils (PAO, synthetic mineral oil) for single-phase immersion.
- Two-phase fluids that boil in use: low-pressure refrigerants such as R-1233zd(E) and R-515B for two-phase cold plates, and fluorinated fluids for two-phase immersion.

The app reads c_p, density and viscosity from the coolant entry and computes flow as ṁ = Q / (c_p·ΔT).

## When to use it

- Water: facility loops in climates without freezing, and technical loops where the operator runs a strict water-treatment program.
- PG25: the common choice for cold-plate technical loops. Jane Street's hall runs the technical loop on deionised water with 25% propylene glycol against bacteria and algae [6].
- PG40: facility loops to outdoor dry coolers in cold climates, where freeze protection matters more than heat capacity.
- Dielectric oil: single-phase immersion (see `cooling/immersion-single-phase`).
- Refrigerants and fluorocarbons: two-phase systems only (see `cooling/direct-to-chip-two-phase` and `cooling/immersion-two-phase`).

## Textbook numbers

| Fluid | c_p kJ/(kg·K) | Density kg/m³ | Freeze or pour point | Source |
|---|---|---|---|---|
| Water, 30 °C | 4.18 | 996 | 0 °C | textbook |
| PG25 (mass) | about 3.97 | about 1,018 at 20 °C | about −11 °C | [1], interpolated |
| PG40 (mass) | 3.75 | 1,030 at 20 °C | −22 °C | [1] |
| PAO / immersion oil | 2.0 to 2.2 at 40 °C | about 800 (SG 0.80) | grade dependent | [3][4] |

- Volume flow for the same heat and ΔT (calculated from ρ·c_p): PG25 needs about 3% more than water, PG40 about 8% more, and immersion oil about 2.5 times as much.
- Dow's DOWFROST LC 25%, a pre-diluted PG25 sold for direct-to-chip loops: freezing point −10 °C, maximum 90 °C, pH 8.0 to 10.5 [2].
- OCP's PG25 guideline (v1.0.0, September 2026) says propylene glycol is added for its biostatic properties and freeze protection, lists pH 8.0 to 10.5 for conventional (non-OAT) inhibitors, and covers a wetted-materials list for 17 to 66 °C operation [5]. A draft OCP fluid table gives PG25 as 24.5 to 27.5% glycol by volume and calls it bio-static within that range [9].
- Two-phase refrigerants: Accelsius's MR250 runs on R-1233zd(E) or R-515B [7].
- Fluorinated two-phase immersion fluids are affected by 3M's exit from PFAS manufacturing by the end of 2025 [8].

## Interactions with other layers

- Cooling: lower c_p means more flow, bigger pumps and more pressure drop. Glycol also raises viscosity, which raises pump power, most of all in cold weather.
- Layout: pipe sizes per row follow from flow; immersion oil's higher flow per kW needs larger lines.
- Floor: fluid mass adds to rack and tank weights.
- Cost: glycol and dielectric fluids are a capex line and a recurring top-up cost.

## What to watch for

- Glycol concentration drift. Top-ups with plain water dilute PG25 below the bio-static range [9].
- Mixing fluids from different suppliers: inhibitor packages may not be compatible.
- Material compatibility with seals, hoses and cold plate metals.
- Rack vendor fluid requirements. Cold-plate warranties usually name approved fluids.

## Typical failure modes

- Microbial growth and biofilm in low-glycol or untreated water loops, which clogs filters and cold plate channels.
- Inhibitor depletion over years, then corrosion of copper and aluminium.
- Freezing of outdoor coils on a loop with too little glycol.
- Oil degradation or water ingress in immersion tanks.

## Sources

1. Engineering ToolBox, "Propylene glycol based heat-transfer fluids". https://www.engineeringtoolbox.com/propylene-glycol-d_363.html
2. ChemPoint, DOWFROST LC 25% product page. https://www.chempoint.com/en-ca/products/dow/dowfrost-glycol-thermal-fluids/dowfrost-propylene-glycol-thermal-fluids/dowfrost-lc-25
3. Chevron Phillips Chemical, Synfluid PAO flyer. https://www.cpchem.com/sites/default/files/2023-01/Synfluid%20Flyer_0.pdf
4. ExxonMobil Data Center Immersion Fluid 3152 (Palmer Holland). https://www.products.palmerholland.com/products/exxonmobil-data-center-fluid-3152
5. Open Compute Project, "Guidelines for using propylene glycol-based heat transfer fluids in liquid cooled racks", Rev 2.0, v1.0.0 (September 2026). https://www.opencompute.org/wp-content/uploads/2026/10/OCP-PG25-Guidelines-V1.0.0.pdf
6. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), basis press. https://www.youtube.com/watch?v=8J-GUnfSqeE
7. Converge Digest, "Accelsius advances its two-phase direct-to-chip cooling". https://convergedigest.com/accelsius-advances-its-two-phase-direct-to-chip-cooling/
8. Data Center Dynamics, "Two-phase cooling will be hit by EPA rules and 3M's exit from PFAS forever chemicals". https://www.datacenterdynamics.com/en/news/two-phase-cooling-will-be-hit-by-epa-rules-and-3ms-exit-from-pfas-forever-chemicals
9. OCP Cooling Environments, draft PG25 and PG55 typical properties (working document). https://docs.google.com/document/d/1GxkhdsTw_vccAbjkd-USWYrAzlejvhTL
