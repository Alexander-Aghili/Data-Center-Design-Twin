import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createDefaultPlan } from '@twin/catalog'
import { RACK, RACK_COOLING, placementId, type Plan } from '@twin/schema'
import { Box3, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three'
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

  it('a focus tray slides out alone so the trays above stay clear of its GPUs', async () => {
    useTwinStore.setState({ plan: nvl72Plan(), evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Rack placementId="R3-02" openness={1} tray={5} />)
    renderer.scene.instance.updateMatrixWorld(true)
    const registry = useSceneRegistry.getState()
    const chassis = registry.worldBox('rack:R3-02:chassis')!.expandByScalar(1e-6)
    const outside = Array.from({ length: 18 }, (_, i) => i).filter((i) => !chassis.containsBox(registry.worldBox(`rack:R3-02:tray:${i}`)!))
    expect(outside).toEqual([5])
  })

  it('places equipment from Evaluation.equipment at its positions', async () => {
    const { evaluate } = await import('@twin/engine')
    const { loadBuiltins } = await import('@twin/catalog')
    const { equipmentUnits } = await import('../src/scene/models/Hall')
    const plan = nvl72Plan()
    const evaluation = evaluate(plan, loadBuiltins())
    const units = equipmentUnits(plan, evaluation)
    const expected = evaluation.equipment.filter((e) => !['optic', 'cable'].includes(e.category))
    for (const e of expected) {
      const drawn = units.filter((u) => u.key === e.key)
      expect(drawn.map((u) => u.objectId), e.key).toEqual(e.objectIds)
    }
    const cdu = units.find((u) => u.kind === 'cdu')!
    const position = plan.hall.positions.find((p) => p.id === evaluation.equipment.find((e) => e.key === cdu.key)!.positionIds[0])!
    expect(Math.abs(cdu.z - position.z)).toBeLessThan(1e-9)
  })

  it('stands UPS modules and transformers in short lineups and wraps a long plant yard into staggered rows', async () => {
    const { evaluate } = await import('@twin/engine')
    const { loadBuiltins } = await import('@twin/catalog')
    const { equipmentUnits } = await import('../src/scene/models/Hall')
    const plan = nvl72Plan()
    const evaluation = evaluate(plan, loadBuiltins())
    const sized = (key: string, count: number, positionIds: string[]) => ({
      key,
      category: key,
      modelId: null,
      count,
      required: count,
      positionIds,
      autoSized: true,
      loadW: 0,
      capacityW: null,
      objectIds: [],
    })
    const units = equipmentUnits(plan, {
      ...evaluation,
      equipment: [sized('ups', 24, ['elec-1']), sized('transformer', 6, ['elec-1']), sized('plant', 16, ['plant-1'])],
    })
    const lineups = (kind: string) => {
      const byX = new Map<number, number>()
      for (const u of units.filter((x) => x.kind === kind)) byX.set(u.x, (byX.get(u.x) ?? 0) + 1)
      return [...byX.values()]
    }
    expect(lineups('ups')).toEqual([8, 8, 8])
    expect(lineups('transformer')).toEqual([6])
    for (const u of units.filter((x) => x.kind === 'ups' || x.kind === 'transformer')) {
      expect(u.x).toBeGreaterThan(0)
      expect(u.x).toBeLessThan(plan.hall.widthM)
    }
    // 16 chillers at a 3.4 m pitch would run 54 m, past the 40 m building: two rows, the far one offset half a
    // pitch so its branch pipes run in the service gaps of the near row.
    const plants = units.filter((u) => u.kind === 'plant')
    const rowsZ = [...new Set(plants.map((u) => u.z))].sort((a, b) => b - a)
    expect(rowsZ).toHaveLength(2)
    const near = plants.filter((u) => u.z === rowsZ[0]).map((u) => u.x)
    const far = plants.filter((u) => u.z === rowsZ[1]).map((u) => u.x)
    expect(Math.max(...near) - Math.min(...near)).toBeLessThanOrEqual(plan.hall.widthM)
    expect(Math.min(...far.map((x) => Math.min(...near.map((n) => Math.abs(n - x)))))).toBeCloseTo(3.4 / 2)
  })

  it('keeps indoor equipment inside the hall walls and yard plant outside, up to every position capacity', async () => {
    const { evaluate } = await import('@twin/engine')
    const { loadBuiltins } = await import('@twin/catalog')
    const { equipmentUnits } = await import('../src/scene/models/Hall')
    const { Site } = await import('../src/scene/models/Site')
    const plan = nvl72Plan()
    const evaluation = evaluate(plan, loadBuiltins())
    // Every position filled to its capacity: 64 leaf switches each, 3 CDUs per row end, 4 CRAHs per zone, a full
    // electrical room and plant yard.
    const full = plan.hall.positions.flatMap((p) => {
      const sized = (key: string, count: number) => ({
        key,
        category: key,
        modelId: null,
        count,
        required: count,
        positionIds: [p.id],
        autoSized: true,
        loadW: 0,
        capacityW: null,
        objectIds: [],
      })
      switch (p.kind) {
        case 'leaf':
          return [sized(`leaf:${p.id}`, p.capacity)]
        case 'cdu':
          return [sized(`cdu:${p.servesRows[0]}`, p.capacity)]
        case 'crah':
          return [sized(`crah:${p.id}`, p.capacity)]
        case 'plant':
          return [sized('plant', p.capacity)]
        case 'electrical':
          return [sized('ups', p.capacity - 7), sized('transformer', 7)]
        default:
          return []
      }
    })
    const { widthM: w, depthM: d } = plan.hall
    const OUTDOOR = new Set(['plant', 'bufferTank'])
    for (const ev of [evaluation, { ...evaluation, equipment: full }]) {
      const units = equipmentUnits(plan, ev)
      useTwinStore.setState({ plan, evaluation: ev })
      renderer = await ReactThreeTestRenderer.create(
        <>
          <Hall plan={plan} units={units} openRack={null} />
          <Site plan={plan} units={units} />
        </>,
      )
      const { worldBox, objects } = useSceneRegistry.getState()
      const cabinets = [...objects].filter(([, o]) => o.kind === 'networkRack').map(([id]) => ({ objectId: id, kind: 'networkRack' }))
      expect(cabinets.length).toBeGreaterThan(0)
      for (const u of [...units, ...cabinets]) {
        const box = worldBox(u.objectId)
        expect(box, u.objectId).not.toBeNull()
        const [min, max] = [box!.min, box!.max]
        if (OUTDOOR.has(u.kind)) {
          const clear = max.x <= 0 || min.x >= w || max.z <= 0 || min.z >= d
          expect(clear, `${u.objectId} stands in the yard`).toBe(true)
        } else {
          const inside = min.x >= -1e-6 && max.x <= w + 1e-6 && min.z >= -1e-6 && max.z <= d + 1e-6
          expect(inside, `${u.objectId} [${min.x.toFixed(2)}, ${min.z.toFixed(2)}]–[${max.x.toFixed(2)}, ${max.z.toFixed(2)}] inside the walls`).toBe(true)
        }
      }
      await renderer.unmount()
      renderer = null
    }
  })

  it('stacks leaf switches eight to a network rack at the row ends their position serves', async () => {
    const { evaluate } = await import('@twin/engine')
    const { loadBuiltins } = await import('@twin/catalog')
    const { equipmentUnits } = await import('../src/scene/models/Hall')
    const plan = createDefaultPlan()
    const position = plan.hall.positions.find((p) => p.kind === 'leaf')!
    const leaf = {
      key: `leaf:${position.id}`,
      category: 'leaf',
      modelId: null,
      count: 20,
      required: 20,
      positionIds: [position.id],
      autoSized: true,
      loadW: 0,
      capacityW: null,
      objectIds: [],
    }
    const units = equipmentUnits(plan, { ...evaluate(plan, loadBuiltins()), equipment: [leaf] })
    const cabinets = new Map<string, number>()
    for (const u of units) cabinets.set(`${u.x}|${u.z}`, (cabinets.get(`${u.x}|${u.z}`) ?? 0) + 1)
    expect([...cabinets.values()]).toEqual([8, 8, 4])
    const rowCenters = position.servesRows.map((id) => {
      const row = plan.hall.rows.find((r) => r.id === id)!
      return row.z + row.rackDepthM / 2
    })
    for (const key of cabinets.keys()) expect(rowCenters).toContain(Number(key.split('|')[1]))
  })

  it('the open rack stays drawn while it eases shut, then returns to the instanced hall', async () => {
    const plan = nvl72Plan()
    useTwinStore.setState({ plan, evaluation: null })
    renderer = await ReactThreeTestRenderer.create(<Hall plan={plan} units={[]} openRack="R3-04" />)
    // The instanced row keeps the open rack's instance, shrunk to nothing, so closing it swaps one matrix back.
    const bodies: InstancedMesh[] = []
    renderer.scene.instance.traverse((o) => {
      if (o instanceof InstancedMesh && o.userData.role === 'rackBody') bodies.push(o)
    })
    const body = bodies.find((m) => (m.userData.objectIds as string[]).includes('rack:R3-04'))!
    const scaleOf = () => {
      const m = new Matrix4()
      body.getMatrixAt((body.userData.objectIds as string[]).indexOf('rack:R3-04'), m)
      return new Vector3().setFromMatrixScale(m).x
    }
    expect(scaleOf()).toBe(0)
    expect(ids()).toContain('rack:R3-04:chassis')
    await renderer.update(<Hall plan={plan} units={[]} openRack={null} />)
    expect(ids()).toContain('rack:R3-04:chassis')
    await new Promise((r) => setTimeout(r, 400))
    expect(ids()).not.toContain('rack:R3-04:chassis')
    expect(ids()).toContain('rack:R3-04')
    expect(scaleOf()).toBe(1)
    expect(bodies[0]!.parent).not.toBeNull()
  })

  it('useStable keeps the reference while the content is unchanged', async () => {
    const { useStable } = await import('../src/scene/hooks')
    const seen: unknown[] = []
    function Probe({ value }: { value: { a: number[] } }) {
      seen.push(useStable(value))
      return null
    }
    renderer = await ReactThreeTestRenderer.create(<Probe value={{ a: [1, 2] }} />)
    await renderer.update(<Probe value={{ a: [1, 2] }} />)
    await renderer.update(<Probe value={{ a: [1, 3] }} />)
    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).not.toBe(seen[0])
    expect(seen[2]).toEqual({ a: [1, 3] })
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
