import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildIndex, searchIndex, type KnowledgeHit, type KnowledgeIndex } from './search.js'

export type { KnowledgeHit } from './search.js'

// A slug is the file path under apps/server/knowledge/ without ".md".
// cooling/ is written by Task 15; layers/, hardware/ and topics/ by Task 17.
export const KNOWLEDGE_SLUGS: string[] = [
  'cooling/air-containment',
  'cooling/rear-door-heat-exchanger',
  'cooling/direct-to-chip-single-phase',
  'cooling/direct-to-chip-two-phase',
  'cooling/immersion-single-phase',
  'cooling/immersion-two-phase',
  'cooling/chiller',
  'cooling/dry-cooler',
  'cooling/adiabatic-dry-cooler',
  'cooling/cooling-tower',
  'cooling/coolants',
  'cooling/buffer-tanks',
  'cooling/liquid-cooling-operations',
  'cooling/water-use',
  'layers/site',
  'layers/workload',
  'layers/compute',
  'layers/layout',
  'layers/cooling',
  'layers/power',
  'layers/network',
  'hardware/nvidia-hgx-b300',
  'hardware/nvidia-gb300-nvl72',
  'hardware/nvidia-vera-rubin-nvl72',
  'hardware/amd-mi355x',
  'hardware/amd-helios',
  'topics/layout-patterns',
  'topics/demand-problems',
  'topics/power-distribution',
  'topics/network-media',
  'topics/cost-and-lead-times',
  'topics/simulation-boundary',
]

const knowledgeDir = new URL('../../knowledge/', import.meta.url)

function pathOf(slug: string): string | null {
  if (!KNOWLEDGE_SLUGS.includes(slug)) return null
  const path = fileURLToPath(new URL(`${slug}.md`, knowledgeDir))
  return existsSync(path) ? path : null
}

export function readKnowledge(slug: string): string {
  const path = pathOf(slug)
  if (!path) throw new Error(`Knowledge file not found: ${slug}`)
  return readFileSync(path, 'utf8')
}

let index: KnowledgeIndex | undefined

export function searchKnowledge(query: string, limit = 5): KnowledgeHit[] {
  index ??= buildIndex(
    KNOWLEDGE_SLUGS.flatMap((slug) => {
      const path = pathOf(slug)
      return path ? [{ slug, markdown: readFileSync(path, 'utf8') }] : []
    }),
  )
  return searchIndex(index, query, limit)
}
