import { num, type Evaluation, type Plan, type SizedEquipment } from '@twin/schema'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Object3D, type Group, type InstancedMesh } from 'three'
import { selectOpenness, useRackOpenness } from '../camera/openness'
import { objectIdForEquipment, objectIdForPlacement, slotWorld } from '../geometry'
import { FINISH, LOUVER_TILE_M } from '../Lighting'
import { useRegistered } from '../hooks'
import { Busway } from './Busway'
import { Cdu, CDU_SIZE } from './Cdu'
import { Crah, CRAH_SIZE } from './Crah'
import { LeafRack } from './LeafSwitch'
import { PLANT_PITCH_M, plantCategory, plantUnitLength } from './Plant'
import { DOOR_MATERIALS, Rack, SHELL_MATERIALS, catalogEntry, panelGeometry, rackDoorGeometry, rackModel, rackShellGeometry } from './Rack'

/** Above this many placements the closed racks draw as instanced meshes, one per rack type. */
export const INSTANCE_THRESHOLD = 40

/** Parallel busway ducts on one row sit side by side as one overhead run: a 150 mm duct plus a 50 mm gap. */
const BUSWAY_PITCH_M = 0.2

export const UNIT_KINDS = ['cdu', 'crah', 'plant', 'busway', 'ups', 'transformer', 'leaf', 'bufferTank'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]

/** One drawn piece of equipment, placed in hall meters (origin north-west corner, x east, z south). */
export interface EquipmentUnit {
  objectId: string
  key: string
  kind: UnitKind
  modelId: string | null
  x: number
  z: number
  rotY: number
  /** Row a busway or CDU belongs to. */
  rowId: string | null
  /** Leaf switches: the switch's slot in its network rack, top down; every switch of one rack shares x, z and rotY. */
  slot?: number
}

type EquipmentSource = Pick<SizedEquipment, 'key' | 'modelId' | 'count' | 'positionIds' | 'objectIds'>

const isUnitKind = (k: string): k is UnitKind => (UNIT_KINDS as readonly string[]).includes(k)

/** Racks whose cooling method needs a CDU, by row. */
function liquidRows(plan: Plan): Set<string> {
  const rows = new Set<string>()
  for (const p of plan.placements) {
    const group = plan.rackGroups.find((g) => g.id === p.groupId)
    if (group && catalogEntry(plan, group.coolingMethodId, 'rackCooling')?.requiresCdu) rows.add(p.rowId)
  }
  return rows
}

/**
 * Stand-in for `Evaluation.equipment` while the engine sizes nothing: one unit per hall position (CDUs only on rows
 * that need one), one busway per occupied row, and plant units = rack nominal power / unit capacity, rounded up.
 */
function positionEquipment(plan: Plan): EquipmentSource[] {
  const liquid = liquidRows(plan)
  const out: EquipmentSource[] = []
  const one = (key: string, positionIds: string[], modelId: string | null = null) =>
    out.push({ key, modelId, count: 1, positionIds, objectIds: [] })
  for (const p of plan.hall.positions) {
    if (p.kind === 'crah') one(`crah:${p.id}`, [p.id])
    if (p.kind === 'leaf') one(`leaf:${p.id}`, [p.id])
    if (p.kind === 'cdu' && p.servesRows.some((r) => liquid.has(r))) one(`cdu:${p.servesRows[0]}`, [p.id])
    if (p.kind === 'electrical') {
      one('ups', [p.id])
      one('transformer', [p.id])
    }
    if (p.kind === 'plant') {
      const plant = catalogEntry(plan, plan.cooling.heatRejectionId, 'heatRejection')
      const unitW = plant ? num(plant.unitCapacityW) : null
      const itW = plan.placements.reduce((sum, pl) => {
        const group = plan.rackGroups.find((g) => g.id === pl.groupId)
        const rack = group ? catalogEntry(plan, group.rackTypeId, 'rack') : undefined
        return sum + (rack ? (num(rack.nominalPowerW) ?? 0) : 0)
      }, 0)
      const count = unitW ? Math.max(1, Math.ceil(itW / unitW)) : 1
      out.push({ key: 'plant', modelId: plan.cooling.heatRejectionId, count, positionIds: [p.id], objectIds: [] })
    }
  }
  for (const row of plan.hall.rows) {
    if (plan.placements.some((p) => p.rowId === row.id)) one(`busway:${row.id}`, [])
  }
  if (plan.cooling.bufferTankM3 > 0) one('bufferTank', [])
  return out
}

