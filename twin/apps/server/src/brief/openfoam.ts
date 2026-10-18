import type { CatalogEntry, Check, EquipmentPosition, Evaluation, Plan, RackResult, Row, SizedEquipment } from '@twin/schema'
import rules from '../../../../packages/catalog/data/rules.json' with { type: 'json' }
import { DASH, bullets, code, fixed, hourOfYear, kelvin, range, table, watts } from './format.js'

// ---------------------------------------------------------------------------
// Constants (each with its source)
// ---------------------------------------------------------------------------

/** The app's air properties. The CFD must use the same ρ and cp, or the rack energy balance will not close. */
const RHO = rules.airDensity.value
const CP = rules.airCp.value
// Dry air at 300 K: μ = 184.6e-7 N·s/m², Pr = 0.707 (Incropera, Fundamentals of Heat and Mass Transfer, Table A.4).
const MU = 1.846e-5
const PR = 0.707
// Molar mass of dry air, g/mol.
const MOL_WEIGHT = 28.96
// Turbulent Prandtl number, the OpenFOAM default for alphatWallFunction.
const PRT = 0.85
// Standard gravity, m/s².
const G = 9.81
// Reference absolute pressure for p and p_rgh, Pa (sea-level atmosphere, 101325 rounded as in the OpenFOAM tutorials).
const P_REF = 1e5
// EIA-310 rack unit (44.45 mm) × 42U, used when a rack entry has no height (same fallback as the 3D view).
const FALLBACK_RACK_HEIGHT_M = 42 * 0.04445
// Inlet turbulence: 5 % intensity ("medium turbulence") and mixing length 0.07 × hydraulic diameter,
// the usual RANS inlet estimates for ducted or grille flow.
const TURBULENT_INTENSITY = 0.05
const MIXING_LENGTH_PER_DH = 0.07
// Mesh: 0.2 m background cells put 3 cells across a 0.6 m slot; one refinement level (0.1 m) at rack,
// CRAH and return faces gives 6. The independence run halves the background size.
const MESH_BASE_M = 0.2
const MESH_REFINED_M = MESH_BASE_M / 2
// Judgment: mesh-independence and energy-balance acceptance limits for a room-scale RANS model.
const MESH_ACCEPT_K = 0.5
const ENERGY_BALANCE_ACCEPT = 0.01
// ASHRAE TC 9.9 Thermal Guidelines for Data Processing Environments (5th ed., 2021): recommended inlet envelope.
const ASHRAE_INLET_MIN_C = 18
const ASHRAE_INLET_MAX_C = 27

// ---------------------------------------------------------------------------
// Derived model
// ---------------------------------------------------------------------------

type Face = 'north' | 'south'

interface RackGeo {
  rack: RackResult
  row: Row
  x0: number
  x1: number
  z0: number
  z1: number
  height: number
  inletFace: Face
  deltaTK: number | null
  airflowM3s: number | null
  patch: string
}

interface Aisle {
  id: string
  rows: [Row, Row]
  x0: number
  x1: number
  z0: number
  z1: number
  height: number
}

interface Zone {
  eq: SizedEquipment
  positions: EquipmentPosition[]
  racks: RackGeo[]
  flowM3s: number | null
  supplyC: number | null
  supplyMaxC: number | null
  returnC: number | null
  ratedPerUnitM3s: number | null
  modelName: string
  datasheet: string | null
}

interface Model {
  plan: Plan
  evaluation: Evaluation
  racks: RackGeo[]
  zones: Zone[]
  hotAisles: Aisle[]
  coldAisles: Aisle[]
  blanks: { row: Row; slots: string }[]
  openHotSides: Row[]
  supplyC: number | null
}

const patchName = (id: string) => id.replace(/[^A-Za-z0-9]+/g, '_')
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)

function rackEntry(plan: Plan, groupId: string): Extract<CatalogEntry, { kind: 'rack' }> | undefined {
  const typeId = plan.rackGroups.find((g) => g.id === groupId)?.rackTypeId
  const entry = typeId ? plan.catalog[typeId] : undefined
  return entry?.kind === 'rack' ? entry : undefined
}

function rackGeo(plan: Plan, rack: RackResult): RackGeo | null {
  const row = plan.hall.rows.find((r) => r.id === rack.rowId)
  if (!row) return null
  const entry = rackEntry(plan, rack.groupId)
  const slotsWide = entry?.slotsWide ?? 1
  const heightMm = entry?.heightMm.value
  const x0 = row.x + rack.slot * row.slotPitchM
  const { airInletC, airOutletC } = rack
  const deltaTK = airInletC !== null && airOutletC !== null && airOutletC > airInletC ? airOutletC - airInletC : null
  const airflowM3s = rack.airW === 0 ? 0 : deltaTK === null ? null : rack.airW / (RHO * CP * deltaTK)
  return {
    rack,
    row,
    x0,
    x1: x0 + slotsWide * row.slotPitchM,
    z0: row.z,
    z1: row.z + row.rackDepthM,
    height: typeof heightMm === 'number' ? heightMm / 1000 : FALLBACK_RACK_HEIGHT_M,
    inletFace: row.hotAisle === 'south' ? 'north' : 'south',
    deltaTK,
    airflowM3s,
    patch: `rack_${patchName(rack.placementId)}`,
  }
}

