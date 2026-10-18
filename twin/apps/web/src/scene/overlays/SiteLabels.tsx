import { Html, Line } from '@react-three/drei'
import { loadBuiltins } from '@twin/catalog'
import { makeCatalogIndex } from '@twin/engine'
import { num, type CheckKind, type Evaluation, type Plan, type Status } from '@twin/schema'
import { useMemo } from 'react'
import { fmtPower, fmtValue } from '../../format'
import { StatusMark } from '../../panels/StatusMark'
import { useTwinStore } from '../../state/store'
import { PALETTE } from '../palette'

type Vec3 = [number, number, number]
type PositionKind = Plan['hall']['positions'][number]['kind']

export interface SiteLabel {
  id: 'grid' | 'water' | 'climate'
  title: string
  value: string
  /** Where the input enters the site, in hall meters; the label stands on a leader above it. */
  anchor: Vec3
  /** The check that compares the plan against this input, when there is an evaluation. */
  status?: { status: Status; text: string }
}

// Leader heights clear the hall roof and yard plant so labels float above the models they point at.
const LEADER_M = 7
const ROOF_LEADER_M = 4
const ANCHOR_DOT_M = 0.25

/** First equipment position of `kind` on the ground, else the middle of the hall's north wall. */
function groundAnchor(plan: Plan, kind: PositionKind): Vec3 {
  const position = plan.hall.positions.find((p) => p.kind === kind)
  return position ? [position.x, 0, position.z] : [plan.hall.widthM / 2, 0, 0]
}

function checkStatus(evaluation: Evaluation | null, kind: CheckKind, prefix: string): SiteLabel['status'] {
  const check = evaluation?.checks.find((c) => c.kind === kind)
  return check ? { status: check.status, text: `${prefix} ${fmtValue(check.value, check.unit)}` } : undefined
}

/** Grid connection, water allowance and climate design temperature, each at the place it enters the site. */
export function siteLabels(plan: Plan, evaluation: Evaluation | null): SiteLabel[] {
  const catalog = makeCatalogIndex([...loadBuiltins().entries, ...Object.values(plan.catalog)])
  const climate = catalog.get(plan.site.climateId, 'climate')
  const { widthM, depthM, ceilingM } = plan.hall
  const grid: SiteLabel = {
    id: 'grid',
    title: 'Grid connection',
    value: fmtPower(plan.site.gridCapacityW),
    anchor: groundAnchor(plan, 'electrical'),
    status: checkStatus(evaluation, 'power.gridWorstHour', 'Worst hour'),
  }
  const water: SiteLabel = {
    id: 'water',
    title: 'Water allowance',
    value: fmtValue(plan.site.waterAllowanceM3PerDay, 'm³/day'),
    anchor: groundAnchor(plan, 'plant'),
    status: checkStatus(evaluation, 'cooling.waterPeakDay', 'Peak day'),
  }
  const design: SiteLabel = {
    id: 'climate',
    title: climate?.name ?? 'Climate',
    value: `Design dry bulb ${fmtValue(climate ? num(climate.designDryBulbC) : null, '°C')}`,
    anchor: [widthM / 2, ceilingM, depthM / 2],
  }
  return [grid, water, design]
}

const css = `
.site-label {
  display: grid;
  gap: 1px;
  min-width: 132px;
  padding: 6px 10px 7px;
  border: var(--rule);
  border-left: 2px solid var(--ink);
  border-radius: var(--radius);
  background: var(--panel-raised);
  color: var(--ink);
  font-family: var(--font);
  line-height: var(--leading-tight);
  white-space: nowrap;
  transform: translate(-1px, -100%);
  user-select: none;
}
.site-label__title {
  color: var(--graphite);
  font-size: var(--text-xs);
  font-stretch: var(--stretch-label);
}
.site-label__value {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  font-stretch: var(--stretch-label);
}
.site-label__check {
  margin-top: 3px;
  font-size: var(--text-xs);
}
`

function SiteLabelCard({ label }: { label: SiteLabel }) {
  return (
    <div className="site-label">
      <style href="twin-site-labels" precedence="twin">
        {css}
      </style>
      <span className="site-label__title">{label.title}</span>
      <span className="site-label__value">{label.value}</span>
      {label.status && (
        <span className="site-label__check">
          <StatusMark status={label.status.status} label={label.status.text} />
        </span>
      )}
    </div>
  )
}

/** Site inputs drawn as callouts: a leader from where each input enters the site up to a label with its value. */
export function SiteLabels() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const labels = useMemo(() => (plan ? siteLabels(plan, evaluation) : []), [plan, evaluation])
  return (
    <group name="site-labels">
      {labels.map((label) => {
        const [x, y, z] = label.anchor
        const top: Vec3 = [x, y + (label.id === 'climate' ? ROOF_LEADER_M : LEADER_M), z]
        return (
          <group key={label.id}>
            <mesh position={label.anchor} raycast={() => undefined}>
              <sphereGeometry args={[ANCHOR_DOT_M, 12, 8]} />
              <meshBasicMaterial color={PALETTE.ink} />
            </mesh>
            <Line points={[label.anchor, top]} color={PALETTE.ink} lineWidth={1} />
            <Html position={top} zIndexRange={[9, 1]} pointerEvents="none">
              <SiteLabelCard label={label} />
            </Html>
          </group>
        )
      })}
    </group>
  )
}