/** Electrical cabinets stand in lineups of at most this many, as UPS modules and transformers ship in. */
const CABINET_LINEUP = 8
/** Lineup to lineup: a cabinet up to 1.2 m deep plus a 1.2 m service aisle. */
const LINEUP_PITCH_M = 2.4
/** Along a lineup: the cabinet width (1.2 m UPS, 1.8 m transformer) plus a 0.2 m gap. */
const CABINET_PITCH_M = { ups: 1.4, transformer: 2.0 } as const
/** Service aisle between rows of yard plant (m). */
const PLANT_ROW_GAP_M = 2.5

/** A network rack (rack.network) holds eight 64-port switches. */
const SWITCHES_PER_RACK = 8
/** Network racks stand side by side, one 600 mm rack width apart. */
const NETWORK_RACK_PITCH_M = 0.6

/**
 * Network rack `r` of a leaf position: at the end of one of the rows it serves (round robin, so each row end gets
 * its racks in turn), further racks at a row end stepping away from the rows toward the nearer side wall.
 */
function leafRackAt(plan: Plan, p: Plan['hall']['positions'][number], r: number): { x: number; z: number; rowId: string | null } {
  const rows = p.servesRows.map((id) => plan.hall.rows.find((row) => row.id === id)).filter((row) => row !== undefined)
  const row = rows.length > 0 ? rows[r % rows.length]! : null
  const column = rows.length > 0 ? Math.floor(r / rows.length) : r
  const away = p.x < plan.hall.widthM / 2 ? -1 : 1
  return { x: p.x + away * column * NETWORK_RACK_PITCH_M, z: row ? row.z + row.rackDepthM / 2 : p.z, rowId: row?.id ?? null }
}

/** Yard plant stands in rows no wider than the building. */
function plantRowLength(plan: Plan, pitch: number): number {
  return Math.max(1, Math.floor(plan.hall.widthM / pitch))
}

/** Slot `j` of `count` units filled `perLine` at a time: its line, its index on that line, and that line's size. */
function yardSlot(j: number, count: number, perLine: number): { line: number; index: number; size: number } {
  const line = Math.floor(j / perLine)
  return { line, index: j % perLine, size: Math.min(perLine, count - line * perLine) }
}

/** Places every unit of sized equipment (or, before the engine sizes any, of the hall's positions). */
export function equipmentUnits(plan: Plan, evaluation: Evaluation | null): EquipmentUnit[] {
  const source: EquipmentSource[] = evaluation && evaluation.equipment.length > 0 ? evaluation.equipment : positionEquipment(plan)
  const positions = new Map(plan.hall.positions.map((p) => [p.id, p]))
  const rowRot = (rowId: string | undefined) => {
    const row = plan.hall.rows.find((r) => r.id === rowId)
    return row ? (row.hotAisle === 'south' ? 0 : Math.PI) : 0
  }
  const units: EquipmentUnit[] = []
  for (const e of source) {
    const [head = '', rest = null] = e.key.split(/:(.*)/s)
    if (!isUnitKind(head)) continue
    const count = Math.max(0, Math.round(e.count))
    const at = e.positionIds.map((id) => positions.get(id)).filter((p) => p !== undefined)
    for (let k = 0; k < count; k++) {
      const base = { objectId: e.objectIds[k] ?? objectIdForEquipment(e.key, k), key: e.key, kind: head, modelId: e.modelId }
      const p = at[k % Math.max(1, at.length)]
      const j = Math.floor(k / Math.max(1, at.length))
      const m = Math.ceil((count - (k % Math.max(1, at.length))) / Math.max(1, at.length))
      const centered = (pitch: number) => (j - (m - 1) / 2) * pitch
      if (head === 'busway') {
        const row = plan.hall.rows.find((r) => r.id === rest)
        if (row) units.push({ ...base, x: row.x, z: row.z + row.rackDepthM / 2 + centered(BUSWAY_PITCH_M), rotY: 0, rowId: row.id })
        continue
      }
      if (head === 'bufferTank') {
        const plant = plan.hall.positions.find((q) => q.kind === 'plant')
        const pitch = PLANT_PITCH_M[plantCategory(plan, null)]
        // West of the near (widest) row of the yard.
        const plantUnits = Math.min(source.find((s) => s.key === 'plant')?.count ?? 1, plantRowLength(plan, pitch))
        units.push({
          ...base,
          x: (plant?.x ?? 0) - (plantUnits * pitch) / 2 - 3 - centered(4),
          z: plant?.z ?? -6,
          rotY: 0,
          rowId: null,
        })
        continue
      }
      if (!p) continue
      const row = head === 'cdu' ? (p.servesRows[0] ?? null) : null
      switch (head) {
        case 'cdu':
          units.push({ ...base, x: p.x + CDU_SIZE.w / 2 + j * (CDU_SIZE.w + 0.1), z: p.z, rotY: rowRot(row ?? undefined), rowId: row })
          break
        case 'crah':
          units.push({ ...base, x: p.x, z: p.z + centered(CRAH_SIZE.w + 0.2), rotY: -Math.PI / 2, rowId: null })
          break
        case 'leaf': {
          const rack = leafRackAt(plan, p, Math.floor(j / SWITCHES_PER_RACK))
          units.push({ ...base, x: rack.x, z: rack.z, rotY: rowRot(rack.rowId ?? undefined), rowId: null, slot: j % SWITCHES_PER_RACK })
          break
        }
        case 'plant': {
          const pitch = PLANT_PITCH_M[plantCategory(plan, e.modelId)]
          const at = yardSlot(j, m, plantRowLength(plan, pitch))
          // Far rows shift half a pitch, so their branch pipes run south through the near row's service gaps.
          const x = p.x + (at.index - (at.size - 1) / 2) * pitch + (at.line % 2) * (pitch / 2)
          units.push({ ...base, x, z: p.z - at.line * (plantUnitLength(plan, e.modelId) + PLANT_ROW_GAP_M), rotY: 0, rowId: null })
          break
        }
        case 'ups':
        case 'transformer': {
          const count = (key: string) => Math.max(0, Math.round(source.find((s) => s.key === key)?.count ?? 0))
          const upsLineups = Math.ceil(count('ups') / CABINET_LINEUP)
          const lineups = upsLineups + Math.ceil(count('transformer') / CABINET_LINEUP)
          const at = yardSlot(j, m, CABINET_LINEUP)
          const column = (head === 'transformer' ? upsLineups : 0) + at.line
          units.push({
            ...base,
            x: p.x + (column - (lineups - 1) / 2) * LINEUP_PITCH_M,
            z: p.z + (at.index - (at.size - 1) / 2) * CABINET_PITCH_M[head],
            rotY: Math.PI / 2,
            rowId: null,
          })
          break
        }
      }
    }
  }
  return units
}

