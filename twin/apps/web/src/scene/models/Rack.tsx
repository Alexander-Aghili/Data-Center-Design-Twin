import { useFrame } from '@react-three/fiber'
import {
  CatalogEntrySchema,
  type CatalogEntry,
  type CatalogEntryOfKind,
  type CatalogKind,
  type Placement,
  type Plan,
  type RackEntry,
} from '@twin/schema'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CylinderGeometry, PlaneGeometry, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useTwinStore } from '../../state/store'
import { objectIdForPlacement, rackSize, slotWorld } from '../geometry'
import { FINISH, PERF_TILE_M } from '../Lighting'
import { useRegistered } from '../Scene'
import { Shelf, Tray, type TrayCooling } from './Tray'

// Built-in entries the scene needs for shapes (rack dimensions and trays, cooling form, plant type). Climate files are
// left out: they are large and carry no geometry. Plan snapshot entries win over these, as in the engine.
const BUILTIN = new Map<string, CatalogEntry>()
const files = import.meta.glob('../../../../../packages/catalog/data/{racks,rack-cooling,heat-rejection,equipment}/*.json', {
  eager: true,
  import: 'default',
})
for (const raw of Object.values(files)) {
  const parsed = CatalogEntrySchema.safeParse(raw)
  if (parsed.success) BUILTIN.set(parsed.data.id, parsed.data)
}

/** Catalog entry by id and kind: the plan's snapshot first, then the built-in data. */
export function catalogEntry<K extends CatalogKind>(plan: Plan, id: string, kind: K): CatalogEntryOfKind<K> | undefined {
  const entry = plan.catalog[id] ?? BUILTIN.get(id)
  return entry?.kind === kind ? (entry as CatalogEntryOfKind<K>) : undefined
}

/** EIA-310 rack unit. */
const U = 0.04445
/** Leveling base under the cabinet. */
const PLINTH_H = 0.05
/** Steel panel thickness for sides, roof and doors. */
const PANEL = 0.015
const DOOR = 0.02
/** EIA-310 19-inch equipment panel width; wider cabinets keep 100 mm of frame on each side. */
const PANEL_19IN = 0.4826
/**
 * Compute tray height in rack units. Liquid MGX racks (NVL72, Helios) use 1U compute trays; air-cooled
 * 8-GPU HGX/OAM servers ship in 8U–10U chassis (NVIDIA DGX B200: 10U), drawn as 10U.
 */
const LIQUID_TRAY_U = 1
const AIR_TRAY_U = 10
/** A tray slides out by this fraction of its depth when the rack is fully open. */
const SLIDE_FRACTION = 0.62
/** The front door swings to 110°. */
const DOOR_MAX_RAD = (110 * Math.PI) / 180
/** Time constant of the open/close easing, in seconds. */
const EASE_S = 0.28

export interface TraySlot {
  kind: 'compute' | 'switch' | 'power'
  /** Index within its kind, top to bottom; compute tray `i` is `rack:<id>:tray:<i>`. */
  index: number
  /** Bottom of the tray above the floor, in meters. */
  y: number
  h: number
}

export interface RackModel {
  size: { w: number; d: number; h: number }
  trays: TraySlot[]
  gpusPerTray: number
  cooling: TrayCooling
  trayWidth: number
  trayDepth: number
}

/**
 * Vertical tray stack of a rack entry, centered in the cabinet: half the power shelves, half the compute
 * trays, the switch trays, the other compute trays, the other power shelves (the NVL72 arrangement).
 */
export function trayLayout(entry: RackEntry, h: number): TraySlot[] {
  const { compute, switch: switches, power } = entry.trays
  const computeU = entry.supportedCooling.includes('air') ? AIR_TRAY_U : LIQUID_TRAY_U
  const run = (kind: TraySlot['kind'], n: number) => Array.from({ length: n }, () => kind)
  const order = [
    ...run('power', Math.ceil(power / 2)),
    ...run('compute', Math.ceil(compute / 2)),
    ...run('switch', switches),
    ...run('compute', Math.floor(compute / 2)),
    ...run('power', Math.floor(power / 2)),
  ]
  const units = order.map((kind) => (kind === 'compute' ? computeU : 1))
  const totalU = units.reduce((a, b) => a + b, 0)
  const usable = h - PLINTH_H - 2 * PANEL - 2 * U
  const u = totalU > 0 ? Math.min(U, usable / totalU) : U
  const mid = PLINTH_H + (h - PLINTH_H) / 2
  let top = mid + (totalU * u) / 2
  const next = { compute: 0, switch: 0, power: 0 }
  return order.map((kind, k) => {
    const th = units[k]! * u
    top -= th
    return { kind, index: next[kind]++, y: top, h: th }
  })
}

const FALLBACK_SIZE = { w: 0.6, d: 1.2, h: 42 * U }

