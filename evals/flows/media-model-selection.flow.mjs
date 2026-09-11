import { readFile } from "node:fs/promises";

// Mount the production frame, bridge, inspector, and workbench HTML. Provider
// calls are intercepted so the proof cannot consume image or video credits.
async function mountStudio(html, resource, pluginId, label, status) {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOMClient } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { MemoryRouter } = await import(modules.find((url) => /react-router-dom/.test(url)));
  const { WorkspaceAppFrame } = await import(`/src/react-app/plugin-ui/workspace-app-frame.tsx?fraimz=${Date.now()}`);
  const { PlatformProvider, createDefaultPlatform } = await import("/src/react-app/kernel/platform.tsx");
  const host = document.createElement("section");
  host.id = "fraimz-media-model-selection";
  host.className = "fixed inset-0 z-40 bg-background text-foreground flex flex-col p-6 gap-3";
  document.body.append(host);
  const root = ReactDOMClient.createRoot(host);
  const requests = [];
  const client = {
    baseUrl: "http://media-model-selection.invalid",
    async callExtensionAction(input) {
      if (input.action === "status") return { ok: true, result: status };
      if (input.action === "jobs") return { ok: true, result: { jobs: [] } };
      requests.push(input);
      return { ok: false, message: "验收已截获请求，未调用收费接口。" };
    },
  };
  root.render(React.createElement(MemoryRouter, null,
    React.createElement(PlatformProvider, { value: createDefaultPlatform() },
      React.createElement("h1", { className: "text-xl font-semibold" }, `${label} · 用户选择模型验证`),
      React.createElement("p", { className: "text-sm text-muted-foreground" }, "真实工作台与参数面板；生成请求已拦截，不消耗额度"),
      React.createElement("div", { className: "flex-1 min-h-0 border rounded-xl overflow-hidden" },
        React.createElement(WorkspaceAppFrame, {
          surface: { id: `${pluginId}-proof`, pluginId, label, resource },
          client,
          workspaceId: "media-model-selection-proof",
          workspaceRoot: "",
          sessionId: "media-model-selection-session",
          placement: "workspace",
          resourceOverride: { pluginId, resource, html },
        })))));
  window.__mediaModelSelectionProof = {
    requests,
    cleanup() { root.unmount(); host.remove(); delete window.__mediaModelSelectionProof; },
  };
}

async function chooseWorkbenchModel(ctx, frameTitle, optionLabel) {
  await ctx.eval(`document.querySelector('iframe[title=${JSON.stringify(frameTitle)}]').contentDocument.querySelector('#modelMenu').click()`);
  await ctx.waitFor(`(() => {
    document.querySelectorAll('[data-media-model-proof-option]').forEach(node => node.removeAttribute('data-media-model-proof-option'));
    const option = Array.from(document.querySelectorAll('[role="menuitemradio"],[role="option"]'))
      .find(node => node.textContent.trim() === ${JSON.stringify(optionLabel)} && node.getBoundingClientRect().width > 0);
    if (!option) return false;
    option.dataset.mediaModelProofOption = 'true';
    return true;
  })()`);
  await ctx.trustedClick('[data-media-model-proof-option="true"]');
}

function imageStatus() {
  return {
    defaultModel: "openai/gpt-image-2",
    models: [{
      id: "openai/gpt-image-2",
      label: "GPT Image 2 · API",
      provider: "openai",
      providerLabel: "OpenAI",
      adapter: "openai",
      upstreamModel: "gpt-image-2",
      authorizationService: "openai-images",
      credentialKey: "OPENAI_API_KEY",
      available: true,
      configured: true,
      parameters: {
        size: { values: ["auto", "1024x1024"], default: "auto", delivery: "native" },
        quality: { values: ["auto", "high"], default: "auto", delivery: "native" },
      },
      capabilities: { generate: true, edit: true, mask: true, region: true },
    }],
  };
}

function videoStatus() {
  return {
    ratios: ["adaptive", "16:9", "9:16"],
    localVideoReady: false,
    models: [{
      id: "minimax-h3",
      label: "MiniMax H3 · RunningHub 工作流",
      service: "runninghub-video",
      upstream: "fixture",
      resolutions: ["0.5MP", "1MP"],
      defaultResolution: "0.5MP",
      ratios: ["16:9", "9:16"],
      durations: ["5", "6"],
      operations: ["text", "first", "first-last"],
      imageLimit: 0,
      videoLimit: 0,
      audioLimit: 0,
      referenceSeconds: 0,
    }],
  };
}

