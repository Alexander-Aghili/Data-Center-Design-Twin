import { RACK, type Plan } from '@twin/schema'
import type { Group } from 'three'
import { FINISH } from '../Lighting'
import { useRegistered } from '../Scene'
import type { EquipmentUnit } from './Hall'
import { DOOR_MATERIALS, SHELL_MATERIALS, rackDoorGeometry, rackModel, rackShellGeometry } from './Rack'

/** Leaf switch in a network cabinet (the catalog's network rack), door open-framed so its switch faces read. */
export function LeafSwitch({ unit, plan }: { unit: EquipmentUnit; plan: Plan }) {
  const ref = useRegistered<Group>(unit.objectId, 'leaf')
  const model = rackModel(plan, RACK.NETWORK, '')
  const { w, d } = model.size
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      <mesh geometry={rackShellGeometry(model.size)} material={SHELL_MATERIALS} castShadow receiveShadow />
      <group position={[w / 2 - 0.015, 0, -d / 2]} rotation-y={-1.2}>
        <mesh geometry={rackDoorGeometry(model.size)} material={DOOR_MATERIALS} castShadow />
      </group>
      {model.trays.map((t) => (
        <group key={t.index} position={[0, t.y + t.h / 2, 0]}>
          <mesh material={FINISH.clayMid} castShadow>
            <boxGeometry args={[model.trayWidth, t.h - 0.004, model.trayDepth]} />
          </mesh>
          <mesh position={[0, 0, -model.trayDepth / 2 - 0.002]} rotation-y={Math.PI} material={FINISH.ink}>
            <planeGeometry args={[model.trayWidth * 0.86, t.h * 0.55]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
