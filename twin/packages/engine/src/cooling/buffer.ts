import { COOLANT, num, type Check, type Metric, type RackResult, type Status } from '@twin/schema'
import type { EvalContext } from '../context'

export interface BufferResult {
  checks: Check[]
  metrics: Metric[]
}

const NBSP = ' '

/** Buffer tank ride-through against chiller restart, plus leak exposure of the piping route (Task 9). */
export function rideThrough(ctx: EvalContext, racks: RackResult[]): BufferResult {
  // Heat that reaches water at the rack: the technical loop plus rear doors on facility water.
  const liquidW = racks.reduce((sum, r) => sum + r.liquidW + r.facilityWaterW, 0)
  const ride = rideThroughCheck(ctx, liquidW)
  return {
    checks: [ride, leakExposureCheck(ctx, liquidW)],
    metrics: [
      {
        id: 'cooling.rideThroughS',
        layer: 'cooling',
        label: 'Buffer tank ride-through',
        value: ride.value,
        unit: 's',
        basis: 'calculated',
        inputs: ['cooling.bufferTankM3', 'rackGroups'],
        group: 'Heat rejection',
      },
    ],
  }
}

function rideThroughCheck(ctx: EvalContext, liquidW: number): Check {
  const { plan, catalog, rules } = ctx
  const volumeM3 = plan.cooling.bufferTankM3
  const water = catalog.get(COOLANT.WATER, 'coolant')
  const density = water ? num(water.densityKgM3) : null
  const cp = water ? num(water.cpJPerKgK) : null
  const riseK = num(rules.bufferAllowedRiseK)
  const restartS = num(rules.chillerRestartS)
  const base = {
    id: 'cooling.rideThrough:bufferTank',
    kind: 'cooling.rideThrough' as const,
    layer: 'cooling' as const,
    subject: { kind: 'equipment' as const, id: 'bufferTank', objectIds: [] },
    title: 'Buffer tank ride-through',
    limit: restartS,
    unit: 's',
    causes: [],
  }

  if (liquidW <= 0) {
    return {
      ...base,
      value: null,
      utilization: null,
      status: 'pass',
      explanation: 'No rack sends heat to water, so a chiller restart does not interrupt liquid cooling.',
    }
  }
  if (density === null || cp === null || riseK === null || restartS === null) {
    return {
      ...base,
      value: null,
      utilization: null,
      status: 'unknown',
      explanation: 'Ride-through needs water density and heat capacity, the allowed temperature rise and the chiller restart time.',
    }
  }

  const seconds = (volumeM3 * density * cp * riseK) / liquidW
  const utilization = seconds > 0 ? restartS / seconds : null
  const warnAt = num(rules.warnThreshold) ?? 1
  let status: Status = 'pass'
  if (seconds < restartS) status = 'fail'
  else if (utilization !== null && utilization >= warnAt) status = 'warn'

  const restart = `${minutes(restartS)} chiller restart`
  const explanation =
    volumeM3 === 0
      ? `No buffer tank: if the chillers restart, ${mw(liquidW)} of liquid-cooled heat has nowhere to go for the ${restart}.`
      : `${round(volumeM3)}${NBSP}m³ of water warming ${riseK}${NBSP}K absorbs ${mw(liquidW)} of liquid heat for ${minutes(seconds)}, against a ${restart}.`
  const neededM3 = (restartS * liquidW) / (density * cp * riseK)
  return {
    ...base,
    value: seconds,
    utilization,
    status,
    explanation,
    ...(status === 'pass' ? {} : { advice: `A buffer tank of at least ${round(neededM3)}${NBSP}m³ covers the restart.` }),
  }
}

function leakExposureCheck(ctx: EvalContext, liquidW: number): Check {
  const overhead = ctx.plan.cooling.pipingRoute === 'overhead'
  let status: Status = 'pass'
  let explanation: string
  if (liquidW <= 0) {
    explanation = 'No rack has liquid at it, so there is no rack-level leak exposure.'
  } else if (overhead) {
    status = 'warn'
    explanation =
      'Coolant pipes run overhead, above the racks, with no under-floor leak containment. A leak would drip onto equipment. Drip trays and leak detection along the runs reduce the risk.'
  } else {
    explanation = 'Coolant pipes run under the raised floor, below the racks, where leak detection and the floor void contain a leak.'
  }
  return {
    id: 'cooling.leakExposure:piping',
    kind: 'cooling.leakExposure',
    layer: 'cooling',
    subject: { kind: 'site', id: 'piping', objectIds: [] },
    title: 'Leak exposure',
    value: null,
    limit: null,
    unit: '',
    utilization: null,
    status,
    explanation,
    causes: [],
  }
}

function round(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function minutes(s: number): string {
  return `${round(s / 60)}${NBSP}min`
}

function mw(w: number): string {
  return `${(w / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}${NBSP}MW`
}
