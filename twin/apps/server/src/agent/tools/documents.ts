import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlanStore } from '../../contracts.js'
import { defineTool, success, type AgentTool, type BriefGenerator } from './schema.js'

/** File name safe for `GET /api/brief/file/:name` (`^[\w.-]+\.md$`), e.g. 2026-10-18T09-30-00-000Z-openfoam.md. */
const briefFileName = (target: string, now: Date) => `${now.toISOString().replace(/[:.]/g, '-')}-${target}.md`

export function documentTools(deps: { store: PlanStore; brief: BriefGenerator; dataDir: string }): AgentTool[] {
  const { store, brief, dataDir } = deps
  return [
    defineTool(
      'generate_simulation_brief',
      'Writes a Markdown brief for setting up a real CFD simulation of the hall in OpenFOAM (buoyantSimpleFoam). Geometry, heat loads, boundary conditions and flows come from the plan; your agentNotes are added verbatim as the narrative. Use it when someone needs more accuracy than the app\'s estimates; the person gets a download link.',
      (input) => {
        const { plan, evaluation } = store.state()
        const markdown = brief(plan, evaluation, input.target, input.agentNotes)
        const dir = join(dataDir, 'briefs')
        mkdirSync(dir, { recursive: true })
        const name = briefFileName(input.target, new Date())
        writeFileSync(join(dir, name), markdown, 'utf8')
        const href = `/api/brief/file/${name}`
        return success({ file: name, href, bytes: Buffer.byteLength(markdown, 'utf8') }, 'Wrote the OpenFOAM simulation brief', [
          { kind: 'link', label: 'OpenFOAM simulation brief', href },
        ])
      },
    ),
    defineTool(
      'export_plan',
      'Returns the whole plan as JSON, the same file the export button downloads, and gives the person a download link. Use it when someone asks to export, save or share the plan.',
      () => success(store.state().plan, 'Exported the plan', [{ kind: 'link', label: 'Plan JSON', href: '/api/plan/export' }]),
    ),
  ]
}
