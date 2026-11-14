import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import type { Config } from "./config.js";
import type { Store } from "./database.js";
import { ServiceError } from "./errors.js";

/** Authentication is owned by Better Auth, with no dependency on Cloud. */
export async function createAuth(config: Config, store: Store) {
  const deliver = async (to: string, template: string, url: string) => {
    if (!config.mailUrl || !config.mailToken) throw new ServiceError("MAIL_NOT_CONFIGURED", 503, "邮件服务尚未配置");
    const result = await fetch(config.mailUrl, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.mailToken },
      body: JSON.stringify({ to, template, url }), signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new ServiceError("MAIL_DELIVERY_FAILED", 503, "邮件发送失败");
  };
  const auth = betterAuth({
    appName: "iPolloWork", baseURL: config.origin, secret: config.secret,
    database: store.db, trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true, minPasswordLength: 10,
      sendResetPassword: ({ user, url }) => deliver(user.email, "reset-password", url),
    },
    emailVerification: { sendVerificationEmail: ({ user, url }) => deliver(user.email, "verify-email", url) },
    plugins: [bearer(), admin({ defaultRole: "user", adminRoles: ["admin"] })],
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    advanced: { database: { generateId: "uuid" }, useSecureCookies: config.origin.startsWith("https:"), ipAddress: { ipAddressHeaders: ["x-ipollo-peer-ip"] } },
    session: { expiresIn: 60 * 60 * 24 * 30 },
  });
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  return auth;
}
export type Auth = Awaited<ReturnType<typeof createAuth>>;
export interface Actor { id: string; name: string; email: string; role: string; emailVerified?: boolean }
