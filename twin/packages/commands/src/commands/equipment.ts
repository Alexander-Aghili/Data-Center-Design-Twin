import { CommandError, type CatalogIndex, type EquipmentCategory, type Plan } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { entryName, requireEntry } from '../lookup'

type PositionKind = Plan['hall']['positions'][number]['kind']

interface KeyKind {
  /** Equipment category of the model, or `plant` for heat rejection units. */
  category: EquipmentCategory | 'plant'
  /** The position kind the units stand in, when the hall has one for them. */
  positionKind?: PositionKind
}

/** Engine equipment keys (see `SizedEquipment.key`): zoned keys carry a suffix, plant-wide keys do not. */
const ZONED: Record<string, KeyKind> = {
  cdu: { category: 'cdu', positionKind: 'cdu' },
  crah: { category: 'crah', positionKind: 'crah' },
  busway: { category: 'busway' },
  leaf: { category: 'leaf', positionKind: 'leaf' },
}
const PLANT_WIDE: Record<string, KeyKind> = {
  plant: { category: 'plant', positionKind: 'plant' },
  ups: { category: 'ups', positionKind: 'electrical' },
  transformer: { category: 'transformer', positionKind: 'electrical' },
  bufferTank: { category: 'bufferTank', positionKind: 'plant' },
}

function keyKind(key: string): KeyKind {
  const [prefix, suffix, ...rest] = key.split(':')
  const kind = suffix && rest.length === 0 ? ZONED[prefix!] : suffix === undefined ? PLANT_WIDE[prefix!] : undefined
  if (kind) return kind
  throw new CommandError(
    `Unknown equipment key "${key}". Keys look like cdu:R3, crah:Z1, busway:R3, leaf:L1, plant, ups, transformer or bufferTank; the evaluation's equipment list has the exact keys.`,
    'payload.key',
  )
}

function assertModel(plan: Plan, catalog: CatalogIndex, kind: KeyKind, modelId: string): void {
  const category = kind.category
  if (category === 'plant') requireEntry(plan, catalog, modelId, 'heatRejection', 'payload.modelId')
  else requireEntry(plan, catalog, modelId, 'equipment', 'payload.modelId', { label: `${category} model`, accept: (e) => e.category === category })
}

function assertPositions(plan: Plan, kind: KeyKind, positionIds: string[]): void {
  for (const id of positionIds) {
    const position = plan.hall.positions.find((p) => p.id === id)
    if (!position) {
      throw new CommandError(`Unknown equipment position "${id}". Known positions: ${plan.hall.positions.map((p) => p.id).join(', ')}`, 'payload.positionIds')
    }
    if (kind.positionKind && position.kind !== kind.positionKind) {
      throw new CommandError(`Position ${id} holds ${position.kind} equipment, not ${kind.category}`, 'payload.positionIds')
    }
  }
}

const overrideEquipment = defineCommand({
  type: 'overrideEquipment',
  layer: 'equipment',
  title: 'Override equipment',
  description:
    'Fixes an auto-sized equipment item instead of letting the engine size it: its model (catalog id; a heatRejection entry for key "plant", an equipment entry of the matching category otherwise), unit count and/or positions. Keys come from the evaluation\'s equipment list, e.g. cdu:R3, crah:Z1, plant, ups. Given fields merge into an existing override; the engine then checks the load against the fixed choice.',
  apply(draft, payload, ctx) {
    const kind = keyKind(payload.key)
    if (payload.modelId === undefined && payload.count === undefined && payload.positionIds === undefined) {
      throw new CommandError('overrideEquipment needs modelId, count or positionIds', 'payload')
    }
    if (payload.modelId !== undefined) assertModel(draft, ctx.catalog, kind, payload.modelId)
    if (payload.positionIds !== undefined) assertPositions(draft, kind, payload.positionIds)
    const { key, ...fields } = payload
    const existing = draft.overrides.find((o) => o.key === key)
    if (existing) Object.assign(existing, fields)
    else draft.overrides.push({ key, ...fields })
  },
  summarize: (payload, plan) => {
    const parts: string[] = []
    if (payload.modelId !== undefined) parts.push(`model ${entryName(plan, payload.modelId)}`)
    if (payload.count !== undefined) parts.push(`count ${payload.count}`)
    if (payload.positionIds !== undefined) parts.push(`${payload.positionIds.length === 1 ? 'position' : 'positions'} ${payload.positionIds.join(', ')}`)
    return `${payload.key} fixed to ${parts.join(', ')}`
  },
})

const clearOverride = defineCommand({
  type: 'clearOverride',
  layer: 'equipment',
  title: 'Clear override',
  description:
    'Removes the override for an equipment key (e.g. cdu:R3), so the engine auto-sizes that item again from load and redundancy.',
  apply(draft, payload) {
    if (!draft.overrides.some((o) => o.key === payload.key)) {
      const keys = draft.overrides.map((o) => o.key).join(', ') || 'none'
      throw new CommandError(`No override for "${payload.key}". Overridden: ${keys}`, 'payload.key')
    }
    draft.overrides = draft.overrides.filter((o) => o.key !== payload.key)
  },
  summarize: (payload) => `${payload.key} is auto-sized again`,
})

export const commands: AnyCommandDef[] = [overrideEquipment, clearOverride]
