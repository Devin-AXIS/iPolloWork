import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "workspace-export-commands",
  title: "Workspace export preserves command fields, order and skill contents over HTTP",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Export an empty workspace, then export saved commands and a skill",
    async run(ctx) {
      let result;
      await ctx.prove("The real workspace export API preserves its portable command contract", {
        voiceover: "这里通过真实的本地 HTTP 服务导出工作区，确认空列表、命令顺序、正文和技能文件保持完整。这是接口验证，不代表桌面会话交互已经验收。",
        action: async () => {
          result = spawnSync("bun", ["--eval", String.raw`
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./apps/server/src/server.ts";
import { upsertCommand } from "./apps/server/src/commands.ts";

const root = await mkdtemp(join(tmpdir(), "ipollowork-export-proof-"));
process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
let server;
try {
  await mkdir(join(root, ".git"));
  const config = {
    host: "127.0.0.1", port: 0, token: "export-proof-client", hostToken: "export-proof-host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [], workspaces: [{ id: "ws_export_proof", name: "Export proof", path: root,
      preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false,
    startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
    logFormat: "pretty", logRequests: false,
  };
  server = await startServer(config);
  const base = "http://127.0.0.1:" + server.port + "/workspace/ws_export_proof";
  async function get(path, token = config.token) {
    const response = await fetch(base + path, {
      headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, token === config.token ? 200 : 401);
    return response.json();
  }
  await get("/export", "invalid-proof-token");
  const empty = await get("/export");
  assert.deepEqual(empty.commands, []);
  assert.deepEqual(empty.skills, []);
  console.log("PASS: authorized empty export returns empty arrays; invalid token is rejected.");

  const expected = new Map([
    ["z-review", { name: "z-review", description: "Review changes", template: "检查代码\nKeep existing behavior." }],
    ["a-build", { name: "a-build", template: "Build the project." }],
  ]);
  for (const command of expected.values()) {
    await upsertCommand(root, { ...command, agent: "build", model: "provider/model", subtask: true });
  }
  const skill = "---\nname: export-proof\ndescription: Export fixture\n---\n\nKeep this skill intact.\n";
  await mkdir(join(root, ".opencode", "skills", "export-proof"), { recursive: true });
  await writeFile(join(root, ".opencode", "skills", "export-proof", "SKILL.md"), skill);
  const listed = await get("/commands");
  const exported = await get("/export");
  assert.equal(listed.items.length, 2);
  assert.deepEqual(exported.commands, listed.items.map((command) => expected.get(command.name)));
  assert.deepEqual(exported.skills, [{ name: "export-proof", description: "Export fixture", content: skill }]);
  assert.equal(exported.workspaceId, "ws_export_proof");
  assert.equal(typeof exported.exportedAt, "number");
  console.log("PASS: command order matches the list API; optional descriptions and multiline text round-trip.");
  console.log("PASS: export contains only portable command fields and the exact skill file content.");
  const repeated = await get("/export");
  assert.deepEqual(repeated.commands, exported.commands);
  assert.deepEqual(repeated.skills, exported.skills);
  console.log("PASS: repeating export preserves the command and skill payloads.");
} finally {
  if (server) await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
`], {
            cwd: fileURLToPath(new URL("../../", import.meta.url)),
            encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Real HTTP workspace export checks", `${result.stdout}\n${result.stderr}`);
        },
        assert: async () => {
          ctx.assert(result.status === 0, result.error?.message ?? "HTTP export checks exited successfully");
          ctx.assert((result.stdout.match(/^PASS:/gm) ?? []).length === 4, "All four export assertions completed");
        },
      });
    },
  }],
};
