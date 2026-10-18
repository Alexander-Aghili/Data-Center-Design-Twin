import { EQUIPMENT, num, type Check, type EquipmentPosition, type Evaluation, type Metric, type NetworkResult, type RackResult, type Row } from '@twin/schema'
import type { EvalContext } from './context'
import { fmt, rackCenter, utilizationStatus } from './floor'

export interface NetworkSlice {
  network: Evaluation['network']
  checks: Check[]
  metrics: Metric[]
}

type Link = NetworkResult['links'][number]
type Media = Link['media']

/** Switch hops on the worst GPU-to-GPU path, per the plan (Task 10): rail-optimized 2, fat tree 3. */
const HOPS = { railOptimized: 2, fatTree: 3 } as const

/** Cable route from the rack center along the row to the nearer useful row end, then across to the leaf (Manhattan). */
function routeM(row: Row, slot: number, slotsWide: number, leaf: EquipmentPosition): number {
  const { x, z } = rackCenter(row, slot, slotsWide)
  const ends = [row.x, row.x + row.slotCount * row.slotPitchM]
  return Math.min(...ends.map((endX) => Math.abs(x - endX) + Math.abs(endX - leaf.x) + Math.abs(z - leaf.z)))
}

const within = (lengthM: number, reachM: number | null) => reachM !== null && lengthM <= reachM

