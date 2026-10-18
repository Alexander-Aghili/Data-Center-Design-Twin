import { createDefaultPlan, loadBuiltins, snapshotCatalog } from '@twin/catalog'
import { evaluate } from '@twin/engine'
import {
  RACK,
  type Check,
  type Evaluation,
  type Plan,
  type RackEntry,
  type RackResult,
  type SizedEquipment,
} from '@twin/schema'
import { describe, expect, it } from 'vitest'
import { generateBrief } from '../src/brief/openfoam.js'

// ---------------------------------------------------------------------------
// Hand-made fixture for the default plan (the engine lands in parallel).
// ---------------------------------------------------------------------------

const builtins = loadBuiltins()
const RHO = builtins.rules.airDensity.value!
const CP = builtins.rules.airCp.value!
const SUPPLY_C = 24
const DELTA_T = 15
const WORST_HOUR = 4935
const GRID_HOUR = 5100
const CRAH_CAPACITY_W = 200_000

const rackEntry: RackEntry = {
  id: RACK.HGX_B300_AIR,
  kind: 'rack',
  name: 'HGX B300 air-cooled rack (fixture)',
  asOf: '2026-10-18',
  summary: 'Test fixture.',
  role: 'compute',
  gpuCount: 16,
  nominalPowerW: { value: 28000, unit: 'W', basis: 'user' },
  peakPowerW: { value: 30000, unit: 'W', basis: 'user' },
  weightKg: { value: 1100, unit: 'kg', basis: 'user' },
  widthMm: { value: 600, unit: 'mm', basis: 'user' },
  depthMm: { value: 1200, unit: 'mm', basis: 'user' },
  heightMm: { value: 2286, unit: 'mm', basis: 'user' },
  slotsWide: 1,
  feet: 4,
  maxLiquidFraction: { value: 0, unit: 'fraction', basis: 'user' },
  maxCoolantSupplyC: { value: null, unit: '°C', basis: 'user' },
  supportedCooling: ['air'],
  supportedPower: ['ac54'],
  scaleOutPorts: 16,
  portGbps: 800,
  fp8Pflops: { value: 72, unit: 'PFLOPS', basis: 'user' },
  trays: { compute: 2, switch: 0, power: 2 },
  capexUsd: { value: 4_000_000, unit: 'USD', basis: 'user' },
  leadTimeWeeks: { value: 20, unit: 'week', basis: 'user' },
}

function fixturePlan(): Plan {
  const plan = createDefaultPlan()
  const crah = builtins.entries.find((e) => e.id === 'crah.200kw')!
  plan.catalog = { [rackEntry.id]: rackEntry, [crah.id]: crah }
  return plan
}

function rackResults(plan: Plan): RackResult[] {
  return plan.placements.map((p) => {
    const rowIndex = Number(p.rowId.slice(1))
    // Distinct per rack so a mixed-up row would be caught.
    const airW = 26000 + 1000 * rowIndex + 10 * p.slot
    return {
      placementId: p.id,
      groupId: p.groupId,
      rowId: p.rowId,
      slot: p.slot,
      objectId: `rack:${p.id}`,
      powerW: airW,
      heatW: airW,
      liquidW: 0,
      facilityWaterW: 0,
      airW,
      flowLps: null,
      supplyC: null,
      returnC: null,
      airInletC: SUPPLY_C,
      airOutletC: SUPPLY_C + DELTA_T,
      weightKg: 1100,
      bayId: 'B3-2',
      flowShare: null,
      coolingOk: true,
    }
  })
}

function crahEquipment(plan: Plan, racks: RackResult[]): SizedEquipment[] {
  return plan.hall.positions
    .filter((pos) => pos.kind === 'crah')
    .map((pos, k) => {
      const loadW = racks.filter((r) => pos.servesRows.includes(r.rowId)).reduce((s, r) => s + r.airW, 0)
      const required = Math.ceil(loadW / CRAH_CAPACITY_W)
      const count = required + 1
      return {
        key: `crah:Z${k + 1}`,
        category: 'crah',
        modelId: 'crah.200kw',
        count,
        required,
        positionIds: [pos.id],
        autoSized: true,
        loadW,
        capacityW: count * CRAH_CAPACITY_W,
        objectIds: Array.from({ length: count }, (_, i) => `eq:crah:Z${k + 1}:${i}`),
      }
    })
}

