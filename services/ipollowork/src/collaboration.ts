/** Historical work and revision reads alongside the current project directory. */
import { projectListings } from "./project-space.js";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store, Row } from "./database.js";
import type { Actor } from "./auth.js";
import { projectAccess, shareAccess } from "./domain.js";
import { ServiceError } from "./errors.js";

type Work = Row & { id:string; project_id:string; source_share_id:string; owner_id:string; native_session_id:string; native_workspace_id:string; version:number };
const selection = `SELECT w.*,p.title AS project_title,p.enterprise_id,e.name AS enterprise_name,u.name AS owner_name,
 COALESCE(r.version,0) AS version,r.title AS result_title,r.created_at AS published_at
 FROM project_work w JOIN projects p ON p.id=w.project_id JOIN shares s ON s.id=w.source_share_id
 JOIN "user" u ON u.id=w.owner_id LEFT JOIN enterprises e ON e.id=p.enterprise_id
 LEFT JOIN work_revisions r ON r.work_id=w.id AND r.version=(SELECT MAX(v.version) FROM work_revisions v WHERE v.work_id=w.id)`;
const visible = `(?='admin' OR p.owner_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=?))
 AND (?='admin' OR w.owner_id=? OR r.version IS NOT NULL OR (s.revoked_at IS NULL AND
 (s.owner_id=? OR s.visibility='enterprise' OR EXISTS(SELECT 1 FROM share_members sm WHERE sm.share_id=s.id AND sm.user_id=?))))`;
function list(store:Store,actor:Actor,projectId?:string) {
  const allowed=new Set(projectListings(store,actor).map(p=>p.id));
  return store.all<Work>(selection+" WHERE "+visible+(projectId?" AND w.project_id=?":"")+" ORDER BY w.updated_at DESC,w.id LIMIT 200",
    actor.role,actor.id,actor.id,actor.role,actor.id,actor.id,actor.id,...(projectId?[projectId]:[])).filter(work=>allowed.has(work.project_id));
}
function access(store:Store,actor:Actor,id:string):Work {
  const work=store.one<Work>(selection+" WHERE w.id=?",id);
  if(!work) throw new ServiceError("WORK_NOT_FOUND",404,"这项工作不存在");
  projectAccess(store,actor,work.project_id);
  if(work.owner_id!==actor.id && actor.role!=="admin" && !work.version) shareAccess(store,actor,work.source_share_id);
  return work;
}
function view(work:Work,actor:Actor) {
  const {native_session_id,native_workspace_id,...publicFields}=work;
  return {...publicFields,canPublish:work.owner_id===actor.id||Number(work.version)>0||actor.role==="admin",
    ...(work.owner_id===actor.id?{native_session_id,native_workspace_id}:{})};
}

/** Mount authorized historical reads and reject retired work mutations. */
export function mountCollaboration(app:App,store:Store) {
  app.get("/api/v1/work",c=>c.json({items:list(store,c.get("actor")).map(w=>view(w,c.get("actor")))}));
  app.get("/api/v1/collaboration/projects",c=>{
    const actor=c.get("actor");
    return c.json({items:projectListings(store,actor)});
  });
  app.get("/api/v1/projects/:id/collaboration",c=>{
    const actor=c.get("actor"),project=projectAccess(store,actor,c.req.param("id"));
    const works=list(store,actor,String(project.id));
    const updates=store.all(`SELECT r.id,r.work_id,r.version,r.title,r.created_at,u.name AS author_name FROM work_revisions r
      JOIN project_work w ON w.id=r.work_id JOIN "user" u ON u.id=r.author_id
      WHERE w.project_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,project.id);
    return c.json({project:{id:project.id,title:project.title,enterpriseId:project.enterprise_id},works:works.map(w=>view(w,actor)),updates});
  });
  app.post("/api/v1/work", () => { throw new ServiceError("PROJECT_SPACE_REQUIRED",410); });
  app.get("/api/v1/work/:id",c=>{
    const actor=c.get("actor"),work=access(store,actor,c.req.param("id"));
    const latest=store.one("SELECT content FROM work_revisions WHERE work_id=? ORDER BY version DESC LIMIT 1",work.id);
    const versions=store.all(`SELECT r.id,r.work_id,r.version,r.title,r.created_at,u.name AS author_name FROM work_revisions r
      JOIN "user" u ON u.id=r.author_id WHERE work_id=? ORDER BY version DESC LIMIT 50`,work.id);
    return c.json({work:view(work,actor),content:latest?.content??"",versions});
  });
  app.get("/api/v1/work/:id/revisions/:version",c=>{
    const work=access(store,c.get("actor"),c.req.param("id"));
    const version=z.coerce.number().int().positive().parse(c.req.param("version"));
    const result=store.one("SELECT title,content,version,created_at FROM work_revisions WHERE work_id=? AND version=?",work.id,version);
    if(!result)throw new ServiceError("WORK_VERSION_NOT_FOUND",404);
    return c.json(result);
  });
  app.post("/api/v1/work/:id/revisions", () => { throw new ServiceError("PROJECT_SPACE_REQUIRED",410); });
}
