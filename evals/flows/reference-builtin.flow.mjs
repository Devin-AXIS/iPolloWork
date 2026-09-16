import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

export default {
  id: "reference-builtin", title: "参考资料作为内置能力加载", kind: "internal", requiresApp: false,
  steps: [{ name: "内置加载与扩展目录隔离", run: async ctx => {
    await ctx.prove("参考资料不进入扩展列表，三个引擎仍加载 Skill，旧禁用和卸载状态自动恢复", {
      voiceover: "参考资料默认随软件加载，不再作为可选扩展展示，旧版本的禁用和卸载状态也会自动恢复。",
      assert: async () => {
        const result = await promisify(execFile)(process.env.BUN_EXECUTABLE || "bun", [
          "test", "src/plugin-package-lifecycle.test.ts", "--test-name-pattern",
          "shared reference Skill|projects bundled Design and Video",
        ], { cwd: resolve(process.cwd(), "apps/server"), windowsHide: true, timeout: 60000 });
        ctx.output("真实服务 HTTP 列表与引擎 Skill 文件检查", result.stdout + result.stderr);
        ctx.assert(result.stderr.includes("5 pass") && result.stderr.includes("0 fail"), "HTTP lists exclude the core Skill while engine files remain installed and enabled");
      },
    });
  } }],
};
