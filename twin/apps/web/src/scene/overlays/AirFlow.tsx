import { useMemo } from 'react'
import { useTwinStore } from '../../state/store'
import { airNetwork } from './flowPaths'
import { FlowParticles, particleRadius } from './LiquidFlow'

/** Sparse, slow, translucent streaks: air leaving each CRAH along the cold aisles, through the racks and back over the hot aisles. */
export function AirFlow() {
  const plan = useTwinStore((s) => s.plan)
  const evaluation = useTwinStore((s) => s.evaluation)
  const network = useMemo(() => (plan && evaluation ? airNetwork(plan, evaluation) : null), [plan, evaluation])
  if (!network) return null
  return (
    <group name="air-flow">
      <FlowParticles circuits={network.circuits} scale={network.scale} radiusFor={particleRadius} opacity={0.4} stretch={4} spread={0.3} />
    </group>
  )
}
