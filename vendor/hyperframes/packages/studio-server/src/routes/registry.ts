import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

interface RegistryPreviewOptions {
  assetBaseUrl: string;
  autoplay: boolean;
  duration: number;
  focus?: { x: number; y: number; zoom: number };
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

export function buildRegistryPreviewHtml(
  html: string,
  { assetBaseUrl, autoplay, duration, focus, seekTime, width, height }: RegistryPreviewOptions,
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
    const startedAt = performance.now();
    const tick = (now) => {
      seek(((now - startedAt) / 1000) % duration);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  };

  window.addEventListener("resize", fitComposition);
  window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
</script>`;

  const baseTag = `<base href="${assetBaseUrl}">`;
  const previewHtml = promoteStandaloneRegistryTemplate(html);
  const htmlWithBase = /<head(?:\s[^>]*)?>/i.test(previewHtml)
    ? previewHtml.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${baseTag}`)
    : `${baseTag}${previewHtml}`;
  return /<\/body>/i.test(htmlWithBase)
    ? htmlWithBase.replace(/<\/body>/i, `${previewScript}</body>`)
    : `${htmlWithBase}${previewScript}`;
}

export function registerRegistryRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/registry/blocks", async (c) => {
    if (!adapter.listRegistryCatalog) {
      return c.json({ error: "Registry not available" }, 501);
    }
    const items = await adapter.listRegistryCatalog();
    return c.json(items);
  });

  api.get("/registry/blocks/:name/preview", async (c) => {
    if (!adapter.loadRegistryPreview) {
      return c.text("Registry preview not available", 501);
    }
    const preview = await adapter.loadRegistryPreview({ blockName: c.req.param("name") });
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
    const asset = await adapter.loadRegistryPreviewAsset({
      blockName: c.req.param("name"),
      assetPath,
    });
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
      const result = await adapter.installRegistryBlock({ project, blockName: body.blockName });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
      return c.json({ error: message }, 500);
    }
  });
}
