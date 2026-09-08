import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openAiImageGenerationStatus } from "../../apps/server/dist/extensions/openai-image-generation.js";

// Production frame, inspector, bridge and Image Studio HTML; only provider I/O
// is simulated. No API credits, credentials or workspace artifacts are used.
async function mountFixture(html, resource, catalog) {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOMClient } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { MemoryRouter, useLocation } = await import(modules.find((url) => /react-router-dom/.test(url)));
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
      if (input.action === "import-image") {
        return { ok: true, result: { path: "/fixture/image.png", name: input.args.filename, dataUrl: input.args.dataUrl, revision: "fixture" } };
      }
      requests.push(input);
      // Deliberately stop before output rendering: this proof concerns parameters,
      // not a generated-image claim. The actual request is asserted below.
      return { ok: false, message: "参数验证完成：已截获请求，未调用收费接口。" };
    },
  };
  function RouteProbe() {
    const location = useLocation();
    return React.createElement("span", { id: "image-parameters-route", hidden: true, "data-pathname": location.pathname });
  }
  root.render(React.createElement(MemoryRouter, null,
    React.createElement(PlatformProvider, { value: createDefaultPlatform() },
      React.createElement(RouteProbe),
      React.createElement("h1", { className: "text-xl font-semibold" }, "图片参数 · 模型切换验证"),
      React.createElement("p", { className: "text-sm text-muted-foreground" }, "真实工作台与参数面板，模拟供应商连接，不消耗生图额度"),
      React.createElement("div", { className: "flex-1 min-h-0 border rounded-xl overflow-hidden" },
        React.createElement(WorkspaceAppFrame, {
          surface: { id: "image-parameters-proof", pluginId: "image-parameters-proof", label: "图片参数验证", resource },
          client, workspaceId: "image-parameters-proof", workspaceRoot: "", placement: "workspace",
          resourceOverride: { pluginId: "image-parameters-proof", resource, html },
        })))));
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
      const imageFixture = fileURLToPath(new URL("../../vendor/hyperframes/assets/logo.png", import.meta.url));
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
        await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#generateMode').click()`);
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
        await ctx.prove("Narrow Image Studio keeps a vertical 32px toolbar visible and explains point annotations", {
          voiceover: "窄面板下工具栏贴在画布左侧纵向排列，按钮保持统一尺寸；没有选区时点击 AI 批注，会提示用户在图片上添加批注点。",
          action: async () => {
            await ctx.trustedClick('button[aria-label="Close settings"]');
            await ctx.waitFor(`!document.querySelector('textarea[name="prompt"]')`);
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
            await ctx.eval(`(() => {
              const frame = document.querySelector('iframe[title="图片参数验证"]');
              Object.assign(frame.style, { position: "fixed", top: "0", right: "0", width: "420px", height: "100vh", zIndex: "60" });
            })()`);
            const input = await ctx.client.send("Runtime.evaluate", {
              expression: `document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#fileInput')`,
              returnByValue: false,
            });
            await ctx.client.send("DOM.setFileInputFiles", { objectId: input.result.objectId, files: [imageFixture] });
            await ctx.client.send("Runtime.releaseObject", { objectId: input.result.objectId });
            await ctx.waitFor(`Boolean(document.querySelector('iframe[title="图片参数验证"]')?.contentDocument?.querySelector('#canvasWrap.visible'))`);
            await ctx.eval(`(() => {
              const doc = document.querySelector('iframe[title="图片参数验证"]').contentDocument;
              if (!doc.querySelector('#selectionActions').hidden) doc.querySelector('#selectionClear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
              doc.querySelector('#askAi').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#annotationHint')?.hidden === false`);
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const doc = document.querySelector('iframe[title="图片参数验证"]').contentDocument;
              const toolbar = doc.querySelector('#toolbar');
              const tools = [...toolbar.querySelectorAll('.tool.compact')];
              const rows = new Set(tools.map((tool) => Math.round(tool.getBoundingClientRect().top)));
              const toolbarRect = toolbar.getBoundingClientRect();
              return {
                noHorizontalOverflow: doc.documentElement.scrollWidth <= doc.documentElement.clientWidth,
                insideViewport: toolbarRect.left >= 0 && toolbarRect.right <= doc.documentElement.clientWidth,
                vertical: toolbarRect.width < 80 && rows.size === tools.length,
                toolSizes: tools.every((tool) => tool.getBoundingClientRect().width === 32 && tool.getBoundingClientRect().height === 32),
                modeSizes: [...doc.querySelectorAll('.mode-switch button')].every((button) => button.getBoundingClientRect().height === 32),
                annotationMode: doc.querySelector('#selectionCanvas').dataset.annotation === 'true',
                annotationHint: !doc.querySelector('#annotationHint').hidden && doc.querySelector('#annotationHint').textContent.includes('点击需要批注的位置'),
              };
            })()`);
            ctx.assert(result.noHorizontalOverflow && result.insideViewport, JSON.stringify(result));
            ctx.assert(result.vertical && result.toolSizes && result.modeSizes, JSON.stringify(result));
            ctx.assert(result.annotationMode && result.annotationHint, JSON.stringify(result));
          },
          screenshot: { name: "narrow-toolbar-annotation" },
        });
        await ctx.prove("Brush controls open beside the narrow vertical toolbar", {
          voiceover: "点击画笔后，大小和硬度设置紧贴工具栏向右展开，不遮住整列工具。",
          action: async () => {
            await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('[data-tool="brush"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#brushOptions')?.hidden === false`);
          },
          assert: async () => {
            const placement = await ctx.eval(`(() => {
              const doc = document.querySelector('iframe[title="图片参数验证"]').contentDocument;
              const toolbar = doc.querySelector('#toolbar').getBoundingClientRect();
              const options = doc.querySelector('#brushOptions').getBoundingClientRect();
              return { adjacent: options.left >= toolbar.right, insideViewport: options.right <= doc.documentElement.clientWidth };
            })()`);
            ctx.assert(placement.adjacent && placement.insideViewport, JSON.stringify(placement));
          },
          screenshot: { name: "narrow-brush-controls" },
        });
        await ctx.prove("Top navigation exposes replacement and direct download", {
          voiceover: "有图片时，顶部导航连续提供替换图片和下载；模型名称空间不足时会截断，但连接状态始终保留。",
          action: async () => {
            await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').style.width = '900px'`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片参数验证"]').contentWindow.innerWidth === 900`);
            await ctx.eval(`(() => {
              const frameWindow = document.querySelector('iframe[title="图片参数验证"]').contentWindow;
              const doc = frameWindow.document;
              const originalClick = frameWindow.HTMLAnchorElement.prototype.click;
              frameWindow.HTMLAnchorElement.prototype.click = function () {
                frameWindow.__downloadProof = { filename: this.download, imageData: this.href.startsWith('data:image/') };
              };
              doc.querySelector('#downloadImage').dispatchEvent(new MouseEvent('click', { bubbles: true }));
              frameWindow.HTMLAnchorElement.prototype.click = originalClick;
            })()`);
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const frame = document.querySelector('iframe[title="图片参数验证"]');
              const doc = frame.contentDocument;
              const replace = doc.querySelector('#topImport');
              const download = doc.querySelector('#downloadImage');
              const providerName = doc.querySelector('#providerName');
              const providerStatus = doc.querySelector('#providerStatus');
              return {
                actionsVisible: !replace.hidden && !download.hidden,
                ordered: replace.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING,
                downloaded: frame.contentWindow.__downloadProof,
                providerNameCanShrink: getComputedStyle(providerName).textOverflow === 'ellipsis' && getComputedStyle(providerName).minWidth === '0px',
                connectionVisible: providerStatus.textContent === '已连接',
              };
            })()`);
            ctx.assert(result.actionsVisible && result.ordered, JSON.stringify(result));
            ctx.assert(result.downloaded?.imageData && result.downloaded?.filename, JSON.stringify(result));
            ctx.assert(result.providerNameCanShrink && result.connectionVisible, JSON.stringify(result));
          },
          screenshot: { name: "top-navigation-download" },
        });
        await ctx.prove("Viewport controls stay unobtrusive at bottom left", {
          voiceover: "画布缩放与适合窗口固定在左下角，采用透明背景，不再打开会遮挡内容的菜单。",
          action: async () => {
            await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').style.width = '700px'`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片参数验证"]').contentWindow.innerWidth === 700`);
            await ctx.eval(`(() => {
              const doc = document.querySelector('iframe[title="图片参数验证"]').contentDocument;
              doc.querySelector('#fitWindow').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#zoomValue')?.textContent.endsWith('%')`);
          },
          assert: async () => {
            const placement = await ctx.eval(`(() => {
              const doc = document.querySelector('iframe[title="图片参数验证"]').contentDocument;
              const controls = doc.querySelector('#zoomControls');
              const rect = controls.getBoundingClientRect();
              const styles = getComputedStyle(controls);
              return {
                bottomLeft: rect.left === 16 && Math.round(doc.documentElement.clientHeight - rect.bottom) === 16,
                transparent: styles.backgroundColor === 'rgba(0, 0, 0, 0)' && styles.borderTopWidth === '0px' && styles.boxShadow === 'none',
                noMenu: !doc.querySelector('#zoomMenu'),
                fitVisible: !doc.querySelector('#fitWindow').hidden,
              };
            })()`);
            ctx.assert(placement.bottomLeft && placement.transparent && placement.noMenu && placement.fitVisible, JSON.stringify(placement));
          },
          screenshot: { name: "bottom-left-viewport-controls" },
        });
        await ctx.prove("The full image model catalog remains visible and unconnected models open Authorization Center", {
          voiceover: "图片模型下拉保留完整目录。已连接模型可直接使用，未连接模型标明状态并跳转授权中心，暂不可用模型保持禁用。",
          action: async () => {
            await ctx.eval("window.__imageParametersProof?.cleanup()");
            const partialCatalog = {
              ...catalog,
              defaultModel: "openai/gpt-image-2-codex",
              models: catalog.models.map((model) => ({
                ...model,
                configured: model.id === "openai/gpt-image-2-codex",
              })),
            };
            await ctx.eval(`(${mountFixture.toString()})(${JSON.stringify(html)},${JSON.stringify(resource)},${JSON.stringify(partialCatalog)})`, { awaitPromise: true });
            await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"图片参数验证\"]')?.contentDocument?.querySelector('#provider.ready'))");
            await ctx.eval(`document.querySelector('iframe[title="图片参数验证"]').contentDocument.querySelector('#generateMode').click()`);
            await ctx.waitFor('Boolean(document.querySelector(\'[aria-label="图片模型"]\'))');
            await ctx.trustedClick('[aria-label="图片模型"]');
            await ctx.waitFor(`(() => {
              const options = Array.from(document.querySelectorAll('[role="option"]'));
              const api = options.find((option) => option.textContent.trim() === 'GPT Image 2 · API · 未连接');
              const unavailable = options.find((option) => option.textContent.trim() === 'Midjourney · 暂不可用');
              if (!api || !unavailable) return false;
              api.dataset.imageProofAuthorization = 'true';
              return unavailable.getAttribute('aria-disabled') === 'true' || unavailable.hasAttribute('data-disabled');
            })()`);
            await ctx.trustedClick('[data-image-proof-authorization="true"]');
            await ctx.waitFor(`document.querySelector('#image-parameters-route')?.dataset.pathname === '/workspace/image-parameters-proof/settings/authorizations'`);
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`document.querySelector('#image-parameters-route')?.dataset.pathname === '/workspace/image-parameters-proof/settings/authorizations'`), "Unconnected model must route to Authorization Center");
          },
          screenshot: { name: "unconnected-model-authorization" },
        });
      } finally {
        await ctx.eval("window.__imageParametersProof?.cleanup()");
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      }
    },
  }],
};
