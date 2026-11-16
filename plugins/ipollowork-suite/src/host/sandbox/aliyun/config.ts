/** Operator-only connection and storage settings for Alibaba Cloud Agent Sandbox. */
import schema from '@deepseek-ai/schemastery';
import { z } from 'zod';

const remoteUrl = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && url.protocol === 'https:';
}, 'Use an HTTPS origin without credentials or query parameters');
const projectSchema = z.object({ serviceUrl: z.url(), projectId: z.string().min(1), tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }).strict();
/** All values are supplied by the Host deployment, never by model tool arguments. */
export const settingsSchema = z.object({
  apiUrl: remoteUrl,
  domain: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('ALIYUN_SANDBOX_API_KEY'),
  template: z.string().trim().min(1),
  workspace: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/?)+$/).default('/home/user'),
  storage: z.object({ bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/), endpoint: remoteUrl, roleArn: z.string().regex(/^acs:ram::[0-9]+:role\/[A-Za-z0-9_./-]+$/) }).strict().optional(),
  project: projectSchema.optional(),
  sandboxTtlSeconds: z.number().int().min(60).max(86400).default(1800),
  requestTimeoutSeconds: z.number().int().min(1).max(300).default(30),
  commandTimeoutSeconds: z.number().int().min(1).max(3600).default(120),
  maxOutputBytes: z.number().int().min(1024).max(1048576).default(32768),
  maxFileBytes: z.number().int().min(1024).max(10485760).default(1048576),
  maxSandboxes: z.number().int().min(1).max(1000).default(10),
  releaseAfterTurn: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.project && !value.storage) ctx.addIssue({code:'custom',message:'Project mode requires durable storage',path:['storage']});
  if (value.storage && !value.project) ctx.addIssue({code:'custom',message:'Shared storage requires a project identity',path:['project']});
});
export type Config = z.input<typeof settingsSchema>;
export type Settings = z.output<typeof settingsSchema>;
/** Cordis configuration schema. Domain validation happens before registrations. */
export const Config = schema.object({
  apiUrl: schema.string().required(), domain: schema.string().required(), template: schema.string().required(),
  apiKeyEnv: schema.string(), workspace: schema.string(),
  project: schema.union([schema.const(undefined),schema.object({serviceUrl:schema.string().required(),projectId:schema.string().required(),tokenEnv:schema.string().required()})]),
  storage: schema.union([schema.const(undefined),schema.object({bucket:schema.string().required(),endpoint:schema.string().required(),roleArn:schema.string().required()})]),
  sandboxTtlSeconds:schema.number(), requestTimeoutSeconds:schema.number(),commandTimeoutSeconds:schema.number(),
  maxOutputBytes:schema.number(),maxFileBytes:schema.number(),maxSandboxes:schema.number(),releaseAfterTurn:schema.boolean(),
}) as schema<Config>;
