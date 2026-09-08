import { readFile } from "node:fs/promises";
import { openAiImageGenerationStatus } from "../../apps/server/dist/extensions/openai-image-generation.js";

// Production frame, inspector, bridge and Image Studio HTML; only provider I/O
// is simulated. No API credits, credentials or workspace artifacts are used.
async function mountFixture(html, resource, catalog) {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOMClient } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { WorkspaceAppFrame } = await import(`/src/react-app/plugin-ui/workspace-app-frame.tsx?fraimz=${Date.now()}`);
  const { PlatformProvider, createDefaultPlatform } = await import("/src/react-app/kernel/platform.tsx");
  const host = document.createElement("section");
  host.id = "fraimz-image-parameters";
  host.className = "fixed inset-0 z-40 bg-background text-foreground flex flex-col p-6 gap-3";
  document.body.append(host);
  const root = ReactDOMClient.createRoot(host);
  const requests = [];
  const client = {
    baseUrl: "http://image-parameters.invalid",
    async callExtensionAction(input) {
      if (input.action === "status") return { ok: true, result: catalog };
      requests.push(input);
      // Deliberately stop before output rendering: this proof concerns parameters,
      // not a generated-image claim. The actual request is asserted below.
      return { ok: false, message: "参数验证完成：已截获请求，未调用收费接口。" };
    },
  };
  root.render(React.createElement(PlatformProvider, { value: createDefaultPlatform() },
    React.createElement("h1", { className: "text-xl font-semibold" }, "图片参数 · 模型切换验证"),
    React.createElement("p", { className: "text-sm text-muted-foreground" }, "真实工作台与参数面板，模拟供应商连接，不消耗生图额度"),
    React.createElement("div", { className: "flex-1 min-h-0 border rounded-xl overflow-hidden" },
      React.createElement(WorkspaceAppFrame, {
        surface: { id: "image-parameters-proof", pluginId: "image-parameters-proof", label: "图片参数验证", resource },
        client, workspaceId: "image-parameters-proof", workspaceRoot: "", placement: "workspace",
        resourceOverride: { pluginId: "image-parameters-proof", resource, html },
      }))));
  window.__imageParametersProof = {
    requests,
    cleanup() { root.unmount(); host.remove(); delete window.__imageParametersProof; },
  };
}

async function choose(ctx, label, option) {
  const trigger = `[aria-label=${JSON.stringify(label)}]`;
  await ctx.trustedClick(trigger);
  await ctx.waitFor(`(() => {
    document.querySelectorAll('[data-image-proof-option]').forEach(el => el.removeAttribute('data-image-proof-option'));
    const target = Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent.trim() === ${JSON.stringify(option)});
    if (!target) return false;
    target.dataset.imageProofOption = "true";
    return true;
  })()`);
  await ctx.trustedClick('[data-image-proof-option="true"]');
  await ctx.waitFor(`(() => {
    const target = document.querySelector(${JSON.stringify(trigger)});
    return target && target.getAttribute("aria-expanded") !== "true" && target.textContent.includes(${JSON.stringify(option)});
  })()`);
}

export default {
  id: "image-studio-parameters",
  title: "Image Studio uses model-specific parameters and preserves prompt drafts",
  kind: "internal",
  steps: [{
    name: "Switch native and prompt-only image providers",
    async run(ctx) {
      const packageRoot = new URL("../../examples/plugin-packages/image-studio/", import.meta.url);
      const html = await readFile(new URL("ui/image-studio.html", packageRoot), "utf8");
      const manifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", packageRoot), "utf8"));
      const resource = manifest.resources.find((item) => item.type === "ui");
      const catalog = await openAiImageGenerationStatus({
        read: async () => ({ OPENAI_API_KEY: "fixture", ARK_API_KEY: "fixture" }),
        openAiBrowserSession: async () => ({ accessToken: "fixture", accountId: "fixture" }),
      });
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      try {
        await ctx.eval("window.__imageParametersProof?.cleanup()");
        await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
        await ctx.eval(`(${mountFixture.toString()})(${JSON.stringify(html)},${JSON.stringify(resource)},${JSON.stringify(catalog)})`, { awaitPromise: true });
        await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"图片参数验证\"]')?.contentDocument?.querySelector('#provider.ready'))");
        await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#parameters').click()`);
        await ctx.waitFor('Boolean(document.querySelector(\'textarea[name="prompt"]\'))');
        await ctx.fill('textarea[name="prompt"]', "保留这段提示词：金色天空");
        await ctx.prove("OpenAI API displays native dimensions and quality with readable labels", {
          voiceover: "API 模型提供真实的输出尺寸和质量，选项显示易读名称，不再显示内部代码。",
          action: async () => {
            await choose(ctx, "质量", "高");
            await choose(ctx, "输出尺寸", "2048 × 1152 · 16:9");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`document.querySelector('[aria-label="质量"]').textContent.includes("高")`), "Quality must be High");
            ctx.assert(await ctx.eval(`document.querySelector('[aria-label="风格"]').textContent.includes("自动")`), "Auto label must be translated");
          },
          screenshot: { name: "api-parameters", requireText: ["GPT Image 2 · API", "2048 × 1152", "质量"] },
        });
        await ctx.prove("Seedream clears unsupported quality and dimensions without losing the prompt", {
          voiceover: "切换到 Seedream 后，不支持的质量选项消失，尺寸回到 2K，刚才输入的提示词仍然保留。",
          action: async () => {
            await choose(ctx, "图片模型", "即梦 Seedream 5.0");
            await ctx.waitFor(`!document.querySelector('[aria-label="质量"]') && document.querySelector('[aria-label="输出尺寸"]')?.textContent.includes("2K")`);
            await choose(ctx, "输出尺寸", "3K · 自动画幅");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`document.querySelector('textarea[name="prompt"]').value === "保留这段提示词：金色天空"`), "Prompt draft must survive the model change");
            ctx.assert(await ctx.eval(`!document.querySelector('[aria-label="质量"]')`), "Seedream cannot expose ignored quality");
          },
          screenshot: { name: "seedream-parameters", requireText: ["即梦 Seedream 5.0", "3K · 自动画幅"], rejectText: ["期望画幅"] },
        });
        await ctx.clickText("生成图片", { exact: true });
        await ctx.waitFor("window.__imageParametersProof.requests.length === 1");
        const request = await ctx.eval("window.__imageParametersProof.requests[0]");
        ctx.assert(request.args.model === "volcengine/seedream-5" && request.args.size === "3K" && !("quality" in request.args), JSON.stringify(request));
        await ctx.prove("ChatGPT login honestly exposes aspect intent rather than native quality controls", {
          voiceover: "ChatGPT 登录通道只提供提示词形式的画幅意图，面板明确说明不能精确控制尺寸和质量。",
          action: async () => {
            await choose(ctx, "图片模型", "GPT Image 2 · ChatGPT 登录");
            await ctx.waitForText("期望画幅（提示词）");
            await choose(ctx, "期望画幅（提示词）", "3:2");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`!document.querySelector('[aria-label="质量"]') && !document.querySelector('[aria-label="输出尺寸"]')`), "No misleading native controls for ChatGPT login");
          },
          screenshot: { name: "chatgpt-parameters", requireText: ["GPT Image 2 · ChatGPT 登录", "期望画幅（提示词）"] },
        });
      } finally {
        await ctx.eval("window.__imageParametersProof?.cleanup()");
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      }
    },
  }],
};
