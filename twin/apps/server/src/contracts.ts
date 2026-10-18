import type { AgentEvent, Builtins, Command, Evaluation, HistoryInfo, Plan, ViewAction } from '@twin/schema'

export interface StoreChange {
  prev: Evaluation
  next: Evaluation
  author: 'user' | 'agent'
  summary: string
  kind: 'command' | 'undo' | 'redo' | 'replace'
}

export type DispatchResult = { ok: true; summary: string } | { ok: false; error: string }
export type DispatchAllResult = { ok: true; summaries: string[] } | { ok: false; error: string }

/** The server's single plan state with history (Task 12). */
export interface PlanStore {
  state(): { plan: Plan; evaluation: Evaluation; history: HistoryInfo }
  dispatch(cmd: Command, author: 'user' | 'agent'): DispatchResult
  /** All-or-nothing; one history entry. */
  dispatchAll(cmds: Command[], author: 'user' | 'agent'): DispatchAllResult
  undo(): boolean
  redo(): boolean
  replace(plan: Plan): void
  onChange(cb: (change: StoreChange) => void): () => void
  builtins(): Builtins
}

export interface ToolRunResult {
  ok: boolean
  result?: string
  error?: string
}

/** The design agent as the server core sees it (Tasks 13 and 14). */
export interface AgentRuntime {
  handleChat(text: string): void
  handleChange(change: StoreChange): void
  resetConversation(): void
  applyProposal(id: string): void
  dismissProposal(id: string): void
  onEvent(cb: (e: AgentEvent) => void): () => void
  onView(cb: (a: ViewAction) => void): () => void
  threadEvents(): AgentEvent[]
  runTool(name: string, input: unknown): Promise<ToolRunResult>
  listTools(): { name: string; description: string; inputSchema: object }[]
}

