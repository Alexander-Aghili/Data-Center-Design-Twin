import type { Plan } from '@twin/schema'
import type { Group } from 'three'
import { FINISH } from '../Lighting'
import { useRegistered } from '../hooks'
import type { EquipmentUnit } from './Hall'

/**
 * Vertical tank with a height of twice its diameter: V = π (D/2)² · 2D = π D³ / 2, so D = ∛(2V / π).
 * The volume is the plan's buffer tank decision, split evenly over the units.
 */
export function tankDiameter(volumeM3: number): number {
  return Math.cbrt((2 * volumeM3) / Math.PI)
}

const SKIRT = 0.5

/** Chilled-water buffer tank on its skirt, with a domed head and supply/return nozzles. */
export function BufferTank({ unit, plan, units }: { unit: EquipmentUnit; plan: Plan; units: number }) {
  const ref = useRegistered<Group>(unit.objectId, 'bufferTank')
  const dia = tankDiameter(plan.cooling.bufferTankM3 / Math.max(1, units))
  const r = dia / 2
  const h = 2 * dia
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]}>
      <mesh position={[0, SKIRT / 2, 0]} material={FINISH.plinth} receiveShadow>
        <cylinderGeometry args={[r * 0.92, r * 0.92, SKIRT, 40]} />
      </mesh>
      <mesh position={[0, SKIRT + h / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 48]} />
      </mesh>
      <mesh position={[0, SKIRT + h, 0]} scale={[1, 0.35, 1]} material={FINISH.clayLight} castShadow>
        <sphereGeometry args={[r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[0.25, 0.75].map((f) => (
        <mesh key={f} position={[0, SKIRT + h * f, -r - 0.12]} rotation-x={Math.PI / 2} material={FINISH.pipe} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.3, 16]} />
        </mesh>
      ))}
    </group>
  )
}
