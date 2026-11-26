import type { Store } from "./database.js";
import type { DeletionJobs } from "./deletion-jobs.js";
import { audit, canDeleteProject, projectAccess } from "./domain.js";
import { ServiceError } from "./errors.js";
import type { App } from "./http.js";
import type { Storage } from "./storage.js";
import type { AppData } from "./app-data.js";

export function mountProjectDeletion(app: App, store: Store, storage: Storage, jobs: DeletionJobs, appData?: AppData): void {
  app.delete("/api/v1/projects/:id/permanent", async c => {
    const id = c.req.param("id"), actor = c.get("actor");
    const job = await store.transaction(async () => {
      await jobs.lock("project", id);
      const existing = await jobs.existing("project", id, actor);
      if (existing) return existing;
      const project = await projectAccess(store, actor, id, true);
      if (!await canDeleteProject(store, actor, project))
        throw new ServiceError("PROJECT_FORBIDDEN", 403, "没有删除项目的权限");
      if (await store.one("SELECT 1 FROM cloud_runtime_leases WHERE project_id=? AND expires_at>?", id, Date.now()))
        throw new ServiceError("PROJECT_RUNTIME_ACTIVE", 409, "请先关闭正在运行的云端工作区");
      if (await store.one("SELECT 1 FROM storage_objects WHERE project_id=? AND state='reserved'", id))
        throw new ServiceError("PROJECT_UPLOAD_ACTIVE", 409, "请等待项目文件上传结束后重试");

      const objects = await store.all<{ storage_key: string }>(
        `SELECT storage_key FROM storage_objects WHERE project_id=?
         UNION SELECT storage_key FROM project_memory_versions WHERE project_id=?
         UNION SELECT f.storage_key FROM publication_files f JOIN publications p ON p.id=f.publication_id
           WHERE p.project_id=? AND f.storage_key IS NOT NULL`, id, id, id,
      );
      const keys = objects.map(row => row.storage_key);
      // Remember candidate identities before removing the project's last artifact references.
      const resources = await store.all<{ id: string }>(
        `SELECT r.id FROM resources r WHERE r.kind='attachment' AND
         (r.storage_key=ANY(?::text[]) OR EXISTS (SELECT 1 FROM project_artifacts a WHERE a.project_id=? AND a.resource_id=r.id))
         ORDER BY r.id FOR UPDATE OF r`, keys, id,
      );
      await store.run("DELETE FROM project_artifacts WHERE project_id=?", id);
      await store.run("DELETE FROM project_memory_versions WHERE project_id=?", id);
      await store.run("DELETE FROM project_changes WHERE project_id=?", id);
      await store.run("DELETE FROM work_revisions WHERE work_id IN (SELECT id FROM project_work WHERE project_id=?)", id);
      await store.run("UPDATE project_work SET source_work_id=NULL WHERE project_id<>? AND source_work_id IN (SELECT id FROM project_work WHERE project_id=?)", id, id);
      await store.run("DELETE FROM project_work WHERE project_id=?", id);
      await store.run("DELETE FROM shares WHERE project_id=?", id);
      await store.run("DELETE FROM enterprise_activity WHERE project_id=?", id);
      await store.run("DELETE FROM publication_files WHERE publication_id IN (SELECT id FROM publications WHERE project_id=?)", id);
      await store.run("DELETE FROM publications WHERE project_id=?", id);
      const removed = await store.all<{ storage_key: string }>(
        `DELETE FROM resources r WHERE r.id=ANY(?::text[])
         AND NOT EXISTS (SELECT 1 FROM package_files f WHERE f.resource_id=r.id)
         AND NOT EXISTS (SELECT 1 FROM project_artifacts a WHERE a.resource_id=r.id)
         AND NOT EXISTS (SELECT 1 FROM projects p CROSS JOIN LATERAL jsonb_array_elements(p.files::jsonb) f
                         WHERE p.id<>? AND f->>'resourceId'=r.id)
         AND NOT EXISTS (SELECT 1 FROM project_changes p CROSS JOIN LATERAL jsonb_array_elements(p.content::jsonb->'files') f
                         WHERE p.kind='files' AND p.status<>'withdrawn' AND f->>'resourceId'=r.id)
         RETURNING r.storage_key`, resources.map(row => row.id), id,
      );
      const candidates = [...new Set([...keys, ...removed.map(row => row.storage_key)])];
      const cleanup = await store.all<{ storage_key: string }>(
        `SELECT storage_key FROM storage_objects o WHERE storage_key=ANY(?::text[])
         AND (o.project_id IS NULL OR o.project_id=?)
         AND NOT EXISTS (SELECT 1 FROM resources r WHERE r.storage_key=o.storage_key)
         AND NOT EXISTS (SELECT 1 FROM publication_files f WHERE f.storage_key=o.storage_key)
         AND NOT EXISTS (SELECT 1 FROM project_memory_versions m WHERE m.storage_key=o.storage_key)
         AND NOT EXISTS (SELECT 1 FROM app_data_files f WHERE f.storage_key=o.storage_key)`, candidates, id,
      );
      const cleanupKeys = cleanup.map(row => row.storage_key);
      await storage.markForRemoval(cleanupKeys);
      if (appData) {
        const apps = await appData.data.all<{ id: string }>("SELECT id FROM data_apps WHERE project_id=? ORDER BY id", id);
        await jobs.attachProjectApps(id, apps.map(row => row.id), actor);
      }
      await store.run("UPDATE storage_objects SET project_id=NULL WHERE project_id=?", id);
      await store.run("DELETE FROM projects WHERE id=?", id);
      await audit(store, actor, "project.permanent-delete", id, project.enterprise_id);
      return jobs.enqueue("project", id, actor, cleanupKeys);
    });
    const result = await jobs.receipt(job);
    return c.json({ ok: result.status === "completed", ...result }, result.status === "completed" ? 200 : 202);
  });
}
