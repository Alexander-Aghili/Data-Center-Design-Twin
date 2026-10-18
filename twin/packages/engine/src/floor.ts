import {
  num,
  type Bay,
  type BayLoad,
  type Check,
  type Metric,
  type Plan,
  type RackResult,
  type Row,
  type Rules,
  type SizedEquipment,
  type Status,
} from '@twin/schema'
import type { EvalContext } from './context'

export interface FloorResult {
  bays: BayLoad[]
  checks: Check[]
  metrics: Metric[]
}

/** Standard gravity in m/s² (ISO 80000-3). */
const G = 9.80665

/** Pass, warn (above `warnThreshold`) or fail (above 1) for a utilization; unknown when it is null. */
export function utilizationStatus(utilization: number | null, rules: Rules): Status {
  if (utilization === null) return 'unknown'
  if (utilization > 1) return 'fail'
  const warn = num(rules.warnThreshold)
  return warn !== null && utilization > warn ? 'warn' : 'pass'
}

/** Number for explanation text, e.g. 9,780 or 7.4. */
export function fmt(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

interface GroupWeight {
  /** Rack weight plus the cooling method's added weight; null when either is unknown. */
  weightKg: number | null
  feet: number | null
  /** One slot (the grid minimum) when the rack type is missing from the catalog. */
  slotsWide: number
  label: string
  inputs: string[]
}

function groupWeights(ctx: EvalContext): Map<string, GroupWeight> {
  const out = new Map<string, GroupWeight>()
  for (const group of ctx.plan.rackGroups) {
    const rack = ctx.catalog.get(group.rackTypeId, 'rack')
    const method = ctx.catalog.get(group.coolingMethodId, 'rackCooling')
    const rackKg = rack ? num(rack.weightKg) : null
    const addedKg = method ? num(method.addedWeightKgPerRack) : null
    out.set(group.id, {
      weightKg: rackKg === null || addedKg === null ? null : rackKg + addedKg,
      feet: rack?.feet ?? null,
      slotsWide: rack?.slotsWide ?? 1,
      label: `${rack?.name ?? group.rackTypeId} with ${method?.name ?? group.coolingMethodId}`,
      inputs: [group.rackTypeId, group.coolingMethodId],
    })
  }
  return out
}

/** Center of a rack's footprint in hall meters (x east, z south); matches the web's `slotWorld`. */
export function rackCenter(row: Row, slot: number, slotsWide: number): { x: number; z: number } {
  return { x: row.x + (slot + slotsWide / 2) * row.slotPitchM, z: row.z + row.rackDepthM / 2 }
}

function bayAt(plan: Plan, x: number, z: number): Bay | undefined {
  return plan.hall.bays.find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d)
}

interface BayTally {
  rackCount: number
  rackKg: number
  equipmentKg: number
  unknown: boolean
  objectIds: string[]
}

