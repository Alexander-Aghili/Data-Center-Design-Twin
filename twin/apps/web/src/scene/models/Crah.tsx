import { useMemo } from 'react'
import { CylinderGeometry, RingGeometry, TorusGeometry, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FINISH, PERF_TILE_M } from '../Lighting'
import { useRegistered } from '../Scene'
import type { EquipmentUnit } from './Hall'
import { box, panelGeometry } from './Rack'

/**
 * Chilled-water CRAH, drawn to fit the 2.2 m of wall the default hall allots per unit (2.0 m wide plus clearance),
 * 0.9 m deep and 1.95 m tall, close to large-frame perimeter units such as the Vertiv Liebert PCW.
 */
export const CRAH_SIZE = { w: 2.0, d: 0.9, h: 1.95 }

const grilleCache = new Map<number, BufferGeometry>()

/** Fan guard seen from above, lying flat at y = 0: rim, two guard rings, four spokes and a hub (radius `r`). */
export function fanGrilleGeometry(r: number): BufferGeometry {
  const cached = grilleCache.get(r)
  if (cached) return cached
  const wire = Math.max(0.006, r * 0.025)
  const flat = (g: BufferGeometry) => g.rotateX(Math.PI / 2).toNonIndexed()
  const parts = [
    flat(new TorusGeometry(r, wire * 1.6, 6, 48)),
    flat(new TorusGeometry(r * 0.66, wire, 4, 40)),
    flat(new TorusGeometry(r * 0.36, wire, 4, 32)),
    new CylinderGeometry(r * 0.16, r * 0.16, wire * 3, 20).toNonIndexed(),
    ...[0, 1, 2, 3].map((k) => box(r * 1.9, wire, wire * 1.6, 0, 0, 0).rotateY((k * Math.PI) / 4)),
  ]
  const geometry = mergeGeometries(parts)
  grilleCache.set(r, geometry)
  return geometry
}

const wellCache = new Map<number, BufferGeometry>()

/** Dark annulus under a fan guard: reads as the fan opening. */
export function fanWellGeometry(r: number): BufferGeometry {
  const cached = wellCache.get(r)
  if (cached) return cached
  const geometry = new RingGeometry(r * 0.16, r, 40).rotateX(-Math.PI / 2)
  wellCache.set(r, geometry)
  return geometry
}

/** Fan opening plus guard at the origin, facing up. */
export function FanGrille({ r, x, y, z }: { r: number; x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh geometry={fanWellGeometry(r)} material={FINISH.graphite} position-y={0.002} />
      <mesh geometry={fanGrilleGeometry(r)} material={FINISH.clayDark} position-y={0.012} castShadow />
    </group>
  )
}

/** Perimeter CRAH: cabinet with a perforated front and three EC fan grilles on the return deck. */
export function Crah({ unit }: { unit: EquipmentUnit }) {
  const ref = useRegistered<Group>(unit.objectId, 'crah')
  const { w, d, h } = CRAH_SIZE
  const fanR = Math.min(d * 0.4, w / 6.6)
  const fans = useMemo(() => [-1, 0, 1].map((k) => k * (w / 3)), [w])
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      <mesh position={[0, h / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh position={[0, h * 0.47, -d / 2 - 0.002]} geometry={panelGeometry(w - 0.12, h * 0.78, PERF_TILE_M)} material={FINISH.perforated} />
      {fans.map((x) => (
        <FanGrille key={x} r={fanR} x={x} y={h} z={0} />
      ))}
    </group>
  )
}
