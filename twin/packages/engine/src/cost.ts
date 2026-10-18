import { num, type Check, type EquipmentEntry, type Evaluation, type Metric, type Quantity, type RackResult, type SizedEquipment } from '@twin/schema'
import type { EvalContext } from './context'

export interface CostSlice {
  cost: Evaluation['cost']
  checks: Check[]
  metrics: Metric[]
}

const HOURS_PER_WEEK = 168
/** Equipment on the facility water loop: it can only be commissioned once the piping is in. */
const WATER_SIDE = new Set(['cdu', 'crah', 'bufferTank'])

/** One thing to buy. `leadWeeks` undefined = its catalog entry has no lead time (not scheduled); null = unknown. */
interface Item {
  name: string
  category: string
  capexUsd: number | null
  leadWeeks: number | null | undefined
  installWeeks: number
  objectIds: string[]
}

const val = (q: Quantity | undefined) => (q ? num(q) : null)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mul = (...xs: (number | null)[]) => (xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a * b, 1))
const manhattan = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z)

function pipingInstallWeeks(ctx: EvalContext): number {
  const key = ctx.plan.cooling.pipingRoute === 'overhead' ? 'overheadInstallWeeks' : 'raisedFloorInstallWeeks'
  return val(ctx.rules[key]) ?? 0
}

/** Center of a rack's footprint in hall coordinates; null when its row is missing. */
export function footprintCenter(ctx: EvalContext, rack: { rowId: string; slot: number; groupId: string }): { x: number; z: number } | null {
  const row = ctx.plan.hall.rows.find((r) => r.id === rack.rowId)
  if (!row) return null
  const group = ctx.plan.rackGroups.find((g) => g.id === rack.groupId)
  const slotsWide = (group ? ctx.catalog.get(group.rackTypeId, 'rack')?.slotsWide : undefined) ?? 1
  return { x: row.x + (rack.slot + slotsWide / 2) * row.slotPitchM, z: row.z + row.rackDepthM / 2 }
}

function rackItems(ctx: EvalContext, racks: RackResult[]): Item[] {
  const byType = new Map<string, RackResult[]>()
  for (const rack of racks) {
    const typeId = ctx.plan.rackGroups.find((g) => g.id === rack.groupId)?.rackTypeId
    if (typeId) byType.set(typeId, [...(byType.get(typeId) ?? []), rack])
  }
  return [...byType].map(([typeId, list]) => {
    const entry = ctx.catalog.get(typeId, 'rack')
    return {
      name: entry?.name ?? typeId,
      category: 'racks',
      capexUsd: mul(val(entry?.capexUsd), list.length),
      leadWeeks: entry ? val(entry.leadTimeWeeks) : null,
      installWeeks: 0,
      objectIds: list.map((r) => r.objectId),
    }
  })
}

function rackCoolingItems(ctx: EvalContext, racks: RackResult[]): Item[] {
  const byMethod = new Map<string, RackResult[]>()
  for (const rack of racks) {
    const methodId = ctx.plan.rackGroups.find((g) => g.id === rack.groupId)?.coolingMethodId
    if (methodId) byMethod.set(methodId, [...(byMethod.get(methodId) ?? []), rack])
  }
  return [...byMethod].map(([methodId, list]) => {
    const entry = ctx.catalog.get(methodId, 'rackCooling')
    const itKw = sum(list.map((r) => r.powerW)) / 1000
    return {
      name: entry?.name ?? methodId,
      category: 'rackCooling',
      capexUsd: mul(val(entry?.capexUsdPerKw), itKw),
      leadWeeks: entry ? val(entry.leadTimeWeeks) : null,
      installWeeks: val(entry?.installWeeks) ?? 0,
      objectIds: list.map((r) => r.objectId),
    }
  })
}

function plantItem(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): Item[] {
  const rejectedKw = sum(racks.map((r) => r.heatW)) / 1000
  if (rejectedKw <= 0) return []
  const plant = equipment.find((e) => isPlant(ctx, e))
  const id = (plant?.modelId && ctx.catalog.get(plant.modelId, 'heatRejection') ? plant.modelId : null) ?? ctx.plan.cooling.heatRejectionId
  const entry = ctx.catalog.get(id, 'heatRejection')
  return [
    {
      name: entry?.name ?? id,
      category: 'plant',
      capexUsd: mul(val(entry?.capexUsdPerKw), rejectedKw),
      leadWeeks: entry ? val(entry.leadTimeWeeks) : null,
      installWeeks: val(entry?.installWeeks) ?? 0,
      objectIds: plant?.objectIds ?? [],
    },
  ]
}

