// Bundles the built-in catalog into data/index.json: { rules, entries }, one entry per line.
//
// loadBuiltins() imports that one file statically, so the same code works in Node (server,
// tests) and in the browser (Vite). A test fails when the index is out of date with the
// data folders.
//
// Run from twin/: node packages/catalog/scripts/build-index.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_FILES = new Set(['index.json', 'rules.json']);

/** Entry files under dataDir, as sorted POSIX paths relative to it. */
export function entryFiles(dataDir) {
  return readdirSync(dataDir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.json') && !ROOT_FILES.has(path))
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The index file's exact text for dataDir (a path ending in a separator). */
export function buildIndex(dataDir) {
  const rules = JSON.stringify(readJson(`${dataDir}rules.json`));
  const entries = entryFiles(dataDir).map((path) => JSON.stringify(readJson(`${dataDir}${path}`)));
  return `{"rules":${rules},\n"entries":[\n${entries.join(',\n')}\n]}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
  writeFileSync(`${dataDir}index.json`, buildIndex(dataDir));
  console.log(`Wrote ${entryFiles(dataDir).length} entries to ${dataDir}index.json`);
}
