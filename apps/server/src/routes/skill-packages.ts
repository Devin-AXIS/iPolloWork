import { z } from "zod";
import { MAX_SKILL_PACKAGE_BYTES, enterpriseSkillContextSchema, enterpriseSkillInstallSchema, skillPackageExportSchema } from "@ipollowork/types/skills";
import { exportStandaloneSkill, importStandaloneSkill, installEnterpriseSkill, listEnterpriseSkills, listStandaloneSkillPackages, prepareEnterpriseSkills, readEnterpriseSkill, setEnterpriseSkillContext, updateEnterpriseSkill } from "../skill-packages.js";
import { readLimitedRequestBody } from "../limited-request-body.js";
import { recordAudit } from "../audit.js";
import { shortId } from "../utils.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type Options = {
  routes: Route[]; config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
};

export function registerSkillPackageRoutes(options: Options) {
  const { routes, config, resolveWorkspace, readJsonBody, ensureWritable, requireClientScope } = options;
  const writable = async (ctx: RequestContext) => { ensureWritable(config); requireClientScope(ctx, "collaborator"); return resolveWorkspace(config, ctx.params.id); };
  const changed = async (ctx: RequestContext, workspace: WorkspaceInfo, action: string, target: string) => {
    await recordAudit(workspace.path, { id: shortId(), workspaceId: workspace.id, actor: ctx.actor ?? { type: "remote" }, action, target, summary: action, timestamp: Date.now() });
    ctx.reloadEvents.recordDebounced(workspace.id, "skills", { type: "skill", name: target, action: "updated" });
  };
  addRoute(routes, "GET", "/workspace/:id/skill-packages", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return Response.json({ personal: await listStandaloneSkillPackages(config, workspace), enterprise: await listEnterpriseSkills(config, workspace) });
  });
  addRoute(routes, "PUT", "/workspace/:id/skill-packages/context", "client", async (ctx) => {
    const workspace = await writable(ctx); const input = z.object({ context: enterpriseSkillContextSchema.nullable() }).parse(await readJsonBody(ctx.request));
    await setEnterpriseSkillContext(config, workspace, input.context); return Response.json({ ok: true });
  });
  addRoute(routes, "POST", "/workspace/:id/skill-packages/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id); const result = await exportStandaloneSkill(config, workspace, skillPackageExportSchema.parse(await readJsonBody(ctx.request)));
    return new Response(new Uint8Array(result.archive), { headers: { "Content-Type": "application/vnd.ipollowork.skill+zip", "Content-Disposition": `attachment; filename="${result.filename}"` } });
  });
  addRoute(routes, "POST", "/workspace/:id/skill-packages/import", "client", async (ctx) => {
    const workspace = await writable(ctx);
    const bytes = Buffer.from(await readLimitedRequestBody(ctx.request, MAX_SKILL_PACKAGE_BYTES));
    const source = z.object({ origin: z.string().min(1).max(2048), resourceId: z.string().min(1).max(128), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).parse({ origin: ctx.request.headers.get("x-ipollowork-skill-origin"), resourceId: ctx.request.headers.get("x-ipollowork-skill-id"), digest: ctx.request.headers.get("x-ipollowork-skill-digest") });
    const item = await importStandaloneSkill(config, workspace, bytes, source); await changed(ctx, workspace, "skills.import", item.name); return Response.json(item);
  });
  addRoute(routes, "POST", "/workspace/:id/skill-packages/enterprise", "client", async (ctx) => {
    const workspace = await writable(ctx); const item = await installEnterpriseSkill(config, workspace, enterpriseSkillInstallSchema.parse(await readJsonBody(ctx.request)));
    await prepareEnterpriseSkills(config, workspace); await changed(ctx, workspace, "skills.enterprise.install", item.resourceId); return Response.json({ item });
  });
  addRoute(routes, "GET", "/workspace/:id/skill-packages/enterprise/:resourceId", "client", async (ctx) => Response.json(await readEnterpriseSkill(config, await resolveWorkspace(config, ctx.params.id), ctx.params.resourceId)));
  for (const method of ["PATCH", "DELETE"]) addRoute(routes, method, "/workspace/:id/skill-packages/enterprise/:resourceId", "client", async (ctx) => {
    const workspace = await writable(ctx); const enabled = method === "DELETE" ? null : z.object({ enabled: z.boolean() }).parse(await readJsonBody(ctx.request)).enabled;
    await updateEnterpriseSkill(config, workspace, ctx.params.resourceId, enabled); await prepareEnterpriseSkills(config, workspace);
    await changed(ctx, workspace, enabled === null ? "skills.enterprise.uninstall" : enabled ? "skills.enterprise.enable" : "skills.enterprise.disable", ctx.params.resourceId); return Response.json({ ok: true });
  });
}
