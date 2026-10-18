import type { AgentEvent, Annotation, Check, Proposal } from '@twin/schema'

/** Scripted agent turns standing in for the server agent (Tasks 13 and 14) in tests and the screenshot harness. */

const check = (over: Partial<Check> & Pick<Check, 'id' | 'kind' | 'title' | 'status'>): Check => ({
  layer: 'cooling',
  subject: { kind: 'plant', id: 'plant', objectIds: [] },
  value: null,
  limit: null,
  unit: '',
  utilization: null,
  explanation: '',
  causes: [],
  ...over,
})

export const liquidProposal: Proposal = {
  id: 'p1',
  title: 'Liquid cooling for rows 3–5',
  rationale: 'Air cannot carry 132 kW per rack. Cold plates move most of the heat into the facility water loop.',
  commands: [
    { type: 'setCoolingMethod', payload: { groupId: 'g2', coolingMethodId: 'dlc-cold-plate' } },
    { type: 'overrideEquipment', payload: { key: 'cdu:R4', count: 2 } },
  ],
  respectsNotes: ['note-1'],
  violatesNotes: [],
  diff: {
    headline: { pueAnnual: { from: 1.3812, to: 1.1874 } },
    worsened: [
      check({
        id: 'layout.floorBay:B4-3',
        kind: 'layout.floorBay',
        layer: 'layout',
        title: 'Floor bay B4-3',
        status: 'warn',
        utilization: 0.97,
      }),
    ],
    improved: [],
    resolved: [check({ id: 'cooling.crahCapacity:Z1', kind: 'cooling.crahCapacity', title: 'CRAH capacity', status: 'pass' })],
    newChecks: [],
    capexDeltaUsd: 4_800_000,
    buildWeeksDelta: 9,
    waterDeltaM3PerDay: 0,
  },
  status: 'open',
  annotationTag: 1,
  basePlanUpdatedAt: '2026-10-18T09:00:00.000Z',
}

const problemText = [
  "**Rows 3–5 can't be air cooled.** ",
  'JR switched them to GB300 NVL72 at 132',
  ' kW per rack. Air handles about 40 kW per rack, ',
  'and the two CRAHs would need to move 214% of their rated heat.',
]

/** An observation turn: a problem with a revision cloud, quiet tool lines and a proposal. */
export const problemTurn: AgentEvent[] = [
  { kind: 'messageStart', messageId: 'm1', trigger: 'observation', severity: 'problem' },
  { kind: 'toolCall', messageId: 'm1', callId: 'c1', name: 'get_evaluation', summary: 'Read the evaluation' },
  { kind: 'toolResult', callId: 'c1', ok: true, summary: '1 check fails', numbers: [132_000, 2.14, 1.3812, 5760] },
  { kind: 'toolCall', messageId: 'm1', callId: 'c2', name: 'explain_check', summary: 'Explained CRAH capacity' },
  { kind: 'toolResult', callId: 'c2', ok: true, summary: 'Rack heat on air above the CRAH rating', numbers: [40_000, 2] },
  ...problemText.map((text): AgentEvent => ({ kind: 'textDelta', messageId: 'm1', text })),
  { kind: 'toolCall', messageId: 'm1', callId: 'c3', name: 'propose_change', summary: 'Proposed liquid cooling' },
  { kind: 'toolResult', callId: 'c3', ok: true, summary: 'Proposal ready', numbers: [] },
  { kind: 'proposal', messageId: 'm1', proposal: liquidProposal },
  { kind: 'messageEnd', messageId: 'm1' },
]

export const problemAnnotation: Annotation = {
  tag: 1,
  objectIds: ['row:R3', 'row:R4', 'row:R5'],
  label: '132 kW per rack on air',
  severity: 'problem',
  messageId: 'm1',
}

/** A chat turn: user question, a list answer, a document link. */
export const chatTurn: AgentEvent[] = [
  { kind: 'userMessage', messageId: 'u1', text: 'What sets the build time now?' },
  { kind: 'messageStart', messageId: 'm2', trigger: 'chat', severity: 'info' },
  { kind: 'toolCall', messageId: 'm2', callId: 'c4', name: 'get_evaluation', summary: 'Read the cost and schedule' },
  { kind: 'toolResult', callId: 'c4', ok: true, summary: 'Critical path found', numbers: [38, 30, 26] },
  {
    kind: 'textDelta',
    messageId: 'm2',
    text: 'The CDUs set the critical path at 38 weeks.\n\n- CDU lead time: 30 weeks\n- Chiller lead time: 26 weeks\n\nOrdering the CDUs first is the only way to pull that in. I wrote a `buoyantSimpleFoam` brief for the room air.',
  },
  { kind: 'toolCall', messageId: 'm2', callId: 'c5', name: 'generate_simulation_brief', summary: 'Wrote the OpenFOAM brief' },
  { kind: 'toolResult', callId: 'c5', ok: true, summary: 'Saved', numbers: [] },
  { kind: 'link', messageId: 'm2', label: 'OpenFOAM simulation brief', href: '/api/brief/file/2026-10-18-openfoam.md' },
  { kind: 'messageEnd', messageId: 'm2' },
]

export const rateLimitError: AgentEvent = {
  kind: 'error',
  message: 'The Claude API is rate limiting requests. Try again in a minute.',
}
