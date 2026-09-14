import { z } from "zod";

export const videoJobSchema = z.object({
  id: z.string(), workspaceId: z.string(), sessionId: z.string(), model: z.string(),
  operation: z.string(), prompt: z.string(), fingerprint: z.string(), upstreamId: z.string(),
  workflowId: z.string().optional(),
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