function sumOrNull(values: (number | null)[]): number | null {
  return values.some((v) => v === null) ? null : sum(values as number[])
}

function flowWeighted(racks: RackGeo[], pick: (r: RackResult) => number | null): number | null {
  const pairs = racks.map((g) => [g.airflowM3s, pick(g.rack)] as const)
  const weight = sum(pairs.map(([f, v]) => (f !== null && v !== null ? f : 0)))
  if (weight <= 0) return null
  return sum(pairs.map(([f, v]) => (f !== null && v !== null ? f * v : 0))) / weight
}

function minMax(values: number[]): [number | null, number | null] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [null, null]
}

function zones(plan: Plan, evaluation: Evaluation, racks: RackGeo[]): Zone[] {
  return evaluation.equipment
    .filter((eq) => eq.category === 'crah')
    .map((eq) => {
      const positions = eq.positionIds
        .map((id) => plan.hall.positions.find((p) => p.id === id))
        .filter((p): p is EquipmentPosition => p !== undefined)
      const served = new Set(positions.flatMap((p) => p.servesRows))
      const zoneRacks = racks.filter((g) => served.has(g.rack.rowId))
      const model = eq.modelId ? plan.catalog[eq.modelId] : undefined
      const equipment = model?.kind === 'equipment' ? model : undefined
      const [supplyC, supplyMaxC] = minMax(zoneRacks.map((g) => g.rack.airInletC).filter((v): v is number => v !== null))
      return {
        eq,
        positions,
        racks: zoneRacks,
        flowM3s: sumOrNull(zoneRacks.map((g) => g.airflowM3s)),
        supplyC,
        supplyMaxC,
        returnC: flowWeighted(zoneRacks, (r) => r.airOutletC),
        ratedPerUnitM3s: equipment?.params['airflowM3s']?.value ?? null,
        modelName: equipment?.name ?? eq.modelId ?? DASH,
        datasheet: equipment?.sources?.[0]?.url ?? null,
      }
    })
}

function aisles(rows: Row[], racks: RackGeo[], kind: 'hot' | 'cold'): Aisle[] {
  const sorted = [...rows].sort((a, b) => a.z - b.z)
  const out: Aisle[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const faces = kind === 'hot' ? a.hotAisle === 'south' && b.hotAisle === 'north' : a.hotAisle === 'north' && b.hotAisle === 'south'
    const pairRacks = racks.filter((g) => g.row === a || g.row === b)
    if (!faces || pairRacks.length === 0) continue
    out.push({
      id: `${kind === 'hot' ? 'HA' : 'CA'}${out.length + 1}`,
      rows: [a, b],
      x0: Math.min(a.x, b.x),
      x1: Math.max(a.x + a.slotCount * a.slotPitchM, b.x + b.slotCount * b.slotPitchM),
      z0: a.z + a.rackDepthM,
      z1: b.z,
      height: Math.max(...pairRacks.map((g) => g.height)),
    })
  }
  return out
}

/** Free slot ranges of a row, e.g. "slots 16–23", or "all 24 slots". */
function freeSlots(row: Row, racks: RackGeo[]): string | null {
  const taken = new Set<number>()
  for (const g of racks.filter((r) => r.row === row)) {
    const wide = Math.round((g.x1 - g.x0) / row.slotPitchM)
    for (let s = g.rack.slot; s < g.rack.slot + wide; s++) taken.add(s)
  }
  if (taken.size === 0) return `all ${row.slotCount} slots`
  const runs: string[] = []
  let start: number | null = null
  for (let s = 0; s <= row.slotCount; s++) {
    const free = s < row.slotCount && !taken.has(s)
    if (free && start === null) start = s
    if (!free && start !== null) {
      runs.push(start === s - 1 ? `slot ${start}` : `slots ${start}–${s - 1}`)
      start = null
    }
  }
  return runs.length ? runs.join(', ') : null
}

function buildModel(plan: Plan, evaluation: Evaluation): Model {
  const racks = evaluation.racks.map((r) => rackGeo(plan, r)).filter((g): g is RackGeo => g !== null)
  const hotAisles = aisles(plan.hall.rows, racks, 'hot')
  const coldAisles = aisles(plan.hall.rows, racks, 'cold')
  const contained = plan.cooling.containment === 'hotAisle' ? hotAisles : plan.cooling.containment === 'coldAisle' ? coldAisles : []
  const containedRows = [...new Set(contained.flatMap((a) => a.rows))].sort((a, b) => a.z - b.z)
  const blanks = containedRows.flatMap((row) => {
    const slots = freeSlots(row, racks)
    return slots ? [{ row, slots }] : []
  })
  const hotRows = new Set(hotAisles.flatMap((a) => a.rows))
  const openHotSides = [...new Set(racks.map((g) => g.row))].filter((row) => !hotRows.has(row))
  const [supplyC] = minMax(racks.map((g) => g.rack.airInletC).filter((v): v is number => v !== null))
  return {
    plan,
    evaluation,
    racks,
    zones: zones(plan, evaluation, racks),
    hotAisles,
    coldAisles,
    blanks,
    openHotSides,
    supplyC,
  }
}

const containmentLabel = { none: 'no containment', hotAisle: 'hot-aisle containment', coldAisle: 'cold-aisle containment' } as const

