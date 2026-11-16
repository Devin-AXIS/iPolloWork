/** Resolved Alibaba execution limits and project authorization settings. */
import schema from '@deepseek-ai/schemastery';
import { z } from 'zod';

/** Validated settings for one plugin instance. */
export const settingsSchema = z.object({
  endpoint: z.url().refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  }, 'Use an HTTPS origin or loopback HTTP without credentials'),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('OPEN_SANDBOX_API_KEY'),
  project: z.object({ serviceUrl: z.url(), projectId: z.string().min(1), tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }).strict().optional(),
  image: z.string().trim().min(1),
  workspace: z.string().startsWith('/').default('/tmp'),
  secureAccess: z.boolean().default(true),
  releaseAfterTurn: z.boolean().default(false),
  cpu: z.string().min(1).default('1'),
  memory: z.string().min(1).default('2Gi'),
  sandboxTtlSeconds: z.number().int().min(60).max(86400).default(1800),
  requestTimeoutSeconds: z.number().int().min(1).max(300).default(30),
  commandTimeoutSeconds: z.number().int().min(1).max(3600).default(120),
  maxOutputBytes: z.number().int().min(1024).max(1048576).default(32768),
  maxFileBytes: z.number().int().min(1024).max(10485760).default(1048576),
  maxSandboxes: z.number().int().min(1).max(1000).default(10),
}).strict();

/** Public loader settings, resolved before any remote operation. */
export type Config = z.input<typeof settingsSchema>;
/** Resolved deployment limits. */
export type Settings = z.output<typeof settingsSchema>;
/** Cordis loader schema. */
export const Config = schema.object({
  project: schema.union([schema.const(undefined), schema.object({ serviceUrl: schema.string().required(), projectId: schema.string().required(), tokenEnv: schema.string().required() })]),
  endpoint: schema.string().required(), apiKeyEnv: schema.string(), image: schema.string().required(),
  secureAccess: schema.boolean(), releaseAfterTurn: schema.boolean(),
  workspace: schema.string(), cpu: schema.string(), memory: schema.string(),
  sandboxTtlSeconds: schema.number(), requestTimeoutSeconds: schema.number(),
  commandTimeoutSeconds: schema.number(), maxOutputBytes: schema.number(),
  maxFileBytes: schema.number(), maxSandboxes: schema.number(),
});
