import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { isIP } from "node:net";

const environment = z.object({
  HOST: z.string().default("127.0.0.1"), PORT: z.coerce.number().int().min(1).max(65535).default(4785),
  SERVICE_ORIGIN: z.url().default("http://localhost:4785"), DATA_DIR: z.string().default("./data"),
  AUTH_SECRET: z.string().optional(), MAIL_WEBHOOK_URL: z.url().optional(), MAIL_WEBHOOK_TOKEN: z.string().optional(),
  TRUSTED_PROXY_IPS: z.string().default(""),
});
export interface Config { host: string; port: number; origin: string; dataDir: string; secret: string; mailUrl?: string; mailToken?: string; trustedProxyIps: string[] }

/** Resolve one deployment; the local secret persists across restarts. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = environment.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  const origin = new URL(value.SERVICE_ORIGIN);
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("SERVICE_ORIGIN must be an origin");
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Public services require HTTPS");
  const dataDir = resolve(value.DATA_DIR);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretPath = resolve(dataDir, "auth.secret");
  if (!value.AUTH_SECRET && !existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString("base64url"), { mode: 0o600, flag: "wx" });
  const secret = value.AUTH_SECRET ?? readFileSync(secretPath, "utf8").trim();
  if (secret.length < 32) throw new Error("AUTH_SECRET must have at least 32 characters");
  const trustedProxyIps = value.TRUSTED_PROXY_IPS.split(",").map(v => v.trim()).filter(Boolean);
  if (trustedProxyIps.some(v => !isIP(v))) throw new Error("TRUSTED_PROXY_IPS accepts explicit IP addresses only");
  return { host: value.HOST, port: value.PORT, origin: origin.origin, dataDir, secret, mailUrl: value.MAIL_WEBHOOK_URL, mailToken: value.MAIL_WEBHOOK_TOKEN, trustedProxyIps };
}
