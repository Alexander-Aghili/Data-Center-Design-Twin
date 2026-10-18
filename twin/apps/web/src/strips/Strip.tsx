import type { LayerId, Selection } from '@twin/schema'
import { HourlyChart } from '../charts/HourlyChart'
import { useTwinStore } from '../state/store'
import { CoolingChain } from './CoolingChain'
import { NetworkTiers } from './NetworkTiers'
import { PowerOneLine } from './PowerOneLine'

/** Layer schematic under the scene: cooling chain, power one-line, network tiers, or the site's year against the grid cap. */
export function Strip({ layer }: { layer: LayerId }) {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const dispatchView = useTwinStore((s) => s.dispatchView)
  if (!plan || !evaluation) return null
  const props = { plan, evaluation, select: (target: Selection) => dispatchView({ type: 'select', target }) }
  switch (layer) {
    case 'cooling':
      return <CoolingChain {...props} />
    case 'power':
      return <PowerOneLine {...props} />
    case 'network':
      return <NetworkTiers {...props} />
    case 'site':
      return <HourlyChart series={['facilityW']} />
    default:
      return null
  }
}
