import type { Plan } from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { applyCommands } from '../src'
import { WIDE_RACK, catalog, plan } from './fixtures'
import { expectRejected, run } from './helpers'

/** The default plan plus a group of double-wide racks with nothing placed. */
function withWideGroup(): Plan {
  return run(plan(), 'createRackGroup', { name: 'Wide', rackTypeId: WIDE_RACK, coolingMethodId: 'rackCooling.dlc-1p' }).plan
}

const ids = (p: Plan, rowId: string) => p.placements.filter((x) => x.rowId === rowId).map((x) => x.id)

describe('placeRacks', () => {
  it('places racks with ids "<row>-<slot>" and summarizes the slots', () => {
    const result = run(plan(), 'placeRacks', { groupId: 'g2', rowId: 'R6', slots: [3, 4, 5, 9] })
    expect(ids(result.plan, 'R6')).toEqual(['R6-03', 'R6-04', 'R6-05', 'R6-09'])
    expect(result.plan.placements.find((x) => x.id === 'R6-09')).toEqual({ id: 'R6-09', groupId: 'g2', rowId: 'R6', slot: 9 })
    expect(result.summary).toBe('Placed 4 Training block racks in R6 at slots 03–05, 09')
  })

  it('placeRacks conflict: an occupied slot rejects and the plan is unchanged', () => {
    expectRejected(plan(), 'placeRacks', { groupId: 'g2', rowId: 'R3', slots: [20, 7] }, 'Slot R3-07 is taken by R3-07')
  })

  it('rejects a slot past the row end', () => {
    expectRejected(plan(), 'placeRacks', { groupId: 'g2', rowId: 'R6', slots: [24] }, /R6 has slots 00–23/)
  })

  it('rejects two new racks on the same slot', () => {
    expectRejected(plan(), 'placeRacks', { groupId: 'g2', rowId: 'R6', slots: [2, 2] }, 'Slot R6-02 is taken by R6-02')
  })

  it('rejects unknown groups and rows with the valid choices', () => {
    expectRejected(plan(), 'placeRacks', { groupId: 'g9', rowId: 'R6', slots: [0] }, 'Unknown rack group "g9". Groups: g1 (Inference block), g2 (Training block)')
    expectRejected(plan(), 'placeRacks', { groupId: 'g1', rowId: 'R9', slots: [0] }, 'Unknown row "R9". Rows: R1, R2, R3, R4, R5, R6, R7, R8')
  })

  describe('double-wide occupancy', () => {
    it('a slotsWide 2 rack takes slot and slot+1', () => {
      const p = withWideGroup()
      const next = run(p, 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [4] }).plan
      expectRejected(next, 'placeRacks', { groupId: 'g1', rowId: 'R6', slots: [5] }, 'Slot R6-05 is taken by R6-04')
      expect(run(next, 'placeRacks', { groupId: 'g1', rowId: 'R6', slots: [6] }).plan.placements).toHaveLength(81)
    })

    it('needs slot+1 free', () => {
      const p = run(withWideGroup(), 'placeRacks', { groupId: 'g1', rowId: 'R6', slots: [5] }).plan
      expectRejected(p, 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [4] }, 'Slot R6-05 is taken by R6-05')
      expectRejected(withWideGroup(), 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [0, 1] }, 'Slot R6-01 is taken by R6-00')
    })

    it('needs slot+1 within the row', () => {
      expectRejected(withWideGroup(), 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [23] }, 'Wide is 2 slots wide, so a rack at R6-23 needs slots 23–24, but R6 has slots 00–23')
      expect(run(withWideGroup(), 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [22] }).plan.placements).toHaveLength(81)
    })
  })
})

describe('fillRow', () => {
  it('fills free slots from a start slot, skipping occupied ones', () => {
    const p = run(plan(), 'placeRacks', { groupId: 'g1', rowId: 'R6', slots: [2] }).plan
    const result = run(p, 'fillRow', { groupId: 'g2', rowId: 'R6', from: 0, count: 4 })
    expect(ids(result.plan, 'R6')).toEqual(['R6-02', 'R6-00', 'R6-01', 'R6-03', 'R6-04'])
    expect(result.summary).toBe('Filled R6 with 4 Training block racks at slots 00–01, 03–04')
  })

  it('fillRow stops at row end and rejects overflow', () => {
    const ok = run(plan(), 'fillRow', { groupId: 'g2', rowId: 'R3', from: 16, count: 8 })
    expect(ids(ok.plan, 'R3').slice(-8)).toEqual(['R3-16', 'R3-17', 'R3-18', 'R3-19', 'R3-20', 'R3-21', 'R3-22', 'R3-23'])
    expectRejected(plan(), 'fillRow', { groupId: 'g2', rowId: 'R3', from: 16, count: 9 }, 'R3 has room for 8 Training block racks from slot 16 to the row end; 9 were asked for. Nothing was placed.')
  })

  it('counts double-wide racks by their width', () => {
    const p = withWideGroup()
    const result = run(p, 'fillRow', { groupId: 'g3', rowId: 'R6', from: 18, count: 3 })
    expect(ids(result.plan, 'R6')).toEqual(['R6-18', 'R6-20', 'R6-22'])
    expectRejected(withWideGroup(), 'fillRow', { groupId: 'g3', rowId: 'R6', from: 19, count: 3 }, /room for 2 Wide racks from slot 19/)
  })

  it('rejects a start slot past the row end', () => {
    expectRejected(plan(), 'fillRow', { groupId: 'g2', rowId: 'R6', from: 30, count: 1 }, /R6 has slots 00–23/)
  })
})