function unitPatches(zone: Zone, prefix: string): string[] {
  return Array.from({ length: zone.eq.count }, (_, i) => {
    const pos = zone.positions[i % Math.max(zone.positions.length, 1)]
    return `${prefix}_${patchName(pos?.id ?? zone.eq.key)}_${Math.floor(i / Math.max(zone.positions.length, 1)) + 1}`
  })
}

function perUnit(flow: number | null, units: number): number | null {
  return flow !== null && units > 0 ? flow / units : null
}

/** Hydraulic diameter of a w × h rectangle. */
const hydraulicDiameter = (w: number, h: number) => (2 * w * h) / (w + h)

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function purpose(m: Model): string {
  const { plan, evaluation } = m
  const airW = sum(m.racks.map((g) => g.rack.airW))
  const liquidW = sum(evaluation.racks.map((r) => r.liquidW))
  const units = sum(m.zones.map((z) => z.eq.count))
  return [
    '## Purpose',
    '',
    `This brief sets up a steady RANS model of the room air in "${plan.name}" (plan ${plan.id}, saved ${plan.updatedAt}). ` +
      `${m.racks.length} racks put ${watts(airW)} W into the air. ${units} CRAH units in ${m.zones.length} zones remove it, with ${containmentLabel[plan.cooling.containment]}.`,
    '',
    'The app gets its air-side numbers from energy balances. It assumes each rack heats its air by a fixed temperature rise and that containment separates hot and cold air perfectly. ' +
      'The simulation shows where those assumptions fail: hot air leaking over or around the containment, uneven supply between CRAH units, hot spots at row ends, and what happens to rack inlet temperatures when one CRAH unit stops.',
    '',
    `Heat that goes to liquid (${watts(liquidW)} W in this plan) leaves through the liquid loop and is not part of this model.`,
    '',
    'All numbers in the tables come from the plan and the app\'s evaluation. Coordinates follow the app: origin at the north-west floor corner, x east, z south, y up, in meters.',
  ].join('\n')
}

function geometry(m: Model): string {
  const { hall, cooling } = m.plan
  const contained = cooling.containment === 'hotAisle' ? m.hotAisles : cooling.containment === 'coldAisle' ? m.coldAisles : m.hotAisles
  const aisleKind = cooling.containment === 'coldAisle' ? 'cold' : 'hot'
  const usedRows = [...new Set(m.racks.map((g) => g.row))].sort((a, b) => a.z - b.z)
  const parts = [
    '## Geometry',
    '',
    table(
      ['Item', 'Value'],
      [
        ['Width, x (east)', `${fixed(hall.widthM, 2)} m`],
        ['Depth, z (south)', `${fixed(hall.depthM, 2)} m`],
        ['Ceiling height, y (up)', `${fixed(hall.ceilingM, 2)} m`],
        ['Floor', hall.floor.type === 'raised' ? 'raised floor (plenum not modeled, see Caveats)' : 'slab'],
        ['Containment', containmentLabel[cooling.containment]],
      ],
    ),
    '',
    'The fluid domain is the hall volume from the floor to the ceiling. Walls, floor and ceiling are adiabatic. ' +
      'Each rack is a solid box removed from the mesh. Its cold face and hot face carry the rack boundary patches described under Boundary conditions.',
    '',
    '### Rack rows',
    '',
    usedRows.length
      ? table(
          ['Row', 'x (m)', 'z (m)', 'Slots', 'Hot aisle side', 'Racks placed'],
          usedRows.map((row) => [
            row.id,
            range(row.x, row.x + row.slotCount * row.slotPitchM),
            range(row.z, row.z + row.rackDepthM),
            String(row.slotCount),
            row.hotAisle,
            String(m.racks.filter((g) => g.row === row).length),
          ]),
        )
      : 'No racks are placed. Rows without racks are left out of the model.',
    '',
    `### ${aisleKind === 'hot' ? 'Hot' : 'Cold'} aisles`,
    '',
    contained.length
      ? table(
          ['Aisle', 'Rows', 'x (m)', 'z (m)', 'Rack top (m)'],
          contained.map((a) => [a.id, `${a.rows[0].id}, ${a.rows[1].id}`, range(a.x0, a.x1), range(a.z0, a.z1), fixed(a.height, 2)]),
        )
      : `No ${aisleKind} aisle is formed by two facing rows with racks.`,
    '',
  ]
  if (cooling.containment === 'hotAisle') {
    parts.push(
      'Model the hot-aisle containment as zero-thickness wall baffles (snappyHexMesh `faceType baffle` or `createBaffles`): ' +
        'a door panel across each aisle end at x0 and x1, full height from floor to ceiling, and vertical panels above both rows from the rack top to the ceiling. ' +
        'The ceiling over each aisle is the return grille into the ceiling plenum (patch `return_<aisle>`).',
    )
  } else if (cooling.containment === 'coldAisle') {
    parts.push(
      'Model the cold-aisle containment as zero-thickness wall baffles: a door panel across each aisle end, full rack height, and a roof at rack-top height over the aisle. ' +
        `Supply air enters each contained aisle through ${hall.floor.type === 'raised' ? 'perforated floor tiles (patch `supply_<aisle>` on the aisle floor)' : 'a ducted diffuser in the aisle roof (patch `supply_<aisle>`)'}.`,
    )
  } else {
    parts.push('There is no containment. Aisles are open and hot exhaust is free to mix with the room. The table lists the hot aisles for reference only.')
  }
  if (m.blanks.length) {
    parts.push(
      '',
      'Empty slots in contained rows are blanking panels (walls flush with the rack faces), so air cannot short-circuit through them:',
      '',
      bullets(m.blanks.map((b) => `\`blank_${b.row.id}\`: row ${b.row.id}, ${b.slots}`)),
    )
  }
  return parts.join('\n')
}

