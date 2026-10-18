import { createDefaultPlan, loadBuiltins } from '@twin/catalog'
import { emptyEvaluation, makeCatalogIndex } from '@twin/engine'
import {
  EQUIPMENT,
  RACK_COOLING,
  type Check,
  type Evaluation,
  type Plan,
  type SizedEquipment,
} from '@twin/schema'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../src/state/backend'

type Modules = {
  floor: typeof import('../src/scene/overlays/FloorLoad')
  power: typeof import('../src/scene/overlays/PowerLoad')
  cables: typeof import('../src/scene/overlays/Cables')
  ghost: typeof import('../src/scene/overlays/Ghost')
  picking: typeof import('../src/scene/Picking')
  store: typeof import('../src/state/store')
  palette: typeof import('../src/scene/palette')
}
let m: Modules

beforeAll(async () => {
  // The store module creates the app's store on import; keep it from opening a real socket.
  vi.stubGlobal('WebSocket', class { readyState = 0 })
  m = {
    floor: await import('../src/scene/overlays/FloorLoad'),
    power: await import('../src/scene/overlays/PowerLoad'),
    cables: await import('../src/scene/overlays/Cables'),
    ghost: await import('../src/scene/overlays/Ghost'),
    picking: await import('../src/scene/Picking'),
    store: await import('../src/state/store'),
    palette: await import('../src/scene/palette'),
  }
})

const builtins = loadBuiltins()

function equipment(key: string, modelId: string, objectIds: string[], positionIds: string[]): SizedEquipment {
  return {
    key,
    category: key.split(':')[0]!,
    modelId,
    count: objectIds.length,
    required: objectIds.length,
    positionIds,
    autoSized: true,
    loadW: 0,
    capacityW: null,
    objectIds,
  }
}

function check(partial: Pick<Check, 'id' | 'kind' | 'subject' | 'value' | 'limit' | 'utilization' | 'status'>): Check {
  return { layer: 'power', title: partial.id, unit: 'A', explanation: '', causes: [], ...partial }
}

describe('ghost diff', () => {
  it('ghost diff lists added/removed/changed object ids between plan and preview plan', () => {
    const plan = createDefaultPlan()
    const preview: Plan = structuredClone(plan)
    // Remove R1-00, add a rack at R6-00, switch the training block (g2: R3–R5) to direct liquid cooling.
    preview.placements = preview.placements.filter((p) => p.id !== 'R1-00')
    preview.placements.push({ id: 'R6-00', groupId: 'g1', rowId: 'R6', slot: 0 })
    preview.rackGroups = preview.rackGroups.map((g) => (g.id === 'g2' ? { ...g, coolingMethodId: RACK_COOLING.DLC_1P } : g))

    const baseEval: Evaluation = {
      ...emptyEvaluation(),
      equipment: [
        equipment('crah:W1', EQUIPMENT.CRAH_200KW, ['eq:crah:W1:0'], ['crah-W1']),
        equipment('busway:R3', EQUIPMENT.BUSWAY_1250A, ['eq:busway:R3:0'], []),
      ],
    }
    const previewEval: Evaluation = {
      ...emptyEvaluation(),
      equipment: [
        equipment('busway:R3', EQUIPMENT.BUSWAY_2500A, ['eq:busway:R3:0'], []),
        equipment('cdu:R3', EQUIPMENT.CDU_1200KW, ['eq:cdu:R3:0', 'eq:cdu:R3:1'], ['cdu-E3']),
      ],
    }

    const diff = m.ghost.ghostDiff({ plan, evaluation: baseEval }, { plan: preview, evaluation: previewEval })

    expect(diff.added).toEqual(['rack:R6-00', 'eq:cdu:R3:0', 'eq:cdu:R3:1'])
    expect(diff.removed).toEqual(['rack:R1-00', 'eq:crah:W1:0'])
    const g2Racks = plan.placements.filter((p) => p.groupId === 'g2').map((p) => `rack:${p.id}`)
    expect(diff.changed).toEqual([...g2Racks, 'eq:busway:R3:0'])
    expect(diff.moved).toEqual([])
  })

  it('pairs a moved rack by its moveRack command instead of listing it as removed and added', () => {
    const plan = createDefaultPlan()
    const preview: Plan = structuredClone(plan)
    preview.placements = preview.placements.map((p) => (p.id === 'R2-03' ? { ...p, id: 'R6-05', rowId: 'R6', slot: 5 } : p))
    const evaluation = emptyEvaluation()

    const diff = m.ghost.ghostDiff({ plan, evaluation }, { plan: preview, evaluation }, [
      { type: 'moveRack', payload: { placementId: 'R2-03', rowId: 'R6', slot: 5 } },
    ])

    expect(diff.moved).toEqual([{ from: 'rack:R2-03', to: 'rack:R6-05' }])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })
})

