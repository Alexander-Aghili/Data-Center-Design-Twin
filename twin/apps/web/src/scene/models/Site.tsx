import { Edges, Line } from '@react-three/drei'
import type { Plan } from '@twin/schema'
import type { Group } from 'three'
import { GROUND_Y } from '../Ground'
import { FINISH } from '../Lighting'
import { PALETTE } from '../palette'
import { useRegistered } from '../Scene'
import { BufferTank } from './BufferTank'
import type { EquipmentUnit } from './Hall'
import { Plant } from './Plant'

const WALL_T = 0.3
/** Steel joists and deck above the ceiling line. */
const ROOF_DEPTH = 0.9
/** Below the site shot the walls are cut here, 1.2 m above the deck, like a plan-section model with poché on the cut. */
const CUT_Y = 1.2
const POCHE = 0.02
/** Site margin around the building and yard, to the property line. */
const MARGIN = 22
const EDGE = '#9AA6AC'

/** Wall footprints as [center x, center z, length along x, length along z]. */
function wallFootprints(plan: Plan): [number, number, number, number][] {
  const { widthM: w, depthM: d } = plan.hall
  return [
    [w / 2, -WALL_T / 2, w + 2 * WALL_T, WALL_T],
    [w / 2, d + WALL_T / 2, w + 2 * WALL_T, WALL_T],
    [-WALL_T / 2, d / 2, WALL_T, d],
    [w + WALL_T / 2, d / 2, WALL_T, d],
  ]
}

/** Building shell: full walls and roof for the site shot; otherwise walls cut low with a dark section cap. */
function Building({ plan, roof }: { plan: Plan; roof: boolean }) {
  const ref = useRegistered<Group>('site:building', 'building')
  const top = roof ? plan.hall.ceilingM + ROOF_DEPTH : CUT_Y
  const height = top - GROUND_Y
  const { widthM: w, depthM: d } = plan.hall
  return (
    <group ref={ref}>
      {wallFootprints(plan).map(([x, z, lx, lz]) => (
        <group key={`${x}|${z}`} position={[x, 0, z]}>
          <mesh position-y={GROUND_Y + height / 2} material={FINISH.clayLight} castShadow receiveShadow>
            <boxGeometry args={[lx, height, lz]} />
            <Edges color={EDGE} threshold={20} />
          </mesh>
          {roof ? null : (
            <mesh position-y={top + POCHE / 2} material={FINISH.ink}>
              <boxGeometry args={[lx, POCHE, lz]} />
            </mesh>
          )}
        </group>
      ))}
      {roof ? (
        <mesh position={[w / 2, top + 0.15, d / 2]} material={FINISH.clayLight} castShadow receiveShadow>
          <boxGeometry args={[w + 2 * WALL_T, 0.3, d + 2 * WALL_T]} />
          <Edges color={EDGE} threshold={20} />
        </mesh>
      ) : null}
    </group>
  )
}

/** Utility service: a fenced pad at the property line and a duct bank to the electrical room wall. */
function UtilityFeed({ plan, siteEastX }: { plan: Plan; siteEastX: number }) {
  const ref = useRegistered<Group>('site:utility', 'utilityFeed')
  const elec = plan.hall.positions.find((p) => p.kind === 'electrical')
  const z = elec?.z ?? plan.hall.depthM / 2
  const padX = siteEastX - 5
  const wallX = plan.hall.widthM + WALL_T
  return (
    <group ref={ref}>
      <mesh position={[padX, GROUND_Y + 0.08, z]} material={FINISH.clayMid} receiveShadow castShadow>
        <boxGeometry args={[6, 0.16, 5]} />
      </mesh>
      <mesh position={[padX, GROUND_Y + 1.1, z]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.9, 1.6]} />
        <Edges color={EDGE} threshold={20} />
      </mesh>
      <mesh position={[(wallX + padX - 3) / 2, GROUND_Y + 0.01, z]} rotation-x={-Math.PI / 2} material={FINISH.graphite}>
        <planeGeometry args={[padX - 3 - wallX, 0.5]} />
      </mesh>
    </group>
  )
}

/** Water service from the property line to the plant yard, with its meter box. */
function WaterFeed({ siteWestX, yardX, yardZ }: { siteWestX: number; yardX: number; yardZ: number }) {
  const ref = useRegistered<Group>('site:water', 'waterFeed')
  return (
    <group ref={ref}>
      <mesh position={[siteWestX + 2, GROUND_Y + 0.35, yardZ]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.7, 0.8]} />
        <Edges color={EDGE} threshold={20} />
      </mesh>
      <mesh position={[(siteWestX + 2.6 + yardX) / 2, GROUND_Y + 0.01, yardZ]} rotation-x={-Math.PI / 2} material={FINISH.graphite}>
        <planeGeometry args={[yardX - siteWestX - 2.6, 0.18]} />
      </mesh>
    </group>
  )
}

interface SiteProps {
  plan: Plan
  units: EquipmentUnit[]
  /** Show the roof (the site shot); otherwise the hall is open from above. */
  roof: boolean
}

/** Everything outside the hall: building shell, yard plant and buffer tank, utility and water feeds, property line. */
export function Site({ plan, units, roof }: SiteProps) {
  const { widthM: w, depthM: d } = plan.hall
  const plants = units.filter((u) => u.kind === 'plant')
  const tanks = units.filter((u) => u.kind === 'bufferTank')
  const yardMinZ = Math.min(-12, ...plants.map((p) => p.z - 6))
  const west = Math.min(-MARGIN, ...[...plants, ...tanks].map((u) => u.x - 8))
  const east = w + MARGIN
  const north = yardMinZ - 6
  const south = d + MARGIN / 2
  const yardWestX = Math.min(...[...plants, ...tanks].map((u) => u.x - 2), w / 2)
  const yardZ = plants[0]?.z ?? -6
  const y = GROUND_Y + 0.02
  return (
    <group>
      <Building plan={plan} roof={roof} />
      {plants.map((u) => (
        <Plant key={u.objectId} unit={u} plan={plan} />
      ))}
      {tanks.map((u) => (
        <BufferTank key={u.objectId} unit={u} plan={plan} units={tanks.length} />
      ))}
      <UtilityFeed plan={plan} siteEastX={east} />
      <WaterFeed siteWestX={west} yardX={yardWestX} yardZ={yardZ} />
      <Line
        points={[[west, y, north], [east, y, north], [east, y, south], [west, y, south], [west, y, north]]}
        color={PALETTE.graphite}
        lineWidth={1}
        dashed
        dashSize={1.6}
        gapSize={0.8}
      />
    </group>
  )
}
