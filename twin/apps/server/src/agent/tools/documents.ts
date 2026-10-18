import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotCatalog } from '@twin/catalog'
import type { PlanStore } from '../../contracts.js'
import { fileSlug, timestampedName } from '../../files.js'
import { defineTool, success, type AgentTool, type BriefGenerator } from './schema.js'

/** Writes `text` to `dataDir/<folder>/<name>` and returns its size in bytes. */
function writeFile(dataDir: string, folder: string, name: string, text: string): number {
  const dir = join(dataDir, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), text, 'utf8')
  return Buffer.byteLength(text, 'utf8')
}

export function documentTools(deps: { store: PlanStore; brief: BriefGenerator; dataDir: string }): AgentTool[] {
  const { store, brief, dataDir } = deps
  return [
    defineTool(
      'generate_simulation_brief',
      'Writes a Markdown brief for setting up a real CFD simulation of the hall in OpenFOAM (buoyantSimpleFoam). Geometry, heat loads, boundary conditions and flows come from the plan; your agentNotes are added verbatim as the narrative. Use it when someone needs more accuracy than the app\'s estimates; the person gets a download link.',
      (input) => {
        const { plan, evaluation } = store.state()
        const markdown = brief(plan, evaluation, input.target, input.agentNotes)
        // Safe for `GET /api/brief/file/:name`, e.g. 2026-10-18T09-30-00-000Z-openfoam.md.
        const name = timestampedName(`${input.target}.md`, new Date())
        const bytes = writeFile(dataDir, 'briefs', name, markdown)
        const href = `/api/brief/file/${name}`
        return success({ file: name, href, bytes }, 'Wrote the OpenFOAM simulation brief', [
          { kind: 'link', label: 'OpenFOAM simulation brief', href },
        ])
      },
    ),
    defineTool(
      'export_plan',
      'Saves the plan as a self-contained JSON file (the catalog entries it uses copied in, the same document the export button downloads) and gives the person a download link. Returns the file name and size, not the plan; use get_plan to read it. Use it when someone asks to export, save or share the plan.',
      () => {
        const plan = snapshotCatalog(store.state().plan, store.builtins().entries)
        // Safe for `GET /api/plan/export/file/:name`, e.g. 2026-10-18T09-30-00-000Z-default-hall.json.
        const name = timestampedName(`${fileSlug(plan.name)}.json`, new Date())
        const bytes = writeFile(dataDir, 'exports', name, JSON.stringify(plan, null, 2))
        const href = `/api/plan/export/file/${name}`
        return success({ file: name, href, bytes }, 'Exported the plan', [{ kind: 'link', label: 'Plan JSON', href }])
      },
    ),
  ]
}
