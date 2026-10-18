# Rear-door heat exchanger (RDHx)

A water coil mounted as the rack's back door. Server exhaust passes through the coil and leaves the rack close to room temperature, so the room sees little of the rack's heat.

## What it is

The door is a finned coil fed with chilled or facility water, usually through a CDU so the coil sits on a clean, controlled loop. A passive door has no fans and relies on the servers' own fans to push air through the coil. An active door adds fans in the door to overcome the coil's pressure drop, which lets it handle more airflow and more heat. The servers themselves stay air cooled and unchanged.

## When to use it

- Retrofitting density into an existing air hall where the CRAHs are already at capacity.
- Air-cooled GPU servers (HGX-class) above what containment alone can handle, up to the door's rating.
- Mixed halls where a few dense racks sit among ordinary ones.
- Not as the main method for 100 kW+ cold-plate racks: those racks need water at the chip.

## Textbook numbers

- Motivair's ChilledDoor (active) is rated up to 75 kW per rack in its 2022 to 2024 brochures [1]. Earlier ratings from the same product line were 45 kW per door on 18 °C (65 °F) water in 2013 and up to 60 kW in 2015 [2]. The rating depends on water temperature and server airflow, so read it as a vendor maximum.
- Passive doors depend on server fan airflow. Motivair notes server fans are in many cases inadequate for high-density racks with a passive door [1]; the app uses the catalog entry's lower passive limit.
- The airflow through the door is the same as for the rack: V = Q / (ρ·c_p·ΔT). At 60 kW and 12 K that is about 4.1 m³/s (calculated with ρ = 1.2 kg/m³, c_p = 1.005 kJ/(kg·K)). The coil adds pressure drop on top of that.
- Water flow per door: ṁ = Q / (c_p·ΔT). At 60 kW and a 6 K water rise, about 2.4 kg/s, or about 144 L/min of water (calculated, c_p = 4.18 kJ/(kg·K)).

## Interactions with other layers

- Cooling: the door's heat goes into the liquid loop, so CDU load and heat rejection grow even though the servers are air cooled. CRAH load falls by the same amount.
- Coolant temperature: the door can only cool exhaust air to a few kelvin above its water supply. If facility water is warm (for example W32 or higher, chosen for chiller-free operation), the room gets warmer air back and the doors' effective capacity falls.
- Layout: doors add depth behind each rack, which narrows the hot aisle. Hoses run under the floor or overhead to each door.
- Power: active door fans draw power that counts against the grid cap.
- Floor: a filled door adds weight at the back edge of the rack, which matters on raised floors.

## What to watch for

- Water near the IT: each door is a water connection at the rack. Leak detection and isolation valves matter as much as for cold plates.
- Condensation: if the water supply is below the room dew point the coil sweats. Supply must stay above dew point, which the CDU controls.
- Server fan speed: a passive door raises the back pressure the server fans see; firmware may spin fans up, which raises IT power.
- Door open during maintenance: the rack exhausts full heat into the room while the door is open.

## Typical failure modes

- Loss of water flow to a door. The rack then dumps its whole load into the room, which the CRAHs were not sized for.
- Clogged fins from dust, which lowers airflow and capacity over months.
- Hose or fitting leak at the door hinge, the part that moves most.
- Fan failure on an active door, falling back to passive capacity.

## Sources

1. Motivair, ChilledDoor brochure (2024). https://www.motivaircorp.com/uploads/files/brochures/2024/The%20ChilledDoor.pdf
2. Scientific Computing World, "Chilled door cooling system" and Motivair SC17 listing (earlier ratings). https://www.scientific-computing.com/press-releases/chilled-door-cooling-system
3. Airflow and water flow equations: textbook energy balance; values above are calculated.
