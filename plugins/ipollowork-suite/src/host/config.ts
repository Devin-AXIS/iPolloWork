/** Deployment-owned configuration. None of these values is writable through a model tool. */
import { fileURLToPath } from "node:url";
import { readFileSync } from 'node:fs';
import z from "@deepseek-ai/schemastery";
import { SuiteError } from "./errors.ts";

const deployment: unknown = JSON.parse(readFileSync(new URL(import.meta.resolve('@ipollo/dsh-suite/deployment.json')), 'utf8'));
if (!deployment || typeof deployment !== 'object' || !('accountOrigin' in deployment) || typeof deployment.accountOrigin !== 'string')
  throw new Error('deployment.json requires an accountOrigin string');
const ACCOUNT_ORIGIN = deployment.accountOrigin;

export interface Config {
  accountOrigin?: string;
  cloudRuntimeTokenEnv?: string;
  catalogPath?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  theme?: boolean;
  market?: boolean;
  account?: boolean;
  dedicatedDesktop?: boolean;
  uploadTimeoutMs?: number;
  maxArtifactBytes?: number;
  archiveHistoryLimit?: number;
  automaticOutputArchive?: boolean;
  enterpriseUsageReporting?: boolean;
  enterpriseUsageQueueLimit?: number;
}
export const Config = z.object({
  cloudRuntimeTokenEnv: z.string().default(""),
  accountOrigin: z.string().default(ACCOUNT_ORIGIN),
  catalogPath: z
    .string()
    .default(
      fileURLToPath(new URL("../../catalog/index.json", import.meta.url)),
    ),
  requestTimeoutMs: z.number().min(1000).max(60000).default(20000),
  maxRequestBytes: z.number().min(16384).max(1048576).default(262144),
  maxResponseBytes: z.number().min(1024).max(4194304).default(1048576),
  uploadTimeoutMs: z.number().min(1000).max(1800000).default(300000),
  maxArtifactBytes: z.number().min(1024).max(2147483648).default(536870912),
  archiveHistoryLimit: z.number().min(10).max(10000).default(500),
  automaticOutputArchive: z.boolean().default(false),
  enterpriseUsageReporting: z.boolean().default(true),
  enterpriseUsageQueueLimit: z.number().min(1).max(10000).default(200),
  theme: z.boolean().default(true),
  market: z.boolean().default(true),
  account: z.boolean().default(true),
  dedicatedDesktop: z.boolean().default(false),
});
export type ResolvedConfig = Required<Config>;
/** Resolve defaults and reject remote unencrypted login destinations before registering routes. */
export function resolveConfig(input: Config, applicationOwned = false, installationOrigin?: unknown): ResolvedConfig {
  if (applicationOwned && installationOrigin !== undefined && typeof installationOrigin !== 'string')
    throw new SuiteError('IPW_INVALID_ACCOUNT_ORIGIN');
  const result = Config(applicationOwned ? {
    ...input, accountOrigin: typeof installationOrigin === 'string' ? installationOrigin : ACCOUNT_ORIGIN,
    dedicatedDesktop: true, theme: true, account: true,
  } : input) as ResolvedConfig;
  if(result.cloudRuntimeTokenEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result.cloudRuntimeTokenEnv))throw new SuiteError('IPW_INVALID_ACCOUNT_ORIGIN');
  let url: URL;
  try { url = new URL(result.accountOrigin); }
  catch { throw new SuiteError('IPW_INVALID_ACCOUNT_ORIGIN'); }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    throw new SuiteError("IPW_INVALID_ACCOUNT_ORIGIN");
  }
  return { ...result, accountOrigin: url.origin };
}
