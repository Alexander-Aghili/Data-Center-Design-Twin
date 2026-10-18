import type { Bay, Cause, Check, CheckKind, LayerId, Placement, Plan } from '@twin/schema'
import type { EvalContext } from './context'
import { footprintCenter } from './cost'

/** A plan-wide decision a check can depend on, keyed by its dot path in the plan. */
type PlanPath =
  | 'site.climateId' | 'site.gridCapacityW' | 'site.waterAllowanceM3PerDay'
  | 'hall.floor.type' | 'hall.positions'
  | 'workload.purpose' | 'workload.targetPflops'
  | 'cooling.heatRejectionId' | 'cooling.facilitySupplyC' | 'cooling.pipingRoute' | 'cooling.flowBalancing'
  | 'cooling.bufferTankM3' | 'cooling.containment'
  | 'power.redundancy' | 'power.distribution' | 'power.oversubscription'
  | 'network.fabric' | 'network.oversubscription'

/** Per-group decisions (expanded over the groups the check covers) and per-bay site inputs. */
type ScopedRef = 'rackType' | 'coolingMethod' | 'bayRating' | 'bayPointLimit'
type Ref = PlanPath | ScopedRef

/** Which decisions drive each check, in the order they are listed. */
const CAUSE_TABLE: Record<CheckKind, Ref[]> = {
  'cooling.rackHeatLimit': ['rackType', 'coolingMethod', 'cooling.containment'],
  'cooling.crahCapacity': ['rackType', 'coolingMethod', 'cooling.containment', 'power.redundancy'],
  'cooling.cduCapacity': ['rackType', 'coolingMethod', 'power.redundancy'],
  'cooling.cduPositions': ['coolingMethod', 'power.redundancy', 'hall.positions'],
  'cooling.manifoldBalance': ['coolingMethod', 'cooling.flowBalancing'],
  'cooling.coolantTemp': ['rackType', 'coolingMethod', 'cooling.facilitySupplyC'],
  'cooling.airInletTemp': ['cooling.facilitySupplyC', 'coolingMethod', 'cooling.heatRejectionId'],
  'cooling.heatRejection': ['cooling.heatRejectionId', 'site.climateId', 'cooling.facilitySupplyC', 'power.redundancy', 'rackType'],
  'cooling.rideThrough': ['cooling.bufferTankM3', 'coolingMethod', 'rackType'],
  'cooling.waterPeakDay': ['cooling.heatRejectionId', 'site.climateId', 'site.waterAllowanceM3PerDay'],
  'cooling.leakExposure': ['cooling.pipingRoute', 'coolingMethod'],
  'power.gridWorstHour': ['site.gridCapacityW', 'rackType', 'cooling.heatRejectionId', 'site.climateId'],
  'power.busway': ['rackType', 'power.redundancy', 'power.oversubscription', 'power.distribution'],
  'power.trainingSwing': ['workload.purpose', 'rackType', 'power.redundancy'],
  'power.ups': ['rackType', 'power.redundancy'],
  'power.transformer': ['rackType', 'power.redundancy'],
  'power.inputCompat': ['power.distribution', 'rackType'],
  'layout.floorBay': ['rackType', 'coolingMethod', 'hall.floor.type', 'bayRating'],
  'layout.pointLoad': ['rackType', 'coolingMethod', 'hall.floor.type', 'bayPointLimit'],
  'network.copperReach': ['network.fabric', 'rackType'],
  'network.leafPorts': ['network.fabric', 'network.oversubscription', 'rackType'],
  'demand.leadTime': ['cooling.heatRejectionId', 'cooling.pipingRoute', 'power.redundancy', 'coolingMethod', 'rackType'],
  'workload.targetCompute': ['workload.targetPflops', 'rackType'],
}

const nbsp = ' '
const number = (n: number, digits = 1) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n)
export const withUnit = (n: number, unit: string, digits = 1) => `${number(n, digits)}${nbsp}${unit}`

