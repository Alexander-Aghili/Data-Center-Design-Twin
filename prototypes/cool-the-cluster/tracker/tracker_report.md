# Hall tracker report: day 119

## Findings (tracked)

| kind | asset | severity | evidence | prediction |
|---|---|---|---|---|
| cold_plate_fouling | G21 | high | cold-plate resistance +21% vs commissioning, rising 6.8%/month; junction peaked 92.2 C last week | throttling now (junction over 87 C) |
| pipe_scaling | G08 | medium | branch dP 117.3 -> 121.5 kPa (+1.45 kPa/month); inferred roughness 673 um vs 1.5 um new / 30 um 5-yr spec | CDU1 hits its 185 kPa pump-head limit in ~485 days |
| laser_wear | G03->N1 lane 5 | high | Tx bias 7.10 -> 10.57 mA (+1.42 mA/month) | past wear-out alarm now |
| dirty_connector | G19->N0 lane 2 | medium | Rx power -2.6 -> -5.8 dBm, step change on day 75 | link margin cut; errors and flaps likely as optics age |
| recirculation | S2 | medium | inlet runs +0.85 K over the twin since ~day 60; recirculation x3.3 | check blanking panels / containment door on this rack |

## Twin prediction (calibrated to telemetry)

| when | annual MWh | kWh per rack-hour | summer min job speed | summer worst GPU °C | summer worst inlet °C | violation |
|---|---|---|---|---|---|---|
| as designed | 7,928 | 49.739 | 1.000 | 82.0 | 26.98 | — |
| today (calibrated) | 7,885 | 49.882 | 0.966 | 87.9 | 27.56 | summer_training: inlet of S2 reaches 27.50 C at 0.50 h (limit 27.0 C) |
| +30 days | 7,836 | 50.053 | 0.928 | 88.8 | 27.55 | summer_training: inlet of S2 reaches 27.50 C at 0.50 h (limit 27.0 C) |
| +90 days | 7,734 | 50.417 | 0.861 | 90.5 | 27.55 | summer_training: inlet of S2 reaches 27.50 C at 0.50 h (limit 27.0 C) |

## Suggested changes (ranked by urgency, then MWh/yr saved at equal output)

| # | action | saves MWh/yr | urgency | note |
|---|---|---|---|---|
| 1 | Re-install blanking panels / fix containment at S2 | 0.0 | now | summer_training: inlet of S2 reaches 27.50 C at 0.50 h (limit 27.0 C) |
| 2 | Flush loop + clean cold plates on G21; move pex branches to stainless at next window | 22.8 | now |  |
| 3 | Replace transceiver G03->N1 lane 5 (pre-emptive) | 0.0 | past wear-out alarm now |  |
| 4 | Stop-gap until the flush: run warm-season coolant 0.5 C colder (setpoints_by_scenario) so fouled racks stop throttling | 3.4 | this week |  |
| 5 | Descale / chemically treat branch G08; add a strainer and water-quality sampling | 0.0 | before 485 days |  |
| 6 | Inspect and clean connector on G19->N0 lane 2 | 0.0 | next walk-through |  |