function heatSources(m: Model): string {
  const totalAir = sum(m.racks.map((g) => g.rack.airW))
  const totalFlow = sumOrNull(m.racks.map((g) => g.airflowM3s))
  return [
    '## Heat sources',
    '',
    `Rack airflow is the app's air heat divided by ρ·cp·ΔT, with ρ = ${RHO} kg/m³ and cp = ${CP} J/(kg·K) (the app's rules) and ΔT = outlet minus inlet temperature from the evaluation. ` +
      'x and z give the rack footprint. The inlet face is the cold side; the hot face is opposite.',
    '',
    table(['Item', 'Value'], [
      ['Racks', String(m.racks.length)],
      ['Total heat to air', `${watts(totalAir)} W`],
      ['Total rack airflow', `${fixed(totalFlow, 3)} m³/s`],
    ]),
    '',
    m.racks.length
      ? table(
          ['Rack', 'Group', 'x (m)', 'z (m)', 'Height (m)', 'Inlet face', 'Heat to air (W)', 'Airflow (m³/s)', 'Inlet (°C)', 'Outlet (°C)', 'ΔT (K)'],
          m.racks.map((g) => [
            g.rack.placementId,
            g.rack.groupId,
            range(g.x0, g.x1),
            range(g.z0, g.z1),
            fixed(g.height, 2),
            g.inletFace,
            watts(g.rack.airW),
            fixed(g.airflowM3s, 3),
            fixed(g.rack.airInletC, 1),
            fixed(g.rack.airOutletC, 1),
            fixed(g.deltaTK, 1),
          ]),
        )
      : 'No racks are placed, so there are no heat sources.',
  ].join('\n')
}

function crahTable(m: Model): string {
  return table(
    ['CRAH zone', 'Position', 'Model', 'Units running', 'Supply air (°C)', 'Supply air (K)', 'Zone supply flow (m³/s)', 'Per unit (m³/s)', 'Rated per unit (m³/s)', 'App load (W)'],
    m.zones.map((z) => [
      z.eq.key,
      z.positions.map((p) => `${p.id} (x ${fixed(p.x, 2)}, z ${fixed(p.z, 2)})`).join('; ') || DASH,
      z.modelName,
      String(z.eq.count),
      fixed(z.supplyC, 1),
      kelvin(z.supplyC),
      fixed(z.flowM3s, 3),
      fixed(perUnit(z.flowM3s, z.eq.count), 3),
      fixed(z.ratedPerUnitM3s, 3),
      watts(z.eq.loadW),
    ]),
  )
}

