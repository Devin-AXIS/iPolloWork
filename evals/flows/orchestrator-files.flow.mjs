import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Build the CLI first with `pnpm --filter ipollowork-orchestrator build`.
export default {
  id: "orchestrator-files",
  title: "The built CLI edits files through an isolated local server",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Exercise file-session commands against the real server",
    async run(ctx) {
      let result;
      await ctx.prove("File-session commands preserve file contents and report write, rename and delete events", {
        voiceover: "这里用真实 CLI 和临时目录中的本地服务验证文件会话，检查文件内容、写入、重命名、删除及事件记录；配置和数据库均与日常使用环境隔离。",
        action: async () => {
          result = spawnSync(process.execPath, ["scripts/files-session.mjs"], {
            cwd: fileURLToPath(new URL("../../apps/orchestrator/", import.meta.url)),
            encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Isolated CLI file-session checks", `${result.stdout}\n${result.stderr}`);
        },
        assert: async () => {
          ctx.assert(result.status === 0, result.error?.message ?? "CLI file-session assertions completed successfully");
          const report = JSON.parse(result.stdout);
          ctx.assert(report.ok === true && typeof report.sessionId === "string", "A real file session completed all content and event assertions");
        },
      });
    },
  }],
};
