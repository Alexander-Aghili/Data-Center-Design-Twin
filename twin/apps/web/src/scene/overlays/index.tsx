import { useTwinStore } from '../../state/store'
import { useSiteReveal } from '../camera/siteReveal'
import { AirFlow } from './AirFlow'
import { Cables } from './Cables'
import { FloorLoad } from './FloorLoad'
import { Ghost } from './Ghost'
import { HeatShimmer } from './HeatShimmer'
import { LiquidFlow } from './LiquidFlow'
import { PowerLoad } from './PowerLoad'
import { SiteLabels } from './SiteLabels'
import { Temperature } from './Temperature'
import { WorkloadTint } from './WorkloadTint'

const SITE_LABELS_AT = 0.8

/** Mounts the overlay components for the store's `overlay` and `activeLayer`. Rendered inside the Canvas by `Scene`. */
export function Overlays() {
  const overlay = useTwinStore((s) => s.overlay)
  const layer = useTwinStore((s) => s.activeLayer)
  const previewing = useTwinStore((s) => s.previewProposalId !== null)
  // Site labels stand on leaders above the closed building; they wait for the camera to rise out of the hall.
  const siteClosed = useSiteReveal((s) => s.value >= SITE_LABELS_AT)
  return (
    <>
      <LiquidFlow visible={overlay === 'liquid'} />
      {overlay === 'air' ? <AirFlow /> : null}
      {overlay === 'temperature' ? <Temperature /> : null}
      {overlay === 'air' || overlay === 'temperature' ? <HeatShimmer /> : null}
      {overlay === 'floorLoad' ? <FloorLoad /> : null}
      {overlay === 'power' ? <PowerLoad /> : null}
      {overlay === 'network' ? <Cables /> : null}
      {previewing ? <Ghost /> : null}
      {layer === 'workload' ? <WorkloadTint /> : null}
      {layer === 'site' && siteClosed ? <SiteLabels /> : null}
    </>
  )
}
