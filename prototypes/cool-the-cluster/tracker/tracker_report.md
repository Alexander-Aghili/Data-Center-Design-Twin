# Hall tracker report: day 119

## Findings (tracked)

| kind | asset | severity | evidence | prediction |
|---|---|---|---|---|
| cold_plate_fouling | G13 | high | cold-plate resistance +21% vs commissioning, rising 7.0%/month; junction peaked 91.0 C last week | throttling now (junction over 87 C) |
| pipe_scaling | G08 | medium | branch dP 119.0 -> 122.8 kPa (-0.04 kPa/month over the last 30 days); inferred roughness 539 um vs 15.0 um new / 20 um 5-yr spec | rise has levelled off; 22 kPa of pump-head margin left |
| laser_wear | G09->N1 lane 5 | high | Tx bias 7.19 -> 10.67 mA (+1.41 mA/month) | past wear-out alarm now |
| dirty_connector | G23->N0 lane 2 | medium | Rx power -1.8 -> -5.0 dBm, step change on day 75 | link margin cut; errors and flaps likely as optics age |
| recirculation | S2 | medium | inlet runs +0.64 K over the twin since ~day 60; recirculation x3.5 | check blanking panels / containment door on this rack |

## Twin prediction (calibrated to telemetry)

| when | annual MWh | kWh per rack-hour | summer min job speed | summer worst GPU °C | summer worst inlet °C | violation |
|---|---|---|---|---|---|---|
| as designed | 8,025 | 50.488 | 1.000 | 81.9 | 26.97 | — |
| today (calibrated) | 7,925 | 50.807 | 0.945 | 88.4 | 27.08 | summer_training: inlet of S2 reaches 27.06 C at 0.50 h (limit 27.0 C) |
| +30 days | 7,847 | 51.055 | 0.907 | 89.3 | 27.08 | summer_training: inlet of S2 reaches 27.06 C at 0.50 h (limit 27.0 C) |
| +90 days | 7,683 | 51.616 | 0.839 | 91.0 | 27.08 | summer_training: inlet of S2 reaches 27.06 C at 0.50 h (limit 27.0 C) |

## Suggested changes (ranked by urgency, then MWh/yr saved at equal output)

| # | action | saves MWh/yr | urgency | note |
|---|---|---|---|---|
| 1 | Re-install blanking panels / fix containment at S2 | 0.0 | now | summer_training: inlet of S2 reaches 27.06 C at 0.50 h (limit 27.0 C) |
| 2 | Flush loop + clean cold plates on G13; move copper branches to stainless at next window | 50.7 | now |  |
| 3 | Replace transceiver G09->N1 lane 5 (pre-emptive) | 0.0 | past wear-out alarm now |  |
| 4 | Stop-gap until the flush: run warm-season coolant 0.5 C colder (setpoints_by_scenario) so fouled racks stop throttling | 4.5 | this week |  |
| 5 | Inspect and clean connector on G23->N0 lane 2 | 0.0 | next walk-through |  |
| 6 | Descale / chemically treat branch G08; add a strainer and water-quality sampling | 0.0 | monitor |  |