describe('moveRack', () => {
  it('moveRack keeps placementId stable as "<row>-<slot>" and retargets notes', () => {
    const p = run(plan(), 'addNote', { target: 'rack:R3-07', importance: 'fyi', authorRole: 'layout', text: 'Keep near the leaf.' }).plan
    const result = run(p, 'moveRack', { placementId: 'R3-07', rowId: 'R6', slot: 11 })
    expect(result.plan.placements.find((x) => x.id === 'R3-07')).toBeUndefined()
    expect(result.plan.placements.find((x) => x.id === 'R6-11')).toEqual({ id: 'R6-11', groupId: 'g2', rowId: 'R6', slot: 11 })
    expect(result.plan.notes.at(-1)?.target).toBe('rack:R6-11')
    expect(result.summary).toBe('Moved rack R3-07 to R6-11')
  })

  it('can shift a rack onto slots it already covers', () => {
    const p = run(withWideGroup(), 'placeRacks', { groupId: 'g3', rowId: 'R6', slots: [4] }).plan
    const next = run(p, 'moveRack', { placementId: 'R6-04', rowId: 'R6', slot: 5 }).plan
    expect(ids(next, 'R6')).toEqual(['R6-05'])
  })

  it('rejects an occupied target, an unknown rack and the row end without changes', () => {
    expectRejected(plan(), 'moveRack', { placementId: 'R3-07', rowId: 'R4', slot: 2 }, 'Slot R4-02 is taken by R4-02')
    expectRejected(plan(), 'moveRack', { placementId: 'R7-01', rowId: 'R4', slot: 20 }, /^Unknown rack "R7-01"/)
    expectRejected(plan(), 'moveRack', { placementId: 'R3-07', rowId: 'R6', slot: 24 }, /R6 has slots 00–23/)
  })
})

describe('removeRacks', () => {
  it('removes racks and the notes on them', () => {
    const p = run(plan(), 'addNote', { target: 'rack:R3-07', importance: 'fyi', authorRole: 'layout', text: 'Spare.' }).plan
    const result = run(p, 'removeRacks', { placementIds: ['R3-07', 'R3-08'] })
    expect(result.plan.placements).toHaveLength(78)
    expect(result.plan.notes.some((n) => n.target === 'rack:R3-07')).toBe(false)
    expect(result.summary).toBe('Removed 2 racks (R3-07, R3-08) and 1 note on them')
  })

  it('rejects unknown ids, naming all of them, and removes nothing', () => {
    expectRejected(plan(), 'removeRacks', { placementIds: ['R3-07', 'R7-01', 'R8-02'] }, 'Unknown racks: R7-01, R8-02. Nothing was removed.')
  })
})

describe('containment and zones', () => {
  it('sets containment', () => {
    const result = run(plan(), 'setContainment', { containment: 'coldAisle' })
    expect(result.plan.cooling.containment).toBe('coldAisle')
    expect(result.summary).toBe('Containment set to cold aisle')
  })

  it('assignZone moves rows from other positions of the same kind', () => {
    const result = run(plan(), 'assignZone', { positionId: 'cdu-E3', rowIds: ['R3', 'R4'] })
    const positions = result.plan.hall.positions
    expect(positions.find((x) => x.id === 'cdu-E3')?.servesRows).toEqual(['R3', 'R4'])
    expect(positions.find((x) => x.id === 'cdu-E4')?.servesRows).toEqual([])
    expect(positions.find((x) => x.id === 'crah-W2')?.servesRows).toEqual(['R3', 'R4'])
    expect(result.summary).toBe('cdu-E3 now serves R3, R4 (taken from cdu-E4)')
  })

  it('assignZone rejects unknown positions and rows', () => {
    expectRejected(plan(), 'assignZone', { positionId: 'cdu-X', rowIds: ['R3'] }, /^Unknown equipment position "cdu-X"/)
    expectRejected(plan(), 'assignZone', { positionId: 'cdu-E3', rowIds: ['R3', 'R12'] }, /^Unknown row "R12"/)
  })
})

describe('all-or-nothing batches', () => {
  it('a failing placement inside applyCommands leaves the plan untouched', () => {
    const p = plan()
    const before = structuredClone(p)
    expect(() =>
      applyCommands(
        p,
        [
          { type: 'removeRacks', payload: { placementIds: ['R5-15'] } },
          { type: 'placeRacks', payload: { groupId: 'g2', rowId: 'R5', slots: [15, 14] } },
        ],
        catalog,
      ),
    ).toThrow('Slot R5-14 is taken by R5-14')
    expect(p).toEqual(before)
  })
})
