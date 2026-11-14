import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import { enterpriseAccess, now, requireAdmin, resourceAccess, uid } from "./domain.js";
import { Settings } from "./settings.js";
import { ServiceError } from "./errors.js";

/** OSS stores private bodies; SQLite owns searchable metadata and authorization. */
export function mountResources(app: App,store:Store,settings:Settings,config:Config) {
  app.get("/api/v1/resources",c=>{
    const actor=c.get("actor"),q=(c.req.query("q")??"").slice(0,200),kind=c.req.query("kind")??"skill",enterprise=c.req.query("enterpriseId")??"";
    const items=store.all("SELECT id,title,description,kind,version,visibility,enterprise_id,bytes,created_at FROM resources r WHERE kind=? AND (?='' OR enterprise_id=?) AND instr(lower(title||' '||description),lower(?))>0 AND (owner_id=? OR visibility='public' OR ?='admin' OR (visibility='enterprise' AND EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=r.enterprise_id AND m.user_id=?))) ORDER BY created_at DESC LIMIT 200",kind,enterprise,enterprise,q,actor.id,actor.role,actor.id);
    return c.json({items});
  });
  app.post("/api/v1/resources",async c=>{
    const actor=c.get("actor");
    let uploaded: Buffer | undefined;
    let payload: unknown;
    if(c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form=await c.req.formData(), file=form.get("file"), metadata=form.get("metadata");
      if(!(file instanceof File) || typeof metadata!=="string") throw new ServiceError("INVALID_UPLOAD",400,"请选择文件");
      if(file.size>24*1024*1024) throw new ServiceError("UPLOAD_TOO_LARGE",413);
      uploaded=Buffer.from(await file.arrayBuffer());
      payload=JSON.parse(metadata);
    } else payload=await c.req.json();
    const input=z.object({
      title:z.string().trim().min(1).max(200),description:z.string().max(3000).default(""),
      kind:z.enum(["skill","plugin","attachment"]),version:z.string().max(60).default("1.0.0"),
      visibility:z.enum(["public","enterprise","private"]).default("private"),enterpriseId:z.string().nullable().default(null),
      content:z.string().max(2_000_000).default(""),mime:z.string().max(100).default("text/markdown"),
    }).parse(payload);
    if(input.visibility==="public") requireAdmin(actor);
    if(input.visibility==="enterprise" && !input.enterpriseId) throw new ServiceError("ENTERPRISE_REQUIRED",400);
    if(input.enterpriseId) enterpriseAccess(store,actor,input.enterpriseId,input.visibility==="enterprise");
    const id=uid(),body=uploaded??Buffer.from(input.content,"utf8"),s=settings.get("oss");
    const key=(input.enterpriseId??"personal")+"/"+id;
    let storageKey="local/"+id;
    if(s.bucket) {
      if(!s.region || !s.accessKeyId || !s.accessKeySecret) throw new ServiceError("OSS_NOT_CONFIGURED",503);
      const {default:OSS}=await import("ali-oss");
      const client=new OSS({region:s.region,bucket:s.bucket,accessKeyId:s.accessKeyId,accessKeySecret:s.accessKeySecret,secure:true});
      await client.put(key,body,{headers:{"Content-Type":input.mime,"x-oss-object-acl":"private"}});
      storageKey="oss/"+key;
    } else {
      await mkdir(resolve(config.dataDir,"files"),{recursive:true,mode:0o700});
      await writeFile(resolve(config.dataDir,"files",id),body,{flag:"wx",mode:0o600});
    }
    if(input.enterpriseId) enterpriseAccess(store,actor,input.enterpriseId,input.visibility==="enterprise");
    store.run("INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",id,actor.id,input.enterpriseId,input.kind,input.visibility,input.title,input.description,input.version,storageKey,input.mime,body.length,createHash("sha256").update(body).digest("hex"),now());
    return c.json({id},201);
  });
  app.get("/api/v1/resources/:id/download",async c=>{
    const resource=resourceAccess(store,c.get("actor"),c.req.param("id"));
    if(resource.storage_key.startsWith("oss/")) {
      const s=settings.get("oss"),{default:OSS}=await import("ali-oss");
      const client=new OSS({region:s.region,bucket:s.bucket,accessKeyId:s.accessKeyId,accessKeySecret:s.accessKeySecret,secure:true});
      return c.json({url:client.signatureUrl(resource.storage_key.slice(4),{expires:60,response:{"content-disposition":"attachment"}})});
    }
    if(!/^local\/[a-f0-9-]{36}$/.test(resource.storage_key)) throw new ServiceError("INVALID_STORAGE_KEY",409);
    const content=await readFile(resolve(config.dataDir,"files",resource.storage_key.slice(6)));
    c.header("Content-Type","application/octet-stream");
    c.header("Content-Disposition",'attachment; filename="'+resource.id+'.txt"');
    c.header("Cache-Control","private, no-store");
    return c.body(content);
  });
  app.get("/api/v1/resources/:id/content",async c=>{
    const resource=resourceAccess(store,c.get("actor"),c.req.param("id"));
    if(resource.kind!=="skill") throw new ServiceError("NOT_A_SKILL",400);
    let content:Buffer;
    if(resource.storage_key.startsWith("oss/")) {
      const s=settings.get("oss"),{default:OSS}=await import("ali-oss");
      const client=new OSS({region:s.region,bucket:s.bucket,accessKeyId:s.accessKeyId,accessKeySecret:s.accessKeySecret,secure:true});
      content=(await client.get(resource.storage_key.slice(4))).content as Buffer;
    } else {
      if(!/^local\/[a-f0-9-]{36}$/.test(resource.storage_key)) throw new ServiceError("INVALID_STORAGE_KEY",409);
      content=await readFile(resolve(config.dataDir,"files",resource.storage_key.slice(6)));
    }
    return c.json({id:resource.id,content:content.toString("utf8")});
  });
}
