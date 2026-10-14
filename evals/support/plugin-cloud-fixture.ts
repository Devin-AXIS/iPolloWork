// Real host installer with an isolated workspace. Only the cloud registry/transport is simulated.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startServer } from "../../apps/server/src/server.ts";
import { listInstalledPluginPackages } from "../../apps/server/src/plugin-package-lifecycle.ts";
import type { ServerConfig } from "../../apps/server/src/types.ts";

const root = await mkdtemp(join(tmpdir(), "ipollowork-cloud-market-proof-"));
process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
const config: ServerConfig = {
  host: "127.0.0.1", port: 5398, token: "cloud-proof", hostToken: "cloud-proof-host",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 },
  corsOrigins: ["http://localhost:5188"], workspaces: [{ id: "cloud-proof", name: "Cloud proof", path: root,
    preset: "starter", workspaceType: "local", engineId: "opencode" }], authorizedRoots: [root], readOnly: false,
  startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};
await mkdir(join(root, ".opencode/skills/user-owned"), { recursive: true });
await writeFile(join(root, ".opencode/skills/user-owned/SKILL.md"), "# User-owned content\nKeep this file.\n");
const requireFromApp = createRequire(new URL("../../apps/app/package.json", import.meta.url));
const JSZip = requireFromApp("jszip");
const artifacts = new Map<string, { bytes: Uint8Array; digest: string }>();
for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
  const archive = new JSZip();
  archive.file("ipollowork.plugin.json", JSON.stringify({
    schemaVersion: 2, id: "cloud-proof-plugin", name: "云端工作流助手", description: "验证独立下载安装与更新。",
    category: "productivity", source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: { version, updateId: "proof/cloud-workflow" },
    resources: [{ id: "workflow", type: "skill", path: "skills/cloud-proof-plugin/SKILL.md", required: true }],
  }));
  archive.file("skills/cloud-proof-plugin/SKILL.md", "# Cloud proof\nPackage version " + version + "\n");
  const bytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  artifacts.set(version, { bytes, digest: createHash("sha256").update(bytes).digest("hex") });
}
let current = "1.0.0", offline = false, corrupt = false;
const host = await startServer(config);
const cloud = Bun.serve({ hostname: "127.0.0.1", port: 5399, async fetch(request) {
  const path = new URL(request.url).pathname;
  const headers = { "Access-Control-Allow-Origin": "http://localhost:5188",
    "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Expose-Headers": "x-ipollowork-sha256,x-ipollowork-resource-type" };
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (path === "/proof/update" && request.method === "POST") { current = "1.1.0"; offline = false; corrupt = false; }
  if (path === "/proof/corrupt" && request.method === "POST") { current = "1.2.0"; corrupt = true; }
  if (path === "/proof/offline" && request.method === "POST") offline = true;
  if (path === "/proof/state") {
    const items = await listInstalledPluginPackages({ serverConfig: config });
    const item = items.find(item => item.pluginId === "cloud-proof-plugin");
    const userFile = await readFile(join(root, ".opencode/skills/user-owned/SKILL.md"), "utf8");
    return Response.json({ installed: item ? { version: item.version, enabled: item.enabled } : null, userFile }, { headers });
  }
  if (path.startsWith("/proof/")) return Response.json({ current, offline, corrupt }, { headers });
  if (offline) return Response.json({ message: "Proof cloud unavailable" }, { status: 503, headers });
  if (request.headers.get("authorization") !== "Bearer cloud-proof") return new Response("Unauthorized", { status: 401, headers });
  const artifact = artifacts.get(current)!;
  if (path === "/api/v1/enterprise-resources") return Response.json({ resources: [{
    id: "proof-resource", type: "extension", slug: "cloud-proof-plugin", name: "云端工作流助手",
    description: "验证独立下载安装与更新。", category: "productivity", enterpriseCategory: "效率工具", updatedAt: "2026-10-14T00:00:00Z",
    latestArtifact: { version: current, manifestId: "cloud-proof-plugin", sha256: artifact.digest,
      downloadPath: "/api/v1/enterprise-resources/proof-resource/versions/" + current + "/download" },
  }] }, { headers });
  if (path.endsWith("/download")) {
    const version = path.split("/").at(-2)!;
    const selected = artifacts.get(version)!;
    return new Response(corrupt ? new Uint8Array([0, 1, 2]) : selected.bytes, { headers: { ...headers,
      "Content-Type": "application/zip", "x-ipollowork-sha256": selected.digest, "x-ipollowork-resource-type": "extension" } });
  }
  return new Response("Not found", { status: 404, headers });
}});
console.log(JSON.stringify({ root, host: "http://127.0.0.1:5398", cloud: "http://127.0.0.1:5399" }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { cloud.stop(true); await host.stop(); process.exit(0); });
