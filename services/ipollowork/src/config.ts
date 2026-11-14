import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { isIP } from "node:net";

const environment = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4785),
  SERVICE_ORIGIN: z.url().default("http://localhost:4785"),
  DATA_DIR: z.string().default("./data"),
  AUTH_SECRET: z.string().optional(),
  MAIL_WEBHOOK_URL: z.url().optional(),
  MAIL_WEBHOOK_TOKEN: z.string().optional(),
  TRUSTED_PROXY_IPS: z.string().default(""),
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "PostgreSQL URL required",
    ),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  DATABASE_SCHEMA: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .default("public"),
  MAX_ARTIFACT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(2_147_483_648)
    .default(536_870_912),
  REQUIRE_OSS: z.enum(["true", "false"]).optional(),
  PERSONAL_STORAGE_GIB: z.coerce.number().int().positive().default(200),
  ORGANIZATION_STORAGE_GIB: z.coerce.number().int().positive().default(500),
  PERSONAL_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  UPLOAD_RESERVATION_MS: z.coerce.number().int().min(60000).default(3600000),
  STORAGE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  PAYMENT_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  MINIMUM_MARGIN_BPS: z.coerce.number().int().min(0).max(9000).default(3000),
  MEMBERSHIP_OPERATING_RESERVE_FEN: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(3000),
});
export interface Config {
  host: string;
  port: number;
  origin: string;
  dataDir: string;
  secret: string;
  mailUrl?: string;
  mailToken?: string;
  trustedProxyIps: string[];
  databaseUrl: string;
  databasePoolSize: number;
  databaseSchema: string;
  maxArtifactBytes: number;
  requireOss: boolean;
  personalStorageGiB: number;
  organizationStorageGiB: number;
  personalRetentionDays: number;
  uploadReservationMs: number;
  storageCleanupIntervalMs: number;
  paymentFeeBps: number;
  minimumMarginBps: number;
  membershipOperatingReserveFen: number;
}

/** Resolve one deployment; the local secret persists across restarts. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = environment.parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")),
  );
  const origin = new URL(value.SERVICE_ORIGIN);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("SERVICE_ORIGIN must be an origin");
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Public services require HTTPS");
  const dataDir = resolve(value.DATA_DIR);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretPath = resolve(dataDir, "auth.secret");
  if (!value.AUTH_SECRET && !existsSync(secretPath))
    writeFileSync(secretPath, randomBytes(48).toString("base64url"), {
      mode: 0o600,
      flag: "wx",
    });
  const secret = value.AUTH_SECRET ?? readFileSync(secretPath, "utf8").trim();
  if (secret.length < 32)
    throw new Error("AUTH_SECRET must have at least 32 characters");
  const trustedProxyIps = value.TRUSTED_PROXY_IPS.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (trustedProxyIps.some((v) => !isIP(v)))
    throw new Error("TRUSTED_PROXY_IPS accepts explicit IP addresses only");
  return {
    host: value.HOST,
    port: value.PORT,
    origin: origin.origin,
    dataDir,
    secret,
    mailUrl: value.MAIL_WEBHOOK_URL,
    mailToken: value.MAIL_WEBHOOK_TOKEN,
    trustedProxyIps,
    databaseUrl: value.DATABASE_URL,
    databasePoolSize: value.DATABASE_POOL_SIZE,
    databaseSchema: value.DATABASE_SCHEMA,
    maxArtifactBytes: value.MAX_ARTIFACT_BYTES,
    requireOss:
      value.REQUIRE_OSS === undefined
        ? !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
        : value.REQUIRE_OSS === "true",
    personalStorageGiB: value.PERSONAL_STORAGE_GIB,
    organizationStorageGiB: value.ORGANIZATION_STORAGE_GIB,
    personalRetentionDays: value.PERSONAL_RETENTION_DAYS,
    uploadReservationMs: value.UPLOAD_RESERVATION_MS,
    storageCleanupIntervalMs: value.STORAGE_CLEANUP_INTERVAL_MS,
    paymentFeeBps: value.PAYMENT_FEE_BPS,
    minimumMarginBps: value.MINIMUM_MARGIN_BPS,
    membershipOperatingReserveFen: value.MEMBERSHIP_OPERATING_RESERVE_FEN,
  };
}
