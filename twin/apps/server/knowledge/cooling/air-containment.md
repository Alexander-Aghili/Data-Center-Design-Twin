# Air cooling with hot or cold aisle containment

Racks draw room air through the front and exhaust it out the back. CRAH or CRAC units cool the return air and supply it again. Containment closes one aisle with doors and a roof so hot exhaust cannot mix back into the cold supply.

## What it is

In an open hall, part of the hot exhaust curls over the rack tops and around row ends into the cold aisle. The cooling units then have to supply colder air than the servers need to make up for that mixing. Cold aisle containment encloses the supply aisle. Hot aisle containment encloses the exhaust aisle and ducts it to the cooling units or a ceiling plenum. Both raise the usable air temperature difference (ΔT) between supply and return, and that difference sets how much heat each cubic metre of air carries.

## When to use it

- Air-cooled servers (HGX-class 8-GPU boxes with fans, storage, network racks) at up to roughly 30 to 40 kW per rack.
- The air-cooled remainder of liquid-cooled racks. A GB300 NVL72 still sends about 15% of its heat to air [5], so a liquid hall still needs air handling.
- Not for 100 kW+ racks on air alone. See the airflow numbers below.

## Textbook numbers

Airflow follows from an energy balance: V = Q / (ρ·c_p·ΔT), with air at ρ ≈ 1.2 kg/m³ and c_p ≈ 1.005 kJ/(kg·K) (textbook values near 20 °C).

| Rack heat | ΔT | Airflow (calculated) |
|---|---|---|
| 1 kW | 12 K | 0.069 m³/s (about 146 CFM) |
| 30 kW | 12 K | 2.1 m³/s (about 4,400 CFM) |
| 40 kW | 12 K | 2.8 m³/s (about 5,900 CFM) |
| 130 kW | 15 K | 7.2 m³/s (about 15,200 CFM) |

A 130 kW rack on air alone would need about 7 m³/s through one cabinet face. Server fans, perforated doors and the CRAH coils cannot move that, so racks at that density are liquid cooled.

Published density limits for air:
- Schneider Electric's power-distribution study treats about 35 kW per rack as the practical ceiling for air-cooled racks [2].
- Uptime Institute puts the practical air ceiling at roughly 50 kW per rack, with containment and careful airflow management [3].
- ASHRAE's recommended server inlet range for class A1 to A4 equipment is 18 to 27 °C [1]. Containment lets the supply sit near the top of that range, which widens the hours a plant can run on free cooling.

## Interactions with other layers

- Compute: rack IT power and the method's liquid heat fraction set the air load per rack.
- Layout: containment needs rows of equal height and length so doors and roof panels close. Gaps from missing racks must be filled with blanking panels.
- Cooling: CRAH count per zone = air load / unit capacity, plus redundancy. Fan power scales with airflow.
- Power: CRAH fan power counts against the grid cap and shows up in PUE.

## What to watch for

- Racks above the air limit for their method. The app flags these as a failing check.
- Mixed rows: a liquid rack in an air row still dumps its air fraction into that aisle.
- Missing blanking panels and open cable cut-outs. Each one is a bypass path that lowers the effective ΔT.
- Fire code. Containment roofs must not block sprinklers or gas suppression; many designs use panels that drop at a set temperature.

## Typical failure modes

- Hot spots at row ends where containment is open or doors are left propped.
- Recirculation through empty U-spaces raises inlet temperatures above the A1 recommended range.
- Losing one CRAH in a zone with no N+1 spare. Inlet temperatures rise within minutes at high density.
- Pressure imbalance: the CRAHs supply less air than the servers pull, and hot air is sucked back through gaps.

## Sources

1. ASHRAE TC 9.9, Thermal Guidelines for Data Processing Environments, 5th ed., recommended envelope 18 to 27 °C. Summary: https://www.upsite.com/blog/major-changes-to-ashraes-fifth-edition-of-thermal-guidelines-part-3-liquid-cooling-chapter-updates/
2. Schneider Electric, "New research studies impact of rack-based liquid cooling and high power densities on power distribution" (2021). https://blog.se.com/datacenter/cloud-and-service-providers/2021/03/25/research-studies-impact-rack-based-liquid-cooling-high-power-densities-power-distribution/
3. Data Center Knowledge, "AI rack density's real limits: power, cooling, failure risk", citing Uptime Institute. https://www.datacenterknowledge.com/ai-data-centers/ai-rack-density-s-real-limits-power-cooling-failure-risk
4. Airflow equation and air properties: textbook (ASHRAE Handbook, Fundamentals). Values in the table are calculated.
5. Lenovo, GB300 NVL72 3D tour (85% of the rack liquid cooled). https://lenovopress.lenovo.com/3dtours/gb300nvl72
