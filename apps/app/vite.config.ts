import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildPluginRuntime } from "@ipollowork/ui/build-plugin-runtime";

const portValue = Number.parseInt(process.env.PORT ?? "", 10);
const devPort = Number.isFinite(portValue) && portValue > 0 ? portValue : 5173;
const uiRuntimeDependencies = new Set<string>();
const allowedHosts = new Set<string>();
const envAllowedHosts = process.env.VITE_ALLOWED_HOSTS ?? "";

const addHost = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return;
  allowedHosts.add(trimmed);
};

envAllowedHosts.split(",").forEach(addHost);
addHost(process.env.IPOLLOWORK_PUBLIC_HOST ?? null);
const hostname = os.hostname();
addHost(hostname);
const shortHostname = hostname.split(".")[0];
if (shortHostname && shortHostname !== hostname) {
  addHost(shortHostname);
}
const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const appPackagePath = resolve(appRoot, "package.json");
const desktopPackagePath = resolve(appRoot, "..", "desktop", "package.json");

function readPackageVersion(packagePath: string): string | null {
  if (!existsSync(packagePath)) return null;

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return parsed.version?.trim() || null;
}

const buildAppVersion =
  process.env.VITE_IPOLLOWORK_APP_VERSION?.trim() ||
  readPackageVersion(desktopPackagePath) ||
  readPackageVersion(appPackagePath) ||
  "0.0.0";

// Load the Tauri → Electron migration-release fragment if present. Written
// by scripts/migration/01-cut-migration-release.mjs for the specific
// release commit; absent otherwise so every other build has the migration
// prompt dormant. Pre-parsed here so Vite's define/import.meta.env picks
// up the keys without a custom plugin.
function loadMigrationReleaseEnv(): Record<string, string> {
  const fragmentPath = resolve(appRoot, ".env.migration-release");
  if (!existsSync(fragmentPath)) return {};
  const out: Record<string, string> = {};
  const raw = readFileSync(fragmentPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.search("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key.startsWith("VITE_")) continue;
    out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}
const migrationReleaseEnv = loadMigrationReleaseEnv();

// Electron packaged builds load index.html via `file://`, so asset URLs
// must be relative. Tauri serves via its own protocol so absolute paths
// work there. Gate on an env var the electron build script sets.
const isElectronPackagedBuild = process.env.IPOLLOWORK_ELECTRON_BUILD === "1";

export default defineConfig({
  // Worktrees can share node_modules; each dev server needs its own optimizer cache.
  cacheDir: resolve(appRoot, "../../.ipollowork-dev/vite", String(devPort)),
  base: isElectronPackagedBuild ? "./" : "/",
  define: {
    ...Object.fromEntries(
      Object.entries(migrationReleaseEnv).map(([k, v]) => [
        `import.meta.env.${k}`,
        JSON.stringify(v),
      ]),
    ),
    "import.meta.env.VITE_IPOLLOWORK_APP_VERSION": JSON.stringify(buildAppVersion),
  },
  plugins: [
    {
      name: "ipollowork-plugin-ui-runtime",
      resolveId(id) { if (id === "virtual:ipollowork-plugin-ui-runtime") return "\0ipollowork-plugin-ui-runtime"; },
      async load(id) {
        if (id !== "\0ipollowork-plugin-ui-runtime") return;
        const runtime = await buildPluginRuntime("host");
        uiRuntimeDependencies.clear();
        for (const path of runtime.dependencies) { this.addWatchFile(path); uiRuntimeDependencies.add(path); }
        if (this.meta.watchMode === false) {
          // The sandbox consumes this as source text. Keep its self-contained
          // payload outside the renderer's executable application chunks.
          const asset = this.emitFile({ type: "asset", name: "plugin-ui-runtime.js", source: `export default ${JSON.stringify(runtime.script)};` });
          return `export default (await import(/* @vite-ignore */ import.meta.ROLLUP_FILE_URL_${asset})).default;`;
        }
        return `export default ${JSON.stringify(runtime.script)}`;
      },
      handleHotUpdate(context) {
        if (!uiRuntimeDependencies.has(context.file)) return;
        const module = context.server.moduleGraph.getModuleById("\0ipollowork-plugin-ui-runtime");
        if (!module) return;
        context.server.moduleGraph.invalidateModule(module);
        return [...context.modules, module];
      },
    },
    {
      name: "ipollowork-dev-server-id",
      configureServer(server) {
        server.middlewares.use("/__ipollowork_dev_server_id", (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ appRoot }));
        });
      },
    },
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { compilationMode: "annotation" }]],
      },
    }),
  ],
  server: {
    port: devPort,
    strictPort: true,
    ...(allowedHosts.size > 0 ? { allowedHosts: Array.from(allowedHosts) } : {}),
  },
  build: {
    target: "esnext",
    // Desktop loads the application from disk. Keep a 4 MB executable chunk
    // budget after extracting sandbox payloads, theme data and shared vendors.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          const locale = path.match(/\/i18n\/locales\/([^/]+)\.ts$/);
          if (locale) return `locale-${locale[1]}`;
          const theme = path.match(/\/design-systems\/design-systems\/([^/]+)\/(manifest\.json|design-tokens\.json|tokens\.css\?raw)$/);
          if (theme) return `theme-tokens-${theme[1].charAt(0)}`;
          const dependency = path.split("/node_modules/").at(-1);
          if (dependency !== path && dependency) {
            const packageName = dependency.startsWith("@") ? dependency.split("/").slice(0, 2).join("/") : dependency.split("/")[0];
            if (/^(react|react-dom|scheduler)$/.test(packageName)) return "react";
            if (/^(@lexical\/|lexical$)/.test(packageName)) return "lexical";
            if (/^(@codemirror\/|@lezer\/)/.test(packageName)) return "code-editor";
            if (["motion-dom", "motion-utils", "framer-motion"].includes(packageName)) return "motion";
            // Shiki already loads individual language grammars on demand.
            if (/^(shiki|@shikijs\/|@shiki\/)/.test(packageName)) return;
            if (["@base-ui/react", "@xterm/xterm", "jspdf", "xlsx", "pdfjs-dist", "lucide-react", "ai", "zod", "html2canvas", "html2canvas-pro", "pptxgenjs"].includes(packageName)) {
              return `vendor-${packageName.replaceAll(/[@/]/g, "-")}`;
            }
            return;
          }
        },
      },
      input: {
        app: resolve(appRoot, "index.html"),
        overlay: resolve(appRoot, "overlay.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(appRoot, "src"),
    },
  },
});
