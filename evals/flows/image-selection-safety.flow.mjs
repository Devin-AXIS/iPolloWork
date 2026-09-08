import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Internal proof of transport and pixel invariants, NOT a live AI quality claim.
// UI reproduction: run evals/support/image-selection-fixture.mjs beside Vite
// on port 5188, open http://127.0.0.1:5190, draw an ellipse, subtract its centre,
// send in chat, remove the chip, reopen the output, then edit with Seedream.
function runTests(files) {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["test", ...files.map(file => `./${file}`)], { cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("exit", code => resolve({ code, output }));
  });
}

export default {
  id: "image-selection-safety",
  title: "图片选区：自然融合、像素保护与会话快照",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "原图、完整蒙版和非原生蒙版模型",
      async run(ctx) {
        await ctx.prove("All providers use the full mask and only selected output pixels change", {
          voiceover: "自然模式在选区内侧渐变，严格模式保持原始蒙版；空洞、软边和独立细小选区均受回归测试覆盖。非原生蒙版模型收到完整选区参考图。模型调用使用假响应，不代表真实生成质量。",
          assert: async () => {
            const result = await runTests(["apps/server/src/extensions/image-selection.test.ts", "apps/server/src/extensions/codex-image-generation.test.ts", "apps/server/src/extensions/openai-image-generation.test.ts"]);
            ctx.output("Mask and provider regression tests", result.output);
            ctx.assert(result.code === 0, "Mask, provider input, frozen source and session isolation tests pass");
          },
        });
      },
    },
    {
      name: "左侧对话和排队使用冻结快照",
      async run(ctx) {
        await ctx.prove("Chat send and queue preserve selection identity, image preview and model settings", {
          voiceover: "左侧发送或排队时冻结图片选区，后续切换图片或模型不会修改已经准备好的请求。捕获失败时不会悄悄发出无选区编辑。",
          assert: async () => {
            const result = await runTests(["apps/app/tests/image-selection-draft.test.ts", "apps/app/tests/session-output-regressions.test.ts"]);
            ctx.output("Chat snapshot and artifact routing tests", result.output);
            ctx.assert(result.code === 0, "Chat preview, frozen capability and artifact routing regressions pass");
          },
        });
      },
    },
  ],
};