/** Rack-to-leaf links, media, optics power and latency (Task 10). */
export function networkFabric(ctx: EvalContext, racks: RackResult[]): NetworkSlice {
  const { plan, rules, catalog } = ctx
  const oversubscription = plan.network.oversubscription
  const leaves = plan.hall.positions.filter((p) => p.kind === 'leaf')
  // A rule without a value adds no slack rather than blocking every link.
  const slackM = num(rules.routingSlackM) ?? 0
  const dacReachM = num(rules.dacReachM)
  const aecReachM = num(rules.aecReachM)
  const param = (id: string, key: string) => {
    const q = catalog.get(id, 'equipment')?.params[key]
    return q ? num(q) : null
  }
  const powerPerEnd: Record<Media, number | null> = {
    dac: param(EQUIPMENT.CABLE_DAC, 'powerWPerEnd'),
    aec: param(EQUIPMENT.CABLE_AEC, 'powerWPerEnd'),
    fiber: param(EQUIPMENT.OPTIC_800G, 'powerW'),
  }

  const links: Link[] = []
  const cables: Record<Media, number> = { dac: 0, aec: 0, fiber: 0 }
  const runs: Record<Media, number> = { dac: 0, aec: 0, fiber: 0 }
  const fiberObjectIds: string[] = []
  let downlinks = 0
  let computeRacks = 0
  let cableM = 0

  for (const r of racks) {
    const group = plan.rackGroups.find((g) => g.id === r.groupId)
    const entry = group && catalog.get(group.rackTypeId, 'rack')
    const row = plan.hall.rows.find((candidate) => candidate.id === r.rowId)
    if (!entry || entry.role !== 'compute' || !row) continue
    computeRacks += 1
    downlinks += entry.scaleOutPorts
    const nearest = leaves
      .map((leaf) => ({ leaf, routeM: routeM(row, r.slot, entry.slotsWide, leaf) }))
      .sort((a, b) => a.routeM - b.routeM)[0]
    if (!nearest) continue
    // Rounded to the millimetre so float noise (0.3 + 1.2 + 0.5 = 2.0000000000000004) cannot flip a medium at its reach.
    const lengthM = Math.round((nearest.routeM + slackM) * 1000) / 1000
    const media: Media = within(lengthM, dacReachM) ? 'dac' : within(lengthM, aecReachM) ? 'aec' : 'fiber'
    links.push({ fromId: r.placementId, toId: nearest.leaf.id, media, lengthM })
    runs[media] += 1
    cables[media] += entry.scaleOutPorts
    cableM += entry.scaleOutPorts * lengthM
    if (media === 'fiber') fiberObjectIds.push(r.objectId)
  }

  // Each cable has two ends: transceivers on fiber, retimers (AEC) or ID chips (DAC) on copper.
  const usedMedia = (Object.keys(cables) as Media[]).filter((m) => cables[m] > 0)
  const opticsKnown = usedMedia.every((m) => powerPerEnd[m] !== null)
  const opticsW = usedMedia.reduce((sum, m) => sum + 2 * cables[m] * (powerPerEnd[m] ?? 0), 0)
  const transceivers = 2 * cables.fiber

  const nsPerM: Record<Media, number | null> = { dac: num(rules.copperNsPerM), aec: num(rules.copperNsPerM), fiber: num(rules.fiberNsPerM) }
  const hopNs = num(rules.hopNs)
  const hops = HOPS[plan.network.fabric]
  // The worst path runs up the slowest rack-to-leaf link and down another like it, crossing `hops` switches.
  const perM = links.map((l) => nsPerM[l.media])
  const baseLatencyNs =
    links.length === 0 || hopNs === null || perM.some((v) => v === null)
      ? null
      : 2 * Math.max(...links.map((l, i) => l.lengthM * perM[i]!)) + hops * hopNs

  // Leaf ports: every scale-out port takes a downlink; uplinks to the spine follow the oversubscription ratio.
  const uplinks = Math.ceil(downlinks / oversubscription)
  const portsNeeded = downlinks + uplinks
  const portsPerLeaf = param(EQUIPMENT.LEAF_64X800G, 'ports')
  const leafCount = leaves.reduce((sum, p) => sum + p.capacity, 0)
  const portLimit = portsPerLeaf === null ? null : portsPerLeaf * leafCount
  let portUtilization: number | null = null
  if (portLimit !== null && portLimit > 0) portUtilization = portsNeeded / portLimit
  else if (portLimit === 0 && portsNeeded === 0) portUtilization = 0
  const portStatus = portLimit === 0 && portsNeeded > 0 ? 'fail' : utilizationStatus(portUtilization, rules)

  const reach = (m: number | null) => (m === null ? 'an unknown reach' : `${fmt(m)}\u00a0m`)
  const copperRuns = runs.dac + runs.aec
  let copperExplanation: string
  if (computeRacks === 0) {
    copperExplanation = 'No compute racks are placed, so there are no scale-out cables.'
  } else if (links.length === 0) {
    copperExplanation = 'No leaf position exists, so no rack can be cabled.'
  } else {
    const fiberPower = powerPerEnd.fiber === null ? 'an unknown power' : `${fmt(transceivers * powerPerEnd.fiber, 0)}\u00a0W`
    copperExplanation =
      `${copperRuns} of ${links.length} racks reach their leaf on copper (${runs.dac} on DAC up to ${reach(dacReachM)}, ` +
      `${runs.aec} on AEC up to ${reach(aecReachM)}). ${runs.fiber} ${runs.fiber === 1 ? 'needs' : 'need'} optics: ` +
      `${fmt(transceivers, 0)} transceivers drawing ${fiberPower}.`
  }

  const checks: Check[] = [
    {
      id: 'network.copperReach:fabric',
      kind: 'network.copperReach',
      layer: 'network',
      subject: { kind: 'site', id: 'fabric', objectIds: fiberObjectIds },
      title: 'Racks within copper reach',
      value: copperRuns,
      limit: null,
      unit: 'racks',
      utilization: null,
      status: computeRacks > 0 && links.length === 0 ? 'unknown' : 'pass',
      explanation: copperExplanation,
      causes: [],
    },
    {
      id: 'network.leafPorts:leaf',
      kind: 'network.leafPorts',
      layer: 'network',
      subject: { kind: 'equipment', id: 'leaf', objectIds: [] },
      title: 'Leaf switch ports',
      value: portsNeeded,
      limit: portLimit,
      unit: 'ports',
      utilization: portUtilization,
      status: portStatus,
      explanation:
        `${fmt(downlinks, 0)} scale-out ports need as many leaf downlinks plus ${fmt(uplinks, 0)} uplinks at ${fmt(oversubscription, 2)}:1, ` +
        `${fmt(portsNeeded, 0)} ports against ${leafCount} leaf switches × ${portsPerLeaf === null ? 'an unknown number of' : fmt(portsPerLeaf, 0)} ports.`,
      causes: [],
      ...(portStatus === 'fail' && {
        advice: 'Add leaf positions or raise their capacity, raise the oversubscription, or place fewer compute racks.',
      }),
    },
  ]

  const metric = (id: string, label: string, value: number | null, unit: string, inputs: string[], group?: string): Metric => ({
    id,
    layer: 'network',
    label,
    value,
    unit,
    basis: 'calculated',
    inputs,
    ...(group !== undefined && { group }),
  })
  const reachInputs = ['dacReachM', 'aecReachM', 'routingSlackM', 'hall.positions']
  const metrics: Metric[] = [
    metric('network.links.dac', 'Racks on DAC', runs.dac, 'racks', reachInputs, 'links'),
    metric('network.links.aec', 'Racks on AEC', runs.aec, 'racks', reachInputs, 'links'),
    metric('network.links.fiber', 'Racks on fiber', runs.fiber, 'racks', reachInputs, 'links'),
    metric('network.cableM', 'Scale-out cable length', cableM, 'm', reachInputs),
    metric('network.transceivers', 'Optical transceivers', transceivers, 'units', [...reachInputs, EQUIPMENT.OPTIC_800G]),
    metric('network.opticsW', 'Optics and active cable power', opticsKnown ? opticsW : null, 'W', [
      EQUIPMENT.OPTIC_800G,
      EQUIPMENT.CABLE_DAC,
      EQUIPMENT.CABLE_AEC,
    ]),
    metric('network.baseLatencyNs', 'Base latency', baseLatencyNs, 'ns', ['fiberNsPerM', 'copperNsPerM', 'hopNs', 'network.fabric']),
    metric('network.leafPortsNeeded', 'Leaf ports needed', portsNeeded, 'ports', ['network.oversubscription', EQUIPMENT.LEAF_64X800G]),
  ]

  return {
    network: { links, opticsW, cableM, baseLatencyNs, oversubscription },
    checks,
    metrics,
  }
}
