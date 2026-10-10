import { readFile } from "node:fs/promises";

// Mount the production frame, bridge, inspector, and workbench HTML. Provider
// calls are intercepted so the proof cannot consume image or video credits.
async function mountStudio(html, resource, pluginId, label, status) {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOMClient } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { MemoryRouter } = await import(modules.find((url) => /react-router-dom/.test(url)));
  const frameUrl = `/src/react-app/plugin-ui/workspace-app-frame.tsx?fraimz=${Date.now()}`;
  const frameSource = await (await fetch(frameUrl)).text();
  const { WorkspaceAppFrame } = await import(frameUrl);
  const platformUrl = frameSource.match(/from "([^"]*kernel\/platform\.tsx[^"]*)"/)[1];
  const { PlatformProvider, createDefaultPlatform } = await import(platformUrl);
  const host = document.createElement("section");
  host.id = "fraimz-media-model-selection";
  host.className = "fixed inset-0 z-40 bg-background text-foreground flex flex-col p-6 gap-3";
  document.body.append(host);
  const root = ReactDOMClient.createRoot(host, {onUncaughtError: error => { host.textContent = error.stack; }});
  const requests = [];
  const client = {
    baseUrl: "http://media-model-selection.invalid",
    async callExtensionAction(input) {
      if (["status", "image-status", "video-status"].includes(input.action)) return { ok: true, result: status };
      if (["jobs", "video-jobs"].includes(input.action)) return { ok: true, result: { jobs: [] } };
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

async function chooseWorkbenchModel(ctx, frameTitle, optionLabel, openMenu = true) {
  if (openMenu) await ctx.eval(`document.querySelector('iframe[title=${JSON.stringify(frameTitle)}]').contentDocument.querySelector('#modelMenu').click()`);
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

async function proveModelGuide(ctx, kind) {
  await ctx.prove(`${kind} output settings explain why model selection is needed`, {
    voiceover: '点击比例后，先说明不同模型支持的参数不同，再通过去选择模型继续操作。',
    action: async () => {
      await ctx.trustedClick('#fraimz-media-model-selection [data-output-settings]');
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=media-output-model-guide]'))");
    },
    assert: async () => {
      await ctx.waitFor("!document.querySelector('[data-testid=media-output-model-guide]').getAnimations().some(a=>a.playState==='running')");
      const text = await ctx.eval("document.querySelector('[data-testid=media-output-model-guide]').textContent");
      ctx.assert(text.includes('先选择生成模型') && text.includes('不同模型') && text.includes('去选择模型'), 'The guide explains the dependency and provides a clear next action');
    },
    screenshot: {name:`${kind}-model-guide`, requireText:['先选择生成模型','去选择模型']},
  });
  await ctx.prove(`${kind} guidance opens the existing model menu at the top right`, {
    voiceover: '点击去选择模型，提示收起，右上角的模型列表打开。',
    action: async () => {
      await ctx.trustedClick('[data-testid=media-output-model-guide] button');
      await ctx.waitFor("[...document.querySelectorAll('[role=menuitemradio]')].some(b=>b.checkVisibility())");
    },
    assert: async () => {
      ctx.assert(await ctx.eval("!document.querySelector('[data-testid=media-output-model-guide]')"), 'The guide closes when the model list opens');
      ctx.assert(await ctx.eval("(() => { const option=[...document.querySelectorAll('[role=menuitemradio]')].find(b=>b.checkVisibility()); const output=document.querySelector('#fraimz-media-model-selection [data-output-settings]'); return option.getBoundingClientRect().top < output.getBoundingClientRect().top; })()"), 'The existing model menu opens above the bottom parameters');
    },
    screenshot: {name:`${kind}-model-menu`, requireText:[kind==='image'?'GPT Image 2 · API':'MiniMax H3 · RunningHub 工作流']},
  });
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
  kind: "user-facing",
  steps: [{
    name: "Generation stays locked until the user chooses a configured model",
    async run(ctx) {
      const imageRoot = new URL("../../examples/plugin-packages/media-studio/", import.meta.url);
      const videoRoot = new URL("../../examples/plugin-packages/media-studio/", import.meta.url);
      const imageHtml = await readFile(new URL("ui/image-studio.html", imageRoot), "utf8");
      const videoHtml = await readFile(new URL("ui/video-console.html", videoRoot), "utf8");
      const imageManifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", imageRoot), "utf8"));
      const videoManifest = JSON.parse(await readFile(new URL("ipollowork.plugin.json", videoRoot), "utf8"));
      const imageResource = imageManifest.resources.find((item) => item.type === "ui");
      const videoResource = videoManifest.resources.find((item) => item.type === "ui" && item.id === "console");
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      try {
        await ctx.prove("Image Studio waits for the user's configured-model choice", {
          voiceover: "从比例入口选择图片模型后，自动回到参数设置，可以继续选择图片尺寸。",
          action: async () => {
            await ctx.eval(`(${mountStudio.toString()})(${JSON.stringify(imageHtml)},${JSON.stringify(imageResource)},"media-studio","图片工作台",${JSON.stringify(imageStatus())})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument?.querySelector('#generateMode'))");
            await ctx.eval(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.waitFor("Boolean(document.querySelector('#fraimz-media-model-selection textarea[name=\"prompt\"]'))");
            await ctx.fill('#fraimz-media-model-selection textarea[name="prompt"]', "一只在霓虹城市奔跑的机械猫");
            ctx.assert(await ctx.eval(`document.querySelector('#fraimz-media-model-selection [data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === true`), "Image generation must be disabled before model selection");
            await ctx.waitFor(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#providerName').textContent.includes('选择图片模型')`);
            ctx.assert(await ctx.eval("Boolean(document.querySelector('#fraimz-media-model-selection [data-output-settings]'))"), "Image parameter entry remains visible before model selection");
            await proveModelGuide(ctx, "image");
            await chooseWorkbenchModel(ctx, "图片工作台", "GPT Image 2 · API", false);
            await ctx.waitFor(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#providerName').textContent.includes('GPT Image 2')`);
            await ctx.waitFor(`document.querySelector('#fraimz-media-model-selection [data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === false`);
          },
          assert: async () => {
            ctx.assert((await ctx.eval("window.__mediaModelSelectionProof.requests.length")) === 0, "Model selection must not submit a generation request");
            ctx.assert(await ctx.eval("document.querySelector('#fraimz-media-model-selection [data-output-settings]').disabled === false"), "Selected model enables parameter settings");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=media-output-parameters]'))");
            ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=media-output-parameters] fieldset'))"), "The parameter panel opens automatically after the guided model selection");
            await ctx.waitFor("Boolean(document.querySelector('#fraimz-media-model-selection input[name=size]'))");
            ctx.assert(await ctx.eval("document.querySelector('#fraimz-media-model-selection input[name=size]').value === 'auto'"), "Image size settings are retained");
            ctx.assert(await ctx.eval("Boolean(document.querySelector('#fraimz-media-model-selection button[aria-label=\"创作偏好\"]'))"), "Creative preferences are retained");
          },
          screenshot: { name: "image-user-selected-model", requireText: ["图片工作台 · 用户选择模型验证", "生成图片"] },
        });
        await ctx.eval("window.__mediaModelSelectionProof.cleanup()");
        await ctx.prove("Video Studio waits for the user's configured-model choice", {
          voiceover: "视频也支持同样的引导，选好模型后自动展开画幅、分辨率和时长。",
          action: async () => {
            await ctx.eval(`(${mountStudio.toString()})(${JSON.stringify(videoHtml)},${JSON.stringify(videoResource)},"media-studio","视频工作台",${JSON.stringify(videoStatus())})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"视频工作台\"]')?.contentDocument?.querySelector('#generateMode'))");
            await ctx.eval(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.eval(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#settings').click()`);
            await ctx.waitFor("Boolean(document.querySelector('#fraimz-media-model-selection textarea[name=\"prompt\"]'))");
            await ctx.fill('#fraimz-media-model-selection textarea[name="prompt"]', "雨夜街头的霓虹倒影缓慢流动");
            ctx.assert(await ctx.eval(`document.querySelector('#fraimz-media-model-selection [data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === true`), "Video generation must be disabled before model selection");
            await ctx.waitFor(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#modelName').textContent.includes('请选择')`);
            ctx.assert(await ctx.eval("Boolean(document.querySelector('#fraimz-media-model-selection [data-output-settings]'))"), "Video parameter entry remains visible before model selection");
            await proveModelGuide(ctx, "video");
            await chooseWorkbenchModel(ctx, "视频工作台", "MiniMax H3 · RunningHub 工作流", false);
            await ctx.waitFor(`document.querySelector('iframe[title="视频工作台"]').contentDocument.querySelector('#modelName').textContent.includes('MiniMax H3')`);
            await ctx.waitFor(`document.querySelector('#fraimz-media-model-selection [data-testid="workspace-app-inspector"] button[type="submit"]')?.disabled === false`);
          },
          assert: async () => {
            ctx.assert((await ctx.eval("window.__mediaModelSelectionProof.requests.length")) === 0, "Model selection must not submit a video request");
            ctx.assert(await ctx.eval("document.querySelector('#fraimz-media-model-selection [data-output-settings]').disabled === false"), "Selected model enables parameter settings");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=media-output-parameters]'))");
            ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=media-output-parameters] fieldset'))"), "The parameter panel opens automatically after the guided model selection");
            ctx.assert(await ctx.eval("['ratio','resolution','duration'].every(name=>document.querySelector('#fraimz-media-model-selection input[name='+name+']'))"), "Video ratio, resolution and duration are retained");
          },
          screenshot: { name: "video-user-selected-model", requireText: ["视频工作台 · 用户选择模型验证", "生成视频"] },
        });
        await ctx.eval("window.__mediaModelSelectionProof.cleanup()");
        await ctx.prove("Cancelling guided selection preserves the normal model-selection behavior", {
          voiceover: '取消引导后，直接从右上角选择模型不会突然弹出比例设置；需要时仍可点击底部参数按钮。',
          action: async () => {
            await ctx.eval(`(${mountStudio.toString()})(${JSON.stringify(imageHtml)},${JSON.stringify(imageResource)},"media-studio","图片工作台",${JSON.stringify(imageStatus())})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument?.querySelector('#generateMode'))");
            await ctx.eval(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.waitFor("Boolean(document.querySelector('#fraimz-media-model-selection [data-output-settings]'))");
            await ctx.trustedClick('#fraimz-media-model-selection [data-output-settings]');
            await ctx.trustedClick('[data-testid=media-output-model-guide] button');
            await ctx.waitFor("[...document.querySelectorAll('[role=menuitemradio]')].some(b=>b.checkVisibility())");
            await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
            await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
            await ctx.waitFor("![...document.querySelectorAll('[role=menuitemradio]')].some(b=>b.checkVisibility())");
            await chooseWorkbenchModel(ctx, "图片工作台", "GPT Image 2 · API");
            await ctx.waitFor("Boolean(document.querySelector('#fraimz-media-model-selection input[name=size]'))");
          },
          assert: async () => {
            ctx.assert(await ctx.eval("!document.querySelector('[data-testid=media-output-parameters]')"), 'Cancelled guidance does not reopen parameters after an unrelated model selection');
            ctx.assert((await ctx.eval("window.__mediaModelSelectionProof.requests.length")) === 0, 'No generation is submitted');
          },
          screenshot: {name:'model-guidance-cancelled', requireText:['图片工作台 · 用户选择模型验证']},
        });
      } finally {
        await ctx.eval("window.__mediaModelSelectionProof?.cleanup()");
      }
    },
  }],
};
