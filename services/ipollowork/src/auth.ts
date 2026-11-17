import { betterAuth } from "better-auth";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { admin, bearer } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { getMigrations } from "better-auth/db/migration";
import type { Config } from "./config.js";
import type { Store } from "./database.js";
import { ServiceError } from "./errors.js";

/** Authentication is owned by Better Auth, with no dependency on Cloud. */
export async function createAuth(config: Config, store: Store) {
  const resetDelivery = new AsyncLocalStorage<{ failed: boolean }>();
  const deliver = async (to: string, template: string, url: string) => {
    if (!config.mailUrl || !config.mailToken)
      throw new ServiceError("MAIL_NOT_CONFIGURED", 503, "邮件服务尚未配置");
    const result = await fetch(config.mailUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.mailToken,
      },
      body: JSON.stringify({ to, template, url }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok)
      throw new ServiceError("MAIL_DELIVERY_FAILED", 503, "邮件发送失败");
  };
  const auth = betterAuth({
    appName: "iPolloWork",
    baseURL: config.origin,
    secret: config.secret,
    database: store.db,
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        try {
          await deliver(user.email, "reset-password", url);
        } catch {
          const delivery = resetDelivery.getStore();
          if (delivery) delivery.failed = true;
          console.warn("password reset email delivery failed");
        }
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        await deliver(user.email, "verify-email", url),
    },
    plugins: [bearer(), admin({ defaultRole: "user", adminRoles: ["admin"] }), apiKey({
      defaultPrefix: "ipw_", requireName: true, enableSessionForAPIKeys: false,
      rateLimit: { enabled: false }, permissions: { defaultPermissions: { capabilities: ["read", "invoke"] } },
    })],
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: config.origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["x-ipollo-peer-ip"] },
    },
    session: { expiresIn: 60 * 60 * 24 * 30 },
  });
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  return {
    ...auth,
    async handler(request: Request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/auth/request-password-reset")
        return auth.handler(request);
      if (!config.mailUrl || !config.mailToken)
        return Response.json({ code: "MAIL_NOT_CONFIGURED", message: "Password reset email is unavailable" }, { status: 503 });
      const delivery = { failed: false };
      const response = await resetDelivery.run(delivery, () => auth.handler(request));
      if (!delivery.failed) return response;
      await response.body?.cancel();
      return Response.json({ code: "MAIL_DELIVERY_FAILED", message: "Password reset email is temporarily unavailable" }, { status: 503 });
    },
  };
}
export type Auth = Awaited<ReturnType<typeof createAuth>>;
export interface Actor {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified?: boolean;
}
