const IMAGE_STUDIO_TITLE = "图片工作台";
const PROMPT = "将这幅后羿射日插画的天空调整为更明亮的金色，保持人物和构图。";
const MODEL = "GPT Image 2 · ChatGPT 登录";

export default {
  id: "image-studio-provider-response",
  title: "Image Studio shows bound models and returns a ChatGPT image edit",
  kind: "user-facing",
  steps: [
    {
      name: "Select the bound ChatGPT model and save a real image edit",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.client.send("Page.enable");
        await ctx.client.send("Page.bringToFront");
        await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

        const studioOpen = await ctx.eval(`Boolean(document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]'))`);
        if (!studioOpen) {
          await ctx.eval(`(() => {
            const addPanel = document.querySelector('button[aria-label="添加侧面板入口"]');
            addPanel?.click();
            return Boolean(addPanel);
          })()`);
          await ctx.waitFor(`Array.from(document.querySelectorAll('button,[role="menuitem"]'))
            .some((element) => element.textContent?.trim() === ${JSON.stringify(IMAGE_STUDIO_TITLE)})`, {
            label: "Image Studio panel menu item",
          });
          await ctx.eval(`(() => {
            const entry = Array.from(document.querySelectorAll('button,[role="menuitem"]'))
              .find((element) => element.textContent?.trim() === ${JSON.stringify(IMAGE_STUDIO_TITLE)});
            entry?.click();
            return Boolean(entry);
          })()`);
          await ctx.waitFor(`Boolean(document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument)`, {
            timeoutMs: 15_000,
            label: "loaded Image Studio panel",
          });
        }

        const inspectorOpen = await ctx.eval("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
        if (!inspectorOpen) {
          await ctx.eval(`(() => {
            const studio = document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument;
            const settings = Array.from(studio?.querySelectorAll('button') ?? [])
              .find((button) => button.textContent?.trim() === "参数");
            settings?.click();
            return Boolean(settings);
          })()`);
          await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))", {
            label: "Image Studio inspector prompt",
          });
        }

        await ctx.eval(`(() => {
          const target = document.activeElement ?? document;
          target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return true;
        })()`);
        await ctx.waitFor("!document.querySelector('[role=\"listbox\"]')", {
          label: "stale Image Studio popover to close",
        });

        await ctx.prove("The model menu contains the bound ChatGPT account without the unbound API or unavailable models", {
          voiceover: "图片模型只显示已绑定且可用的选项，未绑定的 OpenAI API 和暂不可用的模型不再出现。",
          action: async () => {
            await ctx.eval(`document.querySelector('[aria-label="图片模型"]').click()`);
            await ctx.waitFor(`Array.from(document.querySelectorAll('[role="option"]')).some(e => e.textContent.trim() === ${JSON.stringify(MODEL)})`);
          },
          assert: async () => {
            const labels = await ctx.eval(`Array.from(document.querySelectorAll('[role="option"]')).map(e => e.textContent.trim())`);
            ctx.assert(labels.includes(MODEL), "ChatGPT browser account must be connected for this flow.");
            ctx.assert(!labels.some(label => /API|Midjourney|未连接|暂不可用/.test(label)), `Unexpected model entries: ${labels.join(", ")}`);
            ctx.log(`Bound models: ${labels.join(", ")}`);
          },
          screenshot: { name: "image-studio-bound-models", requireText: [MODEL, "图片参数"], rejectText: ["GPT Image 2 · API", "Midjourney"] },
        });
        const point = await ctx.eval(`(() => {
          const rect = Array.from(document.querySelectorAll('[role="option"]')).find(e => e.textContent.trim() === ${JSON.stringify(MODEL)}).getBoundingClientRect();
          return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        })()`);
        await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
        await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
        await ctx.waitFor(`!document.querySelector('[role="listbox"]') && document.querySelector('[aria-label="图片模型"]').textContent.includes(${JSON.stringify(MODEL)})`);

        // Use the normal file-import control when the caller supplies a fixture.
        // Otherwise the user must already have an image open in this workbench.
        if (process.env.IPOLLOWORK_EVAL_IMAGE_SOURCE) {
          const input = await ctx.client.send("Runtime.evaluate", {
            expression: `document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#fileInput')`,
            returnByValue: false,
          });
          await ctx.client.send("DOM.setFileInputFiles", { objectId: input.result.objectId, files: [process.env.IPOLLOWORK_EVAL_IMAGE_SOURCE] });
          await ctx.client.send("Runtime.releaseObject", { objectId: input.result.objectId });
        }
        await ctx.waitFor(`Boolean(document.querySelector('iframe[title="图片工作台"]')?.contentDocument?.querySelector('#canvasWrap.visible'))`, { timeoutMs: 20_000 });
        await ctx.eval(`document.querySelector('iframe[title="图片工作台"]').contentDocument.querySelector('#editMode').click()`);
        await ctx.prove("ChatGPT login returns an edited image and saves it as a new PNG", {
          voiceover: "使用 ChatGPT 登录编辑这张图片，结果会显示在工作台并另存为 PNG，原图不会被覆盖。",
          action: async () => {
            await ctx.fill('textarea[name="prompt"]', PROMPT);
            await ctx.eval(`(() => {
              const button = Array.from(document.querySelectorAll('button'))
                .find((element) => element.textContent?.trim() === "生成编辑结果");
              button?.click();
              return Boolean(button);
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')
              ?.contentDocument?.querySelector('#busyLayer')?.classList.contains('visible') === true`, {
              timeoutMs: 15_000,
              label: "Image Studio generation request to start",
            });
            await ctx.waitFor(`document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')
              ?.contentDocument?.querySelector('#busyLayer')?.classList.contains('visible') === false`, {
              timeoutMs: 300_000,
              label: "Image Studio provider request to finish",
            });
            await ctx.waitFor(`document.body.innerText.includes('已另存为') || Array.from(document.querySelectorAll('[role="status"]')).some(e => e.textContent.trim())`);
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const studio = document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument;
              const errorText = Array.from(document.querySelectorAll('[role="status"]'))
                .map((element) => element.textContent?.trim() ?? "")
                .find((text) => text.length > 0) ?? "";
              const canvas = studio?.querySelector('#imageCanvas');
              return {
                errorText,
                width: canvas?.width,
                height: canvas?.height,
                saved: document.body.innerText.includes("已另存为"),
                generatedImageVisible: Boolean(studio?.querySelector('#canvasWrap.visible')),
                unexpectedErrorVisible: document.body.innerText.includes("Unexpected server error"),
              };
            })()`);
            ctx.assert(!result.unexpectedErrorVisible, "The generic Unexpected server error is still visible.");
            ctx.assert(
              result.generatedImageVisible && result.width > 100 && result.height > 100 && result.saved,
              `Expected a newly saved image, got ${JSON.stringify(result)}.`,
            );
            ctx.log(`Image Studio outcome: ${JSON.stringify(result)}`);
          },
          screenshot: {
            name: "image-studio-provider-response",
            requireText: ["图片参数", MODEL, "已另存为"],
            rejectText: ["Unexpected server error", "Codex 未返回图片"],
          },
        });
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      },
    },
  ],
};