/** The heat rejection line: key "plant", or any line whose model is a heat rejection entry. */
export function isPlant(ctx: EvalContext, eq: SizedEquipment): boolean {
  return eq.key === 'plant' || (eq.modelId !== null && ctx.catalog.get(eq.modelId, 'heatRejection') !== undefined)
}

/** Unit price × quantity for one sized equipment line; null when the catalog lacks the price. */
function equipmentCapex(ctx: EvalContext, eq: SizedEquipment, entry: EquipmentEntry): number | null {
  const p = (key: string) => val(entry.params[key])
  switch (entry.category) {
    case 'ups':
      return mul(p('capexUsdPerKw'), p('moduleW'), eq.count, 1 / 1000)
    case 'busway': {
      const row = ctx.plan.hall.rows.find((r) => eq.key === `busway:${r.id}`)
      return row ? mul(p('capexUsdPerM'), row.slotCount * row.slotPitchM, eq.count) : null
    }
    default:
      return 'capexUsd' in entry.params ? mul(p('capexUsd'), eq.count) : null
  }
}

function equipmentItems(ctx: EvalContext, equipment: SizedEquipment[], pipingWeeks: number): Item[] {
  return equipment
    .filter((eq) => eq.count > 0 && !isPlant(ctx, eq) && eq.category !== 'bufferTank')
    .map((eq) => {
      const entry = eq.modelId ? ctx.catalog.get(eq.modelId, 'equipment') : undefined
      return {
        name: entry?.name ?? eq.modelId ?? eq.key,
        category: eq.category,
        capexUsd: entry ? equipmentCapex(ctx, eq, entry) : null,
        leadWeeks: !entry ? null : 'leadTimeWeeks' in entry.params ? val(entry.params.leadTimeWeeks) : undefined,
        installWeeks: WATER_SIDE.has(eq.category) ? pipingWeeks : 0,
        objectIds: eq.objectIds,
      }
    })
}

function bufferItem(ctx: EvalContext, equipment: SizedEquipment[], pipingWeeks: number): Item[] {
  const volume = ctx.plan.cooling.bufferTankM3
  if (volume <= 0) return []
  const sizedTank = equipment.find((e) => e.category === 'bufferTank')
  const entry =
    (sizedTank?.modelId ? ctx.catalog.get(sizedTank.modelId, 'equipment') : undefined) ??
    ctx.catalog.all().find((e): e is EquipmentEntry => e.kind === 'equipment' && e.category === 'bufferTank')
  return [
    {
      name: entry?.name ?? 'Buffer tank',
      category: 'bufferTank',
      capexUsd: mul(val(entry?.params.capexUsdPerM3), volume),
      leadWeeks: entry ? val(entry.params.leadTimeWeeks) : null,
      installWeeks: pipingWeeks,
      objectIds: sizedTank?.objectIds ?? [],
    },
  ]
}

/**
 * Routed facility piping: a branch from each liquid-cooled rack to the nearest CDU position serving its
 * row, plus a main from the plant to every CDU and CRAH position in use. Each run is the Manhattan
 * distance plus `routingSlackM`.
 */
function pipingLengthM(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): number {
  const slack = val(ctx.rules.routingSlackM) ?? 0
  const positions = new Map(ctx.plan.hall.positions.map((p) => [p.id, p]))
  const positionsOf = (eqs: SizedEquipment[]) => eqs.flatMap((e) => e.positionIds.flatMap((id) => positions.get(id) ?? []))
  const cdus = equipment.filter((e) => e.category === 'cdu' && e.count > 0)

  let length = 0
  for (const rack of racks) {
    if (rack.liquidW <= 0) continue
    const center = footprintCenter(ctx, rack)
    const serving = positionsOf(cdus).filter((p) => p.servesRows.includes(rack.rowId))
    if (!center || serving.length === 0) continue
    length += Math.min(...serving.map((p) => manhattan(center, p))) + slack
  }

  const plantSites = positionsOf(equipment.filter((e) => isPlant(ctx, e)))
  const plants = plantSites.length > 0 ? plantSites : ctx.plan.hall.positions.filter((p) => p.kind === 'plant')
  if (plants.length === 0) return length
  const fed = new Set(positionsOf(equipment.filter((e) => (e.category === 'cdu' || e.category === 'crah') && e.count > 0)))
  for (const site of fed) length += Math.min(...plants.map((p) => manhattan(site, p))) + slack
  return length
}

function pipingItem(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[], pipingWeeks: number): Item[] {
  const lengthM = pipingLengthM(ctx, racks, equipment)
  if (lengthM <= 0) return []
  const overhead = ctx.plan.cooling.pipingRoute === 'overhead'
  return [
    {
      name: overhead ? 'Overhead piping' : 'Raised-floor piping',
      category: 'piping',
      capexUsd: mul(val(ctx.rules[overhead ? 'pipingUsdPerMOverhead' : 'pipingUsdPerMRaised']), lengthM),
      leadWeeks: 0,
      installWeeks: pipingWeeks,
      objectIds: [],
    },
  ]
}