export default {
  id: "media-model-selection",
  title: "Image and video workbenches require an explicit configured-model choice",
  kind: "internal",
  steps: [{
    name: "Generation stays locked until the user chooses a configured model",
    async run(ctx) {
      const imageRoot = new URL("../../examples/plugin-packages/image-studio/", import.meta.url);
      const videoRoot = new URL("../../examples/plugin-packages/video-console/", import.meta.url);
      const imageHtml = await readFile(new URL("ui/image-studio.html", imageRoot), "utf8");
      const videoHtml = await readFile(new URL("ui/video-console.html", videoRoot), "utf8");
      const imageManifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", imageRoot), "utf8"));
      const videoManifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", videoRoot), "utf8"));
      const imageResource = imageManifest.resources.find((item) => item.type === "ui");
      const videoResource = videoManifest.resources.find((item) => item.type === "ui");
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      try {
        await ctx.prove("Image Studio waits for the user's configured-model choice", {
          voiceover: "图片工作台不会再替用户默认选择模型。提示词可以先填写，但生成按钮保持锁定，直到用户从已配置列表中选择图片模型。",
          action: async () => {
            await ctx.eval(`(${mountStudio.toString()})(${JSON.stringify(imageHtml)},${JSON.stringify(imageResource)},"image-studio","图片工作台",${JSON.stringify(imageStatus())})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument?.querySelector('#generateMode'))");
            await ctx.eval(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
            await ctx.fill('textarea[name="prompt"]', "一只在霓虹城市奔跑的机械猫");
            ctx.assert(await ctx.eval(`document.querySelector('[data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === true`), "Image generation must be disabled before model selection");
            await ctx.waitFor(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#providerName').textContent.includes('选择图片模型')`);
            await chooseWorkbenchModel(ctx, "图片工作台", "GPT Image 2 · API");
            await ctx.waitFor(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#providerName').textContent.includes('GPT Image 2')`);
            await ctx.waitFor(`document.querySelector('[data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === false`);
          },
          assert: async () => {
            ctx.assert((await ctx.eval("window.__mediaModelSelectionProof.requests.length")) === 0, "Model selection must not submit a generation request");
          },
          screenshot: { name: "image-user-selected-model", requireText: ["图片工作台 · 用户选择模型验证", "生成图片"] },
        });
        await ctx.eval("window.__mediaModelSelectionProof.cleanup()");
        await ctx.prove("Video Studio waits for the user's configured-model choice", {
          voiceover: "视频工作台同样不再自动绑定第一个模型。用户明确选择已配置的视频模型后，参数才按该模型展开并解锁生成。",
          action: async () => {
            await ctx.eval(`(${mountStudio.toString()})(${JSON.stringify(videoHtml)},${JSON.stringify(videoResource)},"video-console","视频工作台",${JSON.stringify(videoStatus())})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"视频工作台\"]')?.contentDocument?.querySelector('#generateMode'))");
            await ctx.eval(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.eval(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#settings').click()`);
            await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
            await ctx.fill('textarea[name="prompt"]', "雨夜街头的霓虹倒影缓慢流动");
            ctx.assert(await ctx.eval(`document.querySelector('[data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === true`), "Video generation must be disabled before model selection");
            await ctx.waitFor(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#modelName').textContent.includes('请选择')`);
            await chooseWorkbenchModel(ctx, "视频工作台", "MiniMax H3 · RunningHub 工作流");
            await ctx.waitFor(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#modelName').textContent.includes('MiniMax H3')`);
            await ctx.waitFor(`document.querySelector('[data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === false`);
          },
          assert: async () => {
            ctx.assert((await ctx.eval("window.__mediaModelSelectionProof.requests.length")) === 0, "Model selection must not submit a video request");
          },
          screenshot: { name: "video-user-selected-model", requireText: ["视频工作台 · 用户选择模型验证", "生成视频"] },
        });
      } finally {
        await ctx.eval("window.__mediaModelSelectionProof?.cleanup()");
      }
    },
  }],
};
