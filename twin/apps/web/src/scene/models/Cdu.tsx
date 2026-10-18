import type { Group } from 'three'
import { FINISH, LOUVER_TILE_M } from '../Lighting'
import { useRegistered } from '../hooks'
import type { EquipmentUnit } from './Hall'
import { panelGeometry } from './Rack'

/** Cabinet envelope of the catalogued row CDU (Vertiv CoolChip CDU 1350: 900 × 1243 × 2122 mm, per the catalog note). */
export const CDU_SIZE = { w: 0.9, d: 1.243, h: 2.122 }

const PLINTH = 0.06
const STUB_R = 0.055

/** Row-end coolant distribution unit: cabinet, louvered front, controller screen, and four pipe stubs on the roof. */
export function Cdu({ unit }: { unit: EquipmentUnit }) {
  const ref = useRegistered<Group>(unit.objectId, 'cdu')
  const { w, d, h } = CDU_SIZE
  const bodyH = h - PLINTH
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      <mesh position={[0, PLINTH / 2, 0]} material={FINISH.plinth} receiveShadow>
        <boxGeometry args={[w - 0.03, PLINTH, d - 0.03]} />
      </mesh>
      <mesh position={[0, PLINTH + bodyH / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[w, bodyH, d]} />
      </mesh>
      <mesh
        position={[0, PLINTH + bodyH * 0.3, -d / 2 - 0.002]}
        geometry={panelGeometry(w * 0.8, bodyH * 0.42, LOUVER_TILE_M)}
        material={FINISH.louver}
      />
      <mesh position={[w * 0.18, PLINTH + bodyH * 0.74, -d / 2 - 0.004]} material={FINISH.ink}>
        <boxGeometry args={[0.22, 0.14, 0.008]} />
      </mesh>
      <mesh position={[0, PLINTH + bodyH * 0.5, -d / 2 - 0.004]} material={FINISH.clayDark}>
        <boxGeometry args={[w - 0.04, 0.008, 0.008]} />
      </mesh>
      {[-0.27, -0.09, 0.09, 0.27].map((x) => (
        <mesh key={x} position={[x * (w / 0.9), h + 0.09, d * 0.18]} material={FINISH.pipe} castShadow>
          <cylinderGeometry args={[STUB_R, STUB_R, 0.18, 18]} />
        </mesh>
      ))}
    </group>
  )
}