function gpuCount(ctx: EvalContext, racks: RackResult[]): number {
  return sum(
    racks.map((r) => {
      const typeId = ctx.plan.rackGroups.find((g) => g.id === r.groupId)?.rackTypeId
      return (typeId ? ctx.catalog.get(typeId, 'rack')?.gpuCount : undefined) ?? 0
    }),
  )
}

const weeks = (n: number) => `${Math.round(n * 10) / 10} weeks`

function leadTimeCheck(scheduled: Item[], buildWeeks: number, critical: Item[]): Check {
  const missing = [...new Set(scheduled.filter((i) => i.leadWeeks === null).map((i) => i.name))]
  const names = [...new Set(critical.map((i) => i.name))]
  const first = critical[0]
  let explanation: string
  if (missing.length > 0) {
    explanation = `No lead time is known for ${missing.join(', ')}, so the ${weeks(buildWeeks)} build-out may be longer.`
  } else if (!first) {
    explanation = 'Nothing is on order yet, so there is no build-out schedule.'
  } else {
    const install = first.installWeeks > 0 ? ` plus ${weeks(first.installWeeks)} to install` : ''
    explanation = `Build-out takes ${weeks(buildWeeks)}. ${names.join(' and ')} sets the critical path: ${weeks(first.leadWeeks ?? 0)} lead time${install}.`
  }
  return {
    id: 'demand.leadTime:site',
    kind: 'demand.leadTime',
    layer: 'workload',
    subject: { kind: 'site', id: 'site', objectIds: [...new Set(critical.flatMap((i) => i.objectIds))] },
    title: 'Build-out lead time',
    value: buildWeeks,
    limit: null,
    unit: 'week',
    utilization: null,
    status: missing.length > 0 ? 'unknown' : 'pass',
    explanation,
    causes: [],
    ...(first && missing.length === 0 ? { advice: `Order ${names.join(' and ')} first, or pick a model with a shorter lead time.` } : {}),
  }
}

function metric(id: string, label: string, value: number, unit: string, inputs: string[]): Metric {
  return { id, layer: 'site', label, value, unit, basis: 'calculated', inputs, group: 'cost' }
}

/**
 * Capex, build-out weeks and cost of delay. Build-out is the longest `lead time + install time` over the
 * items on order; water-side equipment installs with the piping, so the piping route changes its time.
 */
export function costAndSchedule(ctx: EvalContext, racks: RackResult[], equipment: SizedEquipment[]): CostSlice {
  const pipingWeeks = pipingInstallWeeks(ctx)
  const items = [
    ...rackItems(ctx, racks),
    ...rackCoolingItems(ctx, racks),
    ...equipmentItems(ctx, equipment, pipingWeeks),
    ...plantItem(ctx, racks, equipment),
    ...bufferItem(ctx, equipment, pipingWeeks),
    ...pipingItem(ctx, racks, equipment, pipingWeeks),
  ]

  const byCategory: Record<string, number> = {}
  for (const item of items) {
    if (item.capexUsd !== null) byCategory[item.category] = (byCategory[item.category] ?? 0) + item.capexUsd
  }
  const capexUsd = sum(Object.values(byCategory))
  const unpriced = items.filter((i) => i.capexUsd === null).length

  const scheduled = items.filter((i) => i.leadWeeks !== undefined)
  const total = (i: Item) => (i.leadWeeks ?? 0) + i.installWeeks
  const buildWeeks = Math.max(0, ...scheduled.map(total))
  const critical = buildWeeks > 0 ? scheduled.filter((i) => total(i) === buildWeeks) : []
  const criticalPath = [...new Set(critical.map((i) => i.name))]
  const delayCostUsd = buildWeeks * HOURS_PER_WEEK * gpuCount(ctx, racks) * ctx.plan.site.valueOfComputeUsdPerGpuHour

  return {
    cost: { capexUsd, byCategory, buildWeeks, criticalPath, delayCostUsd },
    checks: [leadTimeCheck(scheduled, buildWeeks, critical)],
    metrics: [
      metric('cost.capex', 'Capex', capexUsd, 'USD', ['rackGroups', 'cooling.pipingRoute', 'cooling.bufferTankM3', 'cooling.heatRejectionId']),
      metric('cost.unpriced', 'Items without a catalog price', unpriced, 'count', ['catalog']),
      metric('cost.buildWeeks', 'Build-out', buildWeeks, 'week', ['cooling.pipingRoute']),
      metric('cost.delay', 'Cost of delay', delayCostUsd, 'USD', ['site.valueOfComputeUsdPerGpuHour']),
    ],
  }
}
