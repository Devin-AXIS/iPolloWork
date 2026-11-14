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
  OSS_RAM_ROLE: z
    .string()
    .regex(/^[A-Za-z0-9.@_-]{1,64}$/)
    .optional(),
  OSS_INTERNAL: z.enum(["true", "false"]).default("false"),
  PUBLICATION_ORIGIN: z.url().optional(),
  MAX_PUBLICATION_FILES: z.coerce.number().int().min(1).max(1000).default(100),
  PERSONAL_STORAGE_GIB: z.coerce.number().int().positive().default(200),
  ORGANIZATION_STORAGE_GIB: z.coerce.number().int().positive().default(500),
  PERSONAL_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  UPLOAD_RESERVATION_MS: z.coerce.number().int().min(60000).default(3600000),
  STORAGE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  PAYMENT_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  USAGE_UTC_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(480),
  MINIMUM_MARGIN_BPS: z.coerce.number().int().min(0).max(9000).default(3000),
  MEMBERSHIP_OPERATING_RESERVE_FEN: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(3000),
  APP_DATA_DATABASE_URL: z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "PostgreSQL URL required",
    )
    .optional(),
  APP_DATA_DATABASE_SCHEMA: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .default("public"),
  APP_DATA_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  APP_DATA_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  APP_DATA_MAX_RECORD_BYTES: z.coerce.number().int().min(256).max(1_048_576).default(16384),
  APP_DATA_MAX_RECORDS_PER_APP: z.coerce.number().int().min(1).default(100_000),
  APP_DATA_MAX_BYTES_PER_APP: z.coerce.number().int().min(1024).default(67_108_864),
  APP_DATA_MAX_APPS_PER_OWNER: z.coerce.number().int().min(1).default(1000),
  APP_DATA_ANONYMOUS_PER_MINUTE: z.coerce.number().int().min(1).default(120),
});
/** App data lives in its own PostgreSQL database; absent `databaseUrl` leaves the API unavailable. */
export interface AppDataConfig {
  databaseUrl: string;
  databaseSchema: string;
  databasePoolSize: number;
  statementTimeoutMs: number;
  maxRecordBytes: number;
  maxRecordsPerApp: number;
  maxBytesPerApp: number;
  maxAppsPerOwner: number;
  anonymousPerMinute: number;
}
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
  ossRamRole?: string;
  ossInternal: boolean;
  publicationOrigin?: string;
  maxPublicationFiles: number;
  personalStorageGiB: number;
  organizationStorageGiB: number;
  personalRetentionDays: number;
  uploadReservationMs: number;
  storageCleanupIntervalMs: number;
  paymentFeeBps: number;
  usageUtcOffsetMinutes: number;
  minimumMarginBps: number;
  membershipOperatingReserveFen: number;
  appData?: AppDataConfig;
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
  const publication = value.PUBLICATION_ORIGIN
    ? new URL(value.PUBLICATION_ORIGIN)
    : undefined;
  if (
    publication &&
    (publication.origin === origin.origin ||
      publication.pathname !== "/" ||
      publication.search ||
      publication.hash ||
      publication.username ||
      publication.password ||
      !(
        publication.protocol === "https:" ||
        (publication.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(publication.hostname))
      ))
  )
    throw new Error(
      "PUBLICATION_ORIGIN must be a separate HTTPS origin (or a separate loopback origin for development)",
    );
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
  if (
    value.APP_DATA_DATABASE_URL === value.DATABASE_URL &&
    value.APP_DATA_DATABASE_SCHEMA === value.DATABASE_SCHEMA
  )
    throw new Error(
      "APP_DATA_DATABASE_URL must name a separate database or schema",
    );
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
    ossRamRole: value.OSS_RAM_ROLE,
    ossInternal: value.OSS_INTERNAL === "true",
    publicationOrigin: publication?.origin,
    maxPublicationFiles: value.MAX_PUBLICATION_FILES,
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
    usageUtcOffsetMinutes: value.USAGE_UTC_OFFSET_MINUTES,
    minimumMarginBps: value.MINIMUM_MARGIN_BPS,
    membershipOperatingReserveFen: value.MEMBERSHIP_OPERATING_RESERVE_FEN,
    appData: value.APP_DATA_DATABASE_URL
      ? {
          databaseUrl: value.APP_DATA_DATABASE_URL,
          databaseSchema: value.APP_DATA_DATABASE_SCHEMA,
          databasePoolSize: value.APP_DATA_POOL_SIZE,
          statementTimeoutMs: value.APP_DATA_STATEMENT_TIMEOUT_MS,
          maxRecordBytes: value.APP_DATA_MAX_RECORD_BYTES,
          maxRecordsPerApp: value.APP_DATA_MAX_RECORDS_PER_APP,
          maxBytesPerApp: value.APP_DATA_MAX_BYTES_PER_APP,
          maxAppsPerOwner: value.APP_DATA_MAX_APPS_PER_OWNER,
          anonymousPerMinute: value.APP_DATA_ANONYMOUS_PER_MINUTE,
        }
      : undefined,
  };
}
