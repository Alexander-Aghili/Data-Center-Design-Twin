# Liquid cooling operations: CDUs, loops, filtration, balancing and leaks

How a liquid-cooled hall is run day to day, with the lessons from Jane Street's Texas GPU hall (4,032 GPUs in 56 racks, retrofitted for liquid cooling) as told on Dwarkesh Patel's tour [1][2].

## What it is

A cold-plate hall has two water loops separated by the coolant distribution unit (CDU):

- The facility water system (FWS) runs from the heat rejection plant to the CDUs. At Jane Street it runs at about 18 °C and is shared with the air units that cool the rest of the room [1].
- The technical cooling system (TCS) runs from the CDU's heat exchanger through row manifolds to each rack's cold plates. It is a small, clean, closed loop. Jane Street fills it with deionised water plus 25% propylene glycol to stop bacteria and algae, and filters it to 25 µm [1].

About 85 to 90% of the heat in Jane Street's racks goes to the cold plates; about 15% of cabinets are still air cooled. GB300 racks peak at about 140 kW per cabinet [1].

## When to use it

This file applies to every hall with cold plates or rear doors (see `cooling/direct-to-chip-single-phase` and `cooling/rear-door-heat-exchanger`). Immersion tanks have their own CDUs but no per-rack hoses.

## Textbook numbers

- Filtration: CDU vendors fit 25 µm filters on the technical side. Nidec's in-row CDU lists 25 µm secondary and 110 µm primary filtration; a CDU built on Google's Deschutes design lists 25 µm secondary, 500 µm primary and 0.2 µm side-stream polishing [3]. Vertiv offers 25 or 50 µm with differential-pressure monitoring that flags filters for cleaning [4].
- CDU approach: about 4 °C between facility supply and technical supply for Vertiv's 2,300 kW unit, with technical supply held within ±1 °C [5].
- OCP's PG25 guideline asks fluid makers to filter at 50 µm or finer before delivery, 25 µm preferred, and recommends sidestream filtration (5 to 15% of loop flow through a filter continuously) for systems above 250 gallons (about 950 L) [7].
- Glycol share: PG25 held at 24.5 to 27.5% by volume is described as bio-static in a draft OCP fluid table (see `cooling/coolants`).
- Flow per kW: about 1.5 L/min per kW at a 10 K rise with PG25 (calculated in `cooling/direct-to-chip-single-phase`).

## Interactions with other layers

- Layout: each rack in a row draws from a shared header. Pressure falls along the header, so without balancing the racks at the far end of the row get less flow than they need. Jane Street balances flow per cabinet and reads it with ultrasonic flow meters so row ends are not starved [1]. In the app, balancing valves fix the starved racks at a pump-head cost.
- Piping route: overhead piping is faster to build but has no under-floor containment if it leaks. Under a raised floor, a leak collects on the slab where detection ropes find it [1]. The app adds installation time for raised-floor routes and a leak-exposure note for overhead routes.
- Cooling: a shared facility loop must run cold enough for the air units, which costs chiller hours compared with a warm loop dedicated to cold plates.
- Buffer tanks hold the loop temperature through chiller restarts (see `cooling/buffer-tanks`).

## What to watch for

- Flow per rack as well as loop temperature. A starved rack shows low flow on its meter before its GPUs throttle.
- Filter differential pressure. A rising reading means debris is collecting; a new loop carries installation debris.
- Glycol concentration and biology. Sample the loop on a schedule; top-ups with plain water dilute the glycol.
- Leak detection coverage. Jane Street runs leak-detection rope inside the servers and under the raised floor, tied to isolation valves that can shut off a rack or a branch [1]. The OCP cold-plate leak detection and intervention white paper covers detection and intervention options, including dry-break quick disconnects [6].
- Commissioning: flush and filter the new loop before connecting cold plates.

## Typical failure modes

- Starved racks at row ends from an unbalanced header.
- Clogged filters or cold plates after installation debris or biofilm.
- Leaks at quick disconnects during server swaps, or at manifold joints after thermal cycling.
- A leak in overhead piping dripping onto racks with nothing to catch it.
- A CDU pump trip with no redundant pump, which stops flow to every rack it serves.

## Sources

1. Dwarkesh Patel, "Jane Street data center tour" (video interview with Ron Minsky and Dan Pontecorvo), basis press. https://www.youtube.com/watch?v=8J-GUnfSqeE
2. Jane Street, "A look inside our newest data center". https://www.janestreet.com/culture/street-view/a-look-inside-our-newest-data-center/
3. Nidec, in-row CDU specification; Beehe IB2000 Deschutes 5 CDU, OCP Marketplace. https://www.nidec.com/en/product/liquid-cooling-line-up/products/in-row/spec-nir.html and https://www.opencompute.org/marketplace/facilities-physical-infrastructure/beehe-ib2000-in-row-l2l-deschutes-5-cdu/
4. Vertiv, CoolChip CDU 600 guide specification. https://www.vertiv.com/4aa3f7/globalassets/shared/vertiv-coolchip-cdu-600-guide-specifications-sl-80239.pdf
5. Vertiv, CoolChip CDU 2300 kW datasheet. https://www.vertiv.cn/4a480e/globalassets/shared/vertiv-coolchipcdu-2300kw-_datasheet_global-english_sl-80607.pdf
6. Open Compute Project, "ACS cold plate leak detection and intervention white paper", Rev 1.0. https://opencompute.org/documents/acs-cold-plate-leak-detection-and-intervention-white-paper-pdf-1
7. Open Compute Project, "Guidelines for using propylene glycol-based heat transfer fluids in liquid cooled racks", Rev 2.0, v1.0.0 (September 2026), section 7. https://www.opencompute.org/wp-content/uploads/2026/10/OCP-PG25-Guidelines-V1.0.0.pdf
