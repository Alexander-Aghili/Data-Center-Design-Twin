import { createDefaultPlan } from '@twin/catalog'
import { RACK, type Check, type Evaluation, type LayerId, type Metric, type Plan, type Status } from '@twin/schema'

/**
 * Test and screenshot data for the shell while the engine is built in parallel. It mirrors the demo
 * moment: the training block (rows 3–5) switched to GB300 NVL72 but is still air cooled.
 * The numbers are illustrative fixture values, never shipped.
 */

export function demoPlan(): Plan {
  const plan = createDefaultPlan()
  return {
    ...plan,
    name: 'Default hall',
    updatedAt: '2026-10-18T14:32:00.000Z',
    rackGroups: plan.rackGroups.map((g) => (g.id === 'g2' ? { ...g, rackTypeId: RACK.GB300_NVL72 } : g)),
  }
}

function check(
  kind: Check['kind'],
  subjectId: string,
  title: string,
  status: Status,
  utilization: number | null,
  extra: Partial<Check> = {},
): Check {
  // Demand checks (lead time) belong to the compute planner.
  const prefix = kind.split('.')[0]
  const layer = (prefix === 'demand' ? 'compute' : prefix) as LayerId
  const value = utilization === null ? null : utilization * 100
  return {
    id: `${kind}:${subjectId}`,
    kind,
    layer,
    subject: { kind: 'group', id: subjectId, objectIds: [] },
    title,
    value,
    limit: utilization === null ? null : 100,
    unit: '%',
    utilization,
    status,
    explanation: `${title}: fixture explanation.`,
    causes: [],
    ...extra,
  }
}

export const demoChecks: Check[] = [
  check('cooling.rackHeatLimit', 'g2', 'Air cooling, rows 3–5', 'fail', 3.3, {
    value: 132_000,
    limit: 40_000,
    unit: 'W',
  }),
  check('cooling.crahCapacity', 'Z1', 'CRAH capacity', 'fail', 2.14),
  check('power.busway', 'R3', 'Busway on row 3', 'warn', 0.91),
  check('layout.floorBay', 'B4-3', 'Floor bay B4-3', 'warn', 0.86),
  check('network.copperReach', 'leaf-2', 'Copper reach to leaf 2', 'unknown', null),
  check('cooling.cduCapacity', 'R3', 'CDU capacity', 'pass', 0),
  check('cooling.cduPositions', 'hall', 'CDU positions', 'pass', 0),
  check('cooling.manifoldBalance', 'R3', 'Manifold balance', 'pass', 0.42),
  check('cooling.coolantTemp', 'hall', 'Coolant temperature', 'pass', 0.7),
  check('cooling.heatRejection', 'plant', 'Heat rejection', 'pass', 0.78),
  check('cooling.rideThrough', 'hall', 'Ride-through on chiller restart', 'pass', 0.5),
  check('cooling.waterPeakDay', 'site', 'Water on the peak day', 'pass', 0),
  check('cooling.leakExposure', 'hall', 'Leak exposure', 'pass', 0.1),
  check('power.gridWorstHour', 'site', 'Grid, worst hour', 'pass', 0.84),
  check('power.trainingSwing', 'site', 'Training power swing', 'pass', 0.6),
  check('power.ups', 'ups', 'UPS modules', 'pass', 0.72),
  check('power.transformer', 'transformer', 'Transformers', 'pass', 0.69),
  check('power.inputCompat', 'g2', 'Rack power input', 'pass', null),
  check('layout.pointLoad', 'R3', 'Point load', 'pass', 0.55),
  check('network.leafPorts', 'leaf-1', 'Leaf ports', 'pass', 0.63),
  check('demand.leadTime', 'g2', 'Lead time', 'pass', 0.4),
  check('workload.targetCompute', 'workload', 'Target compute', 'pass', 0.71),
]

function metric(layer: LayerId, id: string, label: string, value: number | null, unit: string, group?: string): Metric {
  return { id, layer, label, value, unit, basis: 'calculated', inputs: [], ...(group ? { group } : {}) }
}