const proxyGeometry = new BoxGeometry(1, 1, 1)

/** Invisible stand-in that gives an instanced rack its id, world box and pick target. */
function RackProxy({ id, x, z, rotY, size }: { id: string; x: number; z: number; rotY: number; size: { w: number; d: number; h: number } }) {
  const ref = useRegistered<Object3D>(id, 'rack')
  return (
    <mesh
      ref={ref}
      geometry={proxyGeometry}
      visible={false}
      position={[x, size.h / 2, z]}
      rotation-y={rotY}
      scale={[size.w, size.h, size.d]}
    />
  )
}

interface InstancedRacksProps {
  plan: Plan
  rackTypeId: string
  coolingMethodId: string
  racks: { id: string; x: number; z: number; rotY: number }[]
}

/**
 * Closed racks of one type as instances. The open rack (`hidden`, its scene id; drawn in full elsewhere) keeps its instance at
 * zero scale, so opening and closing a rack updates one matrix instead of rebuilding the instanced meshes.
 */
function InstancedRacks({ plan, rackTypeId, coolingMethodId, racks, hidden }: InstancedRacksProps & { hidden: string | null }) {
  const model = useMemo(() => rackModel(plan, rackTypeId, coolingMethodId), [plan, rackTypeId, coolingMethodId])
  const shell = useRef<InstancedMesh>(null)
  const door = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const dummy = new Object3D()
    racks.forEach((r, i) => {
      dummy.position.set(r.x, 0, r.z)
      dummy.rotation.set(0, r.rotY, 0)
      dummy.scale.setScalar(r.id === hidden ? 0 : 1)
      dummy.updateMatrix()
      shell.current?.setMatrixAt(i, dummy.matrix)
      door.current?.setMatrixAt(i, dummy.matrix)
    })
    for (const mesh of [shell.current, door.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.computeBoundingBox()
    }
  }, [racks, hidden])
  const ids = racks.map((r) => r.id)
  return (
    <>
      <instancedMesh
        key={`shell${racks.length}`}
        ref={shell}
        args={[rackShellGeometry(model.size), SHELL_MATERIALS, racks.length]}
        userData={{ role: 'rackBody', objectIds: ids }}
        castShadow
        receiveShadow
      />
      <instancedMesh
        key={`door${racks.length}`}
        ref={door}
        args={[rackDoorGeometry(model.size, true), DOOR_MATERIALS, racks.length]}
        userData={{ role: 'rackDoor', objectIds: ids }}
        castShadow
        receiveShadow
      />
      {racks
        .filter((r) => r.id !== hidden)
        .map((r) => (
          <RackProxy key={r.id} id={r.id} x={r.x} z={r.z} rotY={r.rotY} size={model.size} />
        ))}
    </>
  )
}

