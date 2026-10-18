import { useMemo } from 'react'
import { CatmullRomCurve3, TubeGeometry, Vector3, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FINISH, PERF_TILE_M } from '../Lighting'
import { useRegistered } from '../hooks'
import { GPU_FRONT_CLEAR_M, Gpu, gpuFootprint, gpuPorts } from './Gpu'
import { box, panelGeometry } from './Rack'

export type TrayCooling = 'coldPlate' | 'air'

const SHEET = 0.0025
const BEZEL = 0.014
/** Hose outer radius: 1/4-inch ID tubing is about 9.5 mm across, so 4.75 mm. */
const HOSE_R = 0.00475

export interface GpuSlot {
  x: number
  z: number
}

/** GPU grid on a tray: up to four across, packed toward the rear behind the drive cage. */
export function gpuSlots(n: number, w: number, d: number): GpuSlot[] {
  if (n <= 0) return []
  const cols = Math.min(n, 4)
  const rows = Math.ceil(n / cols)
  const cellW = (w - 0.06) / cols
  const zFront = -d / 2 + GPU_FRONT_CLEAR_M
  const zBack = d / 2 - 0.1
  const cellD = (zBack - zFront) / rows
  return Array.from({ length: n }, (_, j) => ({
    x: -w / 2 + 0.03 + cellW * ((j % cols) + 0.5),
    z: zFront + cellD * (Math.floor(j / cols) + 0.5),
  }))
}

const trayCache = new Map<string, BufferGeometry>()

/** Open-top sheet-metal tray with a perforated bezel and a drive cage. Groups: clay, perforated, graphite. */
function trayGeometry(w: number, h: number, d: number): BufferGeometry {
  const key = `${w}|${h}|${d}`
  const cached = trayCache.get(key)
  if (cached) return cached
  const wall = Math.min(h * 0.55, 0.05)
  const pan = mergeGeometries([
    box(w, SHEET, d, 0, SHEET / 2, 0),
    box(SHEET, wall, d, -w / 2 + SHEET / 2, wall / 2, 0),
    box(SHEET, wall, d, w / 2 - SHEET / 2, wall / 2, 0),
    box(w, wall, SHEET, 0, wall / 2, d / 2 - SHEET / 2),
    box(w * 0.86, Math.min(h * 0.7, 0.04), 0.09, 0, Math.min(h * 0.7, 0.04) / 2, -d / 2 + BEZEL + 0.05),
  ])
  const bezel = box(w, h - 0.002, BEZEL, 0, h / 2, -d / 2 + BEZEL / 2, PERF_TILE_M)
  const handles = mergeGeometries([
    box(0.008, h * 0.6, 0.014, -w / 2 + 0.016, h / 2, -d / 2 - 0.007),
    box(0.008, h * 0.6, 0.014, w / 2 - 0.016, h / 2, -d / 2 - 0.007),
  ])
  const merged = mergeGeometries([pan, bezel, handles], true)
  trayCache.set(key, merged)
  return merged
}

const TRAY_MATERIALS = [FINISH.clayMid, FINISH.perforated, FINISH.graphite]
const hoseCache = new Map<string, { supply: BufferGeometry; return: BufferGeometry }>()

