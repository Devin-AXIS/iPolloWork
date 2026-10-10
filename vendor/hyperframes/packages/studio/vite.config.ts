import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readNodeRequestBody } from "./vite.request-body.js";
import { watch } from "chokidar";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";
import { previewChangeOwner } from "./vite.preview-watch";

async function loadRuntimeSourceForDev(
  server: import("vite").ViteDevServer,
): Promise<string | null> {
  try {
    const mod = await server.ssrLoadModule(
      resolve(__dirname, "../core/src/inline-scripts/hyperframe.ts"),
    );
    if (typeof mod.loadHyperframeRuntimeSource === "function") {
      return mod.loadHyperframeRuntimeSource();
    }
  } catch (err) {
    console.warn("[Studio] Failed to load runtime source from core:", err);
  }
  return null;
}

const studioPkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

// ── Bridge Hono fetch → Node http response ───────────────────────────────────

async function bridgeHonoResponse(
  honoResponse: Response,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const headers: Record<string, string> = {};
  honoResponse.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(honoResponse.status, headers);

  if (!honoResponse.body) {
    res.end();
    return;
  }

  const reader = honoResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    /* client disconnected */
  }
  res.end();
}

// ── Vite plugin ──────────────────────────────────────────────────────────────

function devProjectApi(): Plugin {
  const dataDir = resolve(__dirname, "data/projects");
  const runtimePath = resolve(__dirname, "../core/dist/hyperframe.runtime.iife.js");

  return {
    name: "studio-dev-api",
    configureServer(server): void {
      const watchedProjects = new Map<string, string>();
      try {
        for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
          const full = join(dataDir, entry.name);
          try {
            watchedProjects.set(
              lstatSync(full).isSymbolicLink() ? realpathSync(full) : full,
              entry.name,
            );
          } catch {
            /* skip broken symlinks */
          }
        }
      } catch {
        /* dataDir doesn't exist yet */
      }

      const projectWatcher = watch([...watchedProjects.keys()], {
        ignoreInitial: true,
        // A project write is a whole-file replace; wait for it to settle so a
        // half-written composition is never announced.
        awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 },
      });

      // This watcher, and not Vite's, is what clears the preview signature.
      // Vite's ignores `data/projects/**`, so subscribing the cache to it left
      // the ETag frozen for the life of the dev server: the preview answered
      // every revalidation with 304 and thumbnails regenerated after an edit
      // still rendered the pre-edit composition. Every event type counts, since
      // an added or deleted asset changes the signature as surely as an edit.
      const signatureCache = createProjectSignatureCache({
        watch: (projectDir) => void projectWatcher.add(projectDir),
      });


      let _api: { fetch: (req: Request) => Promise<Response> } | null = null;
      let _studioServerModule: typeof import("@hyperframes/studio-server") | null = null;
      const getApi = async () => {
        if (!_api) {
          const mod = await server.ssrLoadModule("@hyperframes/studio-server");
          _studioServerModule = mod as typeof _studioServerModule;
          const adapter = createViteAdapter(dataDir, server, signatureCache, {
            projectWatcher,
            onResolveProject: project => {
              watchedProjects.set(project.dir, project.id);
              projectWatcher.add(project.dir);
            },
          });
          _api = mod.createStudioApi(adapter);
        }
        return _api;
      };

      // Runtime endpoint — prefer source build over dist artifact
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/api/runtime.js") return next();
        const serve = async () => {
          let runtimeSource = await loadRuntimeSourceForDev(server);
          if (!runtimeSource && existsSync(runtimePath)) {
            runtimeSource = readFileSync(runtimePath, "utf-8");
          }
          if (!runtimeSource) {
            res.writeHead(404);
            res.end("runtime not available — build packages/core or load runtime source");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/javascript",
            "Cache-Control": "no-store",
          });
          res.end(runtimeSource);
        };
        void serve().catch((err) => {
          console.error("[Studio runtime] Failed to serve runtime", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("failed to serve runtime");
          }
        });
      });

      // API middleware
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const api = await getApi();
          const url = new URL(req.url, `http://${req.headers.host}`);
          url.pathname = url.pathname.slice(4);
          let body: Buffer | undefined;
          if (req.method !== "GET" && req.method !== "HEAD") {
            const bytes = await readNodeRequestBody(req);
            body = bytes.byteLength > 0 ? bytes : undefined;
          }
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value != null) headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          const fetchReq = new Request(url.toString(), {
            method: req.method,
            headers,
            body,
          });
          const response = await api.fetch(fetchReq);
          await bridgeHonoResponse(response, res);
        } catch (err) {
          console.error("[Studio API] Error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });

      projectWatcher.on("change", (filePath: string) => {
        const owner = previewChangeOwner(watchedProjects, filePath);
        if (!owner) return;
        if (
          !filePath.endsWith(".html") &&
          !filePath.endsWith(".css") &&
          !filePath.endsWith(".js") &&
          !filePath.endsWith(".json")
        )
          return;
        console.log(`[Studio] File changed: ${filePath}`);
        // The receipt is matched on the file's current bytes, not just its path,
        // so a write is only recognised as ours when the version agrees. Calling
        // this without the version could never match, which left every Studio
        // write looking external and reloaded the preview on each edit.
        const studioServer = _studioServerModule;
        let version: string | null = null;
        try {
          version = studioServer?.fileContentVersion(readFileSync(filePath, "utf-8")) ?? null;
        } catch {
          // A deletion has no current bytes to match a write receipt against.
        }
        const receipt = studioServer
          ? studioServer.identifyFileWrite(filePath, version ?? studioServer.DELETED_VERSION)
          : null;
        // The API records what the preview loaded in this same module, so ask it here.
        const reloads = studioServer?.affectsPreview(owner.projectDir, filePath) ?? true;
        server.ws.send({
          type: "custom",
          event: "hf:file-change",
          data: {
            path: filePath,
            version,
            projectId: owner.projectId,
            affectsPreview: reloads,
            ...(reloads ? {} : { affectedCompositions: [] }),
            ...receipt,
          },
        });
      });
      server.httpServer?.on("close", () => void projectWatcher.close());
    },
  };
}