/** UPS module or dry-type transformer in the electrical room: a plain clay cabinet. */
function Cabinet({ unit }: { unit: EquipmentUnit }) {
  const ref = useRegistered<Group>(unit.objectId, unit.kind)
  const [w, h, d] = unit.kind === 'ups' ? [1.2, 2.0, 0.9] : [1.8, 2.2, 1.2]
  return (
    <group ref={ref} position={[unit.x, 0, unit.z]} rotation-y={unit.rotY}>
      <mesh position={[0, h / 2, 0]} material={FINISH.clayLight} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh position={[0, h * 0.55, -d / 2 - 0.002]} geometry={panelGeometry(w * 0.8, h * 0.6, LOUVER_TILE_M)} material={FINISH.louver} />
    </group>
  )
}

interface HallProps {
  plan: Plan
  units: EquipmentUnit[]
  /** The rack the camera rig opens (`useRackOpenness`); drawn in full with trays and GPUs. */
  openRack: string | null
  /** Hide the overhead busways (they stay mounted, so toggling them costs no rebuild). */
  hideBusways?: boolean
}

/** One unit of hall equipment. Memoized: units keep their identity while unchanged, so view changes skip them. */
const Equipment = memo(function Equipment({ unit, plan, hidden }: { unit: EquipmentUnit; plan: Plan; hidden: boolean }) {
  switch (unit.kind) {
    case 'cdu':
      return <Cdu unit={unit} />
    case 'crah':
      return <Crah unit={unit} />
    case 'busway':
      return (
        <group visible={!hidden}>
          <Busway unit={unit} plan={plan} />
        </group>
      )
    case 'ups':
    case 'transformer':
      return <Cabinet unit={unit} />
    default:
      return null
  }
})

const MemoLeafRack = memo(LeafRack)

/** The rack stays drawn in full this long after the rig closes it, so the door and trays finish easing shut. */
const CLOSE_LINGER_MS = 300

/** `value`, or for `ms` after it turns null, the last non-null value. */
function useLingering(value: string | null, ms: number): string | null {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    if (value !== null) {
      setHeld(value)
      return
    }
    const timer = setTimeout(() => setHeld(null), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return value ?? held
}

/** The open rack, driven by the camera rig's openness slice. */
function RigRack({ placementId }: { placementId: string }) {
  const openness = useRackOpenness(selectOpenness(placementId))
  const tray = useRackOpenness((s) => (s.placementId === placementId ? s.tray : null))
  return <Rack placementId={placementId} openness={openness} tray={tray} />
}

/** Racks in their slots (instanced when there are many), the one open rack, and the equipment inside the hall. */
export function Hall({ plan, units, openRack, hideBusways = false }: HallProps) {
  const instanced = plan.placements.length > INSTANCE_THRESHOLD
  const lingering = useLingering(openRack, CLOSE_LINGER_MS)
  const open = lingering && plan.placements.some((p) => p.id === lingering) ? lingering : null

  const batches = useMemo(() => {
    if (!instanced) return []
    const byType = new Map<string, InstancedRacksProps>()
    for (const p of plan.placements) {
      const group = plan.rackGroups.find((g) => g.id === p.groupId)
      if (!group) continue
      const slotsWide = catalogEntry(plan, group.rackTypeId, 'rack')?.slotsWide ?? 1
      const at = slotWorld(plan, p.rowId, p.slot, slotsWide)
      const key = `${group.rackTypeId}|${group.coolingMethodId}`
      const batch = byType.get(key) ?? { plan, rackTypeId: group.rackTypeId, coolingMethodId: group.coolingMethodId, racks: [] }
      batch.racks.push({ id: objectIdForPlacement(p.id), x: at.x, z: at.z, rotY: at.rotY })
      byType.set(key, batch)
    }
    return [...byType.entries()]
  }, [plan, instanced])

  const leafRacks = useMemo(() => {
    const racks = new Map<string, EquipmentUnit[]>()
    for (const u of units) {
      if (u.kind !== 'leaf') continue
      const id = `${u.x.toFixed(3)}|${u.z.toFixed(3)}`
      racks.set(id, [...(racks.get(id) ?? []), u])
    }
    return racks
  }, [units])

  return (
    <group>
      {instanced
        ? batches.map(([key, batch]) => <InstancedRacks key={key} {...batch} hidden={open === null ? null : objectIdForPlacement(open)} />)
        : plan.placements
            .filter((p) => p.id !== open)
            .map((p) => <Rack key={p.id} placementId={p.id} openness={0} interior={false} />)}
      {open ? <RigRack key={`open-${open}`} placementId={open} /> : null}
      {[...leafRacks].map(([id, rackUnits]) => (
        <MemoLeafRack key={id} id={id} units={rackUnits} plan={plan} />
      ))}
      {units.map((u) => (
        <Equipment key={u.objectId} unit={u} plan={plan} hidden={u.kind === 'busway' && hideBusways} />
      ))}
    </group>
  )
}
