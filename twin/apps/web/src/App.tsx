import type { CSSProperties, ReactNode } from 'react'

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'var(--col-left) minmax(0, 1fr) var(--col-right)',
  gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
  gridTemplateAreas: '"layers scene totals" "layers scene agent"',
  height: '100%',
  background: 'var(--paper)',
}

const panel: CSSProperties = { background: 'var(--panel)', minHeight: 0, overflow: 'auto' }

export function LayerColumn({ children }: { children?: ReactNode }) {
  return (
    <aside aria-label="Layers and decisions" style={{ ...panel, gridArea: 'layers', borderRight: 'var(--rule)' }}>
      {children}
    </aside>
  )
}

export function SceneRegion({ children }: { children?: ReactNode }) {
  return (
    <main aria-label="Plan view" style={{ gridArea: 'scene', minWidth: 0, minHeight: 0, background: 'var(--canvas)' }}>
      {children}
    </main>
  )
}

export function TotalsRegion({ children }: { children?: ReactNode }) {
  return (
    <section aria-label="Plan totals" style={{ ...panel, gridArea: 'totals', borderLeft: 'var(--rule)', borderBottom: 'var(--rule)' }}>
      {children}
    </section>
  )
}

export function AgentRegion({ children }: { children?: ReactNode }) {
  return (
    <section aria-label="Design agent" style={{ ...panel, gridArea: 'agent', borderLeft: 'var(--rule)' }}>
      {children}
    </section>
  )
}

export function App() {
  return (
    <div style={shell}>
      <LayerColumn />
      <SceneRegion />
      <TotalsRegion />
      <AgentRegion />
    </div>
  )
}