function boundaryConditions(m: Model): string {
  const { cooling } = m.plan
  const sample = m.racks.find((g) => g.airflowM3s !== null && g.airflowM3s > 0)
  const sampleZone = m.zones.find((z) => z.eq.count > 0)
  const supplyPrefix = cooling.containment === 'coldAisle' ? 'return' : 'supply'
  const parts = [
    '## Boundary conditions',
    '',
    '### CRAH units',
    '',
    m.zones.length
      ? crahTable(m)
      : 'The evaluation sized no CRAH units. Run the app\'s evaluation with racks placed before using this brief.',
    '',
    'Zone supply flow is the sum of the airflow of the racks in the rows the zone serves, so supply and rack flows balance. ' +
      'Running units share it equally. Rated per unit is the catalog airflow of the model and is the ceiling for the N-1 run. ' +
      'The supply temperature is the rack inlet temperature the app assumes in that zone (with containment, rack inlet equals CRAH supply).',
    '',
  ]
  if (m.zones.some((z) => z.supplyMaxC !== null && z.supplyC !== null && z.supplyMaxC > z.supplyC)) {
    parts.push('Where racks in one zone have different inlet temperatures, the table uses the lowest; the per-rack values are in Heat sources.', '')
  }
  const datasheets = [...new Set(m.zones.map((z) => z.datasheet).filter((u): u is string => u !== null))]
  parts.push(
    'The plan does not hold CRAH cabinet dimensions. Take the discharge and return face sizes from the datasheet' +
      (datasheets.length ? ` (${datasheets.join(', ')})` : '') +
      ' and place a zone\'s units side by side along the wall, centred on the position\'s z.',
    '',
  )
  if (cooling.containment === 'coldAisle') {
    const aisleRows = m.coldAisles.map((a) => {
      const flow = sumOrNull(m.racks.filter((g) => (g.row === a.rows[0] && g.inletFace === 'south') || (g.row === a.rows[1] && g.inletFace === 'north')).map((g) => g.airflowM3s))
      return [`supply_${a.id}`, range(a.x0, a.x1), range(a.z0, a.z1), fixed(flow, 3)]
    })
    parts.push(
      'With cold-aisle containment the supply enters inside each contained aisle and each CRAH unit only takes return air. Each unit\'s return face is a pressure outlet (`return_<position>_<n>`).',
      '',
      aisleRows.length ? table(['Supply patch', 'x (m)', 'z (m)', 'Flow (m³/s)'], aisleRows) : 'No contained cold aisle has racks.',
      '',
    )
  } else {
    parts.push(
      `Each running unit gets a supply patch on its discharge face (\`supply_<position>_<n>\`). ` +
        (cooling.containment === 'hotAisle'
          ? 'Return air leaves through the ceiling over each contained hot aisle (`return_HA<n>`, pressure outlets). The CRAH return faces are walls, because the plenum ducting back to the units is outside the model.'
          : 'Each unit takes return air through its top face (`return_<position>_<n>`, pressure outlet).'),
      '',
    )
  }
  if (sampleZone) {
    const patches = unitPatches(sampleZone, supplyPrefix)
    parts.push(`Unit patches in ${sampleZone.eq.key}: ${patches.map((p) => `\`${p}\``).join(', ')}.`, '')
  }

  const supplyK = sampleZone ? kelvin(sampleZone.supplyC) : DASH
  const unitFlow = sampleZone ? fixed(perUnit(sampleZone.flowM3s, sampleZone.eq.count), 4) : DASH
  parts.push(
    '### Rack patches',
    '',
    'Each rack is a fixed-flux black box with two patches. `rack_<id>_in` on the cold face takes air out of the room at the rack airflow. ' +
      '`rack_<id>_out` on the hot face puts the same flow back. Its temperature is the flow-weighted mean temperature on the inlet patch plus the rack ΔT. ' +
      'Because the outlet follows the inlet, the rack adds exactly its heat (ρ·cp·V·ΔT) even when recirculated hot air raises its inlet temperature. ' +
      'Use the airflow and ΔT columns from Heat sources for each rack.',
    '',
  )
  if (sample) {
    const dh = hydraulicDiameter(sample.x1 - sample.x0, sample.height)
    const outletRef = m.racks.length > 1 ? 'rack_.*' : sample.patch
    parts.push(
      `Example for ${sample.rack.placementId} (airflow ${fixed(sample.airflowM3s, 4)} m³/s, ΔT ${fixed(sample.deltaTK, 1)} K, face hydraulic diameter ${fixed(dh, 3)} m, mixing length ${fixed(MIXING_LENGTH_PER_DH * dh, 3)} m):`,
      '',
      code(
        'cpp',
        [
          `// 0/U`,
          `${sample.patch}_in  { type flowRateOutletVelocity; volumetricFlowRate ${fixed(sample.airflowM3s, 4)}; value uniform (0 0 0); }`,
          `${sample.patch}_out { type flowRateInletVelocity;  volumetricFlowRate ${fixed(sample.airflowM3s, 4)}; value uniform (0 0 0); }`,
          ``,
          `// 0/T`,
          `${sample.patch}_in  { type zeroGradient; }`,
          `${sample.patch}_out`,
          `{`,
          `    type            outletMappedUniformInlet;   // OpenFOAM v2306 or newer (openfoam.com)`,
          `    outlets`,
          `    {`,
          `        ${sample.patch}_in { fraction 1; offset ${fixed(sample.deltaTK, 2)}; timeDelay 0; }`,
          `    }`,
          `    value           uniform ${kelvin(sample.rack.airOutletC)};`,
          `}`,
          ``,
          `// 0/p_rgh: fixedFluxPressure on both rack patches`,
          `// 0/k: in zeroGradient; out turbulentIntensityKineticEnergyInlet, intensity ${TURBULENT_INTENSITY}`,
          `// 0/omega: in zeroGradient; out turbulentMixingLengthFrequencyInlet, mixingLength ${fixed(MIXING_LENGTH_PER_DH * dh, 3)}`,
          `// 0/nut, 0/alphat: calculated on both`,
        ].join('\n'),
      ),
      '',
      `With ${2 * m.racks.length} rack patches, generate the entries with a script or a \`#include\` file per rack; a regex key such as \`"${outletRef}_in"\` works for the fields that do not change per rack.`,
      '',
      'OpenFOAM.org releases (v11 and later) have no `offset` entry in `outletMappedUniformInlet`. There, set `rack_<id>_out` to `fixedValue` at the outlet temperature in Heat sources for the first pass, and accept that recirculation will then not raise the outlet temperature.',
      '',
    )
  }
  parts.push(
    '### Patch summary',
    '',
    table(
      ['Patch', 'Type', 'U', 'p_rgh', 'T', 'k', 'omega'],
      [
        [
          cooling.containment === 'coldAisle' ? '`supply_CA<n>`' : '`supply_<position>_<n>`',
          'patch',
          `flowRateInletVelocity (zone flow / units, e.g. ${unitFlow} m³/s)`,
          'fixedFluxPressure',
          `fixedValue (supply, e.g. ${supplyK} K)`,
          `turbulentIntensityKineticEnergyInlet ${TURBULENT_INTENSITY}`,
          `turbulentMixingLengthFrequencyInlet (${MIXING_LENGTH_PER_DH} × face hydraulic diameter)`,
        ],
        [
          cooling.containment === 'hotAisle' ? '`return_HA<n>`' : '`return_<position>_<n>`',
          'patch',
          'pressureInletOutletVelocity',
          `prghPressure, p ${P_REF}`,
          'inletOutlet (inletValue: return estimate)',
          'inletOutlet',
          'inletOutlet',
        ],
        ['`rack_<id>_in`', 'patch', 'flowRateOutletVelocity', 'fixedFluxPressure', 'zeroGradient', 'zeroGradient', 'zeroGradient'],
        [
          '`rack_<id>_out`',
          'patch',
          'flowRateInletVelocity',
          'fixedFluxPressure',
          'outletMappedUniformInlet (offset ΔT)',
          `turbulentIntensityKineticEnergyInlet ${TURBULENT_INTENSITY}`,
          'turbulentMixingLengthFrequencyInlet',
        ],
        ['walls, rack sides and tops, containment, `blank_*`', 'wall', 'noSlip', 'fixedFluxPressure', 'zeroGradient (adiabatic)', 'kqRWallFunction', 'omegaWallFunction'],
      ],
    ),
    '',
    `On every patch \`p\` is \`calculated\` (value ${P_REF}); \`nut\` is \`nutkWallFunction\` on walls and \`calculated\` elsewhere; \`alphat\` is \`compressible::alphatWallFunction\` (Prt ${PRT}) on walls and \`calculated\` elsewhere. ` +
      `The return \`inletValue\` for T is the flow-weighted rack outlet temperature${m.zones.length ? ' per zone in Results to compare with the app' : ''}; it only matters if backflow occurs.`,
    '',
    `Supply flows are fixed and returns are pressure outlets, so p_rgh has a reference level and no \`pRefCell\` is needed.`,
  )
  return parts.join('\n')
}

