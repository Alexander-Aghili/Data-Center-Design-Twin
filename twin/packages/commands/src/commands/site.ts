import { CommandError, type CommandPayloads, type Plan } from '@twin/schema'
import { defineCommand, type AnyCommandDef } from '../define'
import { formatPower, withUnit } from '../format'
import { entryName, requireEntry } from '../lookup'

type NumericField = Exclude<CommandPayloads['setSiteInput']['field'], 'climateId'>

const NUMERIC: Record<NumericField, { label: string; unit: string; positive: boolean; format: (n: number) => string }> = {
  gridCapacityW: { label: 'Grid capacity', unit: 'W', positive: true, format: formatPower },
  waterAllowanceM3PerDay: { label: 'Water allowance', unit: 'm³/day', positive: false, format: (n) => withUnit(n, 'm³/day') },
  valueOfComputeUsdPerGpuHour: { label: 'Value of compute', unit: 'USD per GPU-hour', positive: false, format: (n) => withUnit(n, 'USD per GPU-hour') },
}

const FLOOR_LABEL = { raised: 'raised floor', slab: 'slab' } as const

function siteValue(plan: Plan, field: CommandPayloads['setSiteInput']['field'], value: string | number): string {
  if (field === 'climateId') return entryName(plan, String(value))
  return NUMERIC[field].format(Number(value))
}

const setSiteInput = defineCommand({
  type: 'setSiteInput',
  layer: 'site',
  title: 'Set site input',
  description:
    'Sets one fixed site input: climateId (a climate catalog id such as climate.dallas, for the hourly weather), gridCapacityW (utility grid capacity in W, > 0), waterAllowanceM3PerDay (m³ per day, ≥ 0) or valueOfComputeUsdPerGpuHour (USD per GPU-hour, ≥ 0). Numbers are SI and must be sent as numbers.',
  apply(draft, payload, ctx) {
    const { field, value } = payload
    if (field === 'climateId') {
      if (typeof value !== 'string') throw new CommandError('climateId needs a climate id such as "climate.dallas", not a number', 'payload.value')
      draft.site.climateId = requireEntry(draft, ctx.catalog, value, 'climate', 'payload.value').id
      return
    }
    const spec = NUMERIC[field]
    if (typeof value !== 'number') throw new CommandError(`${field} needs a number in ${spec.unit}, not the text "${value}"`, 'payload.value')
    if (spec.positive && value <= 0) throw new CommandError(`${field} must be greater than 0`, 'payload.value')
    if (value < 0) throw new CommandError(`${field} cannot be negative`, 'payload.value')
    draft.site[field] = value
  },
  summarize: ({ field, value }, plan) => {
    const label = field === 'climateId' ? 'Climate' : NUMERIC[field].label
    const was = field === 'climateId' ? '' : ` (was ${siteValue(plan, field, plan.site[field])})`
    return `${label} set to ${siteValue(plan, field, value)}${was}`
  },
})

const setFloor = defineCommand({
  type: 'setFloor',
  layer: 'site',
  title: 'Set floor',
  description:
    'Sets the hall floor type (raised or slab). With ratingKnM2, also sets the load rating of every floor bay in kN/m²; use setBayRating for a single bay. Raised floors usually carry less load than slabs.',
  apply(draft, payload) {
    draft.hall.floor.type = payload.type
    if (payload.ratingKnM2 !== undefined) for (const bay of draft.hall.bays) bay.ratingKnM2 = payload.ratingKnM2
  },
  summarize: (payload) =>
    `Floor set to ${FLOOR_LABEL[payload.type]}${payload.ratingKnM2 !== undefined ? `, all bays rated ${withUnit(payload.ratingKnM2, 'kN/m²')}` : ''}`,
})

const setBayRating = defineCommand({
  type: 'setBayRating',
  layer: 'site',
  title: 'Set bay rating',
  description:
    'Sets the floor load rating (kN/m²) of one floor bay, e.g. after reinforcing it. Bay ids are "B<column>-<row>", 1-based, e.g. B3-2.',
  apply(draft, payload) {
    const bay = draft.hall.bays.find((b) => b.id === payload.bayId)
    if (!bay) {
      const bays = draft.hall.bays
      throw new CommandError(`Unknown bay "${payload.bayId}". Bays run from ${bays[0]?.id} to ${bays.at(-1)?.id} (column-row).`, 'payload.bayId')
    }
    bay.ratingKnM2 = payload.ratingKnM2
  },
  summarize: (payload, plan) => {
    const old = plan.hall.bays.find((b) => b.id === payload.bayId)?.ratingKnM2
    return `Bay ${payload.bayId} rated ${withUnit(payload.ratingKnM2, 'kN/m²')}${old !== undefined ? ` (was ${withUnit(old, 'kN/m²')})` : ''}`
  },
})

export const commands: AnyCommandDef[] = [setSiteInput, setFloor, setBayRating]
