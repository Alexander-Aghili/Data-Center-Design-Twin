import { z } from 'zod'
import { LayerIdSchema, type LayerId } from './plan'

export const OVERLAYS = ['none', 'liquid', 'air', 'temperature', 'floorLoad', 'power', 'network'] as const
export const OverlaySchema = z.enum(OVERLAYS)
export type Overlay = z.infer<typeof OverlaySchema>

/** Camera shots, from widest to closest. */
export const SHOT_IDS = ['site', 'hall', 'row', 'rack', 'tray', 'gpu'] as const
export const ShotIdSchema = z.enum(SHOT_IDS)
export type ShotId = z.infer<typeof ShotIdSchema>

export const SeveritySchema = z.enum(['problem', 'warning', 'info'])
export type Severity = z.infer<typeof SeveritySchema>

export const AnnotationSchema = z.object({
  tag: z.number().int().positive(),
  objectIds: z.array(z.string()),
  label: z.string(),
  severity: SeveritySchema,
  messageId: z.string().optional(),
})
export type Annotation = z.infer<typeof AnnotationSchema>

export const FocusKindSchema = z.enum(['rack', 'row', 'equipment', 'gpu', 'bay'])
export const SelectionSchema = z.object({ kind: z.string(), id: z.string() })
export type Selection = z.infer<typeof SelectionSchema>

export const ViewActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setLayer'), layer: LayerIdSchema }),
  z.object({ type: z.literal('setOverlay'), overlay: OverlaySchema }),
  z.object({ type: z.literal('focus'), target: z.object({ kind: FocusKindSchema, id: z.string() }), shot: ShotIdSchema.optional() }),
  z.object({ type: z.literal('select'), target: SelectionSchema.nullable() }),
  z.object({ type: z.literal('annotate'), annotation: AnnotationSchema }),
  z.object({ type: z.literal('clearAnnotations') }),
  z.object({ type: z.literal('previewProposal'), proposalId: z.string().nullable() }),
])
export type ViewAction = z.infer<typeof ViewActionSchema>

export const LAYER_DEFAULTS: Record<LayerId, { shot: ShotId; overlay: Overlay }> = {
  site: { shot: 'site', overlay: 'none' },
  workload: { shot: 'hall', overlay: 'none' },
  compute: { shot: 'gpu', overlay: 'temperature' },
  layout: { shot: 'row', overlay: 'floorLoad' },
  cooling: { shot: 'hall', overlay: 'liquid' },
  power: { shot: 'hall', overlay: 'power' },
  network: { shot: 'hall', overlay: 'network' },
}