export function rackModel(plan: Plan, rackTypeId: string, coolingMethodId: string): RackModel {
  const entry = catalogEntry(plan, rackTypeId, 'rack')
  const method = catalogEntry(plan, coolingMethodId, 'rackCooling')
  const size = entry ? rackSize(entry) : FALLBACK_SIZE
  const compute = entry?.trays.compute ?? 0
  return {
    size,
    trays: entry ? trayLayout(entry, size.h) : [],
    gpusPerTray: entry && compute > 0 ? Math.ceil(entry.gpuCount / compute) : 0,
    cooling: method?.category === 'dlc-1p' || method?.category === 'dlc-2p' ? 'coldPlate' : 'air',
    trayWidth: size.w <= 0.6 ? PANEL_19IN : size.w - 0.2,
    trayDepth: size.d - 0.25,
  }
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Door angle in radians for an openness: the door swings over the first 45%. */
export function doorAngle(openness: number): number {
  return smoothstep(openness / 0.45) * DOOR_MAX_RAD
}

/** Fraction of the full slide for compute tray `k` of `n`: trays follow the door top to bottom. */
export function traySlide(openness: number, k: number, n: number): number {
  const delay = n > 1 ? (0.3 * k) / (n - 1) : 0
  return smoothstep((openness - 0.3 - delay) / 0.4)
}

/** Rescales a box's UVs to meters / tile, so tiling textures keep their physical size. */
export function meterUv(geometry: BoxGeometry, w: number, h: number, d: number, tile: number): BoxGeometry {
  const uv = geometry.getAttribute('uv')
  // BoxGeometry faces in order +x, −x, +y, −y, +z, −z, four vertices each.
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = spans[Math.floor(i / 4)]!
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile)
  }
  return geometry
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, tile?: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d)
  if (tile) meterUv(g, w, h, d, tile)
  return g.translate(x, y, z).toNonIndexed()
}

/** Flat panel facing −z (a cabinet front) with UVs in meters / tile. */
export function panelGeometry(w: number, h: number, tile: number): BufferGeometry {
  const key = `${w}|${h}|${tile}`
  const cached = panelCache.get(key)
  if (cached) return cached
  const g = new PlaneGeometry(w, h).rotateY(Math.PI)
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile)
  panelCache.set(key, g)
  return g
}

const panelCache = new Map<string, BufferGeometry>()
const shellCache = new Map<string, BufferGeometry>()
const doorCache = new Map<string, BufferGeometry>()

/** Cabinet without its front door: sides, roof, floor pan, plinth and perforated rear door. Groups: clay, plinth, perforated. */
export function rackShellGeometry({ w, d, h }: RackModel['size']): BufferGeometry {
  const key = `${w}|${d}|${h}`
  const cached = shellCache.get(key)
  if (cached) return cached
  const bodyH = h - PLINTH_H
  const body = mergeGeometries([
    box(PANEL, bodyH, d, -w / 2 + PANEL / 2, PLINTH_H + bodyH / 2, 0),
    box(PANEL, bodyH, d, w / 2 - PANEL / 2, PLINTH_H + bodyH / 2, 0),
    box(w - 2 * PANEL, PANEL, d, 0, h - PANEL / 2, 0),
    box(w - 2 * PANEL, PANEL, d - 2 * DOOR, 0, PLINTH_H + PANEL / 2, 0),
  ])
  const plinth = box(w - 0.03, PLINTH_H, d - 0.03, 0, PLINTH_H / 2, 0)
  const rear = box(w - 2 * PANEL, bodyH - 2 * PANEL, DOOR, 0, PLINTH_H + bodyH / 2, d / 2 - DOOR / 2, PERF_TILE_M)
  const merged = mergeGeometries([body, plinth, rear], true)
  shellCache.set(key, merged)
  return merged
}

/**
 * Front door in hinge space (hinge on the cabinet's right edge seen from the front, at the origin). Groups:
 * perforated, graphite handle. `closedAt` places it in cabinet space for instancing.
 */
export function rackDoorGeometry({ w, d, h }: RackModel['size'], closedAt = false): BufferGeometry {
  const key = `${w}|${d}|${h}|${closedAt}`
  const cached = doorCache.get(key)
  if (cached) return cached
  const dw = w - 2 * PANEL
  const dh = h - PLINTH_H - 2 * PANEL
  const slab = box(dw, dh, DOOR, -dw / 2, PLINTH_H + PANEL + dh / 2, DOOR / 2, PERF_TILE_M)
  const handle = box(0.018, 0.26, 0.022, -dw + 0.045, PLINTH_H + dh * 0.55, -0.011)
  const merged = mergeGeometries([slab, handle], true)
  if (closedAt) merged.translate(w / 2 - PANEL, 0, -d / 2)
  doorCache.set(key, merged)
  return merged
}

export const SHELL_MATERIALS = [FINISH.clayLight, FINISH.plinth, FINISH.perforated]
export const DOOR_MATERIALS = [FINISH.perforated, FINISH.graphite]

const railGeometry = new BoxGeometry(0.018, 1, 0.03)
const manifoldGeometry = new CylinderGeometry(0.022, 0.022, 1, 14)