describe('floor load overlay', () => {
  it('floor load color scale clamps at 120%', () => {
    const { utilizationColor, LOAD_SCALE_MAX } = m.floor
    const { PALETTE } = m.palette
    expect(LOAD_SCALE_MAX).toBe(1.2)
    expect(utilizationColor(0)).toBe(PALETTE.floor)
    expect(utilizationColor(1.2)).toBe(PALETTE.heat)
    expect(utilizationColor(1.8)).toBe(PALETTE.heat)
    expect(utilizationColor(-0.5)).toBe(PALETTE.floor)
    expect(utilizationColor(1)).not.toBe(utilizationColor(1.2))
  })

  it('takes each bay load from the engine and its status from the bay check', () => {
    const plan = createDefaultPlan()
    const evaluation: Evaluation = {
      ...emptyEvaluation(),
      bays: [{ bayId: 'B3-2', loadKnM2: 8.64, ratingKnM2: 7.2, utilization: 1.2 }],
      checks: [
        {
          ...check({
            id: 'layout.floorBay:B3-2',
            kind: 'layout.floorBay',
            subject: { kind: 'bay', id: 'B3-2', objectIds: [] },
            value: 8.64,
            limit: 7.2,
            utilization: 1.2,
            status: 'fail',
          }),
          layer: 'layout',
        },
      ],
    }

    const bays = m.floor.bayOverlays(plan, evaluation)

    expect(bays).toHaveLength(plan.hall.bays.length)
    expect(bays.find((b) => b.bayId === 'B3-2')).toMatchObject({ utilization: 1.2, status: 'fail', x: 7.2, z: 3.6, w: 3.6, d: 3.6 })
    expect(bays.find((b) => b.bayId === 'B1-1')).toMatchObject({ utilization: 0, status: 'pass' })
  })
})

describe('power load overlay', () => {
  it('joins each row busway current with its busway check', () => {
    const plan = createDefaultPlan()
    const evaluation: Evaluation = {
      ...emptyEvaluation(),
      rows: [{ rowId: 'R3', airW: 0, liquidW: 0, flowLps: 0, buswayLoadA: 1100, cduKey: null }],
      equipment: [equipment('busway:R3', EQUIPMENT.BUSWAY_1250A, ['eq:busway:R3:0'], [])],
      checks: [
        check({
          id: 'power.busway:R3',
          kind: 'power.busway',
          subject: { kind: 'row', id: 'R3', objectIds: ['eq:busway:R3:0'] },
          value: 1100,
          limit: 1250,
          utilization: 0.88,
          status: 'warn',
        }),
      ],
    }

    expect(m.power.buswayLoads(plan, evaluation)).toEqual([
      { rowId: 'R3', loadA: 1100, limitA: 1250, utilization: 0.88, status: 'warn', objectIds: ['eq:busway:R3:0'] },
    ])
  })
})

