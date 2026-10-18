import { createDefaultPlan } from '@twin/catalog'
import {
  CatalogEntrySchema,
  COOLANT,
  EQUIPMENT,
  EvaluationSchema,
  HEAT_REJECTION,
  RACK,
  RACK_COOLING,
  num,
  placementId,
  type CatalogEntry,
  type CatalogEntryOfKind,
  type CatalogKind,
  type Check,
  type ClimateEntry,
  type Evaluation,
  type Plan,
  type RackResult,
  type Rules,
  type SizedEquipment,
} from '@twin/schema'
import { objectIdForEquipment, objectIdForPlacement, slotWorld } from '../../src/scene/geometry'

/**
 * A typed stand-in for the engine while it is built in parallel: the demo anchor of the spec.
 * Rows 1–2 hold air-cooled HGX B300 racks; rows 3–5 hold GB300 NVL72 racks on direct-to-chip
 * cooling, and the hall has no CDU positions, so the liquid racks have nowhere to reject heat.
 * Every number is computed from the real catalog files; the hourly series uses the Dallas TMYx year.
 */

const files = import.meta.glob<unknown>('../../../../packages/catalog/data/**/*.json', { eager: true, import: 'default' })
const entries = new Map<string, CatalogEntry>()
let rules: Rules | null = null
for (const [path, raw] of Object.entries(files)) {
  if (path.endsWith('rules.json')) rules = raw as Rules
  else if (!path.endsWith('index.json')) {
    const entry = CatalogEntrySchema.parse(raw)
    entries.set(entry.id, entry)
  }
}

function entry<K extends CatalogKind>(id: string, kind: K): CatalogEntryOfKind<K> {
  const e = entries.get(id)
  if (!e || e.kind !== kind) throw new Error(`Fixture catalog is missing ${kind} ${id}`)
  return e as CatalogEntryOfKind<K>
}

function rule(key: keyof Rules): number {
  const v = rules ? num(rules[key]) : null
  if (v === null) throw new Error(`Fixture rules are missing ${key}`)
  return v
}

function param(e: CatalogEntryOfKind<'equipment'>, key: string): number {
  const q = e.params[key]
  const v = q ? num(q) : null
  if (v === null) throw new Error(`${e.id} has no ${key}`)
  return v
}

function value(q: Parameters<typeof num>[0]): number {
  const v = num(q)
  if (v === null) throw new Error('Fixture needs a known catalog value')
  return v
}

export const DALLAS = entry('climate.dallas', 'climate') satisfies ClimateEntry

const LIQUID_ROWS = ['R3', 'R4', 'R5']
const AIR_ROWS = ['R1', 'R2']
const RACKS_PER_ROW = 16

/** Default hall with GB300 NVL72 + DLC on rows 3–5 and the CDU positions removed. */
export function fixturePlan(): Plan {
  const plan = createDefaultPlan()
  const snapshot = [
    RACK.HGX_B300_AIR, RACK.GB300_NVL72, RACK_COOLING.AIR_CONTAINED, RACK_COOLING.DLC_1P, HEAT_REJECTION.CHILLER_AIR,
    COOLANT.PG25, COOLANT.WATER, EQUIPMENT.CDU_1200KW, EQUIPMENT.CRAH_400KW, EQUIPMENT.BUSWAY_2500A, EQUIPMENT.UPS_500KW,
    EQUIPMENT.TRANSFORMER_3MVA, EQUIPMENT.LEAF_64X800G, EQUIPMENT.CABLE_DAC, EQUIPMENT.CABLE_AEC, EQUIPMENT.CABLE_FIBER,
  ]
  return {
    ...plan,
    id: 'fixture-plan',
    updatedAt: '2026-10-18T09:00:00.000Z',
    hall: { ...plan.hall, positions: plan.hall.positions.filter((p) => p.kind !== 'cdu') },
    rackGroups: [
      { id: 'g1', name: 'Inference block', rackTypeId: RACK.HGX_B300_AIR, coolingMethodId: RACK_COOLING.AIR_CONTAINED },
      { id: 'g2', name: 'Training block', rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P },
    ],
    catalog: Object.fromEntries(snapshot.map((id) => [id, entries.get(id)!])),
  }
}