const PURPOSE = { training: 'Training', inference: 'Inference', mixed: 'Mixed' } as const
const CONTAINMENT = { none: 'No containment', hotAisle: 'Hot-aisle containment', coldAisle: 'Cold-aisle containment' } as const
const ROUTE = { raisedFloor: 'Raised floor', overhead: 'Overhead' } as const
const DISTRIBUTION = { ac54: '54 V AC busbar', dc800: '800 V DC' } as const
const FABRIC = { railOptimized: 'Rail-optimized', fatTree: 'Fat tree' } as const
const FLOOR = { raised: 'Raised floor', slab: 'Slab' } as const

type Decision = { layer: LayerId; label: string; value: (ctx: EvalContext) => string }

const name = (ctx: EvalContext, id: string) => ctx.catalog.get(id)?.name ?? id

const DECISIONS: Record<PlanPath, Decision> = {
  'site.climateId': { layer: 'site', label: 'Climate', value: (c) => name(c, c.plan.site.climateId) },
  'site.gridCapacityW': { layer: 'site', label: 'Grid capacity', value: (c) => withUnit(c.plan.site.gridCapacityW / 1e6, 'MW') },
  'site.waterAllowanceM3PerDay': { layer: 'site', label: 'Water allowance', value: (c) => withUnit(c.plan.site.waterAllowanceM3PerDay, 'm³/day') },
  'hall.floor.type': { layer: 'site', label: 'Floor type', value: (c) => FLOOR[c.plan.hall.floor.type] },
  'hall.positions': {
    layer: 'layout',
    label: 'CDU positions',
    value: (c) => {
      const cdu = c.plan.hall.positions.filter((p) => p.kind === 'cdu')
      return `${cdu.length} positions, ${cdu.reduce((n, p) => n + p.capacity, 0)} units`
    },
  },
  'workload.purpose': { layer: 'workload', label: 'Workload purpose', value: (c) => PURPOSE[c.plan.workload.purpose] },
  'workload.targetPflops': { layer: 'workload', label: 'Target compute', value: (c) => withUnit(c.plan.workload.targetPflops, 'PFLOPS', 0) },
  'cooling.heatRejectionId': { layer: 'cooling', label: 'Heat rejection', value: (c) => name(c, c.plan.cooling.heatRejectionId) },
  'cooling.facilitySupplyC': { layer: 'cooling', label: 'Facility supply temperature', value: (c) => withUnit(c.plan.cooling.facilitySupplyC, '°C') },
  'cooling.pipingRoute': { layer: 'cooling', label: 'Piping route', value: (c) => ROUTE[c.plan.cooling.pipingRoute] },
  'cooling.flowBalancing': { layer: 'cooling', label: 'Flow balancing', value: (c) => (c.plan.cooling.flowBalancing ? 'Balancing valves' : 'No balancing valves') },
  'cooling.bufferTankM3': {
    layer: 'cooling',
    label: 'Buffer tank',
    value: (c) => (c.plan.cooling.bufferTankM3 > 0 ? withUnit(c.plan.cooling.bufferTankM3, 'm³') : 'No buffer tank'),
  },
  'cooling.containment': { layer: 'cooling', label: 'Containment', value: (c) => CONTAINMENT[c.plan.cooling.containment] },
  'power.redundancy': { layer: 'power', label: 'Redundancy', value: (c) => c.plan.power.redundancy },
  'power.distribution': { layer: 'power', label: 'Power distribution', value: (c) => DISTRIBUTION[c.plan.power.distribution] },
  'power.oversubscription': { layer: 'power', label: 'Power oversubscription allowance', value: (c) => `${number(c.plan.power.oversubscription, 2)}×` },
  'network.fabric': { layer: 'network', label: 'Network fabric', value: (c) => FABRIC[c.plan.network.fabric] },
  'network.oversubscription': { layer: 'network', label: 'Network oversubscription', value: (c) => `${number(c.plan.network.oversubscription, 2)}:1` },
}

const cause = (layer: LayerId, path: string, label: string, value: string): Cause => ({ layer, path, label: `${label}: ${value}`, value })

/** Placements whose footprint center lies inside the bay (same rule as the floor-load module). */
function placementsInBay(ctx: EvalContext, bay: Bay): Placement[] {
  return ctx.plan.placements.filter((pl) => {
    const c = footprintCenter(ctx, pl)
    return c !== null && c.x >= bay.x && c.x < bay.x + bay.w && c.z >= bay.z && c.z < bay.z + bay.d
  })
}

