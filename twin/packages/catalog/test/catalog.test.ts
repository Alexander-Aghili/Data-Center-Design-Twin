import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_IDS,
  CATALOG_KINDS,
  CLIMATE,
  COOLANT,
  HEAT_REJECTION,
  RACK_COOLING,
  RULE_KEYS,
  qty,
  type CatalogEntry,
  type CatalogKind,
  type GpuEntry,
  type RackEntry,
} from '@twin/schema'
import { createDefaultPlan, loadBuiltins, snapshotCatalog, validateCatalog } from '../src/index'

interface DataFile {
  path: string
  entry: { id: string; kind: CatalogKind }
}

interface IndexScript {
  buildIndex: (dataDir: string) => string
  entryFiles: (dataDir: string) => string[]
}

const dataDir = fileURLToPath(new URL('../data/', import.meta.url))
const knowledgeDir = fileURLToPath(new URL('../../../apps/server/knowledge/', import.meta.url))

async function loadIndexScript(): Promise<IndexScript> {
  const href = new URL('../scripts/build-index.mjs', import.meta.url).href
  const script: IndexScript = await import(href)
  return script
}

async function dataFiles(): Promise<DataFile[]> {
  const { entryFiles } = await loadIndexScript()
  return entryFiles(dataDir).map((path) => ({ path, entry: JSON.parse(readFileSync(`${dataDir}${path}`, 'utf8')) }))
}

/** The server passes KNOWLEDGE_SLUGS; this package may not import the server, so the test reads the same folder. */
function knowledgeSlugs(): string[] {
  return readdirSync(knowledgeDir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.md'))
    .map((p) => p.replaceAll('\\', '/').replace(/\.md$/, ''))
}

function builtin<K extends CatalogKind>(kind: K, id: string): Extract<CatalogEntry, { kind: K }> {
  const entry = loadBuiltins().entries.find((e) => e.id === id)
  if (!entry || entry.kind !== kind) throw new Error(`fixture ${id} missing`)
  return entry as Extract<CatalogEntry, { kind: K }>
}

const customGpu: GpuEntry = {
  id: 'custom.gpu-x',
  kind: 'gpu',
  name: 'GPU X',
  asOf: '2026-10-18',
  custom: true,
  summary: 'Test accelerator.',
  tdpW: qty(1000, 'W', 'user'),
  fp8Pflops: qty(5, 'PFLOPS', 'user'),
  fp4Pflops: qty(10, 'PFLOPS', 'user'),
  hbmGb: qty(288, 'GB', 'user'),
  cooling: 'either',
}

function customRack(gpuId: string): RackEntry {
  return {
    id: 'custom.rack-x',
    kind: 'rack',
    name: 'Rack X',
    asOf: '2026-10-18',
    custom: true,
    summary: 'Test rack.',
    role: 'compute',
    gpuId,
    gpuCount: 8,
    nominalPowerW: qty(12000, 'W', 'user'),
    peakPowerW: qty(14000, 'W', 'user'),
    weightKg: qty(900, 'kg', 'user'),
    widthMm: qty(600, 'mm', 'user'),
    depthMm: qty(1200, 'mm', 'user'),
    heightMm: qty(2000, 'mm', 'user'),
    slotsWide: 1,
    feet: 4,
    maxLiquidFraction: qty(0, 'fraction', 'user'),
    maxCoolantSupplyC: { value: null, unit: '°C', basis: 'user' },
    supportedCooling: ['air'],
    supportedPower: ['ac54'],
    scaleOutPorts: 8,
    portGbps: 800,
    fp8Pflops: qty(40, 'PFLOPS', 'user'),
    trays: { compute: 1, switch: 0, power: 0 },
    capexUsd: qty(400000, 'USD', 'user'),
    leadTimeWeeks: qty(12, 'week', 'user'),
  }
}

describe('built-in data files', () => {
  for (const kind of CATALOG_KINDS) {
    it(`every id in ids.ts has exactly one data file: ${kind}`, async () => {
      const files = await dataFiles()
      for (const id of BUILTIN_IDS[kind]) {
        const matches = files.filter((f) => f.entry.id === id)
        expect(matches.map((f) => f.path), id).toHaveLength(1)
        expect(matches[0]!.entry.kind, id).toBe(kind)
        expect(matches[0]!.path.split('/').at(-1), id).toBe(`${id}.json`)
      }
    })
  }

  it('every data file holds a built-in id', async () => {
    const known = new Set<string>(Object.values(BUILTIN_IDS).flat())
    const unknown = (await dataFiles()).filter((f) => !known.has(f.entry.id)).map((f) => f.path)
    expect(unknown).toEqual([])
  })

  it('data/index.json is up to date with the data folders (run node packages/catalog/scripts/build-index.mjs)', async () => {
    const { buildIndex } = await loadIndexScript()
    expect(readFileSync(`${dataDir}index.json`, 'utf8')).toBe(buildIndex(dataDir))
  })
})

describe('loadBuiltins', () => {
  it('returns every data file and every rule', async () => {
    const { entries, rules } = loadBuiltins()
    expect(entries.map((e) => e.id).sort()).toEqual((await dataFiles()).map((f) => f.entry.id).sort())
    expect(Object.keys(rules).sort()).toEqual([...RULE_KEYS].sort())
  })

  it('built-ins pass validation, including risk slugs against the knowledge base', () => {
    expect(validateCatalog(loadBuiltins().entries, { knowledgeSlugs: knowledgeSlugs() })).toEqual({ ok: true, errors: [] })
  })
})

describe('validateCatalog', () => {
  const water = () => builtin('coolant', COOLANT.WATER)
  const dlc = () => builtin('rackCooling', RACK_COOLING.DLC_1P)

  it('reports duplicate id', () => {
    const result = validateCatalog([water(), dlc(), builtin('coolant', COOLANT.PG25), water()])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['coolant.water: duplicate id (entries[0] and entries[3])'])
  })

  it('reports unknown coolantId', () => {
    const result = validateCatalog([water(), { ...dlc(), coolantId: 'coolant.unobtainium' }])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['rackCooling.dlc-1p.coolantId: unknown coolant "coolant.unobtainium"'])
  })

  it('reports a coolantId that names an entry of another kind', () => {
    const result = validateCatalog([builtin('climate', CLIMATE.DALLAS), { ...dlc(), coolantId: CLIMATE.DALLAS }])
    expect(result.errors).toEqual(['rackCooling.dlc-1p.coolantId: unknown coolant "climate.dallas"'])
  })

  it('reports unknown gpuId and accepts a known one', () => {
    expect(validateCatalog([customRack('gpu.nope')]).errors).toEqual(['custom.rack-x.gpuId: unknown gpu "gpu.nope"'])
    expect(validateCatalog([customGpu, customRack(customGpu.id)])).toEqual({ ok: true, errors: [] })
  })

  it('reports schema problems as path: problem', () => {
    const broken = { ...water(), cpJPerKgK: { value: 4184, unit: 'J/(kg·K)', basis: 'estimate' } }
    const result = validateCatalog([broken, { kind: 'gpu' }])
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('coolant.water.cpJPerKgK.note: basis "estimate" needs a note saying how it was estimated')
    expect(result.errors.some((e) => e.startsWith('entries[1].id: '))).toBe(true)
  })

  it('resolves bare and folder-qualified risk slugs and reports unknown ones', () => {
    const slugs = ['cooling/direct-to-chip-single-phase', 'cooling/coolants', 'liquid-cooling-operations']
    const entry = { ...dlc(), risks: ['direct-to-chip-single-phase', 'cooling/coolants', 'liquid-cooling-operations', 'pfas'] }
    expect(validateCatalog([builtin('coolant', COOLANT.PG25), entry], { knowledgeSlugs: slugs }).errors).toEqual([
      'rackCooling.dlc-1p.risks[3]: unknown knowledge slug "pfas"',
    ])
  })

  it('skips the risk check when no slug list is given', () => {
    const entry = { ...dlc(), risks: ['pfas'] }
    expect(validateCatalog([builtin('coolant', COOLANT.PG25), entry])).toEqual({ ok: true, errors: [] })
  })
})

