# Direct-to-chip liquid cooling, single phase

Cold plates sit on the GPUs, CPUs and switch chips. A water-glycol coolant flows through them and stays liquid, carrying most of the rack's heat to a CDU. Fans and the room handle the rest.

## What it is

Each hot chip has a copper cold plate with fine internal channels. Rack manifolds feed the plates through dripless quick disconnects. Coolant leaves the rack warmer and returns to a coolant distribution unit (CDU), where a heat exchanger passes the heat to the facility water loop. The loop inside the racks is called the technical cooling system (TCS); the loop outside the CDU is the facility water system (FWS). See `cooling/liquid-cooling-operations` for how the two loops are run.

Memory, drives, optics and power supplies are often still air cooled, so a DLC rack has a liquid heat fraction below 1.

## When to use it

- Rack-scale GPU systems: GB300 NVL72, Vera Rubin NVL72, AMD Helios. These are designed for cold plates and cannot be air cooled.
- Any rack above the air limit of about 35 to 50 kW. A 130 kW rack on air alone would need about 7 m³/s of airflow (see `cooling/air-containment`).
- Sites that want warm water and few or no chiller hours: cold plates accept supply water far warmer than air systems.

## Textbook numbers

- GB300 NVL72: Lenovo lists about 118 kW to liquid and 18 kW to air, with 85% of the rack liquid cooled [1]. Its datasheet gives warm-water operation from 18 to 45 °C [2]. The Jane Street tour put GB300 at about 140 kW peak per cabinet and 85 to 90% of heat to cold plates [7].
- Vera Rubin NVL72: NVIDIA states a 45 °C liquid supply temperature, and said at CES 2026 that no water chillers are needed at that temperature [3].
- ASHRAE liquid classes name the maximum facility supply temperature: W17, W27, W32, W40, W45 and W+ (above 45 °C) [4].
- Flow per kW (calculated, ṁ = Q / (c_p·ΔT)): about 1.48 L/min per kW with PG25 at a 10 K rise (c_p 3.97 kJ/(kg·K), ρ 1,018 kg/m³), and 1.44 L/min per kW with water. A 118 kW liquid load at 10 K needs about 175 L/min of PG25. At a 7 K rise it needs about 2.1 L/min per kW.
- CDU approach: Vertiv rates its 2,300 kW CDU at a 4 °C approach between facility supply and technical-loop supply [5]. With a 45 °C rack limit, facility water must then arrive at 41 °C or below.

## Interactions with other layers

- Compute: rack peak power times the liquid fraction gives the CDU load; the remainder is air load for CRAHs.
- Cooling: CDU count per zone, pump head, and the heat rejection choice. Warmer allowed supply means more dry-cooler hours and fewer chiller hours.
- Layout: racks far from their CDU add pipe length and pressure drop. Row manifolds without balancing starve the last racks.
- Floor: rack-scale GPU racks are the heaviest objects in the hall, and coolant in the rack and manifolds adds to the catalog weight. Check bay ratings on raised floors.
- Power: CDU pump power (a coefficient in the rules file) counts against the grid cap.

## What to watch for

- Supply temperature against each rack's maximum. Next-generation racks list different limits; a facility loop set for one generation may be too warm or wastefully cold for the next.
- The air fraction. Even 15% of 140 kW is 21 kW per rack of air load, which is more than many legacy halls give a whole rack.
- Filtration. Cold plate microchannels clog; CDUs filter the technical loop, typically at 25 or 50 µm [6].
- Flow balance along the row. A per-rack flow meter shows starvation before temperatures do.

## Typical failure modes

- Loss of flow (pump trip, closed valve, clogged filter). GPUs throttle within seconds because the plate has almost no thermal mass.
- Leak at a quick disconnect or manifold joint during maintenance.
- Biological growth or corrosion products fouling plates in a poorly maintained loop.
- Facility supply drifting above the rack limit on hot afternoons when the heat rejection plant runs out of capacity.

## Sources

1. Lenovo, GB300 NVL72 3D tour (18 kW air, 118 kW liquid, 85% liquid). https://lenovopress.lenovo.com/3dtours/gb300nvl72
2. Lenovo, GB300 NVL72 datasheet DS0207. https://lenovopress.lenovo.com/ds0207
3. Data Center Dynamics, "Vera Rubin hot water cooling reveal triggers HVAC share drop" (2026). https://www.datacenterdynamics.com/en/news/vera-rubin-hot-water-cooling-reveal-triggers-hvac-share-drop
4. Upsite, summary of ASHRAE Thermal Guidelines 5th ed., liquid cooling classes. https://www.upsite.com/blog/major-changes-to-ashraes-fifth-edition-of-thermal-guidelines-part-3-liquid-cooling-chapter-updates/
5. Vertiv, CoolChip CDU 2300 kW datasheet. https://www.vertiv.cn/4a480e/globalassets/shared/vertiv-coolchipcdu-2300kw-_datasheet_global-english_sl-80607.pdf
6. Vertiv, CoolChip CDU 600 guide specification (25 or 50 µm TCS filtration). https://www.vertiv.com/4aa3f7/globalassets/shared/vertiv-coolchip-cdu-600-guide-specifications-sl-80239.pdf
7. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), basis press. https://www.youtube.com/watch?v=8J-GUnfSqeE
