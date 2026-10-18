import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useTwinStore } from '../../state/store'
import { fillPipes, prefersReducedMotion } from './LiquidFlow'

/** How long the liquid network takes to fill after a cooling change is applied. */
export const PIPE_FILL_S = 2.4

/** Fill progress `elapsedS` seconds into the transition: ease-out cubic, clamped to 0..1. */
export function pipeFillAt(elapsedS: number): number {
  const t = Math.min(1, Math.max(0, elapsedS / PIPE_FILL_S))
  return 1 - (1 - t) ** 3
}

/**
 * Refills the pipes from the plant outward whenever the store's `pipeFill` count rises (an applied cooling
 * proposal). Mounted inside the Canvas; with reduced motion the pipes stay full.
 */
export function PipeFillTransition() {
  const pipeFill = useTwinStore((s) => s.pipeFill)
  const started = useRef<number | null>(null)

  useEffect(() => {
    if (pipeFill === 0 || prefersReducedMotion()) return
    started.current = performance.now()
    fillPipes(0)
  }, [pipeFill])

  useFrame(() => {
    if (started.current === null) return
    const progress = pipeFillAt((performance.now() - started.current) / 1000)
    fillPipes(progress)
    if (progress >= 1) started.current = null
  })
  return null
}
