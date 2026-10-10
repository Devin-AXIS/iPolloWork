import { z } from "zod";

export const VIDEO_ENHANCEMENT_MAX_SECONDS = 180;
export const VIDEO_ENHANCEMENT_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_ENHANCEMENT_MASK_SIZE = 64;
export const videoEnhancementSessionSchema = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const videoEnhancementRectSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).strict().refine(rect => rect.x + rect.width <= 1.00001 && rect.y + rect.height <= 1.00001);
export const videoEnhancementSegmentSchema = z.object({
  start: z.number().nonnegative(), end: z.number().positive(), text: z.string().max(2000),
}).strict().refine(value => value.end > value.start);
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const videoEnhancementLayoutSchema = z.object({
  mode: z.enum(["background", "pip", "split"]).default("pip"),
  aspectRatio: z.enum(["16:9", "9:16", "source"]).default("16:9"),
  sourcePosition: z.enum(["bottom-left", "bottom-right", "top-left", "top-right"]).default("bottom-left"),
  sourceSize: z.enum(["small", "medium", "large"]).default("medium"),
  contentPosition: z.enum(["auto", "left", "right", "top", "bottom", "center"]).default("auto"),
}).strict();
export const videoEnhancementGestureSchema = z.object({
  id: z.string().regex(/^gesture-[0-9]+$/), kind: z.enum(["point", "open_palm"]),
  start: z.number().nonnegative(), end: z.number().positive(),
  confidence: z.number().min(0).max(1), target: pointSchema,
}).strict().refine(value => value.end > value.start);
export const videoEnhancementCueSchema = z.object({
  id: z.string().regex(/^enhance-[0-9]+$/),
  kind: z.enum(["keyword", "number", "list", "steps", "comparison", "quote", "summary"]),
  text: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(480).optional(),
  items: z.array(z.string().trim().min(1).max(160)).max(4).optional(),
  start: z.number().nonnegative(), end: z.number().positive(), enabled: z.boolean(),
  placement: z.enum(["auto", "gesture", "left", "right", "top", "bottom", "center"]).optional(),
}).strict().refine(value => value.end > value.start && value.end - value.start >= .5);
export const videoEnhancementPlacedCueSchema = videoEnhancementCueSchema.safeExtend({
  rect: videoEnhancementRectSchema.nullable(), reason: z.string().optional(),
  gesture: videoEnhancementGestureSchema.optional(),
  avoidance: z.enum(["contour", "box", "source"]).optional(),
});
// Fixed 64x64 occupancy bitmap, four horizontal cells per hex digit.
// Null marks an unreliable frame; callers must retain box protection.
export const videoEnhancementMaskSchema = z.object({
  time: z.number().nonnegative(), data: z.string().regex(/^[0-9a-f]{1024}$/).nullable(),
}).strict();
export const videoEnhancementResultSchema = z.object({
  duration: z.number().positive().max(VIDEO_ENHANCEMENT_MAX_SECONDS),
  width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
  layout: videoEnhancementLayoutSchema.optional(),
  segments: z.array(videoEnhancementSegmentSchema).max(600),
  people: z.array(z.object({ time: z.number().nonnegative(), boxes: z.array(videoEnhancementRectSchema).max(20) }).strict()).max(400),
  hands: z.array(z.object({ time: z.number().nonnegative(), boxes: z.array(videoEnhancementRectSchema).max(2) }).strict()).max(721).default([]),
  gestures: z.array(videoEnhancementGestureSchema).max(120).default([]),
  masks: z.array(videoEnhancementMaskSchema).max(721).default([]),
  timings: z.object({ totalMs: z.number().int().nonnegative(), speechMs: z.number().int().nonnegative(), visionMs: z.number().int().nonnegative() }).strict().optional(),
  cues: z.array(videoEnhancementPlacedCueSchema).max(60),
  warnings: z.array(z.string()).max(10),
});
export const videoEnhancementJobSchema = z.object({
  id: z.uuid(), sessionId: videoEnhancementSessionSchema, sourcePath: z.string(),
  status: z.enum(["running", "ready", "cancelled", "failed", "applied"]),
  progress: z.number().min(0).max(100), message: z.string(),
  baseRevision: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number(), result: videoEnhancementResultSchema.optional(),
  appliedRevision: z.string().optional(),
});
export const videoEnhancementStatusSchema = z.object({ ready: z.boolean(), message: z.string(), gesturesReady: z.boolean().default(false), segmentationReady: z.boolean().default(false) });
export const videoEnhancementStartSchema = z.object({
  sessionId: videoEnhancementSessionSchema, sourcePath: z.string().max(400),
  language: z.enum(["zh", "en", "auto"]).default("zh"),
  useGestures: z.boolean().default(true),
  useSegmentation: z.boolean().default(true),
}).strict();
export const videoEnhancementJobInputSchema = z.object({ sessionId: videoEnhancementSessionSchema, jobId: z.uuid() }).strict();
export const videoEnhancementReadSchema = z.object({ sessionId: videoEnhancementSessionSchema, jobId: z.uuid().optional() }).strict();
export const videoEnhancementApplySchema = videoEnhancementJobInputSchema.extend({
  cues: z.array(videoEnhancementCueSchema).min(1).max(60),
  layout: videoEnhancementLayoutSchema.optional(),
}).strict();
export const videoEnhancementPreviewSchema = videoEnhancementJobInputSchema.extend({
  cues: z.array(videoEnhancementCueSchema).max(60).optional(),
  layout: videoEnhancementLayoutSchema,
}).strict();
export const videoEnhancementPreviewResultSchema = z.object({
  html: z.string().max(500_000), cues: z.array(videoEnhancementPlacedCueSchema).max(60),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict();
export const videoEnhancementWorkflowResultSchema = z.object({
  sourcePath: z.string(), requestPath: z.string(), instruction: z.string().max(6000),
}).strict();
export type VideoEnhancementRect = z.infer<typeof videoEnhancementRectSchema>;
export type VideoEnhancementCue = z.infer<typeof videoEnhancementCueSchema>;
export type VideoEnhancementResult = z.infer<typeof videoEnhancementResultSchema>;
export type VideoEnhancementJob = z.infer<typeof videoEnhancementJobSchema>;
export type VideoEnhancementGesture = z.infer<typeof videoEnhancementGestureSchema>;
export type VideoEnhancementMask = z.infer<typeof videoEnhancementMaskSchema>;
export type VideoEnhancementLayout = z.infer<typeof videoEnhancementLayoutSchema>;
export type VideoEnhancementPreview = z.infer<typeof videoEnhancementPreviewResultSchema>;
export type VideoEnhancementWorkflow = z.infer<typeof videoEnhancementWorkflowResultSchema>;
