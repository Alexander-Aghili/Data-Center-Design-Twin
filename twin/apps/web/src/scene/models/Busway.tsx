import type { Plan } from '@twin/schema'
import type { Group } from 'three'
import { FINISH } from '../Lighting'
import { useRegistered } from '../Scene'
import type { EquipmentUnit } from './Hall'
import { catalogEntry, rackModel } from './Rack'

/** Busway duct cross-section (about 150 × 200 mm for 1250–2500 A plug-in busway) and its height above the racks. */
const DUCT = { w: 0.15, h: 0.2 }
const CLEARANCE = 0.45
const HANGER_PITCH = 3
const TAP = { w: 0.16, h: 0.22, d: 0.12 }

/** Overhead plug-in busway along a row: duct, ceiling hangers, and one tap-off box above each rack. */
export function Busway({ unit, plan }: { unit: EquipmentUnit; plan: Plan }) {
  const ref = useRegistered<Group>(unit.objectId, 'busway')
  const row = plan.hall.rows.find((r) => r.id === unit.rowId)
  if (!row) return null
  const length = row.slotCount * row.slotPitchM
  const placed = plan.placements.filter((p) => p.rowId === row.id)
  const tallest = Math.max(
    0,
    ...placed.map((p) => {
      const group = plan.rackGroups.find((g) => g.id === p.groupId)
      return group ? rackModel(plan, group.rackTypeId, group.coolingMethodId).size.h : 0
    }),
  )
  const y = tallest + CLEARANCE
  const hangerTop = plan.hall.ceilingM
  const hangers = Math.max(2, Math.ceil(length / HANGER_PITCH) + 1)
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]}>
      <mesh position={[length / 2, y + DUCT.h / 2, 0]} material={FINISH.clayDark} castShadow receiveShadow>
        <boxGeometry args={[length, DUCT.h, DUCT.w]} />
      </mesh>
      {Array.from({ length: hangers }, (_, k) => (
        <mesh key={k} position={[(k * length) / (hangers - 1), (y + DUCT.h + hangerTop) / 2, 0]} material={FINISH.graphite}>
          <boxGeometry args={[0.012, hangerTop - y - DUCT.h, 0.012]} />
        </mesh>
      ))}
      {placed.map((p) => {
        const wide = catalogEntry(plan, plan.rackGroups.find((g) => g.id === p.groupId)?.rackTypeId ?? '', 'rack')?.slotsWide ?? 1
        return (
          <mesh
            key={p.id}
            position={[(p.slot + wide / 2) * row.slotPitchM, y - TAP.h / 2, 0]}
            material={FINISH.clayMid}
            castShadow
          >
            <boxGeometry args={[TAP.w, TAP.h, TAP.d]} />
          </mesh>
        )
      })}
    </group>
  )
}
