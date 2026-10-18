import { Line } from '@react-three/drei'
import { RACK, type CatalogIndex, type NetworkResult, type Plan } from '@twin/schema'
import { useMemo } from 'react'
import { useTwinStore } from '../../state/store'
import { rackSize, slotWorld } from '../geometry'
import { PALETTE } from '../palette'
import { LegendRow, OverlayLegend } from './FloorLoad'
import { planCatalog } from './Ghost'

type Link = NetworkResult['links'][number]
type Media = Link['media']
type Point = [number, number, number]

/** Copper (passive DAC and active AEC) is graphite; fiber is blue. */
export function cableColor(media: Media): string {
  return media === 'fiber' ? PALETTE.supply : PALETTE.graphite
}

// TIA-942 asks for 300 mm of free space above overhead cable trays; the tray hangs that far below the ceiling.
const TRAY_CLEARANCE_M = 0.3
// Fiber rides in its own raceway just above the copper tray, so shared trunks stay visible for both media.
const FIBER_RACEWAY_ABOVE_M = 0.08

export interface CableRun {
  media: Media
  /** Rack top → up to the tray → along the row to its end → across to the leaf → down to the leaf top. */
  points: Point[]
}

/**
 * Polylines for the engine's rack-to-leaf links, following the route the engine measures: from the rack centre
 * along the row to the nearer useful end, then across in x and in z to the leaf (Manhattan). Links whose rack,
 * rack type or leaf is missing are skipped.
 */
export function cableRuns(plan: Plan, links: Link[], catalog: CatalogIndex): CableRun[] {
  const network = catalog.get(RACK.NETWORK, 'rack')
  const trayY = plan.hall.ceilingM - TRAY_CLEARANCE_M
  return links.flatMap((link): CableRun[] => {
    const placement = plan.placements.find((p) => p.id === link.fromId)
    const row = placement && plan.hall.rows.find((r) => r.id === placement.rowId)
    const group = placement && plan.rackGroups.find((g) => g.id === placement.groupId)
    const entry = group && catalog.get(group.rackTypeId, 'rack')
    const leaf = plan.hall.positions.find((p) => p.id === link.toId)
    if (!placement || !row || !entry || !leaf) return []
    const { x, z } = slotWorld(plan, row.id, placement.slot, entry.slotsWide)
    const rackTop = rackSize(entry).h
    const leafTop = network ? rackSize(network).h : rackTop
    const y = trayY + (link.media === 'fiber' ? FIBER_RACEWAY_ABOVE_M : 0)
    const ends = [row.x, row.x + row.slotCount * row.slotPitchM]
    const routeVia = (endX: number) => Math.abs(x - endX) + Math.abs(endX - leaf.x) + Math.abs(z - leaf.z)
    const endX = ends.reduce((best, e) => (routeVia(e) < routeVia(best) ? e : best))
    return [
      {
        media: link.media,
        points: [
          [x, rackTop, z],
          [x, y, z],
          [endX, y, z],
          [leaf.x, y, z],
          [leaf.x, y, leaf.z],
          [leaf.x, leafTop, leaf.z],
        ],
      },
    ]
  })
}

/** Consecutive point pairs of every run of one medium, for a single segmented line. */
function segmentsOf(runs: CableRun[], media: Media): Point[] {
  return runs.filter((r) => r.media === media).flatMap((r) => r.points.slice(1).flatMap((p, i) => [r.points[i]!, p]))
}

const MEDIA: { media: Media; label: string }[] = [
  { media: 'dac', label: 'Copper, passive (DAC)' },
  { media: 'aec', label: 'Copper, active (AEC)' },
  { media: 'fiber', label: 'Fiber with optics' },
]

// Active copper is dashed so the two copper media differ by more than their label.
const DASH = { dac: false, aec: true, fiber: false } as const

function swatch(media: Media) {
  const color = cableColor(media)
  const background = DASH[media] ? `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 7px)` : color
  return <span style={{ display: 'block', width: 16, height: 2, background }} />
}

/** Scale-out cable runs from each compute rack to its leaf, copper in graphite and fiber in blue. */
export function Cables() {
  const plan = useTwinStore((s) => s.plan)
  const network = useTwinStore((s) => s.evaluation?.network)
  const runs = useMemo(() => (plan && network ? cableRuns(plan, network.links, planCatalog(plan)) : []), [plan, network])
  const segments = useMemo(() => MEDIA.map(({ media }) => ({ media, points: segmentsOf(runs, media) })), [runs])
  if (!network) return null
  const count = (media: Media) => network.links.filter((l) => l.media === media).length
  const racks = (n: number) => `${n} ${n === 1 ? 'rack' : 'racks'}`
  return (
    <group name="overlay:network">
      {segments.map(({ media, points }) =>
        points.length > 0 ? (
          <Line
            key={media}
            points={points}
            segments
            color={cableColor(media)}
            lineWidth={1.5}
            dashed={DASH[media]}
            dashSize={0.3}
            gapSize={0.2}
            raycast={() => null}
          />
        ) : null,
      )}
      <OverlayLegend title="Scale-out cables to leaf switches">
        {MEDIA.map(({ media, label }) => (
          <LegendRow key={media} mark={swatch(media)} label={label} value={racks(count(media))} />
        ))}
        <div style={{ marginTop: 'var(--space-2)', color: 'var(--graphite)', fontSize: 'var(--text-xs)' }}>
          {Math.round(network.cableM).toLocaleString('en-US')}&nbsp;m of cable in total
        </div>
      </OverlayLegend>
    </group>
  )
}
