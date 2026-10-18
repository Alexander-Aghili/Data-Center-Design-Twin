import { Environment, Lightformer } from '@react-three/drei'
import {
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'
import { PALETTE } from './palette'

/**
 * Tiling textures generated in code (no image assets). Each tile is one repeat; geometry UVs are in
 * meters divided by the tile size, so a pattern keeps its physical scale on every surface.
 */
function patternTexture(size: number, shade: (u: number, v: number) => number): Texture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(255 * shade((x + 0.5) / size, (y + 0.5) / size))
      data.set([v, v, v, 255], (y * size + x) * 4)
    }
  }
  const texture = new DataTexture(data, size, size)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Physical size of one perforation tile: two staggered holes per 12 mm square (a common door pattern). */
export const PERF_TILE_M = 0.012
/** Raised-floor tiles are 600 mm square. */
export const FLOOR_TILE_M = 0.6

const perforation = patternTexture(32, (u, v) => {
  const hole = (cx: number, cy: number) => Math.hypot(u - cx, v - cy)
  const d = Math.min(hole(0.25, 0.25), hole(0.75, 0.75), hole(1.25, 0.25), hole(-0.25, 0.75), hole(0.25, 1.25))
  return 0.62 + 0.38 * smooth(0.13, 0.19, d)
})

const floorTile = patternTexture(64, (u, v) => {
  const edge = Math.min(u, 1 - u, v, 1 - v)
  return 0.9 + 0.1 * smooth(0.004, 0.02, edge)
})

const louver = patternTexture(16, (_u, v) => 0.72 + 0.28 * smooth(0.18, 0.42, Math.abs(v - 0.5)))

function clay(color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.86, metalness: 0, ...extra })
}

/**
 * Shared surface finishes for the white architectural-model look: matte clay everywhere, graphite for
 * small hardware, and the physics colors only on parts that carry coolant.
 */
export const FINISH = {
  clayLight: clay(PALETTE.clay.light),
  clayMid: clay(PALETTE.clay.mid),
  clayDark: clay(PALETTE.clay.dark),
  graphite: clay(PALETTE.graphite, { roughness: 0.6 }),
  ink: clay(PALETTE.ink, { roughness: 0.55 }),
  perforated: clay(PALETTE.clay.light, { map: perforation }),
  louver: clay(PALETTE.clay.light, { map: louver }),
  floor: clay(PALETTE.floor, { map: floorTile, roughness: 0.92 }),
  ground: clay(PALETTE.paper, { roughness: 1 }),
  plinth: clay('#C9D1D5', { roughness: 0.95 }),
  metal: clay('#D3DADD', { roughness: 0.38, metalness: 0.55 }),
  pipe: clay('#BAC4C9', { roughness: 0.5 }),
  supply: clay(PALETTE.supply, { roughness: 0.45 }),
  return: clay(PALETTE.return, { roughness: 0.45 }),
} as const

/** Soft daylight over a white model: sky fill, one shadow-casting key from the north-west, a weak bounce. */
export function Lighting() {
  return (
    <>
      <hemisphereLight args={['#FFFFFF', PALETTE.floor, 1.35]} />
      <directionalLight
        castShadow
        position={[-28, 58, -34]}
        intensity={2.1}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={6}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={48}
        shadow-camera-bottom={-48}
        shadow-camera-near={1}
        shadow-camera-far={180}
      >
        <object3D attach="target" position={[20, 0, 14]} />
      </directionalLight>
      <directionalLight position={[40, 18, 50]} intensity={0.35} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={0.6} position={[-14, 4, -10]} rotation-y={Math.PI / 3} scale={[20, 6, 1]} />
        <Lightformer form="rect" intensity={0.4} position={[14, 3, 12]} rotation-y={-Math.PI / 2} scale={[20, 4, 1]} />
      </Environment>
    </>
  )
}