function solverSetup(m: Model): string {
  const t0 = m.supplyC
  const t0K = t0 === null ? null : t0 + 273.15
  return [
    '## Solver setup',
    '',
    'Target OpenFOAM v2406 or newer from openfoam.com, solver `buoyantSimpleFoam` (steady, buoyant, with `p_rgh`). ' +
      'In OpenFOAM.org v11 and later the same physics runs as `foamRun -solver fluid` with the same thermophysical model; the turbulence file is `constant/momentumTransport` and the model key is `model` instead of `RASModel`.',
    '',
    'Fields in `0/`: `U`, `p`, `p_rgh`, `T`, `k`, `omega`, `nut`, `alphat`. Files in `constant/`: `thermophysicalProperties`, `g`, `turbulenceProperties`.',
    '',
    `Air follows the Boussinesq equation of state, ρ = ρ0·(1 − β·(T − T0)). T0 is the CRAH supply temperature (${fixed(t0, 1)} °C). β = 1/T0 for an ideal gas. ρ0 and Cp are the app's values, so the rack ΔT and flows close the energy balance exactly. ` +
      'Boussinesq is valid here because β·ΔT stays well under 0.1 for room-air temperature rises.',
    '',
    code(
      'cpp',
      [
        '// constant/thermophysicalProperties',
        'thermoType',
        '{',
        '    type            heRhoThermo;',
        '    mixture         pureMixture;',
        '    transport       const;',
        '    thermo          hConst;',
        '    equationOfState Boussinesq;',
        '    specie          specie;',
        '    energy          sensibleEnthalpy;',
        '}',
        'mixture',
        '{',
        `    specie          { molWeight ${MOL_WEIGHT}; }`,
        `    equationOfState { rho0 ${RHO}; T0 ${fixed(t0K, 2)}; beta ${t0K === null ? DASH : (1 / t0K).toExponential(4)}; }`,
        `    thermodynamics  { Cp ${CP}; Hf 0; }`,
        `    transport       { mu ${MU.toExponential()}; Pr ${PR}; }`,
        '}',
        '',
        '// constant/g',
        'dimensions      [0 1 -2 0 0 0 0];',
        `value           (0 -${G} 0);`,
        '',
        '// constant/turbulenceProperties',
        'simulationType  RAS;',
        'RAS { RASModel kOmegaSST; turbulence on; printCoeffs on; }',
      ].join('\n'),
    ),
    '',
    'Turbulence: k-omega SST (`kOmegaSST`) with wall functions. Room flow is driven by jets and buoyant plumes, and SST handles the jet spreading and separation around rack edges better than standard k-epsilon.',
    '',
    'Numerics (`system/fvSchemes`, `system/fvSolution`):',
    '',
    bullets([
      '`ddtSchemes` steadyState; `gradSchemes` Gauss linear (cellLimited Gauss linear 1 for `grad(U)` if the mesh has skewed cells).',
      '`div(phi,U)` bounded Gauss linearUpwind grad(U); `div(phi,h)`, `div(phi,k)`, `div(phi,omega)` bounded Gauss upwind for the first 500 iterations, then linearUpwind; `div(phi,K)` bounded Gauss linear; `div(((rho*nuEff)*dev2(T(grad(U)))))` Gauss linear.',
      '`laplacianSchemes` Gauss linear corrected; `snGradSchemes` corrected.',
      'SIMPLE: `momentumPredictor no`, `nNonOrthogonalCorrectors 0` (raise to 1 or 2 above 70° non-orthogonality).',
      'Relaxation as in the buoyantCavity tutorial: fields `p_rgh 0.7`, `rho 1`; equations `U 0.3`, `h 0.3`, `"(k|omega)" 0.7`.',
      'Solvers: GAMG for `p_rgh`; smoothSolver (symGaussSeidel) for `U`, `h`, `k`, `omega`.',
      '`residualControl`: `p_rgh 1e-4`, `U 1e-4`, `h 1e-6`, `"(k|omega)" 1e-4`. Do not stop on residuals alone; see the monitors below.',
    ]),
    '',
    'Monitors (`system/controlDict` functions):',
    '',
    bullets([
      '`surfaceFieldValue` on the patches `"rack_.*_in"` with `operation weightedAverage; weightField phi; fields (T);` and `writeFields false`, one entry per rack (use `regionType patch`). This gives the flow-weighted inlet temperature to compare with the app.',
      '`surfaceFieldValue` with `operation sum; fields (phi);` on the supply and return patches, to check mass balance.',
      '`fieldMinMax` on `T` and `U`, and `yPlus`.',
      'The run has converged when every rack inlet temperature changes by less than 0.1 K over 200 iterations and the residuals are below their targets.',
    ]),
  ].join('\n')
}

