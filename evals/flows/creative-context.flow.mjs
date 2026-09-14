import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function run(args, cwd, extraEnv = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn("bun", args, { cwd: root + cwd, env: { ...process.env, ...extraEnv }, windowsHide: true });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}
export default {
  id: "creative-context", title: "参考资料统一上下文与 Skill 分发", kind: "internal", requiresApp: false,
  steps: [
    { name: "内容、风格和素材路径", run: async (ctx) => {
      await ctx.prove("原始证据保留，用户风格优先，缺失素材阻止上下文发布", {
        voiceover: "统一上下文保留每条信息的来源，使用你修改的风格，并在文件保存完成后关联真实素材路径。",
        assert: async () => {
          const result = await run(["test", "tests/reference-ingestion.test.ts", "tests/composer-attachment-persistence.test.ts", "tests/template-brief.test.ts"], "apps/app");
          ctx.output("生产解析器、提交与持久化检查", result.output);
          ctx.assert(result.code === 0, "Rich document extraction, bounded index, edited style, durable path binding and missing-file rejection pass");
        },
      });
    } },
    ...["pdf", "docx", "pptx", "md", "txt", "csv", "json"].map((type) => ({
      name: `${type.toUpperCase()} 50 MB 回读`, run: async (ctx) => {
        await ctx.prove(`${type} 实际 50,000,000 字节经过生产服务上传、解析、重建和回读`, {
          voiceover: `${type.toUpperCase()} 的五千万字节测试文件上传后，完整证据和原文件校验一致，精简上下文能定位保存后的资料。`,
          assert: async () => {
            const result = await run(["test", "tests/reference-roundtrip.test.ts"], "apps/app", { IPOLLOWORK_REFERENCE_LARGE_TYPE: type });
            ctx.output("真实 HTTP 服务回读与 SHA-256 校验", result.output);
            ctx.assert(result.code === 0 && result.output.includes('"result":"passed"'), "Original hash, full extracted evidence and bound Creative Context read back correctly");
          },
        });
      },
    })),
    { name: "内置插件安装 Skill", run: async (ctx) => {
      await ctx.prove("reference-analyzer 随内置 Video 插件安装到工作区", {
        voiceover: "参考资料 Skill 随软件的内置插件分发，安装后可以从工作区读取使用。",
        assert: async () => {
          const result = await run(["test", "src/plugin-package-lifecycle.test.ts", "--test-name-pattern", "projects bundled Design and Video"], "apps/server");
          ctx.output("插件安装结果", result.output);
          ctx.assert(result.code === 0, "Production plugin lifecycle materializes reference-analyzer/SKILL.md");
        },
      });
    } },
  ],
};