describe('network cables overlay', () => {
  it('cables classify media colors: copper graphite, fiber blue', () => {
    const { cableColor } = m.cables
    const { PALETTE } = m.palette
    expect(cableColor('dac')).toBe(PALETTE.graphite)
    expect(cableColor('aec')).toBe(PALETTE.graphite)
    expect(cableColor('fiber')).toBe(PALETTE.supply)
  })

  it('routes a run along the row to its nearer end and across to the leaf, as the engine measures it', () => {
    const plan = createDefaultPlan()
    const catalog = makeCatalogIndex(builtins.entries)
    const runs = m.cables.cableRuns(plan, [{ fromId: 'R1-00', toId: 'leaf-1', media: 'aec', lengthM: 9.9 }], catalog)

    expect(runs).toHaveLength(1)
    const points = runs[0]!.points
    let horizontal = 0
    for (let i = 1; i < points.length; i++) {
      const [ax, , az] = points[i - 1]!
      const [bx, , bz] = points[i]!
      horizontal += Math.abs(bx - ax) + Math.abs(bz - az)
    }
    // R1-00 centre (8.3, 4.6) → west row end x 8 → leaf-1 (6.8, 10.0): 0.3 + 1.2 + 5.4 m.
    expect(horizontal).toBeCloseTo(6.9, 6)
    expect(points[0]).toEqual([expect.closeTo(8.3, 6), expect.any(Number), expect.closeTo(4.6, 6)])
    expect(points.at(-1)).toEqual([6.8, expect.any(Number), expect.closeTo(10, 6)])
  })
})

describe('picking', () => {
  it('maps scene object ids to selections', () => {
    const { selectionForObjectId } = m.picking
    expect(selectionForObjectId('rack:R3-07')).toEqual({ kind: 'rack', id: 'R3-07' })
    expect(selectionForObjectId('rack:R3-07:tray:2:gpu:5')).toEqual({ kind: 'rack', id: 'R3-07' })
    expect(selectionForObjectId('eq:cdu:R3:1')).toEqual({ kind: 'equipment', id: 'cdu:R3' })
    expect(selectionForObjectId('eq:plant:0')).toEqual({ kind: 'equipment', id: 'plant' })
    expect(selectionForObjectId('bay:B3-2')).toEqual({ kind: 'bay', id: 'B3-2' })
    expect(selectionForObjectId('row:R3')).toEqual({ kind: 'row', id: 'R3' })
    expect(selectionForObjectId('hall')).toBeNull()
  })

  function scene() {
    const backend: Backend = { connect() {}, send() {} }
    const store = m.store.createTwinStore({ backend })
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 10, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const rack = new Mesh(new BoxGeometry(0.6, 2, 1.2), new MeshBasicMaterial())
    rack.position.set(0, 1, 0)
    rack.updateMatrixWorld()
    const tray = new Mesh(new BoxGeometry(0.5, 0.1, 1), new MeshBasicMaterial())
    tray.position.set(0, 1, 0)
    rack.add(tray)
    rack.updateMatrixWorld(true)
    const objects = new Map([
      ['rack:R3-07', { kind: 'rack', ref: rack }],
      ['hall', { kind: 'hall', ref: new Mesh(new BoxGeometry(40, 0.01, 36), new MeshBasicMaterial()) }],
    ])
    objects.get('hall')!.ref.updateMatrixWorld()
    const picker = m.picking.createPicker({
      camera,
      objects: () => objects,
      select: (target) => store.getState().dispatchView({ type: 'select', target }),
    })
    return { store, picker }
  }

  it('clicking an object selects it, through child meshes and past unpickable objects', () => {
    const { store, picker } = scene()
    picker.click({ x: 0, y: 0 })
    expect(store.getState().selection).toEqual({ kind: 'rack', id: 'R3-07' })
    expect(picker.pick({ x: 0, y: 0 })?.objectId).toBe('rack:R3-07')
  })

  it('clicking empty space clears selection', () => {
    const { store, picker } = scene()
    store.setState({ selection: { kind: 'rack', id: 'R3-07' } })
    // Off the rack: the ray hits only the unpickable hall floor.
    picker.click({ x: 0.9, y: 0.9 })
    expect(store.getState().selection).toBeNull()
  })
})