/** Rows an equipment key or position id points at: "cdu:R3" → R3, a position → the rows it serves. */
function rowsOfEquipment(plan: Plan, id: string): string[] | null {
  const tail = id.slice(id.indexOf(':') + 1)
  if (plan.hall.rows.some((r) => r.id === tail)) return [tail]
  const position = plan.hall.positions.find((p) => p.id === tail || p.id === id)
  return position ? position.servesRows : null
}

/** The rack groups a check's subject covers, in plan order. */
function groupsOf(ctx: EvalContext, subject: Check['subject']): string[] {
  const { plan } = ctx
  let placements: Placement[] | null = null
  const rackIds = subject.objectIds.filter((o) => o.startsWith('rack:')).map((o) => o.slice('rack:'.length))
  if (rackIds.length > 0) placements = plan.placements.filter((p) => rackIds.includes(p.id))
  else if (subject.kind === 'group') return plan.rackGroups.filter((g) => g.id === subject.id).map((g) => g.id)
  else if (subject.kind === 'rack') placements = plan.placements.filter((p) => p.id === subject.id)
  else if (subject.kind === 'row') placements = plan.placements.filter((p) => p.rowId === subject.id)
  else if (subject.kind === 'bay') {
    const bay = plan.hall.bays.find((b) => b.id === subject.id)
    placements = bay ? placementsInBay(ctx, bay) : null
  } else if (subject.kind === 'equipment') {
    const rows = rowsOfEquipment(plan, subject.id)
    if (rows) placements = plan.placements.filter((p) => rows.includes(p.rowId))
  }
  const used = new Set((placements ?? plan.placements).map((p) => p.groupId))
  return plan.rackGroups.filter((g) => used.has(g.id)).map((g) => g.id)
}

function scopedCauses(ctx: EvalContext, ref: ScopedRef, check: Check, groupIds: string[]): Cause[] {
  const { plan } = ctx
  if (ref === 'bayRating' || ref === 'bayPointLimit') {
    const bay = check.subject.kind === 'bay' ? plan.hall.bays.find((b) => b.id === check.subject.id) : undefined
    if (!bay) return []
    return ref === 'bayRating'
      ? [cause('site', `hall.bays.${bay.id}.ratingKnM2`, `Bay ${bay.id} rating`, withUnit(bay.ratingKnM2, 'kN/m²', 2))]
      : [cause('site', `hall.bays.${bay.id}.pointLimitKn`, `Bay ${bay.id} point load limit`, withUnit(bay.pointLimitKn, 'kN', 2))]
  }
  const qualify = plan.rackGroups.length > 1
  return groupIds.flatMap((id) => {
    const group = plan.rackGroups.find((g) => g.id === id)
    if (!group) return []
    const scope = qualify ? ` (${group.name})` : ''
    return ref === 'rackType'
      ? [cause('compute', `rackGroups.${id}.rackTypeId`, `Rack type${scope}`, name(ctx, group.rackTypeId))]
      : [cause('cooling', `rackGroups.${id}.coolingMethodId`, `Cooling method${scope}`, name(ctx, group.coolingMethodId))]
  })
}

function isPlanPath(ref: Ref): ref is PlanPath {
  return ref in DECISIONS
}

/**
 * Links each check to the decisions that drive it, across layers, from the fixed `CAUSE_TABLE`. Group
 * decisions expand over the groups the check's subject covers. Each cause carries the decision's current
 * value as people read it ("Rack type (Training block): GB300 NVL72"). Causes a module already set come first.
 */
export function attachCauses(ctx: EvalContext, checks: Check[]): Check[] {
  return checks.map((check) => {
    const groupIds = groupsOf(ctx, check.subject)
    const derived = CAUSE_TABLE[check.kind].flatMap((ref): Cause[] => {
      if (!isPlanPath(ref)) return scopedCauses(ctx, ref, check, groupIds)
      const d = DECISIONS[ref]
      return [cause(d.layer, ref, d.label, d.value(ctx))]
    })
    const seen = new Set(check.causes.map((c) => c.path))
    return { ...check, causes: [...check.causes, ...derived.filter((c) => !seen.has(c.path))] }
  })
}
