import { RACK, type Plan } from '@twin/schema'
import type { Group } from 'three'
import { FINISH } from '../Lighting'
import { useRegistered } from '../hooks'
import type { EquipmentUnit } from './Hall'
import { SHELL_MATERIALS, rackModel, rackShellGeometry, type RackModel, type TraySlot } from './Rack'

/** One leaf switch in its network rack's slot: a clay chassis with a dark port face. */
function Switch({ unit, tray, model }: { unit: EquipmentUnit; tray: TraySlot; model: RackModel }) {
  const ref = useRegistered<Group>(unit.objectId, 'leaf')
  return (
    <group ref={ref} position={[0, tray.y + tray.h / 2, 0]}>
      <mesh material={FINISH.clayMid} castShadow>
        <boxGeometry args={[model.trayWidth, tray.h - 0.004, model.trayDepth]} />
      </mesh>
      <mesh position={[0, 0, -model.trayDepth / 2 - 0.002]} rotation-y={Math.PI} material={FINISH.ink}>
        <planeGeometry args={[model.trayWidth * 0.86, tray.h * 0.55]} />
      </mesh>
    </group>
  )
}

/**
 * A network cabinet (the catalog's network rack) with its front door off, holding the leaf switches `units`
 * (all at one place, one per `slot`), so the switch faces read.
 */
export function LeafRack({ id, units, plan }: { id: string; units: EquipmentUnit[]; plan: Plan }) {
  // Not selectable itself (picking passes through to the switches), but the camera and tests can find it.
  const ref = useRegistered<Group>(`netrack:${id}`, 'networkRack')
  const model = rackModel(plan, RACK.NETWORK, '')
  const at = units[0]
  return (
    <group ref={ref} position={[at?.x ?? 0, 0, at?.z ?? 0]} rotation-y={at?.rotY ?? 0}>
      <mesh geometry={rackShellGeometry(model.size)} material={SHELL_MATERIALS} castShadow receiveShadow />
      {units.map((u) => {
        const tray = model.trays[u.slot ?? 0]
        return tray ? <Switch key={u.objectId} unit={u} tray={tray} model={model} /> : null
      })}
    </group>
  )
}
