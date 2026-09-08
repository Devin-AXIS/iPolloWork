import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Internal proof of transport and pixel invariants, NOT a live AI quality claim.
// UI reproduction: select a region in Image Studio and click AI annotation.
// Selection alone stays local to the canvas; the explicit action adds one chat reference.
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
  title: "图片选区：自然融合、像素保护与显式 AI 批注",
  kind: "internal",
  requiresApp: true,
  steps: [
    {
      name: "启动页图标比例",
      async run(ctx) {
        const html = await readFile(new URL("../../examples/plugin-packages/image-studio/ui/image-studio.html", import.meta.url), "utf8");
        await ctx.eval(`(() => {
          const host = document.createElement('section');
          host.id = 'image-start-icon-proof';
          host.style.cssText = 'position:fixed;inset:0;z-index:100;background:#f4f4f2';
          const frame = document.createElement('iframe');
          frame.title = '图片工作台启动页图标验证';
          frame.style.cssText = 'width:100%;height:100%;border:0';
          frame.srcdoc = ${JSON.stringify(html)};
          host.append(frame);
          document.body.append(host);
        })()`);
        try {
          await ctx.waitFor(`Boolean(document.querySelector('iframe[title="图片工作台启动页图标验证"]')?.contentDocument?.querySelector('.empty-orb'))`);
          await ctx.prove("Start icon uses a centered black mark on a white rounded tile", {
            voiceover: "图片工作台启动页使用白色底板、八像素圆角，黑色图形按三分之二比例居中。",
            assert: async () => {
              const result = await ctx.eval(`(() => {
                const doc = document.querySelector('iframe[title="图片工作台启动页图标验证"]').contentDocument;
                const tile = doc.querySelector('.empty-orb');
                const icon = tile.querySelector('img');
                const tileStyle = getComputedStyle(tile);
                const tileRect = tile.getBoundingClientRect();
                const iconRect = icon.getBoundingClientRect();
                return {
                  white: tileStyle.backgroundColor === 'rgb(255, 255, 255)',
                  radius: tileStyle.borderRadius === '8px',
                  sizes: tileRect.width === 48 && tileRect.height === 48 && iconRect.width === 32 && iconRect.height === 32,
                  centered: iconRect.left - tileRect.left === 8 && iconRect.top - tileRect.top === 8,
                  naturalColor: getComputedStyle(icon).filter === 'none',
                };
              })()`);
              ctx.assert(result.white && result.radius && result.sizes && result.centered && result.naturalColor, JSON.stringify(result));
            },
            screenshot: { name: "image-studio-start-icon" },
          });
        } finally {
          await ctx.eval(`document.querySelector('#image-start-icon-proof')?.remove()`);
        }
      },
    },
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
      name: "只有 AI 批注进入对话",
      async run(ctx) {
        await ctx.prove("Selection remains on canvas until the user explicitly asks AI", {
          voiceover: "完成图片选区不会自动附加到对话；只有点击 AI 批注才会添加一个可移除的图片引用。",
          assert: async () => {
            const result = await runTests(["apps/app/tests/design-ai-composer.test.ts", "apps/app/tests/session-output-regressions.test.ts"]);
            ctx.output("Explicit Image Studio annotation and artifact routing tests", result.output);
            ctx.assert(result.code === 0, "Only explicit AI annotation is wired to the composer and artifact routing remains valid");
          },
        });
      },
    },
  ],
};
