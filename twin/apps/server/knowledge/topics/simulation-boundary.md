# What the app estimates and what CFD answers

The app computes design-stage numbers with textbook algebra. It does not solve fluid flow. This file sets the line between the two, so the agent can say which questions the app answers and which need a CFD study, and what to put in the simulation brief.

## What it is

The engine uses energy balances and simple models:
- airflow V = Q / (ρ·c_p·ΔT) per rack and per zone
- liquid flow ṁ = Q / (c_p·ΔT) per rack and per CDU
- a pressure-drop model along row manifolds, with and without balancing valves
- heat rejection hour by hour against 8,760 hours of climate data (chiller COP vs outdoor temperature, dry-cooler approach, tower wet-bulb approach)
- floor load per bay, busway load per row, network reach by routed length

The flow particles in the 3D view are scaled from these computed values and labelled "Illustrative flow, scaled from computed values". They show where the numbers say air and coolant go, not how they actually move.

CFD solves the conservation equations on a mesh. For room air the app's brief targets OpenFOAM's `buoyantSimpleFoam`, a "steady-state solver for buoyant, turbulent flow of compressible fluids, including radiation, for ventilation and heat-transfer" [1].

## When to use it

Use the app for:
- totals and capacity checks: CRAH and CDU counts, flow per rack, PUE, water, grid headroom
- comparing options quickly and seeing cross-layer effects

Use CFD for:
- recirculation and bypass in a specific room geometry
- hot spots at row ends, under containment roofs and near obstructions
- pressure distribution under a raised floor and tile flow rates
- transient events such as a CRAH or CDU failure, where the app's N-1 pass gives capacity but not temperatures over time

## Textbook numbers

- The app's air model assumes perfect mixing within a zone at the containment's ΔT. Real rooms have recirculation; CFD quantifies it.
- ASHRAE's recommended inlet range is 18 to 27 °C for air-cooled IT (see `air-containment`). Whether every rack inlet stays inside it is a CFD question; the app can only check zone averages.
- Containment savings of 10 to 35% for hot and cold aisles alone [2] are averages; CFD gives the number for one room.

## Interactions with other layers

- Layout: the brief takes geometry, rack positions, containment and equipment positions from the plan.
- Cooling: heat loads, supply temperatures and flows come from the engine deterministically.
- The agent adds narrative to the brief: what to simulate first, mesh guidance, which app estimates to compare.

## What to watch for

- Presenting the flow animation as a simulation result.
- Agent statements about local temperatures. Only zone or rack averages come from the engine.
- Results that pass in the app but sit near limits. Those are the first candidates for a CFD check.

## Typical failure modes

- A plan approved on average air ΔT that has hot spots at row ends.
- Raised-floor tile flow assumed uniform when obstructions under the floor starve some tiles.
- N-1 capacity passing while the transient temperature rise during failover exceeds limits.

## Sources

1. OpenFOAM Foundation, `buoyantSimpleFoam.C` source and description, https://cpp.openfoam.org/v9/buoyantSimpleFoam_8C_source.html (textbook)
2. ENERGY STAR, "Containment/enclosures", https://www.energystar.gov/products/data_center_equipment/16-more-ways-cut-energy-waste-data-center/containmentenclosures (textbook)
