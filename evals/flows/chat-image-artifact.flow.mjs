const EDITOR = '[contenteditable="true"][data-lexical-editor="true"]';
const CARD = '[data-testid="artifact-file-card"]';
const STUDIO = 'iframe[title="图片工作台"]';
const PROMPT = "生成一张后羿射日的中国神话插画，金色天空、史诗构图，不要文字，只生成一张 PNG 图片。";

export default {
  id: "chat-image-artifact",
  title: "Chat generates an image without Image Studio and opens its saved artifact",
  kind: "user-facing",
  steps: [{
    name: "Generate in chat, retain the image card, and open Image Studio",
    run: async (ctx) => {
      // Resume a real in-flight request after a repair without generating a duplicate image.
      const resumeRoute = process.env.IPOLLOWORK_EVAL_IMAGE_SESSION_ROUTE;
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
      await ctx.client.send("Page.bringToFront");
      await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      if (resumeRoute) {
        await ctx.navigateHash(resumeRoute);
        await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${resumeRoute.split("/").at(-1)}"]'))`, {
          timeoutMs: 30_000, label: "resumed conversation surface",
        });
        await ctx.waitForText(PROMPT);
        await ctx.eval(`document.querySelector('button[aria-label="Close tab: 图片工作台"]')?.click()`);
        await ctx.waitFor(`!document.querySelector(${JSON.stringify(STUDIO)})`, { label: "closed Image Studio before saved-card proof" });
      } else await ctx.prove("An image request can start with Image Studio closed", {
        voiceover: "不需要先打开图片工作台，直接在新的聊天中描述想生成的图片。",
        action: async () => {
          await ctx.navigateHash("/");
          const projectName = process.env.IPOLLOWORK_EVAL_IMAGE_PROJECT ?? "codex";
          const projectId = await ctx.waitFor(`(() => {
            const project = [...document.querySelectorAll('[data-testid="project-row"]')]
              .find(el => el.textContent.trim().toLowerCase() === ${JSON.stringify(projectName)});
            return project?.getAttribute('data-project-id');
          })()`, { label: "image-generation project" });
          await ctx.eval(`document.querySelector('[data-testid="project-new-conversation-button"][data-project-id="${projectId}"]').click()`);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR)})) && !document.querySelector(${JSON.stringify(STUDIO)})`, {
            timeoutMs: 30_000, label: "new chat without Image Studio",
          });
          await ctx.trustedClick(EDITOR);
          await ctx.client.send("Input.insertText", { text: PROMPT });
        },
        assert: async () => {
          await ctx.waitForText(PROMPT);
          ctx.assert(await ctx.eval(`!document.querySelector(${JSON.stringify(STUDIO)})`), "Image Studio must be closed.");
        },
        screenshot: { name: "chat-image-request", requireText: [PROMPT], rejectText: ["Something went wrong"] },
      });

      const startedAt = Date.now();
      await ctx.prove(resumeRoute
        ? "The saved image artifact is available in chat with Image Studio closed"
        : "The completed generation produces an image artifact card without opening Image Studio", {
        voiceover: "图片生成结束后，聊天里会出现可打开的图片产物卡片，右侧工作台仍然保持关闭。",
        action: async () => {
          if (!resumeRoute) {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
          }
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(CARD)}))`, {
            timeoutMs: 480_000, label: "real generated image card",
          });
          await ctx.waitFor(`window.__ipolloworkControl.listActions().some(a => a.id === 'composer.stop' && a.disabled)`, {
            timeoutMs: 60_000, label: "completed image-generation turn",
          });
          await ctx.eval(`document.querySelector(${JSON.stringify(CARD)}).scrollIntoView({block:'center'})`);
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({
            card: document.querySelector(${JSON.stringify(CARD)})?.innerText,
            name: document.querySelector(${JSON.stringify(CARD)})?.querySelector('[title]')?.getAttribute('title'),
            studioOpen: Boolean(document.querySelector(${JSON.stringify(STUDIO)})),
          }))()`);
          ctx.assert(/\.png$/i.test(state.name ?? ""), `Expected a PNG artifact: ${JSON.stringify(state)}`);
          ctx.assert(!state.studioOpen, "Generating an image must not force the workbench open.");
          ctx.log(`Real image validation waited ${Math.round((Date.now() - startedAt) / 1000)} seconds, including any user approvals.`);
        },
        screenshot: { name: "chat-image-card", requireText: ["图片"], rejectText: ["Something went wrong"] },
      });

      await ctx.prove("The persisted image card opens its image in the right-hand Image Studio", {
        voiceover: "重新打开对话，图片卡片仍然保留；点击卡片，图片会直接在右侧图片工作台打开，继续编辑。",
        action: async () => {
          const beforeReload = await ctx.eval("({ timeOrigin: performance.timeOrigin, route: location.hash })");
          await ctx.client.send("Page.reload");
          // Page.reload resolves before navigation; do not click the old DOM.
          await ctx.waitFor(`performance.timeOrigin !== ${beforeReload.timeOrigin} && Boolean(window.__ipolloworkControl)`, {
            timeoutMs: 60_000, label: "new renderer after reload",
          });
          await ctx.navigateHash(beforeReload.route);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(CARD)}))`, {
            timeoutMs: 60_000, label: "persisted image card after reload",
          });
          await ctx.waitFor(`(() => {
            const card = document.querySelector(${JSON.stringify(CARD)});
            return card instanceof HTMLButtonElement
              && Object.keys(card).some((key) => key.startsWith("__reactProps$"));
          })()`, { timeoutMs: 30_000, label: "persisted image card is interactive" });
          await ctx.client.send("Page.bringToFront");
          ctx.assert(await ctx.eval(`!document.querySelector(${JSON.stringify(STUDIO)})`), "The saved conversation should still have no Image Studio open.");
          await ctx.trustedClick(CARD);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(STUDIO)})?.contentDocument?.querySelector('#canvasWrap.visible'))`, {
            timeoutMs: 45_000, label: "saved image displayed in Image Studio",
          });
        },
        assert: async () => {
          const image = await ctx.eval(`(() => {
            const canvas = document.querySelector(${JSON.stringify(STUDIO)})?.contentDocument?.querySelector('#imageCanvas');
            return { width: canvas?.width, height: canvas?.height };
          })()`);
          ctx.assert(image.width > 100 && image.height > 100, `The saved image must decode in the workbench: ${JSON.stringify(image)}`);
          ctx.log(`Image Studio decoded ${image.width} × ${image.height} pixels.`);
        },
        screenshot: { name: "chat-image-opened-in-studio", requireText: ["图片工作台"], rejectText: ["Something went wrong"] },
      });
    },
  }],
};
