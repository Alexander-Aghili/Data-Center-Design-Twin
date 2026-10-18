import { useId, type ComponentType } from 'react'
import type { LayerId, Plan } from '@twin/schema'
import { useTwinStore } from '../../state/store'
import { Field } from '../fields/Field'
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

/** Decisions of one layer as editable fields, each with its notes, and the layer's own notes last. */
export function DecisionPanel(props: { layer: LayerId }) {
  const plan = useTwinStore((st) => st.plan)
  const headingId = useId()
  const { title, Decisions } = PANELS[props.layer]
  const owner = plan?.owners[props.layer]
  return (
    <section className={s.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={`section-title ${s.heading}`}>
        <span>{title} decisions</span>
        {owner && owner.initials !== '—' && <span className={s.owner}>{owner.name}</span>}
      </h2>
      {plan ? (
        <>
          <Decisions key={plan.id} plan={plan} />
          <div className={s.layerNotes}>
            <Field label={`Notes on ${title.toLowerCase()}`} target={`layer:${props.layer}`} />
          </div>
        </>
      ) : (
        <p className={s.aside}>Waiting for the plan.</p>
      )}
    </section>
  )
}