function bayAt(plan: Plan, x: number, z: number): string {
  const bay = plan.hall.bays.find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d)
  if (!bay) throw new Error(`No bay at ${x}, ${z}`)
  return bay.id
}

function computeRacks(plan: Plan): RackResult[] {
  const facilitySupplyC = plan.cooling.facilitySupplyC
  const cdu = entry(EQUIPMENT.CDU_1200KW, 'equipment')
  const pg25 = entry(COOLANT.PG25, 'coolant')
  const airDeltaK = rule('airDeltaTKContained')
  const rackOf = (rowId: string): { groupId: string; rack: CatalogEntryOfKind<'rack'>; method: CatalogEntryOfKind<'rackCooling'> } => {
    const g = plan.rackGroups.find((x) => x.id === (LIQUID_ROWS.includes(rowId) ? 'g2' : 'g1'))!
    return { groupId: g.id, rack: entry(g.rackTypeId, 'rack'), method: entry(g.coolingMethodId, 'rackCooling') }
  }
  return [...AIR_ROWS, ...LIQUID_ROWS].flatMap((rowId) =>
    Array.from({ length: RACKS_PER_ROW }, (_, slot): RackResult => {
      const { groupId, rack, method } = rackOf(rowId)
      const id = placementId(rowId, slot)
      const powerW = value(rack.nominalPowerW)
      const liquidW = powerW * value(method.toTechnicalLoop)
      const airW = powerW - liquidW
      const liquid = liquidW > 0
      const flowLps = liquid ? (liquidW / (value(pg25.cpJPerKgK) * value(pg25.densityKgM3) * value(method.deltaTK))) * 1000 : null
      const supplyC = liquid ? facilitySupplyC + param(cdu, 'approachK') : null
      const { x, z } = slotWorld(plan, rowId, slot, rack.slotsWide)
      return {
        placementId: id,
        groupId,
        rowId,
        slot,
        objectId: objectIdForPlacement(id),
        powerW,
        heatW: powerW,
        liquidW,
        facilityWaterW: 0,
        airW,
        flowLps,
        supplyC,
        returnC: supplyC === null ? null : supplyC + value(method.deltaTK),
        airInletC: facilitySupplyC + 6,
        airOutletC: facilitySupplyC + 6 + airDeltaK,
        weightKg: value(rack.weightKg) + value(method.addedWeightKgPerRack),
        bayId: bayAt(plan, x, z),
        flowShare: liquid ? 1 / RACKS_PER_ROW : null,
        // No CDU serves the liquid racks, so their technical loop has no heat sink.
        coolingOk: !liquid,
      }
    }),
  )
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function hourlySeries(plan: Plan, itW: number, airW: number) {
  const chiller = entry(HEAT_REJECTION.CHILLER_AIR, 'heatRejection')
  const crah = entry(EQUIPMENT.CRAH_400KW, 'equipment')
  const copRef = value(chiller.copRef)
  const copRefC = value(chiller.copRefOutdoorC)
  const slope = value(chiller.copSlopePerK)
  const fanFraction = value(chiller.fanPowerFraction)
  // Free cooling when outdoor + approach is at or below the facility return-side limit (supply − loop ΔT).
  const freeBelowC = plan.cooling.facilitySupplyC - rule('facilityLoopDeltaTK') - value(chiller.approachK)
  const crahFansW = Math.ceil(airW / param(crah, 'capacityW')) * param(crah, 'fanPowerW')
  const electricalLoss = 1 / (rule('distributionEfficiency') * rule('upsEfficiency') * rule('transformerEfficiency'))
  const misc = rule('miscFacilityFraction') * itW
  const outdoorC = DALLAS.dryBulbC
  const coolingW = outdoorC.map((t) => {
    const cop = Math.max(1, copRef - slope * (t - copRefC))
    const compressorW = t <= freeBelowC ? 0 : itW / cop
    return compressorW + fanFraction * itW + crahFansW
  })
  const facilityW = coolingW.map((c) => itW * electricalLoss + c + misc)
  return {
    outdoorC,
    wetBulbC: DALLAS.wetBulbC,
    itW: outdoorC.map(() => itW),
    coolingW,
    facilityW,
    pue: facilityW.map((f) => f / itW),
    waterM3: outdoorC.map(() => 0),
    trimW: outdoorC.map(() => 0),
  }
}

function equipmentFor(plan: Plan, racks: RackResult[]): SizedEquipment[] {
  const crah = entry(EQUIPMENT.CRAH_400KW, 'equipment')
  const chiller = entry(HEAT_REJECTION.CHILLER_AIR, 'heatRejection')
  const ups = entry(EQUIPMENT.UPS_500KW, 'equipment')
  const transformer = entry(EQUIPMENT.TRANSFORMER_3MVA, 'equipment')
  const leaf = entry(EQUIPMENT.LEAF_64X800G, 'equipment')
  const busway = entry(EQUIPMENT.BUSWAY_2500A, 'equipment')
  const itW = sum(racks.map((r) => r.powerW))
  const heatW = sum(racks.map((r) => r.heatW))
  const unit = (key: string, n: number) => Array.from({ length: n }, (_, i) => objectIdForEquipment(key, i))
  const sized = (
    key: string,
    category: string,
    modelId: string,
    count: number,
    positionIds: string[],
    loadW: number,
    capacityW: number | null,
  ): SizedEquipment => ({ key, category, modelId, count, required: count, positionIds, autoSized: true, loadW, capacityW, objectIds: unit(key, count) })

  const crahs = plan.hall.positions
    .filter((p) => p.kind === 'crah')
    .slice(0, 2)
    .map((p) => {
      const served = racks.filter((r) => p.servesRows.includes(r.rowId))
      const load = sum(served.map((r) => r.airW))
      return sized(`crah:${p.id.replace('crah-', '')}`, 'crah', crah.id, 2, [p.id], load, 2 * param(crah, 'capacityW'))
    })
  const plantCount = Math.ceil(heatW / value(chiller.unitCapacityW)) + 1
  const upsCount = Math.ceil(itW / param(ups, 'moduleW')) + 1
  const xfmrCount = Math.ceil(itW / param(transformer, 'ratingVa')) + 1
  const buswayRatingW = param(busway, 'ratingA') * param(busway, 'voltageV') * Math.sqrt(3) * param(busway, 'powerFactor')
  const busways = [...new Set(racks.map((r) => r.rowId))].map((rowId) =>
    sized(`busway:${rowId}`, 'busway', busway.id, 1, [], sum(racks.filter((r) => r.rowId === rowId).map((r) => r.powerW)), buswayRatingW),
  )
  const leaves = plan.hall.positions
    .filter((p) => p.kind === 'leaf')
    .map((p, i) => {
      const served = racks.filter((r) => p.servesRows.includes(r.rowId))
      return sized(`leaf:L${i + 1}`, 'leaf', leaf.id, 1, [p.id], served.length * param(leaf, 'powerW'), null)
    })
  return [
    sized('plant', 'heatRejection', chiller.id, plantCount, ['plant-1'], heatW, plantCount * value(chiller.unitCapacityW)),
    ...crahs,
    sized('ups', 'ups', ups.id, upsCount, ['elec-1'], itW, (upsCount - 1) * param(ups, 'moduleW')),
    sized('transformer', 'transformer', transformer.id, xfmrCount, ['elec-1'], itW, (xfmrCount - 1) * param(transformer, 'ratingVa')),
    ...busways,
    ...leaves,
  ]
}

function statusOf(utilization: number): Check['status'] {
  return utilization > 1 ? 'fail' : utilization >= rule('warnThreshold') ? 'warn' : 'pass'
}

function rangeLabel(rows: string[]): string {
  const n = rows.map((r) => Number(r.slice(1)))
  return n.length > 1 ? `rows ${n[0]}–${n[n.length - 1]}` : `row ${n[0]}`
}

function checksFor(plan: Plan, racks: RackResult[], equipment: SizedEquipment[], worstW: number, hoursOver: number): Check[] {
  const liquidIds = racks.filter((r) => r.liquidW > 0).map((r) => r.objectId)
  const cap = plan.site.gridCapacityW
  const crah = equipment.find((e) => e.key === 'crah:W1')!
  const r3 = equipment.find((e) => e.key === 'busway:R3')!
  const ports = param(entry(EQUIPMENT.LEAF_64X800G, 'equipment'), 'ports')
  const leafPorts = racks.filter((r) => ['R1', 'R2', 'R3', 'R4'].includes(r.rowId)).length
  return [
    {
      id: 'cooling.cduPositions:g2',
      kind: 'cooling.cduPositions',
      layer: 'cooling',
      subject: { kind: 'group', id: 'g2', objectIds: liquidIds },
      title: `CDU positions, ${rangeLabel(LIQUID_ROWS)}`,
      value: 0,
      limit: LIQUID_ROWS.length,
      unit: 'positions',
      utilization: null,
      status: 'fail',
      explanation: `The training block uses direct-to-chip cooling, which needs a CDU per row, but ${rangeLabel(LIQUID_ROWS)} have no CDU position to hold one.`,
      causes: [
        { layer: 'cooling', path: 'rackGroups.g2.coolingMethodId', label: 'Rack cooling, Training block', value: 'Direct-to-chip, single-phase' },
        { layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type, Training block', value: 'NVIDIA GB300 NVL72' },
        { layer: 'layout', path: 'hall.positions', label: 'CDU positions in the hall', value: 'none' },
      ],
      advice: 'Add CDU positions at the east end of rows 3–5.',
    },
    {
      id: 'cooling.crahCapacity:W1',
      kind: 'cooling.crahCapacity',
      layer: 'cooling',
      subject: { kind: 'equipment', id: crah.key, objectIds: crah.objectIds },
      title: 'CRAH capacity, west wall 1',
      value: crah.loadW,
      limit: crah.capacityW,
      unit: 'W',
      utilization: crah.loadW / crah.capacityW!,
      status: statusOf(crah.loadW / crah.capacityW!),
      explanation: 'Two 400 kW air handlers carry the air-side heat of rows 1–2.',
      causes: [],
    },
    {
      id: 'power.gridWorstHour:site',
      kind: 'power.gridWorstHour',
      layer: 'power',
      subject: { kind: 'site', id: 'site', objectIds: [] },
      title: 'Grid feed, worst hour',
      value: worstW,
      limit: cap,
      unit: 'W',
      utilization: worstW / cap,
      status: hoursOver > 0 ? 'fail' : 'pass',
      explanation: `Facility power passes the grid cap in ${hoursOver} hours of the Dallas typical year, when the chillers lose efficiency in the afternoon heat.`,
      causes: [
        { layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type, Training block', value: 'NVIDIA GB300 NVL72' },
        { layer: 'cooling', path: 'cooling.heatRejectionId', label: 'Heat rejection', value: 'Air-cooled chiller with free cooling' },
      ],
    },
    {
      id: 'power.busway:R3',
      kind: 'power.busway',
      layer: 'power',
      subject: { kind: 'row', id: 'R3', objectIds: r3.objectIds },
      title: 'Busway, row 3',
      value: r3.loadW,
      limit: r3.capacityW,
      unit: 'W',
      utilization: r3.loadW / r3.capacityW!,
      status: statusOf(r3.loadW / r3.capacityW!),
      explanation: 'Sixteen GB300 NVL72 racks on one 2,500 A busway.',
      causes: [{ layer: 'compute', path: 'rackGroups.g2.rackTypeId', label: 'Rack type, Training block', value: 'NVIDIA GB300 NVL72' }],
    },
    {
      id: 'network.leafPorts:L1',
      kind: 'network.leafPorts',
      layer: 'network',
      subject: { kind: 'equipment', id: 'leaf:L1', objectIds: ['eq:leaf:L1:0'] },
      title: 'Leaf ports, leaf 1',
      value: leafPorts,
      limit: ports,
      unit: 'ports',
      utilization: leafPorts / ports,
      status: statusOf(leafPorts / ports),
      explanation: 'One uplink per rack from rows 1–4.',
      causes: [],
    },
  ]
}

function links(plan: Plan, racks: RackResult[]): Evaluation['network']['links'] {
  const leaves = plan.hall.positions.filter((p) => p.kind === 'leaf')
  return racks.map((r) => {
    const leafIndex = leaves.findIndex((p) => p.servesRows.includes(r.rowId))
    const leaf = leaves[leafIndex]!
    const { x, z } = slotWorld(plan, r.rowId, r.slot)
    const lengthM = Math.abs(x - leaf.x) + Math.abs(z - leaf.z) + rule('routingSlackM')
    const media = lengthM <= rule('dacReachM') ? 'dac' : lengthM <= rule('aecReachM') ? 'aec' : 'fiber'
    return { fromId: r.objectId, toId: objectIdForEquipment(`leaf:L${leafIndex + 1}`, 0), media, lengthM }
  })
}

/** The evaluation the engine would return for `fixturePlan()`, validated against the contract. */
export function fixtureEvaluation(plan: Plan = fixturePlan()): Evaluation {
  const racks = computeRacks(plan)
  const itW = sum(racks.map((r) => r.powerW))
  const airW = sum(racks.map((r) => r.airW))
  const hourly = hourlySeries(plan, itW, airW)
  const cap = plan.site.gridCapacityW
  const worstHour = hourly.facilityW.indexOf(Math.max(...hourly.facilityW))
  const hoursOverCap = hourly.facilityW.filter((w) => w > cap).length
  const equipment = equipmentFor(plan, racks)
  const rowIds = [...new Set(racks.map((r) => r.rowId))]
  const bayIds = [...new Set(racks.map((r) => r.bayId))]
  const bays = bayIds.map((bayId) => {
    const bay = plan.hall.bays.find((b) => b.id === bayId)!
    const loadKnM2 = (sum(racks.filter((r) => r.bayId === bayId).map((r) => r.weightKg)) * 9.81) / 1000 / (bay.w * bay.d)
    return { bayId, loadKnM2, ratingKnM2: bay.ratingKnM2, utilization: loadKnM2 / bay.ratingKnM2 }
  })
  const busway = entry(EQUIPMENT.BUSWAY_2500A, 'equipment')
  const buswayVA = param(busway, 'voltageV') * Math.sqrt(3) * param(busway, 'powerFactor')
  const network = links(plan, racks)
  const fiber = network.filter((l) => l.media === 'fiber').length
  const evaluation: Evaluation = {
    headline: {
      usablePflops: 0,
      placedPflops: 0,
      gpuCount: sum(racks.map((r) => entry(plan.rackGroups.find((g) => g.id === r.groupId)!.rackTypeId, 'rack').gpuCount)),
      hoursOverCap,
      worstHour,
      buildable: false,
      pueAnnual: sum(hourly.facilityW) / sum(hourly.itW),
      pueWorst: hourly.pue[worstHour]!,
      waterM3PerDayPeak: 0,
    },
    metrics: [
      {
        id: 'cooling.pueAnnual',
        layer: 'cooling',
        label: 'PUE, annual',
        value: sum(hourly.facilityW) / sum(hourly.itW),
        unit: '',
        basis: 'calculated',
        inputs: ['hourly.facilityW', 'hourly.itW'],
      },
    ],
    checks: checksFor(plan, racks, equipment, hourly.facilityW[worstHour]!, hoursOverCap),
    racks,
    equipment,
    rows: rowIds.map((rowId) => {
      const inRow = racks.filter((r) => r.rowId === rowId)
      return {
        rowId,
        airW: sum(inRow.map((r) => r.airW)),
        liquidW: sum(inRow.map((r) => r.liquidW)),
        flowLps: sum(inRow.map((r) => r.flowLps ?? 0)),
        buswayLoadA: sum(inRow.map((r) => r.powerW)) / buswayVA,
        cduKey: null,
      }
    }),
    bays,
    network: {
      links: network,
      opticsW: 2 * fiber * param(entry(EQUIPMENT.OPTIC_800G, 'equipment'), 'powerW'),
      cableM: sum(network.map((l) => l.lengthM)),
      baseLatencyNs: Math.max(...network.map((l) => l.lengthM)) * rule('fiberNsPerM') + 2 * rule('hopNs'),
      oversubscription: plan.network.oversubscription,
    },
    cost: { capexUsd: 0, byCategory: {}, buildWeeks: 0, criticalPath: [], delayCostUsd: 0 },
    hourly,
  }
  return EvaluationSchema.parse(evaluation)
}
