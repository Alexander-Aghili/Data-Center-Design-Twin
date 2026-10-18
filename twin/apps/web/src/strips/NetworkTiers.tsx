import type { NetworkResult, SizedEquipment } from '@twin/schema'
import { fmtPower } from '../format'
import { Node, Pipe, selectFor, statusOf, StripFrame, type LayerStripProps } from './parts'

const FABRIC: Record<string, string> = { railOptimized: 'Rail-optimized', fatTree: 'Fat tree' }
const TOP = 26
const BOTTOM = 132
const EMPTY = 'No racks placed yet. Place racks in Layout to see the network tiers.'

type Link = NetworkResult['links'][number]

function counts(links: Link[]): { copper: number; fiber: number } {
  const fiber = links.filter((l) => l.media === 'fiber').length
  return { copper: links.length - fiber, fiber }
}

function countText({ copper, fiber }: { copper: number; fiber: number }): string {
  return [copper ? `${copper} copper` : null, fiber ? `${fiber} fiber` : null].filter(Boolean).join(', ') || 'no links'
}

function SwitchSymbol({ x, y }: { x: number; y: number }) {
  return (
    <g className="dt-symbol">
      <rect x={x - 10} y={y - 5} width={20} height={10} rx={1} />
      <path d={`M${x - 5} ${y - 5}v10M${x} ${y - 5}v10M${x + 5} ${y - 5}v10`} strokeWidth={0.8} />
    </g>
  )
}

function RackSymbol({ x, y }: { x: number; y: number }) {
  return <rect className="dt-symbol" x={x - 4} y={y - 5} width={8} height={10} rx={1} />
}

/** The fabric as tiers: rows of racks, their leaf switches with copper and fiber link counts, and the spine. */
export function NetworkTiers({ plan, evaluation, select }: LayerStripProps) {
  const { racks, network, equipment, checks } = evaluation
  const leafEquipment = equipment.filter((e) => e.category === 'leaf')
  const rowOf = new Map(racks.map((r) => [r.objectId, r.rowId]))
  const leafOf = (toId: string): SizedEquipment | undefined =>
    leafEquipment.find((e) => e.key === toId || e.objectIds.includes(toId) || e.positionIds.includes(toId))

  const rowIds = [...new Set(racks.map((r) => r.rowId))]
  const leafIds = [...new Set(network.links.map((l) => leafOf(l.toId)?.key ?? l.toId))]
  const linksOf = (rowId: string, leafId?: string) =>
    network.links.filter((l) => rowOf.get(l.fromId) === rowId && (leafId === undefined || (leafOf(l.toId)?.key ?? l.toId) === leafId))
  const total = counts(network.links)
  const summary = `${total.copper} copper links, ${total.fiber} fiber links, optics ${fmtPower(network.opticsW)}`

  function draw(width: number) {
    const rowX = 28
    const leafX = Math.max(320, Math.round(width * 0.55))
    const spineX = Math.min(width - 190, leafX + 220)
    const pitch = Math.min(22, (BOTTOM - TOP) / Math.max(1, rowIds.length - 1))
    const rowY = (i: number) => TOP + i * pitch + (rowIds.length === 1 ? (BOTTOM - TOP) / 2 : 0)
    const lineStart = rowX + 150
    const leafY = (leafId: string) => {
      const served = rowIds.map((id, i) => (linksOf(id, leafId).length ? rowY(i) : null)).filter((y): y is number => y !== null)
      return served.length ? (Math.min(...served) + Math.max(...served)) / 2 : (TOP + BOTTOM) / 2
    }
    const spineY = (TOP + BOTTOM) / 2
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mx = (x1 + x2) / 2
      return `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
    }

    return (
      <svg width={width} height={140} role="group" aria-label="Network tiers">
        <text className="dt-tier" x={rowX - 6} y={10}>
          Racks
        </text>
        <text className="dt-tier" x={leafX - 10} y={10}>
          Leaves
        </text>
        <text className="dt-tier" x={spineX - 10} y={10}>
          Spine
        </text>
        {rowIds.flatMap((rowId, i) =>
          leafIds.flatMap((leafId) => {
            const c = counts(linksOf(rowId, leafId))
            const y2 = leafY(leafId)
            return [
              c.copper ? <Pipe key={`${rowId}-${leafId}-c`} d={curve(lineStart, rowY(i) - 1.5, leafX - 12, y2 - 1.5)} kind="copper" width={1.5} /> : null,
              c.fiber ? <Pipe key={`${rowId}-${leafId}-f`} d={curve(lineStart, rowY(i) + 1.5, leafX - 12, y2 + 1.5)} kind="fiber" width={1.5} /> : null,
            ]
          }),
        )}
        {leafIds.map((leafId) => (
          <Pipe key={`${leafId}-spine`} d={curve(leafX + 12, leafY(leafId), spineX - 12, spineY)} kind="fiber" width={1.5} />
        ))}
        {rowIds.map((rowId, i) => {
          const rackIds = new Set(racks.filter((r) => r.rowId === rowId).map((r) => r.objectId))
          const rowChecks = checks.filter((c) => c.kind === 'network.copperReach' && c.subject.objectIds.some((id) => rackIds.has(id)))
          return (
            <Node
              key={rowId}
              x={rowX}
              y={rowY(i)}
              label={rowId}
              value={countText(counts(linksOf(rowId)))}
              textAt="inline"
              symbol={<RackSymbol x={rowX} y={rowY(i)} />}
              status={statusOf(rowChecks)}
              onSelect={() => select({ kind: 'row', id: rowId })}
            />
          )
        })}
        {leafIds.map((leafId, i) => {
          const leaf = leafEquipment.find((e) => e.key === leafId)
          const portChecks = checks.filter((c) => c.kind === 'network.leafPorts' && (c.subject.id === leafId || leaf?.objectIds.some((id) => c.subject.objectIds.includes(id))))
          const ports = portChecks[0]
          return (
            <Node
              key={leafId}
              x={leafX}
              y={leafY(leafId)}
              label={`Leaf ${i + 1}`}
              value={ports && ports.value !== null && ports.limit !== null ? `${ports.value} of ${ports.limit} ports` : `${network.links.filter((l) => (leafOf(l.toId)?.key ?? l.toId) === leafId).length} links`}
              textAt="right"
              symbol={<SwitchSymbol x={leafX} y={leafY(leafId)} />}
              status={statusOf(portChecks)}
              onSelect={selectFor(select, portChecks, leaf)}
            />
          )
        })}
        <Node
          x={spineX}
          y={spineY}
          label="Spine"
          value={`${FABRIC[plan.network.fabric] ?? plan.network.fabric}, ${network.oversubscription}:1`}
          detail={`base latency ${Math.round(network.baseLatencyNs).toLocaleString('en-US')} ns`}
          textAt="right"
          symbol={<SwitchSymbol x={spineX} y={spineY} />}
        />
      </svg>
    )
  }

  return (
    <StripFrame title="Network tiers" summary={racks.length ? summary : undefined} empty={racks.length ? undefined : EMPTY}>
      {draw}
    </StripFrame>
  )
}
