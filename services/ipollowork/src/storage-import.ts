/** Adopt existing file references without moving objects or expiring pre-migration data. */
import type { Config } from "./config.js";
import type { Store } from "./database.js";

/** Existing files remain permanent; newly uploaded personal outputs follow the retention policy.
 * @param store Transaction holding the migration or import.
 * @param config Initial per-owner storage limits.
 */
export async function adoptStoredResources(
  store: Store,
  config: Config,
): Promise<void> {
  if (!store.inTransaction)
    throw new Error("Storage import requires a transaction");
  await store.run(
    `INSERT INTO storage_quotas(scope,owner_id,limit_bytes)
    SELECT DISTINCT CASE WHEN enterprise_id IS NULL THEN 'personal' ELSE 'organization' END,
      COALESCE(enterprise_id,owner_id),CASE WHEN enterprise_id IS NULL THEN ?::bigint ELSE ?::bigint END
    FROM resources ON CONFLICT DO NOTHING`,
    config.personalStorageGiB * 1024 ** 3,
    config.organizationStorageGiB * 1024 ** 3,
  );
  await store.run(`WITH added AS (
    INSERT INTO storage_objects(id,scope,owner_id,storage_key,bytes,state,charged,created_at,attached)
    SELECT DISTINCT ON(r.storage_key) r.id,CASE WHEN r.enterprise_id IS NULL THEN 'personal' ELSE 'organization' END,
      COALESCE(r.enterprise_id,r.owner_id),r.storage_key,r.bytes,'ready',true,r.created_at,true
    FROM resources r WHERE NOT EXISTS(SELECT 1 FROM storage_objects o WHERE o.storage_key=r.storage_key)
    ORDER BY r.storage_key,r.created_at,r.id ON CONFLICT DO NOTHING RETURNING scope,owner_id,bytes
  ), totals AS (SELECT scope,owner_id,SUM(bytes) AS bytes FROM added GROUP BY scope,owner_id)
  UPDATE storage_quotas q SET used_bytes=q.used_bytes+t.bytes FROM totals t
  WHERE q.scope=t.scope AND q.owner_id=t.owner_id`);
}
