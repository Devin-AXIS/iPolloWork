import { z } from "zod";
import type { AppData } from "./app-data.js";
import type { Auth } from "./auth.js";
import type { Store } from "./database.js";
import { audit } from "./domain.js";
import { ServiceError } from "./errors.js";

const removal = z.object({ userId: z.coerce.string().min(1).max(200) });
const linkedAccount = () => new ServiceError("ACCOUNT_HAS_DEPENDENCIES", 409, "此账号仍关联业务数据，请先转交或处理相关数据，也可以保留账号并停用");

/** Keep Better Auth as the session authority and remove identity data in one service transaction. */
export async function removeAccount(request: Request, auth: Auth, store: Store, origin: string, appData?: AppData): Promise<Response> {
  const actualOrigin = request.headers.get("origin");
  if ((actualOrigin && actualOrigin !== origin) || (!actualOrigin && request.headers.has("cookie")))
    throw new ServiceError("ORIGIN_FORBIDDEN", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.banned) throw new ServiceError("SIGN_IN_REQUIRED", 401);
  if (session.user.role !== "admin") throw new ServiceError("ADMIN_REQUIRED", 403);
  const { userId } = removal.parse(await request.json());
  if (userId === session.user.id) throw new ServiceError("ACCOUNT_REMOVE_SELF", 400, "不能删除当前登录账号");
  try {
    await store.transaction(async () => {
      const user = await store.one<{ email: string; role: string }>('SELECT email,role FROM "user" WHERE id=? FOR UPDATE', userId);
      if (!user) throw new ServiceError("USER_NOT_FOUND", 404, "账号不存在");
      if (user.role === "admin") throw new ServiceError("ACCOUNT_REMOVE_ADMIN", 409, "请先撤销该账号的管理员角色");
      if (await appData?.data.one("SELECT 1 FROM data_apps WHERE (owner_kind='user' AND owner_id=?) OR created_by=? LIMIT 1", userId, userId) ||
          await store.one("SELECT 1 FROM storage_objects WHERE scope='personal' AND owner_id=? AND (state<>'deleted' OR (storage_key LIKE 'oss/%' AND NOT physical_deleted)) LIMIT 1", userId))
        throw linkedAccount();
      await store.run('DELETE FROM session WHERE "userId"=? OR "impersonatedBy"=?', userId, userId);
      await store.run('DELETE FROM account WHERE "userId"=?', userId);
      await store.run('DELETE FROM apikey WHERE "referenceId"=?', userId);
      await store.run("DELETE FROM verification WHERE identifier=? OR value=?", user.email, userId);
      await store.run("DELETE FROM storage_objects WHERE scope='personal' AND owner_id=? AND state='deleted'", userId);
      await store.run("DELETE FROM storage_quotas WHERE scope='personal' AND owner_id=?", userId);
      await store.run("DELETE FROM wallets WHERE user_id=? AND balance=0 AND total_earned=0 AND total_spent=0", userId);
      await store.run('DELETE FROM "user" WHERE id=?', userId);
      await audit(store, { ...session.user, role: "admin" }, "account.permanent-delete", userId);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23503") throw linkedAccount();
    throw error;
  }
  return Response.json({ success: true });
}