function meshGuidance(m: Model): string {
  const { hall } = m.plan
  const n = (len: number, h: number) => Math.ceil(len / h)
  const base = [n(hall.widthM, MESH_BASE_M), n(hall.ceilingM, MESH_BASE_M), n(hall.depthM, MESH_BASE_M)]
  const fine = [n(hall.widthM, MESH_REFINED_M), n(hall.ceilingM, MESH_REFINED_M), n(hall.depthM, MESH_REFINED_M)]
  return [
    '## Mesh guidance',
    '',
    bullets([
      `Background: \`blockMesh\` box 0 0 0 to ${fixed(hall.widthM, 2)} ${fixed(hall.ceilingM, 2)} ${fixed(hall.depthM, 2)} with ${MESH_BASE_M} m cells (${base.join(' × ')} = ${base[0]! * base[1]! * base[2]!} cells). Rack slots sit on a 0.6 m grid and rows on the plan coordinates, so most rack faces fall on cell faces.`,
      `\`snappyHexMesh\`: rack boxes, CRAH cabinets and containment panels from STL (one region per patch name). Refinement level 1 (${MESH_REFINED_M} m) on rack faces, CRAH supply and return faces, and containment edges, plus a refinement box over each aisle up to the ceiling.`,
      'Containment panels and blanking panels are baffles (`faceType baffle`), so they need no thickness.',
      'Wall treatment: wall functions, aim for y+ between 30 and 300 on rack and containment walls. No prism layers are needed for this room-scale model.',
      '`checkMesh` before running: max non-orthogonality under 65°, skewness under 4.',
      `Mesh independence: repeat the baseline with ${MESH_REFINED_M} m background cells (${fine.join(' × ')} = ${fine[0]! * fine[1]! * fine[2]!} cells). Accept the coarse mesh if every rack inlet temperature changes by less than ${MESH_ACCEPT_K} K (a judgment limit).`,
      'Run in parallel with `decomposePar` (scotch) and `mpirun -np <N> buoyantSimpleFoam -parallel`.',
    ]),
  ].join('\n')
}

function runs(m: Model): string {
  const { evaluation } = m
  const h = evaluation.headline.worstHour
  const inRange = Number.isInteger(h) && h >= 0 && h < evaluation.hourly.itW.length
  const placedIt = sum(evaluation.racks.map((r) => r.powerW))
  const itAtHour = inRange ? evaluation.hourly.itW[h]! : null
  const scale = itAtHour !== null && placedIt > 0 ? itAtHour / placedIt : null
  const rejection = evaluation.checks.find((c) => c.kind === 'cooling.heatRejection')
  const n1 = m.zones
    .map((z) => ({ z, perUnit: perUnit(z.flowM3s, z.eq.count - 1), check: evaluation.checks.find((c) => c.kind === 'cooling.crahCapacity' && c.subject.id === z.eq.key) }))
  const worst = n1
    .filter((r) => r.z.eq.count > 1 && r.perUnit !== null)
    .sort((a, b) => (b.perUnit ?? 0) - (a.perUnit ?? 0))[0]
  const parts = [
    '## Runs to make',
    '',
    '### 1. Baseline',
    '',
    'All CRAH units running, rack heat and flows exactly as in Heat sources and Boundary conditions. Run the mesh-independence check on this case.',
    '',
    '### 2. Worst hour',
    '',
    inRange
      ? `The app's worst hour is hour ${h} of the weather year (${hourOfYear(h)}), at ${fixed(evaluation.hourly.outdoorC[h], 1)} °C outdoor dry bulb and ${fixed(evaluation.hourly.wetBulbC[h], 1)} °C wet bulb. ` +
        `IT load that hour is ${watts(itAtHour)} W against ${watts(placedIt)} W placed, a factor of × ${fixed(scale, 3)}. ` +
        'Multiply every rack heat and airflow, and every CRAH supply flow, by that factor and keep ΔT and the supply temperature.'
      : 'The evaluation has no hourly data for its worst hour, so this run cannot be set up yet.',
    '',
    rejection
      ? `The app's heat rejection check is ${rejection.status} (${rejection.title}). If it is not pass, the plant cannot hold the supply temperature at this hour; ask the design agent what supply temperature the plant reaches and use that instead.`
      : 'The evaluation has no heat rejection check, so the supply temperature is assumed to hold at this hour.',
    '',
    '### 3. N-1 CRAH',
    '',
    m.zones.length
      ? table(
          ['CRAH zone', 'Units', 'Per unit after one loss (m³/s)', 'Rated per unit (m³/s)', 'App N-1 status'],
          n1.map(({ z, perUnit: pu, check }) => [
            z.eq.key,
            String(z.eq.count),
            z.eq.count > 1 ? fixed(pu, 3) : 'no unit left',
            fixed(z.ratedPerUnitM3s, 3),
            check?.worstFailure ? `${check.worstFailure.status} (${check.worstFailure.scenario})` : DASH,
          ]),
        )
      : 'No CRAH units were sized, so there is no N-1 case.',
    '',
  ]
  if (worst) {
    const patch = unitPatches(worst.z, m.plan.cooling.containment === 'coldAisle' ? 'return' : 'supply')[0]
    parts.push(
      `Run it for ${worst.z.eq.key}, the zone with the highest flow per remaining unit. Turn \`${patch}\` into a wall (U noSlip, T zeroGradient) and give the other ${worst.z.eq.count - 1} units ${fixed(worst.perUnit, 4)} m³/s each. ` +
        'If that exceeds the rated airflow, cap it at the rated value and let the room show the shortfall. If the result is marginal, repeat with the unit at the other end of the zone.',
      '',
      'This steady run shows the state after the loss. For the minutes in between, restart from the baseline with `buoyantPimpleFoam` and switch the unit off at t = 0.',
    )
  }
  return parts.join('\n')
}

