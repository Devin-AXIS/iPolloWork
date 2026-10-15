// Real config/workflow storage, isolated workspace; synthetic bindings do not call a model.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../apps/server/src/server.js";
import { bindConversationSession, readProjectSessionWorkItem } from "../../apps/server/src/work-items.js";
import { readiPolloWorkWorkspaceConfig } from "../../apps/server/src/ipollowork-workspace-config-store.js";
import type { ServerConfig } from "../../apps/server/src/types.js";

const root = await mkdtemp(join(tmpdir(), "ipw-project-presets-"));
const config: ServerConfig = {
  host: "127.0.0.1", port: 5297, token: "isolated-preset-proof", hostToken: "isolated-preset-proof",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 },
  corsOrigins: ["http://127.0.0.1:5268"],
  workspaces: [{ id: "preset-proof", name: "项目预设验证", path: root, preset: "starter", workspaceType: "local" }],
  authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated",
  hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};
await bindConversationSession(config, config.workspaces[0], "before-defaults", { title: "已有对话", engineId: "opencode" });
await startServer(config);
const output = new URL(`../results/${new Date().toISOString().replace(/[:.]/g, "-")}-project-agent-defaults/`, import.meta.url);
const frames = new Map<string, { claim: string; assertion: string }>();
Bun.serve({ hostname: "127.0.0.1", port: 5298, async fetch(request) {
  const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5268" };
  if (request.method === "POST" && new URL(request.url).pathname === "/evidence") {
    const body = await request.json();
    const current = await readiPolloWorkWorkspaceConfig(config, "preset-proof");
    const old = await readProjectSessionWorkItem(config, "preset-proof", "before-defaults");
    const fresh = await readProjectSessionWorkItem(config, "preset-proof", "after-defaults");
    const hasPreset = (value: unknown) => JSON.stringify(value)?.includes('"id":"content-operations"') ?? false;
    const evidence = {
      project: { claim: "项目概览添加预设并刷新，配置仍然保留。", assertion: hasPreset(current.project) },
      old: { claim: "已有对话保留原配置。", assertion: Boolean(old) && !hasPreset(old?.execution?.workflow?.config) },
      new: { claim: "新建对话继承项目默认智能体。", assertion: hasPreset(fresh?.execution?.workflow?.config) },
    };
    if (!(body.frame === "project" || body.frame === "old" || body.frame === "new") || typeof body.image !== "string") return new Response("Invalid evidence", { status: 400, headers });
    const frame = evidence[body.frame];
    const bytes = Buffer.from(body.image, "base64");
    if (!frame.assertion || bytes[0] !== 0xff || bytes[1] !== 0xd8) return new Response("Assertion or screenshot failed", { status: 409, headers });
    await mkdir(output, { recursive: true });
    await writeFile(new URL(`${body.frame}.jpg`, output), bytes);
    frames.set(body.frame, { claim: frame.claim, assertion: "真实服务端持久化断言通过；页面由 CUA 操作并检查对应可见状态。" });
    const status = frames.size === 3 ? "Passed" : "Incomplete";
    await writeFile(new URL("report.json", output), JSON.stringify({ status, driver: "CUA", scope: "真实概览组件与存储，合成对话绑定，未调用模型", frames: Object.fromEntries(frames) }, null, 2));
    await writeFile(new URL("fraimz.html", output), `<!doctype html><meta charset="utf-8"><title>项目预设验证</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:0 20px}img{max-width:100%;border:1px solid #ddd}article{margin:32px 0}</style><h1>项目预设验证 · ${status}</h1><p>CUA 实际页面操作；真实配置 API 与 SQLite 存储；对话绑定为合成验证，未调用 AI 模型。</p>${[...frames].map(([id, frame]) => `<article><h2>${frame.claim}</h2><p>操作与旁白：${frame.claim}</p><p>${frame.assertion}</p><img src="${id}.jpg"></article>`).join("")}`);
    return Response.json({ status, output: output.pathname }, { headers });
  }
  if (request.method === "POST" && new URL(request.url).pathname === "/new") {
    const item = await bindConversationSession(config, config.workspaces[0], "after-defaults", { title: "新对话", engineId: "opencode" });
    return Response.json(item, { headers });
  }
  return new Response("Not found", { status: 404, headers });
} });
console.log(JSON.stringify({ root, url: "http://127.0.0.1:5268/tests/project-agent-presets-proof.html" }));
