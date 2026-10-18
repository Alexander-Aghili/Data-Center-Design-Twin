import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_SLUGS, readKnowledge, searchKnowledge } from '../src/knowledge/index.js'
import { buildIndex, searchIndex } from '../src/knowledge/search.js'

const knowledgeDir = fileURLToPath(new URL('../knowledge/', import.meta.url))

// Task 17 writes layers/, hardware/ and topics/ on a parallel branch. Until a folder
// is merged it is skipped here; once it exists, every slug in it must have a file.
const TASK_17_FOLDERS = new Set(['layers', 'hardware', 'topics'])
const folderOf = (slug: string) => slug.split('/')[0] ?? ''
const checkedSlugs = KNOWLEDGE_SLUGS.filter(
  (slug) => !TASK_17_FOLDERS.has(folderOf(slug)) || existsSync(join(knowledgeDir, folderOf(slug))),
)

describe('knowledge base files', () => {
  it('every slug in KNOWLEDGE_SLUGS has a file', () => {
    expect(checkedSlugs.filter((slug) => slug.startsWith('cooling/'))).toHaveLength(14)
    const missing = checkedSlugs.filter((slug) => !existsSync(join(knowledgeDir, `${slug}.md`)))
    expect(missing).toEqual([])
  })

  it('every markdown file in a knowledge folder is listed in KNOWLEDGE_SLUGS', () => {
    const folders = readdirSync(knowledgeDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    const onDisk = folders.flatMap((folder) =>
      readdirSync(join(knowledgeDir, folder.name))
        .filter((file) => file.endsWith('.md'))
        .map((file) => `${folder.name}/${file.slice(0, -3)}`),
    )
    expect(onDisk.filter((slug) => !KNOWLEDGE_SLUGS.includes(slug))).toEqual([])
  })

  it('every cooling file has the required sections', () => {
    const sections = [
      'What it is',
      'When to use it',
      'Textbook numbers',
      'Interactions with other layers',
      'What to watch for',
      'Typical failure modes',
      'Sources',
    ]
    for (const slug of KNOWLEDGE_SLUGS.filter((s) => s.startsWith('cooling/'))) {
      const text = readKnowledge(slug)
      expect(text.startsWith('# '), slug).toBe(true)
      for (const section of sections) expect(text, `${slug}: ${section}`).toContain(`\n## ${section}\n`)
    }
  })
})

describe('readKnowledge', () => {
  it('returns the markdown for a known slug', () => {
    expect(readKnowledge('cooling/dry-cooler')).toMatch(/^# Dry cooler\n/)
  })

  it('readKnowledge unknown slug throws', () => {
    expect(() => readKnowledge('cooling/does-not-exist')).toThrow(/not found/)
  })

  it('rejects path traversal', () => {
    expect(() => readKnowledge('../package')).toThrow(/not found/)
  })
})

describe('searchKnowledge', () => {
  it('search "rack 130 kW air" ranks air-containment and direct-to-chip-single-phase in top 3', () => {
    const top3 = searchKnowledge('rack 130 kW air', 3).map((hit) => hit.slug)
    expect(top3).toContain('cooling/air-containment')
    expect(top3).toContain('cooling/direct-to-chip-single-phase')
  })

  it('returns title, snippet and a descending score', () => {
    const hits = searchKnowledge('buffer tank ride-through chiller restart')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(5)
    const bufferTanks = hits.slice(0, 3).find((hit) => hit.slug === 'cooling/buffer-tanks')
    expect(bufferTanks?.title).toBe('Buffer tanks (thermal storage for ride-through)')
    for (const hit of hits) {
      expect(hit.title.length).toBeGreaterThan(0)
      expect(hit.snippet.length).toBeGreaterThan(0)
    }
    const scores = hits.map((hit) => hit.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('finds the Jane Street operations lessons', () => {
    const top3 = searchKnowledge('filtration 25 µm glycol leak detection', 3).map((hit) => hit.slug)
    expect(top3).toContain('cooling/liquid-cooling-operations')
  })

  it('returns nothing for an empty or stopword-only query', () => {
    expect(searchKnowledge('')).toEqual([])
    expect(searchKnowledge('the and of')).toEqual([])
  })
})

describe('searchIndex (BM25)', () => {
  const index = buildIndex([
    { slug: 'a', markdown: '# Alpha\n\n## Notes\n\nPumps move coolant. Pumps need power.\n' },
    { slug: 'b', markdown: '# Beta\n\n## Notes\n\nCoolant flows through the manifold to every rack.\n' },
    { slug: 'c', markdown: '# Gamma\n\nRacks stand in rows.\n' },
  ])

  it('ranks the document with the rarer matching term first', () => {
    expect(searchIndex(index, 'manifold coolant', 5).map((hit) => hit.slug)).toEqual(['b', 'a'])
  })

  it('matches singular and plural forms', () => {
    expect(searchIndex(index, 'rack', 5).map((hit) => hit.slug).sort()).toEqual(['b', 'c'])
  })

  it('uses the best passage as the snippet and respects the limit', () => {
    const [hit, ...rest] = searchIndex(index, 'pumps', 1)
    expect(rest).toEqual([])
    expect(hit).toMatchObject({ slug: 'a', title: 'Alpha', snippet: 'Pumps move coolant. Pumps need power.' })
  })
})
