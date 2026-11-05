let workspaceId = process.env.IPOLLOWORK_EVAL_WORKSPACE_ID || "";
let sessionId = process.env.IPOLLOWORK_EVAL_SESSION_ID || "";
const MODEL = "GPT Image 2 · ChatGPT 登录";

export default {
  id: "openai-image-browser-login",
  title: "Authorization Center shares OpenAI browser login with Image Studio",
  kind: "user-facing",
  steps: [
    {
      name: "Shared OpenAI account and browser login",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        const currentHash = await ctx.eval("location.hash");
        const currentSession = currentHash.match(/^#\/workspace\/([^/]+)\/session\/([^/]+)/);
        workspaceId ||= currentSession?.[1] || "";
        sessionId ||= currentSession?.[2] || "";
        ctx.assert(workspaceId && sessionId, "Open an existing session first, or set IPOLLOWORK_EVAL_WORKSPACE_ID and IPOLLOWORK_EVAL_SESSION_ID.");
        await ctx.client.send("Page.bringToFront");
        await ctx.client.send("Page.enable");
        await ctx.eval(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
        await ctx.navigateHash(`/workspace/${workspaceId}/settings/authorizations`);
        await ctx.waitForText("浏览器登录", { timeoutMs: 30_000 });
        await ctx.prove("Authorization Center preserves API credentials and recognizes the shared ChatGPT account", {
          voiceover: "授权中心现在会识别模型供应商中已登录的 ChatGPT 账号，API Key 仍单独保留。",
          action: async () => {
            await ctx.waitForText("ChatGPT · 已登录", { timeoutMs: 20_000 });
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
            await ctx.eval("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 600))))", { awaitPromise: true });
          },
          assert: async () => {
            await ctx.expectText("配置 API Key");
            await ctx.expectText("测试 API");
            await ctx.expectText("ChatGPT · 已登录");
          },
          screenshot: { name: "openai-shared-authorization", requireText: ["ChatGPT · 已登录", "浏览器登录", "配置 API Key"] },
        });
        await ctx.prove("Browser sign-in opens the same OpenAI provider login chooser", {
          voiceover: "点击浏览器登录，可以使用与模型供应商相同的 ChatGPT 浏览器授权流程。",
          action: async () => {
            await ctx.clickText("浏览器登录");
            await ctx.waitFor(`document.querySelector('[role="dialog"]')?.innerText.includes('ChatGPT Pro/Plus (browser)')`, { timeoutMs: 30_000 });
            await ctx.eval("new Promise(resolve => setTimeout(resolve, 600))", { awaitPromise: true });
          },
          assert: async () => {
            const text = await ctx.eval(`document.querySelector('[role="dialog"]')?.innerText || ''`);
            ctx.assert(text.includes("ChatGPT Pro/Plus (browser)"), "OpenAI browser login method is missing");
            ctx.assert(text.includes("Manually enter API Key"), "Existing provider login chooser was not reused");
          },
          screenshot: { name: "openai-provider-browser-method", requireText: ["ChatGPT Pro/Plus (browser)", "Connect providers"] },
        });
        await ctx.eval(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      },
    },
    {
      name: "Generate through the browser account in Image Studio",
      run: async (ctx) => {
        await ctx.navigateHash(`/workspace/${workspaceId}/session/${sessionId}`);
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        if (!await ctx.eval(`Boolean(document.querySelector('iframe[title="图片工作台"]'))`)) {
          await ctx.eval(`document.querySelector('button[aria-label="添加侧面板入口"]')?.click()`);
          await ctx.clickText("图片工作台");
        }
        await ctx.waitFor(`Boolean(document.querySelector('iframe[title="图片工作台"]')?.contentDocument?.querySelector('#busyLayer'))`, { timeoutMs: 20_000 });
        if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) {
          await ctx.eval(`Array.from(document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelectorAll('button')).find(b=>b.textContent.trim()==='参数')?.click()`);
        }
        await ctx.waitFor(`Boolean(document.querySelector('[aria-label="图片模型"]'))`, { timeoutMs: 20_000 });
        await ctx.prove("The browser-login model returns a generated PNG in the workbench", {
          voiceover: "选择 ChatGPT 登录模型，输入后羿射日并生成，图片会保存在当前工作区并显示在工作台。",
          action: async () => {
            await ctx.eval(`Array.from(document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelectorAll('button')).find(b=>b.textContent.trim()==='生成')?.click()`);
            if (!await ctx.eval(`Boolean(document.querySelector('[role="listbox"]'))`)) {
              await ctx.eval(`document.querySelector('[aria-label="图片模型"]')?.click()`);
            }
            await ctx.waitFor(`Array.from(document.querySelectorAll('[role="option"]')).some(e=>e.textContent.trim()===${JSON.stringify(MODEL)})`);
            const point = await ctx.eval(`(() => {
              const rect = Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(MODEL)}).getBoundingClientRect();
              return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
            })()`);
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
            await ctx.waitFor(`document.querySelector('[aria-label="图片模型"]')?.textContent.includes(${JSON.stringify(MODEL)}) && !document.querySelector('[role="listbox"]')`);
            await ctx.fill('textarea[name="prompt"]', "生成一张后羿射日的中国神话插画，弓箭手面对天空的太阳，金色与青绿色，精细插画。");
            await ctx.eval(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='生成图片')?.click()`);
            await ctx.waitFor(`document.querySelector('iframe[title="图片工作台"]')?.contentDocument?.querySelector('#busyLayer.visible')`, { timeoutMs: 15_000 });
            await ctx.waitFor(`!document.querySelector('iframe[title="图片工作台"]')?.contentDocument?.querySelector('#busyLayer.visible')`, { timeoutMs: 420_000 });
            await ctx.waitFor(`document.body.innerText.includes('已另存为') || Array.from(document.querySelectorAll('[role="status"]')).some(e=>e.textContent.trim())`, { timeoutMs: 10_000 });
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
            await ctx.eval("new Promise(resolve => setTimeout(resolve, 600))", { awaitPromise: true });
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const studio = document.querySelector('iframe[title="图片工作台"]').contentDocument;
              const canvas = studio.querySelector('#imageCanvas');
              return { visible:!!studio.querySelector('#canvasWrap.visible'), width:canvas?.width, height:canvas?.height,
                saved:document.body.innerText.includes('已另存为'),
                status:Array.from(document.querySelectorAll('[role="status"]')).map(e=>e.textContent).join(' '),
                model:document.querySelector('[aria-label="图片模型"]')?.textContent };
            })()`);
            ctx.assert(result.model?.includes(MODEL), "The selected billing source is not ChatGPT login");
            ctx.assert(result.visible && result.width > 100 && result.height > 100, `No generated image: ${JSON.stringify(result)}`);
            ctx.assert(result.saved, `Image was not saved: ${result.status}`);
            ctx.log(JSON.stringify(result));
          },
          screenshot: { name: "chatgpt-image-generated", requireText: [MODEL, "图片参数"], rejectText: ["Unexpected server error", "request_timeout"] },
        });
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      },
    },
  ],
};