function RackInterior({ id, model }: { id: string; model: RackModel }) {
  const { size, trays, trayWidth } = model
  const railH = size.h - PLINTH_H - 2 * PANEL
  const railY = PLINTH_H + PANEL + railH / 2
  const railX = trayWidth / 2 + 0.012
  const manifoldX = Math.min(size.w / 2 - 0.05, trayWidth / 2 + 0.045)
  return (
    <>
      {[-1, 1].flatMap((sx) =>
        [-size.d / 2 + 0.11, size.d / 2 - 0.11].map((z) => (
          <mesh
            key={`${sx}${z}`}
            geometry={railGeometry}
            material={FINISH.graphite}
            position={[sx * railX, railY, z]}
            scale={[1, railH, 1]}
            castShadow
          />
        )),
      )}
      {model.cooling === 'coldPlate'
        ? ([
            [-manifoldX, FINISH.supply],
            [manifoldX, FINISH.return],
          ] as const).map(([x, material]) => (
            <mesh
              key={x}
              geometry={manifoldGeometry}
              material={material}
              position={[x, railY, size.d / 2 - 0.09]}
              scale={[1, railH, 1]}
              castShadow
            />
          ))
        : null}
      {trays
        .filter((t) => t.kind !== 'compute')
        .map((t) => (
          <Shelf
            key={`${t.kind}${t.index}`}
            objectId={`${id}:${t.kind}:${t.index}`}
            kind={t.kind === 'switch' ? 'switch' : 'power'}
            y={t.y}
            h={t.h}
            w={trayWidth}
            d={model.trayDepth}
          />
        ))}
    </>
  )
}

interface RackBodyProps {
  plan: Plan
  placement: Placement
  openness: number
  interior: boolean
}

function RackBody({ plan, placement, openness, interior }: RackBodyProps) {
  const group = plan.rackGroups.find((g) => g.id === placement.groupId)
  const model = useMemo(
    () => rackModel(plan, group?.rackTypeId ?? '', group?.coolingMethodId ?? ''),
    [plan, group?.rackTypeId, group?.coolingMethodId],
  )
  const slotsWide = group ? (catalogEntry(plan, group.rackTypeId, 'rack')?.slotsWide ?? 1) : 1
  const at = slotWorld(plan, placement.rowId, placement.slot, slotsWide)
  const id = objectIdForPlacement(placement.id)

  const root = useRegistered<Group>(id, 'rack')
  const chassis = useRegistered<Group>(`${id}:chassis`, 'rackChassis')
  const door = useRef<Group>(null)
  const slides = useRef<(Group | null)[]>([])
  const current = useRef(openness)

  const computeTrays = model.trays.filter((t) => t.kind === 'compute')
  const slideDepth = SLIDE_FRACTION * model.trayDepth

  const apply = (o: number) => {
    if (door.current) door.current.rotation.y = -doorAngle(o)
    slides.current.forEach((g, k) => {
      if (g) g.position.z = -traySlide(o, k, computeTrays.length) * slideDepth
    })
  }

  useLayoutEffect(() => apply(current.current))
  useFrame((_, dt) => {
    const gap = openness - current.current
    if (Math.abs(gap) < 1e-4) return
    current.current = Math.abs(gap) < 2e-3 ? openness : current.current + gap * (1 - Math.exp(-dt / EASE_S))
    apply(current.current)
  })

  const showInterior = interior && model.trays.length > 0
  return (
    <group ref={root} position={[at.x, 0, at.z]} rotation-y={at.rotY}>
      <group ref={chassis}>
        <mesh geometry={rackShellGeometry(model.size)} material={SHELL_MATERIALS} castShadow receiveShadow />
      </group>
      <group ref={door} position={[model.size.w / 2 - PANEL, 0, -model.size.d / 2]}>
        <mesh geometry={rackDoorGeometry(model.size)} material={DOOR_MATERIALS} castShadow receiveShadow />
      </group>
      {showInterior ? <RackInterior id={id} model={model} /> : null}
      {showInterior
        ? computeTrays.map((t, k) => (
            <group
              key={t.index}
              ref={(g) => {
                slides.current[k] = g
              }}
            >
              <Tray
                objectId={`${id}:tray:${t.index}`}
                y={t.y}
                h={t.h}
                w={model.trayWidth}
                d={model.trayDepth}
                gpus={model.gpusPerTray}
                cooling={model.cooling}
              />
            </group>
          ))
        : null}
    </group>
  )
}

/**
 * One cabinet at its slot, built from catalog dimensions. `openness` 0..1 swings the front door, then slides the
 * compute trays out top to bottom; the model eases toward a changed value. `interior` false draws only the shell
 * (the hall's closed racks), so trays and GPUs exist only where someone can see them.
 */
export function Rack({ placementId, openness, interior = true }: { placementId: string; openness: number; interior?: boolean }) {
  const plan = useTwinStore((s) => s.plan)
  const placement = plan?.placements.find((p) => p.id === placementId)
  if (!plan || !placement) return null
  return <RackBody plan={plan} placement={placement} openness={openness} interior={interior} />
}