/** Supply and return hoses from each cold plate to the tray's rear rails, plus the rails and their quick disconnects. */
function hoseGeometries(slots: GpuSlot[], size: number, w: number, h: number, d: number) {
  const key = `${slots.length}|${w}|${h}|${d}`
  const cached = hoseCache.get(key)
  if (cached) return cached
  const railY = Math.min(h * 0.55, 0.026)
  const railZ = { supply: d / 2 - 0.035, return: d / 2 - 0.06 }
  const ports = gpuPorts(size, h)
  const hose = (from: Vector3, toZ: number) => {
    const lift = from.y + 0.006
    const curve = new CatmullRomCurve3([
      from,
      new Vector3(from.x, lift, from.z + 0.015),
      new Vector3(from.x, railY, (from.z + toZ) / 2 + 0.01),
      new Vector3(from.x, railY, toZ),
    ])
    return new TubeGeometry(curve, 16, HOSE_R, 6).toNonIndexed()
  }
  const rail = (z: number) => box(w - 0.08, 0.012, 0.012, 0, railY, z)
  const coupler = (x: number, z: number) => box(0.018, 0.018, 0.03, x, railY, z + 0.005)
  const side = { supply: -1, return: 1 } as const
  const build = (kind: 'supply' | 'return') =>
    mergeGeometries([
      rail(railZ[kind]),
      coupler(side[kind] * (w / 2 - 0.03), railZ[kind]),
      ...slots.map((s) => hose(new Vector3(s.x + ports[kind].x, ports[kind].y, s.z + ports[kind].z), railZ[kind])),
    ])
  const geometries = { supply: build('supply'), return: build('return') }
  hoseCache.set(key, geometries)
  return geometries
}

/** The tray's cold-plate hoses, rails and quick disconnects, registered so the gpu shot can frame them. */
function Hoses({ objectId, supply, ret }: { objectId: string; supply: BufferGeometry; ret: BufferGeometry }) {
  const ref = useRegistered<Group>(objectId, 'hoses')
  return (
    <group ref={ref}>
      <mesh geometry={supply} material={FINISH.supply} castShadow />
      <mesh geometry={ret} material={FINISH.return} castShadow />
    </group>
  )
}

interface TrayProps {
  objectId: string
  y: number
  h: number
  w: number
  d: number
  gpus: number
  cooling: TrayCooling
  /** Heatsink color under the temperature overlay (air trays only); null keeps bare metal. */
  heat?: string | null
}

/** A compute tray at height `y` inside the cabinet, with its GPUs (`<objectId>:gpu:<j>`) and coolant hoses. */
export function Tray({ objectId, y, h, w, d, gpus, cooling, heat = null }: TrayProps) {
  const ref = useRegistered<Group>(objectId, 'tray')
  const slots = useMemo(() => gpuSlots(gpus, w, d), [gpus, w, d])
  const size = gpuFootprint(slots.length, w, d)
  const hoses = useMemo(
    () => (cooling === 'coldPlate' && slots.length > 0 ? hoseGeometries(slots, size, w, h, d) : null),
    [cooling, slots, size, w, h, d],
  )
  return (
    <group ref={ref} position={[0, y, 0]}>
      <mesh geometry={trayGeometry(w, h, d)} material={TRAY_MATERIALS} castShadow receiveShadow />
      {slots.map((s, j) => (
        <Gpu key={j} objectId={`${objectId}:gpu:${j}`} x={s.x} z={s.z} size={size} trayH={h} cooling={cooling} heat={heat} />
      ))}
      {hoses ? <Hoses objectId={`${objectId}:hoses`} supply={hoses.supply} ret={hoses.return} /> : null}
    </group>
  )
}

/** Switch tray or power shelf: a closed 1U box with a ported or perforated face. */
export function Shelf({ objectId, kind, y, h, w, d }: { objectId: string; kind: 'switch' | 'power'; y: number; h: number; w: number; d: number }) {
  const ref = useRegistered<Group>(objectId, kind === 'switch' ? 'switchTray' : 'powerShelf')
  return (
    <group ref={ref} position={[0, y + h / 2, 0]}>
      <mesh castShadow receiveShadow material={FINISH.clayMid}>
        <boxGeometry args={[w, h - 0.003, d]} />
      </mesh>
      <mesh
        position={[0, 0, -d / 2 - 0.001]}
        geometry={panelGeometry(w * (kind === 'switch' ? 0.8 : 0.94), h * 0.62, PERF_TILE_M)}
        material={kind === 'switch' ? FINISH.graphite : FINISH.perforated}
      />
    </group>
  )
}
