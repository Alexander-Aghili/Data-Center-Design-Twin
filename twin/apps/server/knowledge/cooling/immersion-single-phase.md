# Immersion cooling, single phase

Servers stand vertically in an open tank filled with a dielectric oil. Pumps circulate the oil through a heat exchanger, and the oil stays liquid throughout. All of the IT heat goes to liquid.

## What it is

A tank replaces the rack. Servers, with their fans removed, hang in the fluid from the top. The fluid is a hydrocarbon such as a polyalphaolefin (PAO) or a synthetic mineral oil. It is electrically insulating, so it can touch every component. A coolant distribution unit beside or inside the tank pumps warm oil through a plate heat exchanger to facility water and returns it to the bottom of the tank.

## When to use it

- Dense compute where the operator controls the server design and can remove fans and use immersion-compatible parts (crypto mining and some HPC sites started here).
- Sites that want no air handling for IT at all: liquid heat fraction is about 1.0.
- Less suited to vendor rack-scale GPU systems (GB300 NVL72 and successors), which are built and warranted for cold plates.

## Textbook numbers

- GRC ICEraQ Series 10: up to 200 kW of IT per tank with 32 °C water on the secondary side, or up to 368 kW with 13 °C chilled water [1]. The ratings assume coolant up to about 50 °C.
- Floor loading: the Series 10 Quad lists 822 kg/m² operating, and a filled ICEraQ Micro (24U) weighs 907 kg at 891 kg/m² [1][2]. Tanks need a level surface (GRC specifies slope under 1/650).
- Fluid properties: ExxonMobil immersion fluids have specific gravity about 0.80 and kinematic viscosity 5 to 31 mm²/s at 40 °C; closed-cup flash points range from about 150 to 246 °C depending on grade [3]. PAO specific heat is about 2.0 to 2.2 kJ/(kg·K) at 40 °C [4].
- Volumetric heat capacity (calculated): PAO about 0.80 × 2.1 = 1.7 MJ/(m³·K), water about 4.2 MJ/(m³·K). For the same temperature rise, oil needs about 2.5 times the volume flow of water.

## Interactions with other layers

- Layout: tanks lie horizontally and take more floor area per server than a rack; the slot grid needs a tank footprint and service clearance above the tank for lifting servers out.
- Floor: the fluid mass makes tanks heavy across a large area. Raised floors often cannot take them; slab is the default.
- Compute: servers must be immersion-qualified. Some optics, drives and thermal pastes are not compatible with the fluid.
- Cooling: no CRAH load from IT, but the hall still needs ventilation and some air cooling for people, switchgear and fluid vapour.
- Heat rejection: warm-water operation (32 °C secondary in GRC's rating) suits dry coolers for many hours of the year.

## What to watch for

- Material compatibility of cables, labels, gaskets and thermal interface material. Plasticisers can leach into the fluid.
- Serviceability: technicians lift dripping servers out of the tank; drip trays, gloves and time per swap add up.
- Fire safety: flash points are high but nonzero. Local fire code may treat tanks as stored combustible liquid.
- Fluid top-up and loss over time, from drag-out on serviced servers.

## Typical failure modes

- Pump or heat exchanger fouling, which raises tank temperature slowly across all servers in a tank.
- Fluid degradation or contamination (water, particles), which lowers dielectric strength.
- Hot spots on high-power chips where natural convection in the tank is weak. Some designs add cold plates or directed flow for GPUs.
- Spills during maintenance onto the floor, creating a slip hazard.

## Sources

1. GRC, ICEraQ Series 10 data sheet. https://www.grcooling.com/wp-content/uploads/grc_iceraq_series_10_data_sheet.pdf
2. GRC, ICEraQ Micro data sheet. https://www.grcooling.com/wp-content/uploads/grc_iceraq_micro_data_sheet.pdf
3. ExxonMobil Data Center Immersion Fluids 3152, 3220 and 3250 product pages (Palmer Holland). https://www.products.palmerholland.com/products/exxonmobil-data-center-fluid-3152
4. Chevron Phillips Chemical, Synfluid PAO flyer (typical properties). https://www.cpchem.com/sites/default/files/2023-01/Synfluid%20Flyer_0.pdf
