import { z } from "zod";

// Bound persisted job metadata separately from the model's per-call duration.
export const MAX_AVATAR_SEGMENTS = 10_000;
export const AVATAR_STANDARD_VIDEO = { resolution: "0.258048MP", shortEdge: 384, longEdge: 672 };
export const MAX_AVATAR_PROFILES = 50;
export const avatarProfileSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80),
  imagePath: z.string().max(4096), imageName: z.string().max(255),
  ratio: z.enum(["9:16", "16:9"]), prompt: z.string().max(8000),
  audioClipId: z.string().max(100), updatedAt: z.number().int().nonnegative(),
});
export type AvatarProfile = z.infer<typeof avatarProfileSchema>;
export const avatarProfilesResultSchema = z.object({ profiles: z.array(avatarProfileSchema).max(MAX_AVATAR_PROFILES) });
export const avatarProfileResultSchema = z.object({ profile: avatarProfileSchema });
export const avatarAudioClipSchema = z.object({
  id: z.string(), label: z.string(), start: z.number().nonnegative(),
  duration: z.number().positive(), voiceId: z.string(), fingerprint: z.string(),
});
export const avatarSegmentSchema = z.object({
  start: z.number().nonnegative(), end: z.number().positive(),
  status: z.enum(["pending", "submitting", "running", "succeeded", "failed", "uncertain", "save_failed"]),
  upstreamId: z.string(), path: z.string(), attempt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(), completedAt: z.number().int().nonnegative().optional(),
});
export type AvatarSegment = z.infer<typeof avatarSegmentSchema>;
export const avatarSequenceSchema = z.object({
  duration: z.number().positive(), audioPath: z.string(), imagePath: z.string(),
  ratio: z.enum(["9:16", "16:9"]),
  segments: z.array(avatarSegmentSchema).min(1).max(MAX_AVATAR_SEGMENTS),
  seams: z.array(z.object({ time: z.number(), difference: z.number(), blend: z.number() })).optional(),
});

export const videoJobSchema = z.object({
  id: z.string(), workspaceId: z.string(), sessionId: z.string(), model: z.string(),
  operation: z.string(), prompt: z.string(), fingerprint: z.string(), upstreamId: z.string(),
  workflowId: z.string().optional(),
  avatarBackground: z.enum(["transparent", "scene"]).optional(),
  avatarProfileId: z.uuid().optional(), avatarProfileUpdatedAt: z.number().int().nonnegative().optional(),
  avatarAudioFingerprint: z.string().optional(),
  avatarAudioStart: z.number().nonnegative().optional(),
  avatarSequence: avatarSequenceSchema.optional(),
  status: z.enum(["submitting", "running", "saving", "paused", "succeeded", "failed", "uncertain", "save_failed", "stopped"]),
  pauseRequested: z.boolean().optional(),
  path: z.string(), message: z.string(), createdAt: z.number(), updatedAt: z.number(), nextPoll: z.number(),
});
export type VideoJob = z.infer<typeof videoJobSchema>;
export const videoJobsResultSchema = z.object({ jobs: z.array(videoJobSchema) });
export const videoSubmitResultSchema = z.object({ job: videoJobSchema });
export const videoModelStatusSchema = z.object({ models: z.array(z.object({ id: z.string() })) });

export const videoAvatarContextSchema = z.object({
  content: z.string(),
  audioDuration: z.number().nonnegative(),
  audioCount: z.number().int().nonnegative(),
  audioIssue: z.string(),
  audioClips: z.array(avatarAudioClipSchema).optional(),
});
export type VideoAvatarContext = z.infer<typeof videoAvatarContextSchema>;

/** Preserve the background unless the user explicitly requests removal. */
export function avatarBackgroundForPrompt(prompt: string): "transparent" | "scene" {
  const clauses = prompt.split(/[。；;\n，,]/);
  return clauses.some(clause => {
    if (/(?:不要|不需要|无需|禁止).{0,4}(?:抠图|抠像|去掉|去除|移除)|保留.{0,4}背景/i.test(clause)) return false;
    return /(?:无|不要|不需要|去掉|去除|移除|透明|没有|no\s+|without\s+|remove\s+|transparent\s+).{0,8}(?:背景|background)|(?:背景|background).{0,8}(?:透明|去掉|去除|移除|transparent|removed)/i.test(clause);
  }) ? "transparent" : "scene";
}
