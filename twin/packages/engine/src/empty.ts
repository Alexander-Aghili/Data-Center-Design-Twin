import type { CostResult, Evaluation, Headline, HourlySeries, NetworkResult } from '@twin/schema'

export function emptyHeadline(): Headline {
  return {
    usablePflops: 0,
    placedPflops: 0,
    gpuCount: 0,
    hoursOverCap: 0,
    worstHour: 0,
    buildable: false,
    pueAnnual: null,
    pueWorst: null,
    waterM3PerDayPeak: 0,
  }
}

export function emptyHourly(): HourlySeries {
  return { outdoorC: [], wetBulbC: [], itW: [], coolingW: [], facilityW: [], pue: [], waterM3: [], trimW: [] }
}

export function emptyNetwork(oversubscription: number): NetworkResult {
  return { links: [], opticsW: 0, cableM: 0, baseLatencyNs: 0, oversubscription }
}

export function emptyCost(): CostResult {
  return { capexUsd: 0, byCategory: {}, buildWeeks: 0, criticalPath: [], delayCostUsd: 0 }
}

/** A well-formed evaluation with nothing in it, for plans that cannot be evaluated yet. */
export function emptyEvaluation(networkOversubscription = 1): Evaluation {
  return {
    headline: emptyHeadline(),
    metrics: [],
    checks: [],
    racks: [],
    equipment: [],
    rows: [],
    bays: [],
    network: emptyNetwork(networkOversubscription),
    cost: emptyCost(),
    hourly: emptyHourly(),
  }
}
