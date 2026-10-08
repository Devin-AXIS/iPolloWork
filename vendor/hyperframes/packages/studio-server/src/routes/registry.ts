import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { StudioApiAdapter } from "../types.js";
import { readFileSync, writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { toJSON, fromJSON, componentContentSchema, componentContentGuide, isComponentContentModel, type ComponentContentModel, type ComponentVariableValues } from "@hyperframes/core/registry";
import { resolveWithinProject } from "../helpers/safePath.js";
import { fileContentVersion, recordFileWriteReceipt, createWriteToken } from "../helpers/fileVersion.js";
import { snapshotBeforeWrite, backupPathForResponse } from "../helpers/backupJournal.js";
import { patchElementInHtml } from "../helpers/sourceMutation.js";
import { COMPONENT_PACK_MAX_BYTES, importComponentPack, installLibraryComponent, listLibraryComponents, parseComponentPack } from "../helpers/componentLibrary.js";
import { loadRegistryPreviewAssetFromRoot, loadRegistryPreviewFromRoot } from "../helpers/registryPreview.js";

interface RegistryPreviewOptions {
  assetBaseUrl: string;
  autoplay: boolean;
  duration: number;
  focus?: { x: number; y: number; zoom: number };
  runtimeUrl?: string;
  seekTime: number;
  width: number;
  height: number;
}

function finitePreviewNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function promoteStandaloneRegistryTemplate(html: string): string {
  const opening = /<template\b[^>]*>/i.exec(html);
  if (!opening || opening.index == null) return html;
  const contentStart = opening.index + opening[0].length;
  const closingIndex = html.indexOf("</template>", contentStart);
  if (closingIndex < 0) return html;

  const outsideTemplate = `${html.slice(0, opening.index)}${html.slice(closingIndex + 11)}`;
  if (/\bdata-composition-id\s*=/i.test(outsideTemplate)) return html;
  return `${html.slice(0, opening.index)}${html.slice(contentStart, closingIndex)}${html.slice(
    closingIndex + 11,
  )}`;
}

function loadGsapForRegistryPreview(html: string): string {
  const usesGsap = /\b(?:window\.)?gsap\.(?:timeline|to|from|fromTo|set|registerPlugin)\b/.test(html);
  const hasGsap = /<script\b[^>]*\bsrc=["'][^"']*gsap[^"']*\.js/i.test(html)
    || /\b(?:GreenSock|_gsScope)\b/.test(html);
  if (!usesGsap || hasGsap) return html;
  const script = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>';
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${script}</head>`)
    : `${script}${html}`;
}

function loadHyperframesRuntimeForRegistryPreview(html: string, runtimeUrl?: string): string {
  if (!runtimeUrl || !/\bwindow\.__hyperframes\b/.test(html)
    || /<script\b[^>]*\bsrc=["'][^"']*(?:hyperframe\.runtime|\/api\/runtime\.js)/i.test(html)) return html;
  const script = `<script src="${runtimeUrl}"></script>`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${script}</head>`)
    : `${script}${html}`;
}

