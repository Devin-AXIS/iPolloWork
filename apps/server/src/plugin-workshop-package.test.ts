import { describe, expect, test } from "bun:test";

import type { PluginWorkshopSourceBundle } from "@ipollowork/types/plugins";

import { parsePluginPackageManifest } from "./plugin-package-manifest.js";
import { preparePluginWorkshopSourceBundle } from "./plugin-workshop-package.js";

function sourceBundle(html: string, manifestOverrides: Record<string, unknown> = {}): PluginWorkshopSourceBundle {
  const manifest = {
    schemaVersion: 2,
    id: "chart-studio",
    name: "Chart Studio",
    description: "A chart studio Plugin Workshop project.",
    source: { format: "ipollowork-extension-manifest", origin: "workspace", trusted: false },
    package: { version: "1.0.0", updateId: "personal/chart-studio" },
    resources: [{
      type: "ui",
      id: "studio",
      path: "ui/studio.html",
      required: true,
      ui: {
        uri: "ui://chart-studio/studio",
        mimeType: "text/html;profile=mcp-app",
        csp: { resourceDomains: ["https://cdn.jsdelivr.net"] },
      },
    }],
    contributions: [{ type: "workspace-app", ref: "studio", label: "Chart Studio" }],
    ...manifestOverrides,
  };
  return {
    pluginId: "chart-studio",
    version: "1.0.0",
    files: [
      {
        path: "ipollowork.plugin.json",
        contentBase64: Buffer.from(JSON.stringify(manifest), "utf8").toString("base64"),
      },
      {
        path: "ui/studio.html",
        contentBase64: Buffer.from(html, "utf8").toString("base64"),
      },
    ],
    preparation: { localizedUrls: [], removedNetworkPermission: false },
  };
}

function fileText(bundle: PluginWorkshopSourceBundle, path: string): string {
  const file = bundle.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Missing ${path}`);
  return Buffer.from(file.contentBase64, "base64").toString("utf8");
}

describe("Plugin Workshop package preparation", () => {
  test("localizes declared CDN scripts and styles without changing the draft bundle", async () => {
    const source = sourceBundle(`<!doctype html>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/chart-theme@1.0.0/theme.css">
      <main>Chart Studio</main>
      <script src="https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js"></script>`);
    const prepared = await preparePluginWorkshopSourceBundle(source, {
      fetchResource: async (url) => url.endsWith(".css")
        ? new Response("main { color: #123; }", { headers: { "content-type": "text/css" } })
        : new Response("globalThis.echarts = {};", { headers: { "content-type": "application/javascript" } }),
    });

    const html = fileText(prepared, "ui/studio.html");
    const manifest = parsePluginPackageManifest(JSON.parse(fileText(prepared, "ipollowork.plugin.json")) as unknown);
    expect(html).toContain("globalThis.echarts = {};");
    expect(html).toContain("main { color: #123; }");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
    expect(manifest.resources[0]?.ui?.csp?.resourceDomains).toBeUndefined();
    expect(manifest.permissions).toBeUndefined();
    expect(prepared.preparation).toEqual({
      localizedUrls: [
        "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
        "https://cdn.jsdelivr.net/npm/chart-theme@1.0.0/theme.css",
      ],
      removedNetworkPermission: true,
    });
    expect(fileText(source, "ui/studio.html")).toContain("<script src=");
  });

  test("rejects remote resources that were not declared by the UI CSP", async () => {
    const source = sourceBundle('<script src="https://unpkg.com/example@1.0.0/index.js"></script>');
    await expect(preparePluginWorkshopSourceBundle(source, {
      fetchResource: async () => new Response("", { headers: { "content-type": "application/javascript" } }),
    })).rejects.toMatchObject({ code: "plugin_workshop_remote_resource_not_declared" });
  });

  test("localizes dynamic CDN fallback scripts used by generated Studio apps", async () => {
    const source = sourceBundle(`<!doctype html><main>Chart Studio</main><script>
      function loadScripts(urls, ready) {
        if (ready()) return Promise.resolve();
        const script = document.createElement("script");
        script.src = urls[0];
        document.head.appendChild(script);
      }
      const echartsUrls = [
        "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
        "https://unpkg.com/echarts@5.6.0/dist/echarts.min.js"
      ];
      const chartOptions = {}; chartOptions.type = "line";
      loadScripts(echartsUrls, () => Boolean(window.echarts));
    </script>`, {
      permissions: [{ id: "network", reason: "Load ECharts from a public CDN." }],
      resources: [{
        type: "ui",
        id: "studio",
        path: "ui/studio.html",
        required: true,
        ui: {
          uri: "ui://chart-studio/studio",
          mimeType: "text/html;profile=mcp-app",
          csp: { resourceDomains: ["https://cdn.jsdelivr.net", "https://unpkg.com"] },
        },
      }],
    });
    const library = "globalThis.echarts = { init() {} };";
    const prepared = await preparePluginWorkshopSourceBundle(source, {
      fetchResource: async () => new Response(library, {
        headers: { "content-type": "application/javascript" },
      }),
    });

    const html = fileText(prepared, "ui/studio.html");
    const manifest = parsePluginPackageManifest(JSON.parse(fileText(prepared, "ipollowork.plugin.json")) as unknown);
    expect(html.indexOf(library)).toBeLessThan(html.indexOf("function loadScripts"));
    expect(html.match(/globalThis\.echarts/g)).toHaveLength(1);
    expect(manifest.resources[0]?.ui?.csp?.resourceDomains).toBeUndefined();
    expect(manifest.permissions).toBeUndefined();
    expect(prepared.preparation).toEqual({
      localizedUrls: [
        "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
        "https://unpkg.com/echarts@5.6.0/dist/echarts.min.js",
      ],
      removedNetworkPermission: true,
    });
  });

  test("rejects dynamic scripts from unsupported hosts instead of exporting a broken Studio", async () => {
    const source = sourceBundle('<script>const urls = ["https://example.com/chart.min.js"];</script>', {
      resources: [{
        type: "ui",
        id: "studio",
        path: "ui/studio.html",
        required: true,
        ui: {
          uri: "ui://chart-studio/studio",
          mimeType: "text/html;profile=mcp-app",
          csp: { resourceDomains: ["https://example.com"] },
        },
      }],
    });
    await expect(preparePluginWorkshopSourceBundle(source, {
      fetchResource: async () => new Response("not used"),
    })).rejects.toMatchObject({ code: "plugin_workshop_remote_resource_host_unsupported" });
  });

  test("keeps API and media networking explicit instead of silently removing it", async () => {
    const source = sourceBundle('<img src="https://cdn.jsdelivr.net/npm/example@1.0.0/chart.png">');
    await expect(preparePluginWorkshopSourceBundle(source, {
      fetchResource: async () => new Response("not used"),
    })).rejects.toMatchObject({ code: "plugin_workshop_remote_resource_unsupported" });
  });
});