/** Floor bay and point loads (Task 10). */
export function floorLoads(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): FloorResult {
  const { plan, rules } = ctx
  const weights = groupWeights(ctx)
  const tallies = new Map<string, BayTally>()
  const tally = (bayId: string) => {
    let t = tallies.get(bayId)
    if (!t) {
      t = { rackCount: 0, rackKg: 0, equipmentKg: 0, unknown: false, objectIds: [] }
      tallies.set(bayId, t)
    }
    return t
  }
  const groupBays = new Map<string, { bays: Set<Bay>; objectIds: string[] }>()

  for (const r of racks) {
    const row = plan.hall.rows.find((candidate) => candidate.id === r.rowId)
    const weight = weights.get(r.groupId)
    if (!row || !weight) continue
    const center = rackCenter(row, r.slot, weight.slotsWide)
    const bay = bayAt(plan, center.x, center.z)
    const group = groupBays.get(r.groupId) ?? { bays: new Set<Bay>(), objectIds: [] }
    group.objectIds.push(r.objectId)
    groupBays.set(r.groupId, group)
    if (!bay) continue
    group.bays.add(bay)
    const t = tally(bay.id)
    t.rackCount += 1
    t.objectIds.push(r.objectId)
    if (weight.weightKg === null) t.unknown = true
    else t.rackKg += weight.weightKg
  }

  const equipmentInputs = new Set<string>()
  for (const eq of equipment) {
    const model = eq.modelId === null ? undefined : ctx.catalog.get(eq.modelId, 'equipment')
    const weightParam = model?.params.weightKg
    if (!model || !weightParam || eq.positionIds.length === 0) continue
    equipmentInputs.add(model.id)
    const unitKg = num(weightParam)
    const unitsPerPosition = eq.count / eq.positionIds.length
    eq.positionIds.forEach((positionId, k) => {
      const position = plan.hall.positions.find((p) => p.id === positionId)
      const bay = position && bayAt(plan, position.x, position.z)
      if (!bay) return
      const t = tally(bay.id)
      if (unitKg === null) t.unknown = true
      else t.equipmentKg += unitKg * unitsPerPosition
      // Units fill the positions in order, so object i belongs to position ⌊i · positions / objects⌋.
      t.objectIds.push(...eq.objectIds.filter((_, i) => Math.floor((i * eq.positionIds.length) / eq.objectIds.length) === k))
    })
  }

  const bays: BayLoad[] = plan.hall.bays.map((bay) => {
    const t = tallies.get(bay.id)
    const loadKnM2 = t ? ((t.rackKg + t.equipmentKg) * G) / (bay.w * bay.d) / 1000 : 0
    return { bayId: bay.id, loadKnM2, ratingKnM2: bay.ratingKnM2, utilization: loadKnM2 / bay.ratingKnM2 }
  })

  const checks: Check[] = []
  const knownBayLoads: number[] = []
  plan.hall.bays.forEach((bay, i) => {
    const t = tallies.get(bay.id)
    if (!t) return
    const value = t.unknown ? null : bays[i]!.loadKnM2
    if (value !== null) knownBayLoads.push(value)
    const utilization = value === null ? null : value / bay.ratingKnM2
    const status = utilizationStatus(utilization, rules)
    checks.push({
      id: `layout.floorBay:${bay.id}`,
      kind: 'layout.floorBay',
      layer: 'layout',
      subject: { kind: 'bay', id: bay.id, objectIds: t.objectIds },
      title: `Floor bay ${bay.id}`,
      value,
      limit: bay.ratingKnM2,
      unit: 'kN/m²',
      utilization,
      status,
      explanation:
        value === null
          ? `A rack or unit in bay ${bay.id} has no weight in the catalog, so its load is unknown.`
          : `${t.rackCount} racks (${fmt(t.rackKg, 0)}\u00a0kg) and ${fmt(t.equipmentKg, 0)}\u00a0kg of equipment on ${fmt(bay.w * bay.d, 2)}\u00a0m² give ${fmt(value, 2)}\u00a0kN/m² against a ${fmt(bay.ratingKnM2, 2)}\u00a0kN/m² rating.`,
      causes: [],
      ...(status === 'fail' && {
        advice: 'Leave slots empty to spread the racks over more bays, choose a lighter rack or cooling method, or strengthen the floor.',
      }),
    })
  })

  const knownPointLoads: number[] = []
  for (const [groupId, group] of groupBays) {
    const weight = weights.get(groupId)!
    const value = weight.weightKg === null || weight.feet === null ? null : (weight.weightKg * G) / weight.feet / 1000
    if (value !== null) knownPointLoads.push(value)
    const limits = [...group.bays].map((b) => b.pointLimitKn)
    const limit = limits.length > 0 ? Math.min(...limits) : null
    const utilization = value === null || limit === null ? null : value / limit
    const status = utilizationStatus(utilization, rules)
    let explanation: string
    if (weight.weightKg === null || weight.feet === null || value === null) {
      explanation = `${weight.label} has no known weight, so the load per foot is unknown.`
    } else if (limit === null) {
      explanation = `${weight.label} puts ${fmt(value, 2)}\u00a0kN on each of ${weight.feet} feet, but none of its racks stands on a rated bay.`
    } else {
      explanation = `${weight.label}: ${fmt(weight.weightKg, 0)}\u00a0kg on ${weight.feet} feet puts ${fmt(value, 2)}\u00a0kN on each foot against a ${fmt(limit, 2)}\u00a0kN limit.`
    }
    checks.push({
      id: `layout.pointLoad:${groupId}`,
      kind: 'layout.pointLoad',
      layer: 'layout',
      subject: { kind: 'group', id: groupId, objectIds: group.objectIds },
      title: `Point load per rack foot, ${groupId}`,
      value,
      limit,
      unit: 'kN',
      utilization,
      status,
      explanation,
      causes: [],
      ...(status === 'fail' && { advice: 'Use spreader plates under the rack feet, or choose a lighter rack or cooling method.' }),
    })
  }

  const groupInputs = [...weights.values()].flatMap((w) => w.inputs)
  const metrics: Metric[] = [
    {
      id: 'layout.maxBayLoad',
      layer: 'layout',
      label: 'Heaviest floor bay',
      value: knownBayLoads.length > 0 ? Math.max(...knownBayLoads) : null,
      unit: 'kN/m²',
      basis: 'calculated',
      inputs: [...groupInputs, ...equipmentInputs, 'hall.bays'],
    },
    {
      id: 'layout.maxPointLoad',
      layer: 'layout',
      label: 'Heaviest rack foot',
      value: knownPointLoads.length > 0 ? Math.max(...knownPointLoads) : null,
      unit: 'kN',
      basis: 'calculated',
      inputs: groupInputs,
    },
  ]

  return { bays, checks, metrics }
}
