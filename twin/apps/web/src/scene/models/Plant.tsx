import { num, type HeatRejectionEntry, type Plan } from '@twin/schema'
import type { Group } from 'three'
import { FINISH } from '../Lighting'
import { useRegistered } from '../Scene'
import { FanGrille } from './Crah'
import type { EquipmentUnit } from './Hall'
import { catalogEntry } from './Rack'

type PlantCategory = HeatRejectionEntry['category']

/** Plant type of a heat rejection model (the plan's choice when the unit names none). */
export function plantCategory(plan: Plan, modelId: string | null): PlantCategory {
  return catalogEntry(plan, modelId ?? plan.cooling.heatRejectionId, 'heatRejection')?.category ?? 'chiller'
}

/**
 * Packaged air-cooled chillers and dry coolers ship about 2.3 m wide (under the 2.55 m road limit) and stand in
 * rows with about 1.1 m of service space between them; tower cells are square.
 */
const FAN_DECK_W = 2.3
const SERVICE_GAP = 1.1
const TOWER_SIDE = 5
/** Axial fans on V-coil chillers and dry coolers are commonly 800–910 mm across. */
const FAN_R = 0.45

export const PLANT_PITCH_M: Record<PlantCategory, number> = {
  chiller: FAN_DECK_W + SERVICE_GAP,
  dryCooler: FAN_DECK_W + SERVICE_GAP,
  adiabaticDryCooler: FAN_DECK_W + SERVICE_GAP,
  custom: FAN_DECK_W + SERVICE_GAP,
  coolingTower: TOWER_SIDE + SERVICE_GAP,
}

/**
 * Unit length from the catalog's footprint per MW: footprint = footprintM2PerMw × unit capacity, spread over the
 * unit's row pitch, kept between 4 m and the 9 m a 12 m deep yard leaves after access on both sides.
 */
export function plantUnitLength(plan: Plan, modelId: string | null): number {
  const entry = catalogEntry(plan, modelId ?? plan.cooling.heatRejectionId, 'heatRejection')
  const perMw = entry ? num(entry.footprintM2PerMw) : null
  const unitW = entry ? num(entry.unitCapacityW) : null
  if (!entry || perMw === null || unitW === null) return 6
  const footprint = (perMw * unitW) / 1e6
  return Math.min(9, Math.max(4, footprint / PLANT_PITCH_M[entry.category]))
}

function FanDeckUnit({ length, category }: { length: number; category: PlantCategory }) {
  const h = category === 'chiller' ? 2.5 : 2.2
  const base = category === 'chiller' ? 0.75 : 0.45
  const across = [-0.56, 0.56]
  const along = Math.max(1, Math.floor(length / 1.15))
  const step = length / along
  return (
    <>
      <mesh position={[0, base / 2, 0]} material={FINISH.clayMid} castShadow receiveShadow>
        <boxGeometry args={[FAN_DECK_W - 0.1, base, length - 0.1]} />
      </mesh>
      <mesh position={[0, base + (h - base) / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[FAN_DECK_W, h - base, length]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (FAN_DECK_W / 2 + 0.002), base + (h - base) / 2, 0]}
          rotation-y={(s * Math.PI) / 2}
          material={category === 'adiabaticDryCooler' ? FINISH.clayMid : FINISH.louver}
        >
          <planeGeometry args={[length - 0.2, (h - base) * 0.84]} />
        </mesh>
      ))}
      {Array.from({ length: along }, (_, k) =>
        across.map((x) => <FanGrille key={`${k}${x}`} r={FAN_R} x={x} y={h} z={-length / 2 + step * (k + 0.5)} />),
      )}
    </>
  )
}

function TowerCell() {
  const h = 4
  const stackR = 1.7
  return (
    <>
      <mesh position={[0, h / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[TOWER_SIDE, h, TOWER_SIDE]} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh
          key={k}
          position={[Math.sin((k * Math.PI) / 2) * (TOWER_SIDE / 2 + 0.002), h * 0.3, Math.cos((k * Math.PI) / 2) * (TOWER_SIDE / 2 + 0.002)]}
          rotation-y={(k * Math.PI) / 2}
          material={FINISH.louver}
        >
          <planeGeometry args={[TOWER_SIDE - 0.3, h * 0.45]} />
        </mesh>
      ))}
      <mesh position={[0, h + 0.6, 0]} material={FINISH.clayLight} castShadow>
        <cylinderGeometry args={[stackR, stackR * 1.08, 1.2, 40, 1, true]} />
      </mesh>
      <FanGrille r={stackR * 0.96} x={0} y={h + 0.3} z={0} />
    </>
  )
}

/** One heat rejection unit in the yard or on the roof: a fan-deck chiller or dry cooler, or a cooling tower cell. */
export function Plant({ unit, plan }: { unit: EquipmentUnit; plan: Plan }) {
  const ref = useRegistered<Group>(unit.objectId, 'plant')
  const category = plantCategory(plan, unit.modelId)
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      {category === 'coolingTower' ? <TowerCell /> : <FanDeckUnit length={plantUnitLength(plan, unit.modelId)} category={category} />}
    </group>
  )
}
