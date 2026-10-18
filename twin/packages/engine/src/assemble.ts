import type { Evaluation, RackResult, RowLoad } from '@twin/schema'
import type { EvalContext } from './context'
import type { AirSideResult } from './cooling/air'
import type { BufferResult } from './cooling/buffer'
import type { LiquidSideResult } from './cooling/liquid'
import type { RejectionResult } from './cooling/rejection'
import type { CostSlice } from './cost'
import type { DemandResult } from './demand'
import { emptyHeadline } from './empty'
import type { FloorResult } from './floor'
import type { NetworkSlice } from './network'
import { toHours, type PowerResult } from './power'
import type { SizingResult } from './sizing'

/** Every module's output, in pipeline order. */
export interface EvalSlices {
  racks: RackResult[]
  air: AirSideResult
  liquid: LiquidSideResult
  sizing: SizingResult
  rejection: RejectionResult
  buffer: BufferResult
  network: NetworkSlice
  power: PowerResult
  floor: FloorResult
  cost: CostSlice
  demand: DemandResult
}

const finite = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Largest water use over any calendar day of the hourly series, in m³. */
function peakDayM3(waterM3: number[]): number {
  let peak = 0
  for (let start = 0; start < waterM3.length; start += 24) {
    peak = Math.max(peak, waterM3.slice(start, start + 24).reduce((s, v) => s + v, 0))
  }
  return peak
}

/** Merges the slices into one Evaluation: hourly series, rows, headline (Task 7). */
export function assemble(ctx: EvalContext, s: EvalSlices): Evaluation {
  const hours = ctx.climate.dryBulbC.length
  const checks = [
    ...s.air.checks,
    ...s.liquid.checks,
    ...s.sizing.checks,
    ...s.rejection.checks,
    ...s.buffer.checks,
    ...s.network.checks,
    ...s.power.checks,
    ...s.floor.checks,
    ...s.cost.checks,
    ...s.demand.checks,
  ]
  const metrics = [
    ...s.air.metrics,
    ...s.liquid.metrics,
    ...s.rejection.metrics,
    ...s.buffer.metrics,
    ...s.network.metrics,
    ...s.power.metrics,
    ...s.floor.metrics,
    ...s.cost.metrics,
  ]

  const rows: RowLoad[] = ctx.plan.hall.rows.map((row) => {
    const air = s.air.rows.find((r) => r.rowId === row.id)
    const liquid = s.liquid.rowFlows.find((r) => r.rowId === row.id)
    const power = s.power.rows.find((r) => r.rowId === row.id)
    const cdu = s.sizing.equipment.find((e) => e.category === 'cdu' && e.key === `cdu:${row.id}`)
    return {
      rowId: row.id,
      airW: finite(air?.airW),
      liquidW: finite(liquid?.liquidW),
      flowLps: finite(liquid?.flowLps),
      buswayLoadA: finite(power?.buswayLoadA),
      cduKey: cdu?.key ?? null,
    }
  })

  const waterM3 = toHours(s.rejection.hourly.waterM3, hours)
  const hourly: Evaluation['hourly'] = {
    outdoorC: toHours(ctx.climate.dryBulbC, hours),
    wetBulbC: toHours(ctx.climate.wetBulbC, hours),
    itW: toHours(s.power.hourly.itW, hours),
    coolingW: toHours(s.rejection.hourly.coolingW, hours),
    facilityW: toHours(s.power.hourly.facilityW, hours),
    pue: Array.from({ length: hours }, (_, h) => {
      const v = s.power.hourly.pue[h]
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    }),
    waterM3,
    trimW: toHours(s.rejection.hourly.trimW, hours),
  }

  return {
    headline: {
      ...emptyHeadline(),
      ...s.power.headline,
      waterM3PerDayPeak: peakDayM3(waterM3),
      buildable: s.racks.length > 0 && checks.every((c) => c.status !== 'fail'),
    },
    metrics,
    checks,
    racks: s.racks,
    equipment: s.sizing.equipment,
    rows,
    bays: s.floor.bays,
    network: s.network.network,
    cost: s.cost.cost,
    hourly,
  }
}
