import { z } from "zod";

export const MAX_AVATAR_SECONDS = 600;
export const avatarSegmentSchema = z.object({
  start: z.number().nonnegative(), end: z.number().positive(),
  status: z.enum(["pending", "submitting", "running", "succeeded", "failed", "uncertain", "save_failed"]),
  upstreamId: z.string(), path: z.string(), attempt: z.number().int().nonnegative(),
});
export type AvatarSegment = z.infer<typeof avatarSegmentSchema>;
export const avatarSequenceSchema = z.object({
  duration: z.number().positive().max(MAX_AVATAR_SECONDS), audioPath: z.string(), imagePath: z.string(),
  ratio: z.enum(["9:16", "16:9"]),
  segments: z.array(avatarSegmentSchema).min(1).max(64),
  seams: z.array(z.object({ time: z.number(), difference: z.number(), blend: z.number() })).optional(),
});

export const videoJobSchema = z.object({
  id: z.string(), workspaceId: z.string(), sessionId: z.string(), model: z.string(),
  operation: z.string(), prompt: z.string(), fingerprint: z.string(), upstreamId: z.string(),
  workflowId: z.string().optional(),
  avatarBackground: z.enum(["transparent", "scene"]).optional(),
  avatarSequence: avatarSequenceSchema.optional(),
  status: z.enum(["submitting", "running", "saving", "succeeded", "failed", "uncertain", "save_failed"]),
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
});
export type VideoAvatarContext = z.infer<typeof videoAvatarContextSchema>;

/** Only the user's motion prompt participates, never the referenced video's text. */
export function avatarBackgroundForPrompt(prompt: string): "transparent" | "scene" {
  const clauses = prompt.split(/[。；;\n，,]/);
  return clauses.some(clause => {
    if (/(?:无|不要|不需要|去掉|去除|移除|透明|没有|抠图|抠像|no\s+|without\s+|remove\s+|transparent\s+).{0,8}(?:背景|场景|background)|(?:背景|background).{0,8}(?:透明|去掉|移除|transparent|removed)/i.test(clause)) return false;
    return /背景|场景|background|backdrop|(?:站|坐|置身|身处)在.{0,20}(?:海边|公园|街道|教室|办公室|室内|室外|舞台)/i.test(clause);
  }) ? "scene" : "transparent";
}
