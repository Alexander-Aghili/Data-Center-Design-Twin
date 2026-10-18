import type { Check } from '@twin/schema'
import { fmtPower } from '../format'
import { Node, Pipe, selectFor, sizedSummary, statusOf, StripFrame, type LayerStripProps } from './parts'

const DISTRIBUTION: Record<string, string> = { ac54: 'AC to 54 V rack busbars', dc800: '800 V DC' }
const MAIN_Y = 30
const LOAD_Y = 80
const EMPTY = 'No racks placed yet. Place racks in Layout to see the power chain.'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function UtilitySymbol({ x, y }: { x: number; y: number }) {
  return (
    <g className="dt-symbol">
      <circle cx={x} cy={y} r={9} />
      <path d={`M${x - 5} ${y}q2.5 -4 5 0t5 0`} fill="none" />
    </g>
  )
}

function TransformerSymbol({ x, y }: { x: number; y: number }) {
  return (
    <g className="dt-symbol">
      <circle cx={x - 4.5} cy={y} r={7} />
      <circle cx={x + 4.5} cy={y} r={7} fillOpacity={0.6} />
    </g>
  )
}

function UpsSymbol({ x, y }: { x: number; y: number }) {
  return (
    <g className="dt-symbol">
      <rect x={x - 11} y={y - 8} width={22} height={16} rx={1} />
      <path d={`M${x - 11} ${y + 8}L${x + 11} ${y - 8}`} />
    </g>
  )
}

function LoadSymbol({ x, y }: { x: number; y: number }) {
  return <rect className="dt-symbol" x={x - 6} y={y - 7} width={12} height={14} rx={1} />
}

/** The power chain as a one-line diagram: utility, transformers, UPS, then one busway drop per row with its load. */
export function PowerOneLine({ plan, evaluation, select }: LayerStripProps) {
  const { equipment, checks, racks, rows } = evaluation
  const of = (kind: Check['kind']) => checks.filter((c) => c.kind === kind)
  const transformers = equipment.filter((e) => e.category === 'transformer')
  const ups = equipment.filter((e) => e.category === 'ups')
  const busways = equipment.filter((e) => e.category === 'busway')
  const itW = sum(racks.map((r) => r.powerW))
  const worstHourW = evaluation.hourly.facilityW.length ? Math.max(...evaluation.hourly.facilityW) : null
  const gridChecks = [...of('power.gridWorstHour'), ...of('power.trainingSwing')]
  const summary = `${fmtPower(itW)} IT load, ${plan.power.redundancy} redundancy, ${DISTRIBUTION[plan.power.distribution]}`

  const drops = rows.map((row) => {
    const busway = busways.find((b) => b.key === `busway:${row.rowId}`)
    const rowChecks = of('power.busway').filter(
      (c) => c.subject.id === row.rowId || (busway !== undefined && c.subject.objectIds.some((id) => busway.objectIds.includes(id))),
    )
    return { row, busway, checks: rowChecks, loadW: sum(racks.filter((r) => r.rowId === row.rowId).map((r) => r.powerW)) }
  })

  function draw(width: number) {
    const x0 = 56
    const step = Math.min(150, (width - 120) / 6)
    const xs = [x0, x0 + step, x0 + 2 * step]
    const busStart = xs[2]! + 30
    const span = width - 40 - busStart
    const dropX = (i: number) => busStart + 18 + (drops.length > 1 ? (i * (span - 18)) / (drops.length - 1) : span / 2)
    const tSummary = sizedSummary(transformers)
    const uSummary = sizedSummary(ups, 'modules')
    return (
      <svg width={width} height={140} role="group" aria-label="Power one-line">
        <Pipe d={`M${xs[0]! + 9} ${MAIN_Y}H${xs[1]! - 12}`} kind="power" />
        <Pipe d={`M${xs[1]! + 12} ${MAIN_Y}H${xs[2]! - 11}`} kind="power" />
        {drops.length ? (
          <>
            <Pipe d={`M${xs[2]! + 11} ${MAIN_Y}H${dropX(drops.length - 1)}`} kind="power" width={3} />
            {drops.map((d, i) => (
              <Pipe key={d.row.rowId} d={`M${dropX(i)} ${MAIN_Y}V${LOAD_Y - 7}`} kind="power" />
            ))}
          </>
        ) : null}
        <Node
          x={xs[0]!}
          y={MAIN_Y}
          label="Utility"
          value={`${fmtPower(plan.site.gridCapacityW)} cap`}
          detail={worstHourW === null ? undefined : `worst hour ${fmtPower(worstHourW)}`}
          symbol={<UtilitySymbol x={xs[0]!} y={MAIN_Y} />}
          status={statusOf(gridChecks)}
          onSelect={selectFor(select, gridChecks)}
        />
        <Node
          x={xs[1]!}
          y={MAIN_Y}
          label="Transformers"
          value={tSummary?.value ?? 'not sized'}
          detail={tSummary?.detail}
          symbol={<TransformerSymbol x={xs[1]!} y={MAIN_Y} />}
          status={statusOf(of('power.transformer'))}
          onSelect={selectFor(select, of('power.transformer'), transformers[0])}
        />
        <Node
          x={xs[2]!}
          y={MAIN_Y}
          label="UPS"
          value={uSummary ? `${uSummary.value}, ${plan.power.redundancy}` : 'not sized'}
          detail={uSummary?.detail}
          symbol={<UpsSymbol x={xs[2]!} y={MAIN_Y} />}
          status={statusOf(of('power.ups'))}
          onSelect={selectFor(select, of('power.ups'), ups[0])}
        />
        {drops.map((d, i) => (
          <Node
            key={d.row.rowId}
            x={dropX(i)}
            y={LOAD_Y}
            label={d.row.rowId}
            value={fmtPower(d.loadW)}
            detail={`${Math.round(d.row.buswayLoadA).toLocaleString('en-US')} A`}
            symbol={<LoadSymbol x={dropX(i)} y={LOAD_Y} />}
            status={statusOf(d.checks)}
            onSelect={selectFor(select, d.checks, d.busway)}
          />
        ))}
      </svg>
    )
  }

  return (
    <StripFrame title="Power one-line" summary={racks.length ? summary : undefined} empty={racks.length ? undefined : EMPTY}>
      {draw}
    </StripFrame>
  )
}
