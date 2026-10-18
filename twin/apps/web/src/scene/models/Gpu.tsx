import { CylinderGeometry, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FINISH } from '../Lighting'
import { useRegistered } from '../Scene'
import { box } from './Rack'
import type { TrayCooling } from './Tray'

const BOARD_Y = 0.0025
const BOARD_H = 0.003
const PACKAGE_H = 0.004
const FITTING_H = 0.008
const FITTING_R = 0.0055
/** Fin pitch of a GPU air heatsink, about 2 mm. */
const FIN_PITCH = 0.0022

/** Square GPU module footprint for `n` GPUs on a tray of width `w` and depth `d` (same grid as `gpuSlots`). */
export function gpuFootprint(n: number, w: number, d: number): number {
  const cols = Math.max(1, Math.min(n, 4))
  const rows = Math.max(1, Math.ceil(n / cols))
  const cellW = (w - 0.06) / cols
  const cellD = (d - 0.26) / rows
  return Math.min(cellW * 0.78, cellD * 0.7, 0.14)
}

function plateHeight(trayH: number): number {
  return Math.min(0.012, trayH * 0.25)
}

/** Top of the cold plate's inlet and outlet fittings, relative to the GPU center on the tray floor. */
export function gpuPorts(size: number, trayH: number) {
  const y = BOARD_Y + BOARD_H + PACKAGE_H + plateHeight(trayH) + FITTING_H
  return {
    supply: { x: -size * 0.2, y, z: size * 0.32 },
    return: { x: size * 0.2, y, z: size * 0.32 },
  }
}

function cylinder(r: number, h: number, x: number, y: number, z: number): BufferGeometry {
  return new CylinderGeometry(r, r, h, 16).translate(x, y + h / 2, z).toNonIndexed()
}

const cache = new Map<string, BufferGeometry>()

/**
 * Cold-plate module: board, package, plate, and inlet/outlet barbs with quick-disconnect collars in the
 * supply and return colors. Groups: board, graphite, plate, supply collar, return collar.
 */
function coldPlateGeometry(s: number, trayH: number): BufferGeometry {
  const ph = plateHeight(trayH)
  const plateY = BOARD_Y + BOARD_H + PACKAGE_H
  const fittingY = plateY + ph
  const ports = gpuPorts(s, trayH)
  const collar = (x: number) => cylinder(FITTING_R * 1.35, FITTING_H * 0.35, x, fittingY + FITTING_H * 0.45, ports.supply.z)
  return mergeGeometries(
    [
      box(s * 1.2, BOARD_H, s * 1.3, 0, BOARD_Y + BOARD_H / 2, 0),
      mergeGeometries([
        box(s * 0.82, PACKAGE_H, s * 0.82, 0, BOARD_Y + BOARD_H + PACKAGE_H / 2, 0),
        cylinder(FITTING_R, FITTING_H, ports.supply.x, fittingY, ports.supply.z),
        cylinder(FITTING_R, FITTING_H, ports.return.x, fittingY, ports.return.z),
      ]),
      mergeGeometries([
        box(s * 0.78, ph, s * 0.94, 0, plateY + ph / 2, 0),
        box(s * 0.62, ph * 0.3, s * 0.2, 0, plateY + ph * 1.15, ports.supply.z),
      ]),
      collar(ports.supply.x),
      collar(ports.return.x),
    ],
    true,
  )
}

/** Air heatsink: board, base and a fin stack running front to back. Groups: board, graphite, fins. */
function heatsinkGeometry(s: number, trayH: number): BufferGeometry {
  const baseY = BOARD_Y + BOARD_H + PACKAGE_H
  const finH = Math.min(0.14, trayH * 0.55)
  const fins = Math.max(2, Math.floor((s * 0.9) / FIN_PITCH))
  const finGeoms = Array.from({ length: fins }, (_, k) =>
    box(0.0008, finH, s * 1.1, -s * 0.45 + (k + 0.5) * ((s * 0.9) / fins), baseY + 0.006 + finH / 2, 0),
  )
  return mergeGeometries(
    [
      box(s * 1.2, BOARD_H, s * 1.3, 0, BOARD_Y + BOARD_H / 2, 0),
      box(s * 0.92, 0.006, s * 1.1, 0, baseY + 0.003, 0),
      mergeGeometries(finGeoms),
    ],
    true,
  )
}

function gpuGeometry(cooling: TrayCooling, s: number, trayH: number): BufferGeometry {
  const key = `${cooling}|${s}|${trayH}`
  const cached = cache.get(key)
  if (cached) return cached
  const geometry = cooling === 'coldPlate' ? coldPlateGeometry(s, trayH) : heatsinkGeometry(s, trayH)
  cache.set(key, geometry)
  return geometry
}

const COLD_PLATE_MATERIALS = [FINISH.clayDark, FINISH.graphite, FINISH.metal, FINISH.supply, FINISH.return]
const HEATSINK_MATERIALS = [FINISH.clayDark, FINISH.graphite, FINISH.metal]

interface GpuProps {
  objectId: string
  x: number
  z: number
  size: number
  trayH: number
  cooling: TrayCooling
}

/** One GPU module on a tray: a cold plate with quick disconnects, or an air heatsink. */
export function Gpu({ objectId, x, z, size, trayH, cooling }: GpuProps) {
  const ref = useRegistered<Group>(objectId, 'gpu')
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh
        geometry={gpuGeometry(cooling, size, trayH)}
        material={cooling === 'coldPlate' ? COLD_PLATE_MATERIALS : HEATSINK_MATERIALS}
        castShadow
        receiveShadow
      />
    </group>
  )
}