describe('snapshotCatalog', () => {
  it('includes custom entries and drops unused built-ins', () => {
    const base = createDefaultPlan()
    const rack = customRack(customGpu.id)
    const plan = {
      ...base,
      rackGroups: [{ id: 'g1', name: 'Custom block', rackTypeId: rack.id, coolingMethodId: RACK_COOLING.AIR_CONTAINED }],
      catalog: { [rack.id]: rack, [RACK_COOLING.DLC_1P]: builtin('rackCooling', RACK_COOLING.DLC_1P) },
    }
    const out = snapshotCatalog(plan, [...loadBuiltins().entries, customGpu])

    expect(Object.keys(out.catalog).sort()).toEqual(
      [
        CLIMATE.DALLAS,
        COOLANT.WATER, // via rackCooling.air-contained
        customGpu.id,
        rack.id,
        HEAT_REJECTION.CHILLER_AIR,
        RACK_COOLING.AIR_CONTAINED,
      ].sort(),
    )
    expect(out.catalog[rack.id]).toEqual(rack)
    expect(plan.catalog[RACK_COOLING.DLC_1P]).toBeDefined()
  })

  it('keeps the plan copy of a used entry over the built-in and does not share objects', () => {
    const base = createDefaultPlan()
    const pinned = { ...builtin('heatRejection', HEAT_REJECTION.CHILLER_AIR), name: 'Chiller as designed' }
    const builtins = loadBuiltins().entries
    const out = snapshotCatalog({ ...base, catalog: { [pinned.id]: pinned } }, builtins)

    expect(out.catalog[pinned.id]).toEqual(pinned)
    expect(out.catalog[pinned.id]).not.toBe(pinned)
    expect(out.catalog[CLIMATE.DALLAS]).toEqual(builtins.find((e) => e.id === CLIMATE.DALLAS))
    expect(out.catalog[CLIMATE.DALLAS]).not.toBe(builtins.find((e) => e.id === CLIMATE.DALLAS))
  })

  it('copies equipment named by overrides', () => {
    const base = createDefaultPlan()
    const out = snapshotCatalog({ ...base, overrides: [{ key: 'cdu', modelId: 'cdu.2000kw' }] }, loadBuiltins().entries)
    expect(out.catalog['cdu.2000kw']?.kind).toBe('equipment')
    expect(out.catalog['cdu.1200kw']).toBeUndefined()
  })
})
