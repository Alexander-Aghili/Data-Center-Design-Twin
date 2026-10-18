// BM25 search over knowledge-base passages. A passage is one paragraph, list item,
// or table under its section heading; the Sources list is not indexed. Documents
// rank by their best passage, and that passage becomes the snippet.

export interface KnowledgeDoc {
  slug: string
  markdown: string
}

export interface KnowledgeHit {
  slug: string
  title: string
  snippet: string
  score: number
}

interface Passage {
  slug: string
  text: string
  termFreq: Map<string, number>
  length: number
}

export interface KnowledgeIndex {
  titles: Map<string, string>
  passages: Passage[]
  docFreq: Map<string, number>
  avgLength: number
}

const K1 = 1.2
const B = 0.75
const SNIPPET_CHARS = 280

const STOPWORDS = new Set(
  'a an and are as at be by can for from has in is it its of on or per so than that the their then there these this to was what when where which with'.split(
    ' ',
  ),
)

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token))
}

function splitPassages(markdown: string): { title: string; blocks: { heading: string; text: string }[] } {
  let title = ''
  let heading = ''
  const blocks: { heading: string; text: string }[] = []
  for (const block of markdown.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n')
    const body: string[] = []
    for (const line of lines) {
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (!h) body.push(line)
      else if (h[1] === '#') title = h[2] ?? ''
      else heading = h[2] ?? ''
    }
    const items = body.join('\n').split(/\n(?=\s*(?:[-*]|\d+\.) )/)
    for (const item of items) {
      const text = item.trim().replace(/^([-*]|\d+\.)\s+/, '').replace(/\s+/g, ' ')
      if (text && heading !== 'Sources') blocks.push({ heading, text })
    }
  }
  return { title, blocks }
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

export function buildIndex(docs: KnowledgeDoc[]): KnowledgeIndex {
  const titles = new Map<string, string>()
  const passages: Passage[] = []
  const docFreq = new Map<string, number>()
  for (const doc of docs) {
    const { title, blocks } = splitPassages(doc.markdown)
    titles.set(doc.slug, title)
    for (const block of blocks) {
      const tokens = tokenize(`${title} ${block.heading} ${block.text}`)
      const termFreq = countTerms(tokens)
      for (const term of termFreq.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      passages.push({ slug: doc.slug, text: block.text, termFreq, length: tokens.length })
    }
  }
  const totalLength = passages.reduce((sum, p) => sum + p.length, 0)
  return { titles, passages, docFreq, avgLength: passages.length ? totalLength / passages.length : 0 }
}

function bm25(index: KnowledgeIndex, passage: Passage, terms: string[]): number {
  const n = index.passages.length
  let score = 0
  for (const term of terms) {
    const tf = passage.termFreq.get(term)
    if (!tf) continue
    const df = index.docFreq.get(term) ?? 0
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
    score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * passage.length) / index.avgLength))
  }
  return score
}

function snippetOf(text: string): string {
  if (text.length <= SNIPPET_CHARS) return text
  const cut = text.lastIndexOf(' ', SNIPPET_CHARS)
  return `${text.slice(0, cut > 0 ? cut : SNIPPET_CHARS)}…`
}

export function searchIndex(index: KnowledgeIndex, query: string, limit: number): KnowledgeHit[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0 || limit < 1) return []
  const best = new Map<string, { score: number; text: string }>()
  for (const passage of index.passages) {
    const score = bm25(index, passage, terms)
    if (score > (best.get(passage.slug)?.score ?? 0)) best.set(passage.slug, { score, text: passage.text })
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, Math.floor(limit))
    .map(([slug, { score, text }]) => ({
      slug,
      title: index.titles.get(slug) ?? slug,
      snippet: snippetOf(text),
      score: Math.round(score * 1000) / 1000,
    }))
}
