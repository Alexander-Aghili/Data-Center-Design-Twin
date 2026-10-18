import type { Check, CheckKind, Plan, RackResult } from '@twin/schema'
import { Fragment } from 'react'
import { fmtPower } from '../format'
import {
  fmtUnit,
  Node,
  Pipe,
  rowsLabel,
  selectFor,
  sizedSummary,
  statusOf,
  StripFrame,
  worstCheck,
  type LayerStripProps,
} from './parts'

const HEAT_REJECTION_NAMES: Record<string, string> = {
  chiller: 'Chiller',
  dryCooler: 'Dry cooler',
  adiabaticDryCooler: 'Adiabatic dry cooler',
  coolingTower: 'Cooling tower',
}

function heatRejectionName(plan: Plan): string {
  const entry = plan.catalog[plan.cooling.heatRejectionId]
  if (entry?.kind !== 'heatRejection') return 'Heat rejection'
  return HEAT_REJECTION_NAMES[entry.category] ?? entry.name
}

function methodOf(plan: Plan, rack: RackResult) {
  const group = plan.rackGroups.find((g) => g.id === rack.groupId)
  const entry = group ? plan.catalog[group.coolingMethodId] : undefined
  return entry?.kind === 'rackCooling' ? entry : undefined
}

function coolantName(plan: Plan, racks: RackResult[]): string | null {
  const ids = new Set(racks.map((r) => methodOf(plan, r)?.coolantId).filter((id): id is string => Boolean(id)))
  const names = [...ids].map((id) => plan.catalog[id]?.name ?? id)
  return names.length ? names.join(', ') : null
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** "W1 at 112%": the zone behind a problem when the node sums several zones. */
function zoneProblem(checks: Check[]): string | undefined {
  const worst = worstCheck(checks)
  if (!worst || (worst.status !== 'fail' && worst.status !== 'warn') || worst.utilization === null) return undefined
  return `${worst.subject.id.replace(/^\w+:/, '')} at ${fmtUnit(worst.utilization, 'fraction')}`
}
const LANE_TOP = 22
const LANE_AIR = 84
const EMPTY = 'No racks placed yet. Place racks in Layout to see the cooling chain.'

/** The cooling chain as a piping diagram: heat rejection, facility loop, CDU, technical loop, racks; CRAH on the air side. */
export function CoolingChain({ plan, evaluation, select }: LayerStripProps) {
  const { racks, equipment, checks } = evaluation
  const liquidRacks = racks.filter((r) => r.liquidW > 0)
  const airRacks = racks.filter((r) => r.airW > 0)
  const cdus = equipment.filter((e) => e.category === 'cdu')
  const crahs = equipment.filter((e) => e.category === 'crah')
  const plant = equipment.filter((e) => e.key === 'plant' || e.category === 'heatRejection')
  const liquidW = sum(liquidRacks.map((r) => r.liquidW))
  const airW = sum(airRacks.map((r) => r.airW))
  const hasLiquid = liquidRacks.length > 0 || cdus.length > 0
  const hasAir = airRacks.length > 0 || crahs.length > 0

  const of = (...kinds: CheckKind[]) => checks.filter((c) => kinds.includes(c.kind))
  const groupsOf = (rs: RackResult[]) => new Set(rs.map((r) => r.groupId))
  const rackChecks = (rs: RackResult[]) => {
    const groups = groupsOf(rs)
    const ids = new Set(rs.map((r) => r.objectId))
    return of('cooling.rackHeatLimit').filter((c) => groups.has(c.subject.id) || c.subject.objectIds.some((id) => ids.has(id)))
  }

  const rowsWithCdu = new Set(evaluation.rows.filter((r) => r.cduKey).map((r) => r.rowId))
  const needCdu = liquidRacks.filter((r) => methodOf(plan, r)?.requiresCdu !== false)
  const uncovered = [...new Set(needCdu.map((r) => r.rowId))].filter((id) => !rowsWithCdu.has(id))
  const cduMissing = cdus.length === 0 && (uncovered.length > 0 || of('cooling.cduPositions').some((c) => c.status === 'fail'))

  const summary = [
    hasLiquid ? `${fmtPower(liquidW)} to liquid` : null,
    hasAir ? `${fmtPower(airW)} to air` : null,
    `facility supply ${fmtUnit(plan.cooling.facilitySupplyC, '°C')}`,
  ]
    .filter(Boolean)
    .join(', ')

  function draw(width: number) {
    const left = 64
    const step = (width - left - 80) / 4
    const x = (i: number) => left + i * step
    const airY = hasLiquid ? LANE_AIR : LANE_TOP
    const tee = x(1) + step / 2
    const plantSummary = sizedSummary(plant)
    const cduSummary = sizedSummary(cdus)
    const crahSummary = sizedSummary(crahs)
    const coolant = coolantName(plan, liquidRacks)
    const liquidFlow = sum(liquidRacks.map((r) => r.flowLps ?? 0))
    const broken = cduMissing ? 'missing' : 'supply'
    const liquidFailing = liquidRacks.some((r) => !r.coolingOk)
    const airFailing = airRacks.some((r) => !r.coolingOk && r.liquidW === 0)
    const liquidChecks = rackChecks(liquidRacks)
    const airChecks = rackChecks(airRacks.filter((r) => r.liquidW === 0))
    const rackStatus = (failing: boolean, cs: typeof checks) =>
      failing ? 'fail' : (cs.find((c) => c.status === 'fail' || c.status === 'warn')?.status ?? undefined)

    return (
      <svg width={width} height={140} role="group" aria-label="Cooling chain">
        <Pipe d={`M${x(0) + 10} ${LANE_TOP}H${x(1) - 10}`} kind="supply" />
        {hasLiquid ? (
          <>
            <Pipe d={`M${x(1) + 10} ${LANE_TOP}H${x(2) - 10}`} kind={broken} />
            <Pipe d={`M${x(2) + 10} ${LANE_TOP}H${x(3) - 10}`} kind={broken} />
            <Pipe d={`M${x(3) + 10} ${LANE_TOP}H${x(4) - 10}`} kind={broken} />
          </>
        ) : null}
        {hasAir ? (
          <>
            <Pipe
              d={hasLiquid ? `M${tee} ${LANE_TOP}V${airY}H${x(2) - 10}` : `M${x(1) + 10} ${airY}H${x(2) - 10}`}
              kind="supply"
            />
            {hasLiquid ? <circle cx={tee} cy={LANE_TOP} r={2.5} fill="var(--supply)" /> : null}
            <Pipe d={`M${x(2) + 10} ${airY}H${x(4) - 10}`} kind="air" />
          </>
        ) : null}

        <Node
          x={x(0)}
          y={LANE_TOP}
          label={heatRejectionName(plan)}
          value={plantSummary?.value ?? 'not sized'}
          detail={plantSummary?.detail}
          status={statusOf(of('cooling.heatRejection', 'cooling.waterPeakDay'))}
          onSelect={selectFor(select, of('cooling.heatRejection', 'cooling.waterPeakDay'), plant[0])}
        />
        <Node
          x={x(1)}
          y={LANE_TOP}
          label="Facility loop"
          value={`${fmtUnit(plan.cooling.facilitySupplyC, '°C')} supply`}
          detail={plan.cooling.bufferTankM3 > 0 ? `${fmtUnit(plan.cooling.bufferTankM3, 'm³')} buffer tank` : 'no buffer tank'}
          status={statusOf(of('cooling.rideThrough'))}
          onSelect={selectFor(select, of('cooling.rideThrough'))}
        />
        {hasLiquid ? (
          <Fragment>
            <Node
              x={x(2)}
              y={LANE_TOP}
              label="CDU"
              value={cduMissing ? `none for ${rowsLabel(uncovered, false)}` : (cduSummary?.value ?? 'not sized')}
              detail={cduMissing ? undefined : uncovered.length ? `none for ${rowsLabel(uncovered, false)}` : cduSummary?.detail}
              missing={cduMissing}
              status={statusOf(of('cooling.cduCapacity', 'cooling.cduPositions'))}
              onSelect={selectFor(select, of('cooling.cduPositions', 'cooling.cduCapacity'), cdus[0])}
            />
            <Node
              x={x(3)}
              y={LANE_TOP}
              label="Technical loop"
              value={coolant ?? 'no coolant'}
              detail={liquidFlow > 0 ? fmtUnit(liquidFlow, 'L/s') : undefined}
              missing={cduMissing}
              status={statusOf(of('cooling.coolantTemp', 'cooling.manifoldBalance', 'cooling.leakExposure'))}
              onSelect={selectFor(select, of('cooling.coolantTemp', 'cooling.manifoldBalance', 'cooling.leakExposure'))}
            />
            <Node
              x={x(4)}
              y={LANE_TOP}
              label={rowsLabel(liquidRacks.map((r) => r.rowId))}
              value={`${liquidRacks.length} racks`}
              detail={`${fmtPower(liquidW)} to liquid`}
              status={rackStatus(liquidFailing, liquidChecks)}
              onSelect={selectFor(select, liquidFailing ? [...of('cooling.cduPositions'), ...liquidChecks] : liquidChecks)}
            />
          </Fragment>
        ) : null}
        {hasAir ? (
          <Fragment>
            <Node
              x={x(2)}
              y={airY}
              label="CRAH"
              value={crahSummary ? `${crahSummary.value}, ${crahSummary.detail}` : 'not sized'}
              detail={zoneProblem(of('cooling.crahCapacity'))}
              status={statusOf(of('cooling.crahCapacity'))}
              onSelect={selectFor(select, of('cooling.crahCapacity'), crahs[0])}
            />
            <Node
              x={x(4)}
              y={airY}
              label={rowsLabel(airRacks.map((r) => r.rowId))}
              value={`${fmtPower(airW)} to air`}
              status={rackStatus(airFailing, airChecks)}
              onSelect={selectFor(select, airChecks)}
            />
          </Fragment>
        ) : null}
      </svg>
    )
  }

  return (
    <StripFrame title="Cooling chain" summary={racks.length ? summary : undefined} empty={racks.length ? undefined : EMPTY}>
      {draw}
    </StripFrame>
  )
}
