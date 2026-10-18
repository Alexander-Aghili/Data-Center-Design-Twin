import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createDefaultPlan } from '@twin/catalog'
import { RACK, RACK_COOLING, placementId, type Plan } from '@twin/schema'
import { Box3, InstancedMesh, Vector3, type Object3D } from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Hall as HallComponent } from '../src/scene/models/Hall'
import type { Rack as RackComponent } from '../src/scene/models/Rack'
import type { useSceneRegistry as Registry } from '../src/scene/registry'
import type { useTwinStore as Store } from '../src/state/store'

let Rack: typeof RackComponent
let Hall: typeof HallComponent
let useSceneRegistry: typeof Registry
let useTwinStore: typeof Store

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  ;({ Rack } = await import('../src/scene/models/Rack'))
  ;({ Hall } = await import('../src/scene/models/Hall'))
  ;({ useSceneRegistry } = await import('../src/scene/registry'))
  ;({ useTwinStore } = await import('../src/state/store'))
})

let renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>> | null = null

afterEach(async () => {
  await renderer?.unmount()
  renderer = null
})

/** Default hall with rows 3–5 switched to GB300 NVL72 on direct-to-chip cooling (the demo step). */
function nvl72Plan(): Plan {
  const plan = createDefaultPlan()
  return {
    ...plan,
    rackGroups: plan.rackGroups.map((g) =>
      g.id === 'g2' ? { ...g, rackTypeId: RACK.GB300_NVL72, coolingMethodId: RACK_COOLING.DLC_1P } : g,
    ),
  }
}

function withPlacements(count: number): Plan {
  const plan = createDefaultPlan()
  const rows = plan.hall.rows
  const placements = Array.from({ length: count }, (_, k) => {
    const row = rows[Math.floor(k / 16)]!
    const slot = k % 16
    return { id: placementId(row.id, slot), groupId: 'g1', rowId: row.id, slot }
  })
  return { ...plan, placements }
}

const ids = () => [...useSceneRegistry.getState().objects.keys()]

describe('procedural models', () => {
  it('Rack registers tray and gpu ids', async () => {
    useTwinStore.setState({ plan: nvl72Plan(), evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Rack placementId="R3-00" openness={1} />)
    const registered = ids()
    // GB300 NVL72: 18 compute trays, 72 GPUs → 4 per tray.
    expect(registered).toContain('rack:R3-00')
    expect(registered).toContain('rack:R3-00:tray:0')
    expect(registered).toContain('rack:R3-00:tray:17')
    expect(registered).not.toContain('rack:R3-00:tray:18')
    expect(registered).toContain('rack:R3-00:tray:17:gpu:3')
    expect(registered).not.toContain('rack:R3-00:tray:0:gpu:4')
    expect(registered.filter((id) => /^rack:R3-00:tray:\d+:gpu:\d+$/.test(id))).toHaveLength(72)
  })

  it('openness 0 keeps trays inside chassis bounds', async () => {
    useTwinStore.setState({ plan: nvl72Plan(), evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Rack placementId="R3-05" openness={0} />)
    const registry = useSceneRegistry.getState()
    const chassis = registry.worldBox('rack:R3-05:chassis')
    expect(chassis).not.toBeNull()
    const inside = chassis!.clone().expandByScalar(1e-6)
    for (let i = 0; i < 18; i++) {
      const tray = registry.worldBox(`rack:R3-05:tray:${i}`)!
      expect(inside.containsBox(tray), `tray ${i}`).toBe(true)
    }

    // The same rack fully open pushes trays out of the front, so the check above is meaningful.
    await renderer.update(<Rack placementId="R3-05" openness={1} />)
    await renderer.advanceFrames(240, 1 / 60)
    // A rendered frame refreshes world matrices; worldBox only refreshes the object itself.
    renderer.scene.instance.updateMatrixWorld(true)
    const open = useSceneRegistry.getState().worldBox('rack:R3-05:tray:0')!
    expect(inside.containsBox(open)).toBe(false)
  })

  it('Hall renders one mesh per placement (instanced for >40)', async () => {
    const countRacks = () => ids().filter((id) => /^rack:R\d-\d\d$/.test(id)).length
    const instanced = (root: Object3D) => {
      const meshes: InstancedMesh[] = []
      root.traverse((o) => {
        if (o instanceof InstancedMesh && o.userData.role === 'rackBody') meshes.push(o)
      })
      return meshes
    }

    const small = withPlacements(40)
    useTwinStore.setState({ plan: small, evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Hall plan={small} units={[]} openRack={null} />)
    expect(countRacks()).toBe(40)
    expect(instanced(renderer.scene.instance)).toHaveLength(0)
    await renderer.unmount()

    const large = withPlacements(80)
    useTwinStore.setState({ plan: large, evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Hall plan={large} units={[]} openRack={null} />)
    expect(countRacks()).toBe(80)
    const meshes = instanced(renderer.scene.instance)
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(80)

    // Each instanced rack still has a world box at its slot, for the camera and picking.
    const box = useSceneRegistry.getState().worldBox('rack:R1-00') ?? new Box3()
    const center = box.getCenter(new Vector3())
    expect(center.x).toBeCloseTo(8 + 0.3, 5)
    expect(center.z).toBeCloseTo(4 + 0.6, 5)
  })
})