export function buildRegistryPreviewHtml(
  html: string,
  { assetBaseUrl, autoplay, duration, focus, runtimeUrl, seekTime, width, height }: RegistryPreviewOptions,
): string {
  const safeDuration = Math.max(0.1, duration);
  const safeSeekTime = Math.max(0, Math.min(seekTime, safeDuration));
  const safeFocus =
    focus &&
    Number.isFinite(focus.x) &&
    Number.isFinite(focus.y) &&
    Number.isFinite(focus.zoom) &&
    focus.zoom > 0
      ? {
          x: Math.max(0, Math.min(1, focus.x)),
          y: Math.max(0, Math.min(1, focus.y)),
          zoom: Math.max(1, Math.min(4, focus.zoom)),
        }
      : null;
  const previewScript = `<script data-hf-registry-preview>
(() => {
  const autoplay = ${JSON.stringify(autoplay)};
  const duration = ${JSON.stringify(safeDuration)};
  const seekTime = ${JSON.stringify(safeSeekTime)};
  const sourceWidth = ${JSON.stringify(Math.max(1, width))};
  const sourceHeight = ${JSON.stringify(Math.max(1, height))};
  const previewFocus = ${JSON.stringify(safeFocus)};
  let animationFrame = 0;

  const fitComposition = () => {
    const baseScale = Math.min(window.innerWidth / sourceWidth, window.innerHeight / sourceHeight);
    const scale = previewFocus ? baseScale * previewFocus.zoom : baseScale;
    const focusX = sourceWidth * (previewFocus ? previewFocus.x : 0.5);
    const focusY = sourceHeight * (previewFocus ? previewFocus.y : 0.5);
    const offsetX = previewFocus
      ? window.innerWidth / 2 - focusX * scale
      : (window.innerWidth - sourceWidth * scale) / 2;
    const offsetY = previewFocus
      ? window.innerHeight / 2 - focusY * scale
      : (window.innerHeight - sourceHeight * scale) / 2;
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";
    document.body.style.width = sourceWidth + "px";
    document.body.style.height = sourceHeight + "px";
    document.body.style.margin = "0";
    document.body.style.transformOrigin = "top left";
    document.body.style.transform =
      "translate(" + offsetX + "px, " + offsetY + "px) scale(" + scale + ")";
  };

  const seek = (time) => {
    window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time } }));
    for (const timeline of Object.values(window.__timelines || {})) {
      if (timeline && typeof timeline.seek === "function") timeline.seek(time);
    }
  };

  const start = () => {
    fitComposition();
    if (!autoplay) {
      seek(seekTime);
      return;
    }
    const timelineDurations = Object.values(window.__timelines || {})
      .map((timeline) => {
        if (timeline && typeof timeline.totalDuration === "function") {
          return timeline.totalDuration();
        }
        return timeline && typeof timeline.duration === "function" ? timeline.duration() : 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0);
    const motionDuration = timelineDurations.length ? Math.max(...timelineDurations) : duration;
    const previewDuration = Math.min(duration, Math.max(1.25, motionDuration + 0.45));
    const startedAt = performance.now();
    const tick = (now) => {
      seek(((now - startedAt) / 1000) % previewDuration);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  };

  window.addEventListener("resize", fitComposition);
  window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else start();
})();
</script>`;

  const baseTag = `<base href="${assetBaseUrl}">`;
  const previewHtml = loadHyperframesRuntimeForRegistryPreview(
    loadGsapForRegistryPreview(promoteStandaloneRegistryTemplate(html)),
    runtimeUrl,
  );
  const htmlWithBase = /<head(?:\s[^>]*)?>/i.test(previewHtml)
    ? previewHtml.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${baseTag}`)
    : `${baseTag}${previewHtml}`;
  return /<\/body>/i.test(htmlWithBase)
    ? htmlWithBase.replace(/<\/body>/i, `${previewScript}</body>`)
    : `${htmlWithBase}${previewScript}`;
}

export function registerRegistryRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.use("/projects/:id/components/:elementId", bodyLimit({ maxSize: 64 * 1024 }));
  // One read and one atomic write, consumed by Studio's native AI tools.
  for (const method of ["GET", "PATCH"] as const) api.on(method, "/projects/:id/components/:elementId", async c => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const sourceFile = c.req.query("sourceFile") ?? "index.html";
    const path = resolveWithinProject(project.dir, sourceFile);
    if (!path || !/\.html?$/i.test(sourceFile)) return c.json({ error: "Invalid composition path" }, 400);
    let source: string;
    try { source = readFileSync(path, "utf8"); } catch { return c.json({ error: "not found" }, 404); }
    const { document } = parseHTML(source), elementId = c.req.param("elementId");
    const matches = [...document.querySelectorAll("[id]")].filter(node => node.id === elementId);
    const host = matches[0];
    if (!host || matches.length !== 1) return c.json({ error: "Select one unique installed component id" }, 404);
    const compositionSrc = host.getAttribute("data-composition-src");
    const installedPath = compositionSrc && resolveWithinProject(project.dir, compositionSrc);
    if (!installedPath) return c.json({ error: "Invalid installed component path" }, 400);
    let model: ComponentContentModel;
    try {
      const installed = parseHTML(readFileSync(installedPath, "utf8")).document;
      const content = installed.querySelector("template")?.content ?? installed;
      const embedded: unknown = JSON.parse(content.querySelector("[data-component-content-model]")?.getAttribute("data-component-content-model") ?? "null");
      if (!isComponentContentModel(embedded)) return c.json({ error: "This installed component has no structured content contract; install its current template to use JSON editing" }, 422);
      const defaults = { ...embedded.defaults };
      const declaration: unknown = JSON.parse(installed.querySelector("[data-composition-variables]")?.getAttribute("data-composition-variables") ?? "[]");
      if (Array.isArray(declaration)) for (const variable of declaration) {
        if (variable && typeof variable === "object" && "id" in variable && "default" in variable && typeof variable.id === "string"
          && (typeof variable.default === "string" || typeof variable.default === "boolean" || typeof variable.default === "number" && Number.isFinite(variable.default))) defaults[variable.id] = variable.default;
      }
      model = { ...embedded, defaults, duration: Number(host.getAttribute("data-source-duration") ?? embedded.duration) };
    } catch { return c.json({ error: "Installed component declarations are invalid" }, 422); }
    const defaults = model.defaults;
    let raw: unknown;
    try { raw = JSON.parse(host.getAttribute("data-variable-values") ?? "{}"); } catch { return c.json({ error: "Invalid current variables" }, 422); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return c.json({ error: "Invalid current variables" }, 422);
    const current: ComponentVariableValues = { ...defaults };
    for (const [id, value] of Object.entries(raw)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") current[id] = value;
    const revision = fileContentVersion(source);
    if (method === "GET") {
      try { return c.json({ elementId, sourceFile, componentId: model.type, revision, data: toJSON(model, current), schema: componentContentSchema(model), guide: componentContentGuide(model), example: toJSON(model, defaults) }); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : "Invalid current data" }, 422); }
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("revision" in body) || !("data" in body) || typeof body.revision !== "string") return c.json({ error: "Pass the revision from read and one data object" }, 400);
    if (body.revision !== revision) return c.json({ error: "Component changed; read current data before retrying", revision }, 409);
    const result = fromJSON(model, body.data, current);
    if (result.errors.length) return c.json({ error: "Invalid component data", issues: result.errors }, 422);
    if (!adapter.generateThumbnail) return c.json({ error: "Component layout validation is unavailable" }, 503);
    const preview = new URL(`/api/projects/${encodeURIComponent(project.id)}/preview${sourceFile === "index.html" ? "" : `/comp/${sourceFile.split("/").map(encodeURIComponent).join("/")}`}`, c.req.url);
    let review;
    try {
      review = await adapter.generateThumbnail({ project, compPath: sourceFile, seekTime: 0, width: 1920, height: 1080,
        previewUrl: preview.href, componentVariables: { elementId, values: result.values } });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Layout validation failed" }, 422); }
    if (!review || Buffer.isBuffer(review)) return c.json({ error: "Component layout validation is unavailable" }, 503);
    if (!review.valid) return c.json({ error: "Component layout does not fit", issues: review.issues }, 422);
    // The capture is asynchronous. Check again immediately before the synchronous commit.
    if (fileContentVersion(readFileSync(path, "utf8")) !== revision) return c.json({ error: "Component changed during validation; read before retrying" }, 409);
    const overrides = Object.fromEntries(Object.entries(result.values).filter(([id, value]) => value !== defaults[id]));
    const patched = patchElementInHtml(source, { id: elementId }, [{ type: "attribute", property: "variable-values", value: Object.keys(overrides).length ? JSON.stringify(overrides) : null }]).html;
    if (patched === source) return c.json({ ok: true, changed: false, revision, data: toJSON(model, result.values) });
    const backup = snapshotBeforeWrite(project.dir, path);
    if (backup.error) return c.json({ error: backup.error }, 500);
    writeFileSync(path, patched, "utf8");
    const nextRevision = fileContentVersion(patched);
    recordFileWriteReceipt(path, { path: sourceFile, version: nextRevision, writeToken: createWriteToken() });
    adapter.invalidateProjectSignature?.(project.dir);
    return c.json({ ok: true, changed: true, revision: nextRevision, data: toJSON(model, result.values),
      backupPath: backupPathForResponse(project.dir, backup.backupPath) });
  });
  api.use("/registry/import", bodyLimit({ maxSize: COMPONENT_PACK_MAX_BYTES }));
  api.post("/registry/import", async (c) => {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-origin component import is not allowed" }, 403);
    if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON component pack required" }, 415);
    try {
      const body: unknown = await c.req.json();
      if (!body || typeof body !== "object") throw new Error("Invalid component pack request");
      const pack = parseComponentPack(Reflect.get(body, "package"));
      if (Reflect.get(body, "confirmed") !== true) return c.json({ items: pack.items.map(item => ({ name: item.manifest.name, title: item.manifest.title })) });
      const builtIns = await adapter.listRegistryCatalog?.() ?? [];
      const items = importComponentPack(pack, builtIns.map(item => item.name));
      return c.json({ items });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Unable to import component pack" }, 400);
    }
  });
  api.get("/registry/blocks", async (c) => {
    if (!adapter.listRegistryCatalog) {
      return c.json({ error: "Registry not available" }, 501);
    }
    const items = await adapter.listRegistryCatalog();
    const names = new Set(items.map(item => item.name));
    return c.json([...items, ...listLibraryComponents().filter(item => !names.has(item.manifest.name)).map(item => item.manifest)]);
  });

  api.get("/registry/blocks/:name/preview", async (c) => {
    if (!adapter.loadRegistryPreview) {
      return c.text("Registry preview not available", 501);
    }
    const name = c.req.param("name");
    const imported = listLibraryComponents().find(item => item.manifest.name === name);
    const preview = await adapter.loadRegistryPreview({ blockName: name })
      ?? (imported ? loadRegistryPreviewFromRoot(imported.registryRoot, name) : null);
    if (!preview) return c.text("Registry block not found", 404);

    const duration = Math.max(0.1, preview.duration);
    const seekTime = finitePreviewNumber(c.req.query("time"), duration / 2);
    const autoplay = c.req.query("autoplay") === "1";
    return c.html(
      buildRegistryPreviewHtml(preview.html, {
        assetBaseUrl: `/api/registry/blocks/${encodeURIComponent(c.req.param("name"))}/assets/`,
        autoplay,
        duration,
        seekTime,
        focus: preview.focus,
        runtimeUrl: adapter.runtimeUrl,
        width: preview.dimensions.width,
        height: preview.dimensions.height,
      }),
      200,
      {
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy":
          "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; img-src 'self' https: data: blob:; media-src 'self' https: data: blob:",
      },
    );
  });

  api.get("/registry/blocks/:name/assets/*", async (c) => {
    if (!adapter.loadRegistryPreviewAsset) {
      return c.text("Registry preview assets not available", 501);
    }
    const assetMarker = "/assets/";
    const assetMarkerIndex = c.req.path.indexOf(assetMarker);
    const assetPath = decodeURIComponent(
      assetMarkerIndex >= 0 ? c.req.path.slice(assetMarkerIndex + assetMarker.length) : "",
    );
    const imported = listLibraryComponents().find(item => item.manifest.name === c.req.param("name"));
    const asset = await adapter.loadRegistryPreviewAsset({
      blockName: c.req.param("name"),
      assetPath,
    }) ?? (imported ? loadRegistryPreviewAssetFromRoot(imported.registryRoot, c.req.param("name"), assetPath) : null);
    if (!asset) return c.text("Registry asset not found", 404);
    const responseBody = Uint8Array.from(asset.body).buffer;
    return new Response(responseBody, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.body.byteLength),
      },
    });
  });

  // fallow-ignore-next-line complexity
  api.post("/projects/:id/registry/install", async (c) => {
    if (!adapter.installRegistryBlock) {
      return c.json({ error: "Registry install not available" }, 501);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json<{ blockName?: string }>().catch(() => null);
    if (!body?.blockName) {
      return c.json({ error: "blockName is required" }, 400);
    }

    try {
      const imported = listLibraryComponents().find(item => item.manifest.name === body.blockName);
      if (imported) return c.json({ written: installLibraryComponent(imported, project.dir), block: imported.manifest });
      const result = await adapter.installRegistryBlock({ project, blockName: body.blockName });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
      return c.json({ error: message }, 500);
    }
  });
}