export function stableStylesCssPlugin(): Plugin {
  return {
    name: "studio-stable-styles-css",
    writeBundle(options, bundle) {
      const cssAssets = Object.values(bundle).filter(
        (item) => item.type === "asset" && item.fileName.endsWith(".css"),
      );
      if (cssAssets.length !== 1) {
        throw new Error(
          `stableStylesCssPlugin: expected exactly one CSS asset for the ./styles.css ` +
            `export, found ${cssAssets.length} (${cssAssets.map((a) => a.fileName).join(", ") || "none"}). ` +
            `Scope this plugin to the entry stylesheet instead of assuming a single emit.`,
        );
      }
      const outDir = options.dir ?? "dist";
      copyFileSync(join(outDir, cssAssets[0]!.fileName), join(outDir, "styles.css"));
    },
  };
}


export default defineConfig({
  plugins: [react(), devProjectApi(), stableStylesCssPlugin()],
  define: {
    __STUDIO_VERSION__: JSON.stringify(studioPkg.version),
  },
  resolve: {
    alias: [
      ...Object.entries({
        // The embedded Studio consumes the host's source contract in both dev
        // and release builds; Bun file dependencies may omit ignored dist files.
        "@ipollowork/types/hyperframes": resolve(
          __dirname,
          "../../../../packages/types/src/hyperframes.ts",
        ),
        "@ipollowork/types/video-image-workbench": resolve(
          __dirname,
          "../../../../packages/types/src/video-image-workbench.ts",
        ),
        "@hyperframes/player": resolve(
          __dirname,
          "../player/src/hyperframes-player.ts",
        ),
        "@hyperframes/studio-server/source-mutation": resolve(
          __dirname,
          "../studio-server/src/helpers/sourceMutation.ts",
        ),
      }).map(([find, replacement]) => ({ find, replacement })),
      {
        find: /^@hyperframes\/studio-server$/,
        replacement: resolve(__dirname, "../studio-server/src/index.ts"),
      },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ["bpm-detective"],
  },
  server: {
    port: 5190,
    watch: {
      // Official dev ownership: composition edits refresh their preview without
      // reloading Studio and losing selection, undo or Dock layout state.
      ignored: ["**/data/projects/**"],
    },
  },
  ssr: {
    // recast / @babel/parser are CommonJS and call `require("fs")`. They are
    // reachable only server-side via the Node-only `@hyperframes/parsers/gsap-parser`
    // subpath (studio-api GSAP mutations + the linter), which the dev server loads
    // through Vite SSR. Externalizing them makes SSR load the native Node modules
    // instead of esbuild-transforming the `require` into a shim that throws
    // "Dynamic require of fs is not supported". Browser bundles never reach them.
    external: ["recast", "@babel/parser", "ast-types"],
  },
  test: {
    exclude: ["data/**", "node_modules/**"],
    setupFiles: ["src/test-setup.ts"],
  },
});