function crahCheck(eq: SizedEquipment): Check {
  const utilization = eq.loadW / (eq.required * CRAH_CAPACITY_W || 1)
  return {
    id: `cooling.crahCapacity:${eq.key}`,
    kind: 'cooling.crahCapacity',
    layer: 'cooling',
    subject: { kind: 'equipment', id: eq.key, objectIds: eq.objectIds },
    title: `CRAH capacity ${eq.key}`,
    value: eq.loadW,
    limit: eq.count * CRAH_CAPACITY_W,
    unit: 'W',
    utilization,
    status: 'pass',
    worstFailure: { scenario: `one CRAH lost in ${eq.key}`, value: eq.loadW, utilization, status: 'pass' },
    explanation: 'Fixture.',
    causes: [],
  }
}

function fixtureEvaluation(plan: Plan): Evaluation {
  const racks = rackResults(plan)
  const equipment = crahEquipment(plan, racks)
  const itTotal = racks.reduce((s, r) => s + r.powerW, 0)
  const hours = 8760
  const itW = Array.from({ length: hours }, (_, h) => (h === WORST_HOUR ? itTotal * 1.1 : itTotal))
  return {
    headline: {
      usablePflops: 5000,
      placedPflops: 5760,
      gpuCount: 1280,
      hoursOverCap: 0,
      worstHour: GRID_HOUR,
      buildable: true,
      pueAnnual: 1.32,
      pueWorst: 1.51,
      waterM3PerDayPeak: 0,
    },
    metrics: [],
    checks: equipment.map(crahCheck),
    racks,
    equipment,
    rows: plan.hall.rows.map((row) => ({
      rowId: row.id,
      airW: racks.filter((r) => r.rowId === row.id).reduce((s, r) => s + r.airW, 0),
      liquidW: 0,
      flowLps: 0,
      buswayLoadA: 0,
      cduKey: null,
    })),
    bays: [],
    network: { links: [], opticsW: 0, cableM: 0, baseLatencyNs: 0, oversubscription: 1 },
    cost: { capexUsd: 0, byCategory: {}, buildWeeks: 0, criticalPath: [], delayCostUsd: 0 },
    hourly: {
      outdoorC: Array.from({ length: hours }, (_, h) => (h === WORST_HOUR ? 41.7 : 20)),
      wetBulbC: Array.from({ length: hours }, (_, h) => (h === WORST_HOUR ? 24.3 : 15)),
      itW,
      coolingW: Array.from({ length: hours }, (_, h) => (h === WORST_HOUR ? 900_000 : 400_000)),
      facilityW: Array.from({ length: hours }, () => 0),
      pue: Array.from({ length: hours }, () => null),
      waterM3: Array.from({ length: hours }, () => 0),
      trimW: Array.from({ length: hours }, () => 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

function section(md: string, heading: string): string {
  const start = md.indexOf(`\n## ${heading}\n`)
  expect(start, `section "${heading}"`).toBeGreaterThanOrEqual(0)
  const next = md.indexOf('\n## ', start + 1)
  return md.slice(start, next === -1 ? undefined : next)
}

/** Rows of the first Markdown table after `marker` inside `text`, as cell arrays keyed by header. */
function tableAfter(text: string, marker: string): Record<string, string>[] {
  const from = text.indexOf(marker)
  expect(from, `table marker "${marker}"`).toBeGreaterThanOrEqual(0)
  const lines = text.slice(from).split('\n')
  const first = lines.findIndex((l) => l.startsWith('|'))
  const block: string[] = []
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break
    block.push(line)
  }
  const cells = (l: string) => l.slice(1, -1).split('|').map((c) => c.trim())
  const headers = cells(block[0]!)
  return block.slice(2).map((l) => Object.fromEntries(cells(l).map((c, i) => [headers[i]!, c])))
}

const airflow = (airW: number, dT: number) => airW / (RHO * CP * dT)

// ---------------------------------------------------------------------------

describe('generateBrief (OpenFOAM)', () => {
  const plan = fixturePlan()
  const evaluation = fixtureEvaluation(plan)
  const md = generateBrief(plan, evaluation, 'openfoam')

  it('brief lists every rack with position, heat to air (W), airflow (m³/s)', () => {
    const rows = tableAfter(section(md, 'Heat sources'), '| Rack | Group')
    expect(rows).toHaveLength(evaluation.racks.length)
    for (const rack of evaluation.racks) {
      const row = rows.find((r) => r['Rack'] === rack.placementId)
      expect(row, rack.placementId).toBeDefined()
      const hallRow = plan.hall.rows.find((r) => r.id === rack.rowId)!
      const x0 = hallRow.x + rack.slot * 0.6
      expect(row!['x (m)']).toBe(`${x0.toFixed(2)}–${(x0 + 0.6).toFixed(2)}`)
      expect(row!['z (m)']).toBe(`${hallRow.z.toFixed(2)}–${(hallRow.z + 1.2).toFixed(2)}`)
      expect(row!['Heat to air (W)']).toBe(String(rack.airW))
      expect(row!['Airflow (m³/s)']).toBe(airflow(rack.airW, DELTA_T).toFixed(3))
      expect(row!['Inlet face']).toBe(hallRow.hotAisle === 'south' ? 'north' : 'south')
    }
  })

  it('includes hall geometry, CRAH positions with supply temp and flow, containment boundaries', () => {
    const geometry = section(md, 'Geometry')
    expect(geometry).toContain('| Width, x (east) | 40.00 m |')
    expect(geometry).toContain('| Depth, z (south) | 36.00 m |')
    expect(geometry).toContain('| Ceiling height, y (up) | 4.50 m |')

    const crahRows = tableAfter(section(md, 'Boundary conditions'), '| CRAH zone')
    expect(crahRows).toHaveLength(4)
    for (const eq of evaluation.equipment) {
      const pos = plan.hall.positions.find((p) => p.id === eq.positionIds[0])!
      const row = crahRows.find((r) => r['CRAH zone'] === eq.key)!
      expect(row['Position']).toBe(`${pos.id} (x ${pos.x.toFixed(2)}, z ${pos.z.toFixed(2)})`)
      expect(row['Supply air (°C)']).toBe(eq.loadW > 0 ? SUPPLY_C.toFixed(1) : '—')
      const zoneFlow = evaluation.racks
        .filter((r) => pos.servesRows.includes(r.rowId))
        .reduce((s, r) => s + airflow(r.airW, DELTA_T), 0)
      expect(row['Zone supply flow (m³/s)']).toBe(zoneFlow.toFixed(3))
      expect(row['Units running']).toBe(String(eq.count))
    }

    // Hot aisles between R1/R2, R3/R4 and R5/R6 (R6 is empty and blanked). R7/R8 hold no racks.
    const aisles = tableAfter(section(md, 'Geometry'), '| Aisle')
    expect(aisles.map((a) => a['Aisle'])).toEqual(['HA1', 'HA2', 'HA3'])
    expect(aisles[0]).toMatchObject({ Rows: 'R1, R2', 'x (m)': '8.00–22.40', 'z (m)': '5.20–7.60' })
    expect(aisles[2]!['Rows']).toBe('R5, R6')
    expect(geometry).toContain('hot-aisle containment')
    expect(geometry).toContain('blank_R6')
  })

  it('numbers match evaluation exactly', () => {
    const totalAir = evaluation.racks.reduce((s, r) => s + r.airW, 0)
    expect(section(md, 'Heat sources')).toContain(`| Total heat to air | ${totalAir} W |`)
    const crahRows = tableAfter(section(md, 'Boundary conditions'), '| CRAH zone')
    for (const eq of evaluation.equipment) {
      const row = crahRows.find((r) => r['CRAH zone'] === eq.key)!
      expect(row['App load (W)']).toBe(String(eq.loadW))
    }
    const solver = section(md, 'Solver setup')
    expect(solver).toContain(`rho0 ${RHO.toFixed(3)};`)
    expect(solver).toContain(`Cp ${CP.toFixed(0)};`)
  })

  it('worst-hour run uses the cooling worst hour and names the grid headline hour', () => {
    const runs = section(md, 'Runs to make')
    expect(runs).toContain(`hour ${WORST_HOUR} of the weather year`)
    expect(runs).toContain('highest cooling power')
    expect(runs).toContain(`headline worst hour (hour ${GRID_HOUR})`)
    expect(runs).toContain('41.7 °C')
    // IT at that hour over the placed IT load scales the rack heat.
    expect(runs).toContain('× 1.100')
  })

  it('counts each rack in exactly one CRAH zone', () => {
    const overlapping = fixturePlan()
    const w2 = overlapping.hall.positions.find((p) => p.id === 'crah-W2')!
    w2.servesRows = ['R2', ...w2.servesRows]
    const out = generateBrief(overlapping, evaluation, 'openfoam')
    const zones = tableAfter(section(out, 'Results to compare with the app'), '| CRAH zone')
    expect(zones.reduce((n, z) => n + Number(z['Racks served']), 0)).toBe(evaluation.racks.length)
    const crah = tableAfter(section(out, 'Boundary conditions'), '| CRAH zone')
    const zoneFlow = crah.reduce((f, z) => f + Number(z['Zone supply flow (m³/s)']), 0)
    const total = evaluation.racks.reduce((f, r) => f + airflow(r.airW, DELTA_T), 0)
    expect(zoneFlow).toBeCloseTo(total, 2)
  })

  it('prints check values at their own precision', () => {
    const ratio: Check = { ...evaluation.checks[0]!, kind: 'cooling.rackHeatLimit', title: 'Ratio check', value: 0.9, limit: 1, unit: 'fraction' }
    const out = generateBrief(plan, { ...evaluation, checks: [ratio] }, 'openfoam')
    expect(section(out, 'Results to compare with the app')).toContain('| Ratio check | pass | 0.9 | 1 | fraction |')
  })

  it('falls back to the app room-air ΔT and an assumed supply temperature when racks carry no air temperatures', () => {
    const bare: Evaluation = {
      ...evaluation,
      racks: evaluation.racks.map((r) => ({ ...r, airInletC: null, airOutletC: null })),
      metrics: [{ id: 'cooling.airDeltaTK', layer: 'cooling', label: 'Room air ΔT', value: DELTA_T, unit: 'K', basis: 'calculated', inputs: [] }],
    }
    const out = generateBrief(plan, bare, 'openfoam')
    const rows = tableAfter(section(out, 'Heat sources'), '| Rack | Group')
    const first = evaluation.racks[0]!
    expect(rows[0]).toMatchObject({ 'Airflow (m³/s)': airflow(first.airW, DELTA_T).toFixed(3), 'Inlet (°C)': '18.0', 'Outlet (°C)': '33.0' })
    expect(section(out, 'Boundary conditions')).toContain('The app does not compute a supply air temperature. This brief assumes 18.0 °C')
    expect(section(out, 'Caveats')).toContain("this brief's assumption")
  })

  it('works on the real engine output for the default plan', () => {
    const real = snapshotCatalog(createDefaultPlan(), builtins.entries)
    const out = generateBrief(real, evaluate(real, builtins), 'openfoam')
    expect(out).not.toMatch(/NaN|Infinity|undefined/)
    const rows = tableAfter(section(out, 'Heat sources'), '| Rack | Group')
    expect(rows).toHaveLength(real.placements.length)
    for (const row of rows) expect(row['Airflow (m³/s)']).toMatch(/^\d+\.\d{3}$/)
    // Auto-sized CRAH models resolve from the built-in catalog when the plan snapshot lacks them.
    for (const zone of tableAfter(section(out, 'Boundary conditions'), '| CRAH zone')) expect(zone['Rated per unit (m³/s)']).not.toBe('—')
  })

  it('sections in order', () => {
    const order = [
      'Purpose',
      'Geometry',
      'Heat sources',
      'Boundary conditions',
      'Solver setup',
      'Mesh guidance',
      'Runs to make',
      'Results to compare with the app',
      'Caveats',
    ]
    const found = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(found).toEqual(order)
    const solver = section(md, 'Solver setup')
    for (const word of ['buoyantSimpleFoam', 'kOmegaSST', 'Boussinesq']) expect(solver).toContain(word)
    const runs = section(md, 'Runs to make')
    for (const word of ['Baseline', 'Worst hour', 'N-1 CRAH']) expect(runs).toContain(word)
  })

  it('rack patches use fixed-flux boundary conditions with the rack heat as a temperature offset', () => {
    const bc = section(md, 'Boundary conditions')
    for (const word of ['flowRateOutletVelocity', 'flowRateInletVelocity', 'outletMappedUniformInlet', 'fixedFluxPressure', 'prghPressure']) {
      expect(bc).toContain(word)
    }
    expect(bc).toContain('rack_R1_00_in')
  })

  it('puts agent notes verbatim under their own section, and omits it without notes', () => {
    const notes = 'Start with the R3–R5 block.\n\nWatch the end-of-row recirculation at slot 15.'
    const withNotes = generateBrief(plan, evaluation, 'openfoam', notes)
    expect(withNotes).toContain(`## Notes from the design agent\n\n${notes}\n`)
    expect(md).not.toContain('Notes from the design agent')
    expect(generateBrief(plan, evaluation, 'openfoam', '   ')).not.toContain('Notes from the design agent')
  })

  it('is deterministic', () => {
    expect(generateBrief(plan, evaluation, 'openfoam')).toBe(md)
  })

  it('empty hall gives a brief without NaN, Infinity or undefined', () => {
    const empty = { ...plan, placements: [] }
    const ev = fixtureEvaluation(empty)
    const out = generateBrief(empty, { ...ev, racks: [], equipment: [], checks: [] }, 'openfoam')
    expect(out).not.toMatch(/NaN|Infinity|undefined|null/)
    expect(out).toContain('## Caveats')
  })
})
