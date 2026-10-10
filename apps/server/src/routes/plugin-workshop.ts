import { pluginWorkshopExportFormatSchema } from "@ipollowork/types/plugins";

import { ApiError } from "../errors.js";
import {
  exportPluginWorkshopProject,
  importPluginWorkshopProject,
  listPluginWorkshopProjects,
  readPluginWorkshopProjectSnapshot,
} from "../plugin-package-lifecycle.js";
import { withMaterializedPluginPackageUpload } from "../plugin-package-upload.js";
import { DEFAULT_ENGINE_ID, type ServerConfig, type TokenScope, type WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;

interface RegisterPluginWorkshopRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  ensureWritable: (config: ServerConfig) => void;
  readPluginPackageUploadBody: (request: Request) => Promise<unknown>;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

export function registerPluginWorkshopRoutes(options: RegisterPluginWorkshopRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    ensureWritable,
    readPluginPackageUploadBody,
    requireClientScope,
    resolveWorkspace,
  } = options;

  addRoute(routes, "GET", "/workspace/:id/plugin-workshop/projects", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ items: await listPluginWorkshopProjects({ workspaceRoot: workspace.path }) });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-workshop/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readPluginPackageUploadBody(ctx.request);
    const overwrite = ctx.url.searchParams.get("overwrite") === "true";
    return withMaterializedPluginPackageUpload(body, "source", async ({ packageRoot }) => jsonResponse(
      await importPluginWorkshopProject({
        workspaceRoot: workspace.path,
        packageRoot,
        engineId: workspace.engineId ?? DEFAULT_ENGINE_ID,
        overwrite,
      }),
      201,
    ));
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-workshop/projects/:pluginId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await readPluginWorkshopProjectSnapshot({
      workspaceRoot: workspace.path,
      directoryId: ctx.params.pluginId ?? "",
    }));
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-workshop/projects/:pluginId/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const format = pluginWorkshopExportFormatSchema.safeParse(ctx.url.searchParams.get("format") ?? "install");
    if (!format.success) {
      throw new ApiError(400, "plugin_workshop_export_format_invalid", "format must be install or source");
    }
    return jsonResponse(await exportPluginWorkshopProject({
      workspaceRoot: workspace.path,
      directoryId: ctx.params.pluginId ?? "",
      format: format.data,
    }));
  });
}
