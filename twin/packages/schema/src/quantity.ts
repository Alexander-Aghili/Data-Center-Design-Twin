import { z } from 'zod'

export const BASES = ['vendor', 'oem', 'press', 'textbook', 'estimate', 'user', 'calculated'] as const
export const BasisSchema = z.enum(BASES)
export type Basis = z.infer<typeof BasisSchema>

const quantityShape = {
  value: z.number().nullable(),
  low: z.number().optional(),
  high: z.number().optional(),
  unit: z.string(),
  source: z.url().optional(),
  note: z.string().min(1).optional(),
}

function checkProvenance(q: { basis: Basis; source?: string; note?: string }, ctx: z.RefinementCtx) {
  if ((q.basis === 'vendor' || q.basis === 'oem') && !q.source) {
    ctx.addIssue({ code: 'custom', path: ['source'], message: `basis "${q.basis}" needs a source URL` })
  }
  if (q.basis === 'estimate' && !q.note) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: 'basis "estimate" needs a note saying how it was estimated' })
  }
}

/** A catalog or plan number with its origin. `value: null` means unknown, never 0. */
export const QuantitySchema = z.object({ ...quantityShape, basis: BasisSchema }).superRefine(checkProvenance)
export type Quantity = z.infer<typeof QuantitySchema>

/** Input form used by custom-entry commands: a missing basis becomes `user`. */
export const QuantityInputSchema = z
  .object({ ...quantityShape, basis: BasisSchema.default('user') })
  .superRefine(checkProvenance)

export function qty(value: number, unit: string, basis: Basis, extra?: Partial<Quantity>): Quantity {
  return { value, unit, basis, ...extra }
}

/** Null-safe read of one field of a quantity. */
export function num(q: Quantity, pick: 'value' | 'low' | 'high' = 'value'): number | null {
  const v = q[pick]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
