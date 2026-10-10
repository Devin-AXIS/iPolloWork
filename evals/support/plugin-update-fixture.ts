// Isolated proof of the real plugin lifecycle and React library. Only transport
// latency is simulated; no user workspace or installed plugin state is changed.
import { createServer } from "node:http";
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listInstalledPluginPackages, previewPluginPackage, updatePluginPackage } from "../../apps/server/src/plugin-package-lifecycle.js";
import { openCodePluginEngineAdapter } from "../../apps/server/src/plugin-engine-adapter.js";
import type { ServerConfig } from "../../apps/server/src/types.js";

const installedRoot = process.argv[2];
const packageRoot = process.argv[3];
if (!installedRoot || !packageRoot) throw new Error("Usage: bun evals/support/plugin-update-fixture.ts <installed-plugin-packages> <new-video-package>");
const root = await mkdtemp(join(tmpdir(), "ipollowork-plugin-update-proof-"));
process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
const sourceState = JSON.parse(await readFile(join(installedRoot, "state.json"), "utf8"));
const installed = sourceState.packages["video-agent"];
// Reproduce the legacy installation even after the user's real upgrade succeeds.
installed.currentVersion = "0.3.4";
installed.previousVersion = null;
installed.enabled = true;
installed.disabledResourceIds = [];
delete installed.versions["0.3.10"];
await cp(join(installedRoot, "artifacts/video-agent"), join(root, "plugin-packages/artifacts/video-agent"), { recursive: true });
await writeFile(join(root, "plugin-packages/state.json"), JSON.stringify({ schemaVersion: 3, packages: { "video-agent": installed } }));
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
  workspaces: [{ id: "proof", name: "Proof", path: root, preset: "starter", workspaceType: "local", engineId: "opencode" }],
  authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};
const [initial] = await listInstalledPluginPackages({ serverConfig: config });
const artifactRoot = join(root, "plugin-packages/artifacts/video-agent", installed.currentVersion);
for (const file of openCodePluginEngineAdapter.workspaceFiles({ manifest: initial.manifest, artifactRoot, files: installed.versions[installed.currentVersion].files })) {
  const target = join(root, file.targetPath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(artifactRoot, file.sourcePath), target);
}
const referenceRoot = ".opencode/skills/ipollowork-video-studio/references";
const references = ["video.md", "video-acceptance.md", "video-motion-principles.md"];
await mkdir(join(root, referenceRoot), { recursive: true });
for (const name of references) await copyFile(join(root, "plugin-packages/artifacts/video-agent/0.3.10/skills/ipollowork-video-studio/references", name), join(root, referenceRoot, name));
const preview = await previewPluginPackage({ packageRoot });
const app = fileURLToPath(new URL("../../apps/app", import.meta.url)).replaceAll("\\", "/");
let updateResult: unknown;
const requests: Array<{ method?: string; path?: string }> = [];
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/workspace/")) requests.push({ method: req.method, path: req.url });
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5196");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.end(); return; }
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Plugin update proof</title></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from 'http://localhost:5196/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
        localStorage.setItem('ipollowork.language','zh');
        await import('http://localhost:5196/@fs/${app}/src/app/index.css');
        const {default:React}=await import('http://localhost:5196/node_modules/.vite/deps/react.js');
        const {default:{createRoot}}=await import('http://localhost:5196/node_modules/.vite/deps/react-dom_client.js');
        const {PluginPackagesPanel}=await import('http://localhost:5196/@fs/${app}/src/react-app/domains/settings/plugin-packages-panel.tsx');
        const {createiPolloWorkServerClient}=await import('http://localhost:5196/@fs/${app}/src/app/lib/ipollowork-server.ts');
        const ref=React.createRef(); const noop=()=>{}; const client=createiPolloWorkServerClient({baseUrl:location.origin,token:'fixture'});
        createRoot(document.getElementById('root')).render(React.createElement('main',{className:'bg-background text-foreground min-h-screen p-8'},
          React.createElement('button',{onClick:()=>ref.current.refresh(),'data-testid':'proof-refresh',className:'mb-4 rounded border px-3 py-1'},'刷新'),
          React.createElement(PluginPackagesPanel,{ref,client,workspaceId:'proof',selectedPluginId:null,onSelectPlugin:noop,onOpenUrl:noop,mcpStatuses:{},onConnectMcp:async()=>null,onLogoutMcpAuth:noop,onRelationshipsChange:noop,marketplaceView:()=>null})));
        window.__ipolloworkControl={fixture:true};
      </script></body></html>`);
      return;
    }
    if (!req.url?.startsWith("/workspace/") && req.url !== "/observe") {
      res.writeHead(302, { Location: `http://localhost:5196${req.url}` });
      res.end(); return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/observe") {
      const files = await Promise.all(references.map(async name => ({ name, matches: (await readFile(join(root, referenceRoot, name))).equals(await readFile(join(packageRoot, "skills/ipollowork-video-studio/references", name))) })));
      res.end(JSON.stringify({ updateResult, files, requests, version: (await listInstalledPluginPackages({ serverConfig: config }))[0].version }));
      return;
    }
    if (req.url?.endsWith("/authorization")) { res.end(JSON.stringify({ required: false, methods: [], connections: [] })); return; }
    await new Promise(resolve => setTimeout(resolve, 1800));
    if (req.method === "POST") {
      updateResult = await updatePluginPackage({ serverConfig: config, packageRoot });
      res.end(JSON.stringify(updateResult));
    } else if (req.url?.endsWith("/catalog")) {
      const [item] = await listInstalledPluginPackages({ serverConfig: config });
      res.end(JSON.stringify({ items: [{ pluginId: "video-agent", name: preview.manifest.name, manifest: preview.manifest, version: preview.manifest.package?.version, installedVersion: item.version, updateAvailable: item.version !== preview.manifest.package?.version }], errors: [] }));
    } else {
      res.end(JSON.stringify({ items: await listInstalledPluginPackages({ serverConfig: config }) }));
    }
  } catch (error) {
    res.statusCode = 409;
    res.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
  }
});
server.listen(5199, "127.0.0.1", () => console.log(JSON.stringify({ url: "http://127.0.0.1:5199", root: resolve(root) })));
