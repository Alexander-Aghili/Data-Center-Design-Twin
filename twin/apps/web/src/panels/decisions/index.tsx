import { useId, type ComponentType } from 'react'
import type { LayerId, Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { useNoted } from '../fields/Field'
import { ComputeDecisions } from './Compute'
import { CoolingDecisions } from './Cooling'
import { LayoutDecisions } from './Layout'
import { NetworkDecisions } from './Network'
import { PowerDecisions } from './Power'
import { SiteDecisions } from './Site'
import { WorkloadDecisions } from './Workload'
import s from './decisions.module.css'

const PANELS: Record<LayerId, { title: string; Decisions: ComponentType<{ plan: Plan }> }> = {
  site: { title: 'Site', Decisions: SiteDecisions },
  workload: { title: 'Workload', Decisions: WorkloadDecisions },
  compute: { title: 'Compute', Decisions: ComputeDecisions },
  layout: { title: 'Layout', Decisions: LayoutDecisions },
  cooling: { title: 'Cooling', Decisions: CoolingDecisions },
  power: { title: 'Power', Decisions: PowerDecisions },
  network: { title: 'Network', Decisions: NetworkDecisions },
}

/**
 * The layer card: the layer's few essential decisions up front, the rest behind "More settings".
 * The layer's own notes hang off the flag beside the title.
 */
export function DecisionPanel(props: { layer: LayerId }) {
  const plan = useTwinStore((st) => st.plan)
  const headingId = useId()
  const { title, Decisions } = PANELS[props.layer]
  const owner = plan?.owners[props.layer]
  const { badge, body } = useNoted(`layer:${props.layer}`, `the ${title.toLowerCase()} layer`)
  return (
    <section className={s.panel} aria-labelledby={headingId} data-note-target={`layer:${props.layer}`}>
      <div className={s.head}>
        <h2 id={headingId} className={s.heading}>
          {title}
          <span className="visually-hidden"> decisions</span>
        </h2>
        {owner && <span className={s.owner}>{owner.name}</span>}
        {plan && badge}
      </div>
      {plan ? (
        <>
          {body}
          <Decisions key={plan.id} plan={plan} />
        </>
      ) : (
        <p className={s.aside}>Waiting for the plan.</p>
      )}
    </section>
  )
}