function results(m: Model): string {
  const cooling = m.evaluation.checks.filter((c: Check) => c.kind === 'cooling.rackHeatLimit' || c.kind === 'cooling.crahCapacity')
  return [
    '## Results to compare with the app',
    '',
    bullets([
      `Rack inlet temperature: the flow-weighted mean T on each \`rack_<id>_in\` against the Inlet column in Heat sources. The app assumes 0 K of recirculation, so any difference is hot air reaching the cold side. Flag racks above ${ASHRAE_INLET_MAX_C} °C (ASHRAE recommended envelope ${ASHRAE_INLET_MIN_C}–${ASHRAE_INLET_MAX_C} °C).`,
      'CRAH load per zone: ρ·cp·(return flow)·(T return − T supply) against the app load below.',
      `Energy balance: total rack heat to air against the heat carried out by the returns. Investigate if they differ by more than ${ENERGY_BALANCE_ACCEPT * 100} % (a judgment limit).`,
      'Hot spots: the hottest cells in the cold aisles and at row ends, and where hot air leaks over or around containment.',
    ]),
    '',
    m.zones.length
      ? table(
          ['CRAH zone', 'App load (W)', 'Supply (°C)', 'Return, flow-weighted (°C)', 'Racks served'],
          m.zones.map((z) => [z.eq.key, watts(z.eq.loadW), fixed(z.supplyC, 1), fixed(z.returnC, 1), String(z.racks.length)]),
        )
      : 'No CRAH zones to compare.',
    '',
    cooling.length
      ? table(
          ['App check', 'Status', 'Value', 'Limit', 'Unit'],
          cooling.map((c) => [c.title, c.status, fixed(c.value, 0), fixed(c.limit, 0), c.unit]),
        )
      : 'The evaluation has no rack heat or CRAH capacity checks.',
  ].join('\n')
}

function caveats(m: Model): string {
  const items = [
    'The app\'s rack airflow comes from an assumed air temperature rise per rack. Real servers vary fan speed with load and inlet temperature; replace the flows with vendor airflow curves if you have them.',
    'Racks are black boxes. The model leaves out flow through the chassis, cable cut-outs and gaps between racks and containment, so it underestimates leakage.',
    m.plan.hall.floor.type === 'raised'
      ? 'The hall has a raised floor, but the plan holds no plenum depth or tile layout. This model supplies air straight into the room. If the real hall supplies through the floor, add the plenum region and model tiles as porous baffles (`porousBafflePressure`).'
      : 'Overhead ducting and cable trays are not in the plan and are left out; they can block supply jets.',
    'CRAH positions and flows come from the plan. Cabinet and face sizes come from the datasheet, so check them against the units actually bought.',
    'Boussinesq air with constant properties is fine for these temperature rises. It is not valid if any region exceeds roughly 30 K above the supply temperature.',
    'Steady RANS gives a time-averaged picture. Use the transient follow-up of the N-1 run for ride-through questions.',
  ]
  if (m.openHotSides.length) {
    items.push(`Rows ${m.openHotSides.map((r) => r.id).join(', ')} have no facing row on their hot side, so their exhaust is not contained in this model.`)
  }
  return ['## Caveats', '', bullets(items)].join('\n')
}

/** Deterministic OpenFOAM simulation brief, in Markdown, from a plan and its evaluation. */
export function generateBrief(plan: Plan, evaluation: Evaluation, target: 'openfoam', agentNotes?: string): string {
  const m = buildModel(plan, evaluation)
  const sections = [
    `# OpenFOAM simulation brief: ${plan.name}`,
    `Target: ${target}, \`buoyantSimpleFoam\`, k-omega SST, Boussinesq air.`,
    purpose(m),
    geometry(m),
    heatSources(m),
    boundaryConditions(m),
    solverSetup(m),
    meshGuidance(m),
    runs(m),
    results(m),
    caveats(m),
  ]
  const notes = agentNotes?.trim()
  if (notes) sections.push(`## Notes from the design agent\n\n${agentNotes}`)
  return `${sections.join('\n\n')}\n`
}
