/** "Default hall" → "default-hall", for download file names. */
export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'
}

/** A sortable, URL-safe file name: 2026-10-18T09-30-00-000Z-<suffix>. */
export const timestampedName = (suffix: string, now: Date) => `${now.toISOString().replace(/[:.]/g, '-')}-${suffix}`

/** Names of files the agent writes into `dataDir/briefs/` and `dataDir/exports/`. No slashes, so no path traversal. */
export const BRIEF_FILE_NAME = /^[\w.-]+\.md$/
export const EXPORT_FILE_NAME = /^[\w.-]+\.json$/