export const demoMetrics: Metric[] = [
  metric('site', 'site.gridCapacity', 'Grid capacity', 10_000_000, 'W'),
  metric('site', 'site.designDryBulb', 'Design dry bulb, 0.4%', 38.9, '°C'),
  metric('site', 'site.waterAllowance', 'Water allowance', 120, 'm³/day'),
  metric('workload', 'workload.target', 'Target compute', 4000, 'PFLOPS'),
  metric('workload', 'workload.peakToAverage', 'Peak to average power', 1.15, ''),
  metric('compute', 'compute.gpuCount', 'GPUs placed', 3968, ''),
  metric('compute', 'compute.placedPflops', 'Placed compute', 5640, 'PFLOPS'),
  metric('compute', 'compute.g2.rackPower', 'Rack power, training block', 132_000, 'W', 'Training block'),
  metric('compute', 'compute.g2.rackWeight', 'Rack weight, training block', 1_360, 'kg', 'Training block'),
  metric('compute', 'compute.g1.rackPower', 'Rack power, inference block', 14_300, 'W', 'Inference block'),
  metric('layout', 'layout.racksPlaced', 'Racks placed', 80, ''),
  metric('layout', 'layout.worstBay', 'Worst bay load', 6.2, 'kN/m²'),
  metric('cooling', 'cooling.airHeat', 'Heat to air', 6_793_600, 'W', 'Air side'),
  metric('cooling', 'cooling.crahCapacity', 'CRAH capacity installed', 3_200_000, 'W', 'Air side'),
  metric('cooling', 'cooling.liquidHeat', 'Heat to liquid', 0, 'W', 'Liquid side'),
  metric('cooling', 'cooling.facilityFlow', 'Facility water flow', null, 'L/s', 'Liquid side'),
  metric('cooling', 'cooling.plantCop', 'Chiller COP, worst hour', 3.4, '', 'Heat rejection'),
  metric('cooling', 'cooling.capex', 'Cooling capex', 6_100_000, 'USD', 'Cost'),
  metric('power', 'power.itPeak', 'IT load, peak', 7_593_600, 'W'),
  metric('power', 'power.facilityWorst', 'Facility power, worst hour', 8_420_000, 'W'),
  metric('power', 'power.upsModules', 'UPS modules', 18, ''),
  metric('network', 'network.opticsPower', 'Optics power', 61_000, 'W'),
  metric('network', 'network.cable', 'Cable length', 9_840, 'm'),
]

const HOURS = 8760
// Hottest hour of the fixture year: 17:00 on 3 August.
const WORST_HOUR = 214 * 24 + 17

function series(base: number, swing: number): number[] {
  return Array.from({ length: HOURS }, (_, h) => {
    const season = Math.cos(((h - WORST_HOUR) / HOURS) * 2 * Math.PI)
    const day = Math.cos((((h % 24) - 17) / 24) * 2 * Math.PI)
    return base + swing * (0.7 * season + 0.3 * day)
  })
}

export function demoEvaluation(plan: Plan = demoPlan()): Evaluation {
  const racks = plan.placements.map((p) => {
    const training = p.groupId === 'g2'
    const powerW = training ? 132_000 : 14_300
    return {
      placementId: p.id,
      groupId: p.groupId,
      rowId: p.rowId,
      slot: p.slot,
      objectId: `rack:${p.id}`,
      powerW,
      heatW: powerW,
      liquidW: 0,
      facilityWaterW: 0,
      airW: powerW,
      flowLps: null,
      supplyC: null,
      returnC: null,
      airInletC: 24,
      airOutletC: training ? 61 : 38,
      weightKg: training ? 1_360 : 890,
      bayId: 'B3-2',
      flowShare: null,
      coolingOk: !training,
    }
  })
  const facilityW = series(7_900_000, 520_000)
  const itW = series(7_400_000, 150_000)
  return {
    headline: {
      usablePflops: 5_640,
      placedPflops: 5_640,
      gpuCount: 3_968,
      hoursOverCap: 0,
      worstHour: WORST_HOUR,
      buildable: false,
      pueAnnual: 1.21,
      pueWorst: 1.38,
      waterM3PerDayPeak: 0,
    },
    metrics: demoMetrics,
    checks: demoChecks,
    racks,
    equipment: [],
    rows: [],
    bays: [],
    network: { links: [], opticsW: 61_000, cableM: 9_840, baseLatencyNs: 600, oversubscription: 1 },
    cost: { capexUsd: 184_000_000, byCategory: {}, buildWeeks: 38, criticalPath: [], delayCostUsd: 0 },
    hourly: {
      outdoorC: series(19, 18),
      wetBulbC: series(14, 10),
      itW,
      coolingW: series(400_000, 300_000),
      facilityW,
      pue: facilityW.map((f, h) => f / itW[h]!),
      waterM3: Array.from({ length: HOURS }, () => 0),
      trimW: Array.from({ length: HOURS }, () => 0),
    },
  }
}
