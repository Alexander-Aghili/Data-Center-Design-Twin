# Buffer tanks (thermal storage for ride-through)

Insulated tanks of chilled or facility water connected to the cooling loop. When the chillers or pumps stop briefly, the stored water keeps absorbing heat until the plant restarts. Jane Street's team calls theirs a thermal battery [3].

## What it is

A buffer tank adds water volume, and so thermal mass, to the loop. In normal operation it sits at the supply temperature. When the heat rejection stops (a utility blip that drops the chillers, a transfer to generators, a controls fault), pumps on UPS keep circulating and the tank water absorbs the IT heat as it warms. The ride-through time ends when the supply temperature reaches the highest value the racks accept.

The app computes ride-through as

t = V · ρ · c_p · ΔT_allowed / Q_liquid

where V is the tank volume, ΔT_allowed is the gap between normal supply and the highest acceptable supply, and Q_liquid is the heat going into the loop. It reports minutes and compares them with the chiller restart time.

## When to use it

- Any liquid-cooled hall with chillers in the heat rejection path. Cold plates have almost no thermal mass, so GPUs throttle within seconds of losing cooling, long before a chiller is back.
- Plants with a generator start and transfer sequence that interrupts chiller power.
- Less needed with dry coolers on UPS-backed fans and pumps, which never stop rejecting heat; the tank then only covers pump transfer.

## Textbook numbers

- Chiller restart times to compare against:
  - Trane: mechanical cooling within 120 seconds and about 3 minutes to 80% load with rapid restart [1].
  - Carrier: 2 to 7 minutes from power loss to full capacity [2].
  - RagingWire (2009): from 13 minutes to under 3 minutes after a quick-start retrofit [4].
- Ride-through examples (calculated, water at ρ = 996 kg/m³ and c_p = 4.18 kJ/(kg·K)):

| Tank | Liquid heat | ΔT allowed | Ride-through |
|---|---|---|---|
| 20 m³ | 2 MW | 5 K | 3.5 min |
| 40 m³ | 2 MW | 5 K | 6.9 min |
| 10 m³ | 1 MW | 3 K | 2.1 min |

- Volume needed: covering Carrier's 7-minute worst case at 2 MW and 5 K takes 420 × 2,000 / (996 × 4.18 × 5) = 40 m³ (calculated).
- Glycol lowers c_p (3.97 kJ/(kg·K) for PG25, see `cooling/coolants`), so a glycol tank holds about 3% less heat per cubic metre than water.

## Interactions with other layers

- Cooling: ΔT_allowed is the margin between the normal supply setpoint and the rack's maximum supply temperature. Raising the setpoint for efficiency shrinks the margin and the ride-through.
- Power: the pumps that move water through the tank, and the CDU pumps, must be on UPS, or the tank is useless.
- Layout and floor: tanks are heavy (1 m³ of water is about 1 t) and usually sit outside the white space or on slab.
- Cost and lead time: tanks are simple steel, but large ones need foundations and space.

## What to watch for

- The real ΔT_allowed. A loop already near the rack limit on a hot day has little margin left.
- Stratification versus mixing: a well-stratified tank delivers its cold water first; a mixed tank warms from the start.
- Placement in the loop. An informal engineering forum view is that a tank simply on the chiller outlet may not protect the load during an outage, which argues for a dedicated, valved arrangement [5].
- Restart time measured on site, not the brochure value.

## Typical failure modes

- Pumps not on UPS: the tank has cold water but nothing moves it.
- Tank isolated by a closed valve after maintenance.
- Tank warmed to the return temperature because flow bypassed it in normal operation, so it has no stored cold when needed.
- Second interruption before the tank has recovered.

## Sources

1. Trane, rapid restart sales literature AC-SLB003. https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature/Sales/AC-SLB003-EN_10302024.pdf
2. Carrier, "Capacity recovery: reliable uptime for mission critical facilities". https://www.carrier.co.id/images/pdf/Capacity%20Recovery%20-%20Reliable%20Uptime%20for%20Mission%20Critical%20Facilities.pdf
3. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), basis press. https://www.youtube.com/watch?v=8J-GUnfSqeE
4. Data Center Knowledge, "Speeding up those chiller restarts" (2009). https://datacenterknowledge.com/business/speeding-up-those-chiller-restarts
5. Eng-Tips forum, "Chilled water storage" thread. https://eng-tips.com/threads/chilled-water-storage.218982
