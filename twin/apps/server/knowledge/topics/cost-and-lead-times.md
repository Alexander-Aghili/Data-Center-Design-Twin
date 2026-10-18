# Cost and lead times

What a data center costs per megawatt, which equipment takes longest to arrive, and why the cost of delay can outweigh the hardware. The app reports capex from catalog cost fields, build-out weeks as the longest lead time plus installation, and cost of delay as build-out weeks times an editable value of compute per GPU-hour.

## What it is

Facility cost is mostly power and cooling infrastructure plus the building. GPUs are a separate and usually larger line. Lead times on electrical equipment now run past two years for some items, so the schedule is set by what was ordered and when, not by construction speed.

## When to use it

- When comparing plans that differ in heat rejection, distribution or redundancy.
- When a proposal adds equipment with a long lead time (transformers, switchgear, chillers).
- When deciding whether to wait for a better design or build now.

## Textbook numbers

- All-in greenfield cost in the US and Canada: $8.9M to $23.3M per MW, excluding chips and GPUs; up 21% per MW since late 2024 against about 5% general inflation [1].
- Cost shares of a greenfield build: power infrastructure 21%, core and shell plus sitework 17%, contingency 16%, site acquisition 7% [1].
- Equipment price rises from December 2021 to early 2026: switchgear 60%, copper 46%, generators and motors 33%, cooling equipment 32%, transformers 29% [1].
- Lead times: pad-mounted transformers 68 to 113 weeks; generators 60 to 100 weeks; medium-voltage switchgear 38 to 63 weeks [1]. High-voltage breakers 125 weeks in the second half of 2025, up from 77 weeks in 2023; generator step-up transformers over 160 weeks by Q1 2026 [2].
- Grid connection: the median US project built in 2023 took about 5 years from interconnection request to operation [3].
- Rack hardware: analysts estimate $5 to 5.5 million per AMD Helios rack and $3.5 to 4 million per Vera Rubin NVL72 [4].

## Interactions with other layers

- Power: redundancy changes equipment counts and cost, not the grid budget. 2N roughly doubles UPS and distribution equipment.
- Cooling: the piping route changes installation time; overhead is faster than raised floor in the app's model.
- Compute: GPU capex dwarfs facility capex per rack. A $3.5M rack drawing about 0.19 MW costs about $18M per MW of IT (calculated from [4] and the Vera Rubin Max-Q estimate), comparable to the top of the facility range.
- Demand problems: lead times are one of the checks (see `demand-problems`).

## What to watch for

- The critical path. Find the single longest lead item; shortening anything else does not move the date.
- Cost of delay. With hardware worth millions per rack idle while the facility finishes, each week of delay can cost more than the equipment premium that would have avoided it.
- Range width. The $8.9M to $23.3M range spans 2.6× (calculated); use a figure that matches the scope, and keep basis `estimate`.

## Typical failure modes

- Ordering transformers or switchgear after design freeze, adding a year.
- Choosing a cheaper cooling option with a longer lead time and losing more in delay than was saved.
- Comparing cost-per-MW benchmarks that measure different scopes.

## Sources

1. CRE Daily, "Data Center Construction Costs Jump 21% Since 2024", citing Cushman & Wakefield's 2026 Data Center Development Cost Guide, https://www.credaily.com/briefs/data-center-construction-costs-jump-21-since-2024/ (press)
2. Reuters via Kitco, "US power companies scramble to secure equipment as surging data center demand strains supplies" (July 9, 2026), https://www.kitco.com/news/off-the-wire/2026-07-09/us-power-companies-scramble-secure-equipment-surging-data-center (press)
3. Lawrence Berkeley National Laboratory, "Queued Up: 2024 Edition", https://eta-publications.lbl.gov/bibcite/reference/36234 (textbook)
4. ai2.work, "Inside AMD's $5.25M Helios Rack and Its 12 Gigawatts of Demand", https://ai2.work/blog/inside-amd-s-5-25m-helios-rack-and-its-12-gigawatts-of-demand (press)
