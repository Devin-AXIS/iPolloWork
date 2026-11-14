/** Scoped external access uses Better Auth's hashed API keys, never provider credentials. */
import { z } from "zod";
import { APIError } from "better-auth/api";
import type { Actor, Auth } from "./auth.js";
import type { Store, Row } from "./database.js";
import type { App } from "./http.js";
import { ServiceError } from "./errors.js";

const createSchema = z.object({ name: z.string().trim().min(1).max(100), expiresIn: z.number().int().min(60).max(31536000).optional() }).strict();
interface UserRow extends Row { id: string; name: string; email: string; emailVerified: boolean; banned: boolean | null }
/** Convert the authentication provider's expected key-management failures without exposing its payload. */
async function manage<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (cause) {
    if (!(cause instanceof APIError)) throw cause;
    const status = cause.statusCode === 401 || cause.statusCode === 403 || cause.statusCode === 404 || cause.statusCode === 429 ? cause.statusCode : 400;
    throw new ServiceError("API_KEY_MANAGEMENT_FAILED", status, "无法管理该访问 Key，请确认权限和有效期", { cause });
  }
}
/** Verify an external key only on capability APIs and recheck its owner's current account status.
 * @param auth Authentication provider owning hashed API keys.
 * @param store Current account records.
 * @param headers Incoming credential headers.
 * @param path Requested application path.
 * @param method Requested HTTP method.
 * @returns The current unprivileged owner, or undefined when no external key was supplied.
 */
export async function authenticateCapabilityKey(auth: Auth, store: Store, headers: Headers, path: string, method: string): Promise<Actor | undefined> {
  const authorization = headers.get("authorization");
  const key = headers.get("x-api-key") ?? (authorization?.startsWith("Bearer ipw_") ? authorization.slice(7) : undefined);
  if (!key) return undefined;
  if (!/^\/api\/v1\/(capabilities(?:\/[^/]+(?:\/invoke)?)?|capability-tasks\/[^/]+)$/.test(path)) throw new ServiceError("API_KEY_SCOPE_FORBIDDEN", 403);
  if (!['GET', 'POST'].includes(method)) throw new ServiceError("API_KEY_SCOPE_FORBIDDEN", 403);
  const check = await auth.api.verifyApiKey({ body: { key, permissions: { capabilities: [method === "GET" ? "read" : "invoke"] } } });
  if (!check.valid || !check.key) throw new ServiceError("API_KEY_INVALID", 401, "访问 Key 无效、已撤销或已过期");
  const user = await store.one<UserRow>('SELECT id,name,email,"emailVerified",banned FROM "user" WHERE id=?', check.key.referenceId);
  if (!user || user.banned) throw new ServiceError("API_KEY_INVALID", 401);
  return { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: "user" };
}
/** Session-authenticated owners create, list and revoke keys; the plaintext is returned only at creation.
 * @param app Authenticated account router.
 * @param auth Authentication provider owning key lifecycle.
 */
export function mountAccessKeys(app: App, auth: Auth) {
  app.get("/api/v1/access-keys", async c => {
    const keys = await manage(() => auth.api.listApiKeys({ headers: c.req.raw.headers }));
    return c.json({ items: keys.apiKeys.map(key => ({ id: key.id, name: key.name, start: key.start, enabled: key.enabled, createdAt: key.createdAt, expiresAt: key.expiresAt, lastRequest: key.lastRequest })) });
  });
  app.post("/api/v1/access-keys", async c => {
    const input = createSchema.parse(await c.req.json());
    const key = await manage(() => auth.api.createApiKey({ body: { ...input, userId: c.get("actor").id, permissions: { capabilities: ["read", "invoke"] }, rateLimitEnabled: false } }));
    return c.json({ id: key.id, name: key.name, key: key.key, expiresAt: key.expiresAt }, 201);
  });
  app.delete("/api/v1/access-keys/:id", async c => {
    await manage(() => auth.api.deleteApiKey({ headers: c.req.raw.headers, body: { keyId: c.req.param("id") } }));
    return c.json({ ok: true });
  });
}
