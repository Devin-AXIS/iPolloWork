import { z } from "zod";

export const VIDEO_ENHANCEMENT_MAX_SECONDS = 180;
export const VIDEO_ENHANCEMENT_MAX_BYTES = 100 * 1024 * 1024;
export const videoEnhancementSessionSchema = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const videoEnhancementRectSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).strict().refine(rect => rect.x + rect.width <= 1.00001 && rect.y + rect.height <= 1.00001);
export const videoEnhancementSegmentSchema = z.object({
  start: z.number().nonnegative(), end: z.number().positive(), text: z.string().max(2000),
}).strict().refine(value => value.end > value.start);
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const videoEnhancementGestureSchema = z.object({
  id: z.string().regex(/^gesture-[0-9]+$/), kind: z.enum(["point", "open_palm"]),
  start: z.number().nonnegative(), end: z.number().positive(),
  confidence: z.number().min(0).max(1), target: pointSchema,
}).strict().refine(value => value.end > value.start);
export const videoEnhancementCueSchema = z.object({
  id: z.string().regex(/^enhance-[0-9]+$/),
  kind: z.enum(["keyword", "number", "list"]),
  text: z.string().trim().min(1).max(80),
  start: z.number().nonnegative(), end: z.number().positive(), enabled: z.boolean(),
  placement: z.enum(["auto", "gesture", "left", "right"]).optional(),
}).strict().refine(value => value.end > value.start && value.end - value.start >= .5);
export const videoEnhancementPlacedCueSchema = videoEnhancementCueSchema.safeExtend({
  rect: videoEnhancementRectSchema.nullable(), reason: z.string().optional(),
  gesture: videoEnhancementGestureSchema.optional(),
});
export const videoEnhancementResultSchema = z.object({
  duration: z.number().positive().max(VIDEO_ENHANCEMENT_MAX_SECONDS),
  width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
  segments: z.array(videoEnhancementSegmentSchema).max(600),
  people: z.array(z.object({ time: z.number().nonnegative(), boxes: z.array(videoEnhancementRectSchema).max(20) }).strict()).max(400),
  hands: z.array(z.object({ time: z.number().nonnegative(), boxes: z.array(videoEnhancementRectSchema).max(2) }).strict()).max(721).default([]),
  gestures: z.array(videoEnhancementGestureSchema).max(120).default([]),
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
export const videoEnhancementStatusSchema = z.object({ ready: z.boolean(), message: z.string(), gesturesReady: z.boolean().default(false) });
export const videoEnhancementStartSchema = z.object({
  sessionId: videoEnhancementSessionSchema, sourcePath: z.string().max(400),
  language: z.enum(["zh", "en", "auto"]).default("zh"),
  useGestures: z.boolean().default(true),
}).strict();
export const videoEnhancementJobInputSchema = z.object({ sessionId: videoEnhancementSessionSchema, jobId: z.uuid() }).strict();
export const videoEnhancementReadSchema = z.object({ sessionId: videoEnhancementSessionSchema, jobId: z.uuid().optional() }).strict();
export const videoEnhancementApplySchema = videoEnhancementJobInputSchema.extend({
  cues: z.array(videoEnhancementCueSchema).min(1).max(60),
}).strict();
export type VideoEnhancementRect = z.infer<typeof videoEnhancementRectSchema>;
export type VideoEnhancementCue = z.infer<typeof videoEnhancementCueSchema>;
export type VideoEnhancementResult = z.infer<typeof videoEnhancementResultSchema>;
export type VideoEnhancementJob = z.infer<typeof videoEnhancementJobSchema>;
export type VideoEnhancementGesture = z.infer<typeof videoEnhancementGestureSchema>;
