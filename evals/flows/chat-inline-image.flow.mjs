const IMAGE = '.markdown-content img[data-ipollowork-image-path]';

export default {
  id: "chat-inline-image",
  title: "Saved workspace images display inline in chat",
  kind: "user-facing",
  steps: [{
    name: "Reopen an existing conversation and view its generated image",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
      const route = process.env.IPOLLOWORK_EVAL_IMAGE_SESSION_ROUTE ?? await ctx.eval("location.hash");
      ctx.assert(route.includes("/session/"), "Open a conversation with a generated image, or set IPOLLOWORK_EVAL_IMAGE_SESSION_ROUTE.");
      await ctx.prove("A saved workspace PNG renders in the chat body without Image Studio", {
        voiceover: "重新打开这段对话，已生成的图片会直接显示在正文中，不需要打开图片工作台。",
        action: async () => {
          await ctx.navigateHash("/");
          await ctx.navigateHash(route);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(IMAGE)}))`, { timeoutMs: 30_000 });
          await ctx.eval(`document.querySelector('button[aria-label="Close tab: 图片工作台"]')?.click()`);
          await ctx.eval(`document.querySelector(${JSON.stringify(IMAGE)}).scrollIntoView({block:'center'})`);
          await ctx.waitFor(`(() => {
            const image = document.querySelector(${JSON.stringify(IMAGE)});
            return image?.complete && image.naturalWidth > 100 && image.naturalHeight > 100;
          })()`, { timeoutMs: 30_000, label: "inline image decoded from the workspace" });
          await ctx.eval(`document.querySelector(${JSON.stringify(IMAGE)}).closest('[data-ipollowork-image-preview]').querySelector('button')?.click()`);
          await ctx.eval(`document.querySelector(${JSON.stringify(IMAGE)}).scrollIntoView({block:'center'})`);
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const image = document.querySelector(${JSON.stringify(IMAGE)});
            const rect = image.getBoundingClientRect();
            return { source: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight,
              visible: rect.width > 100 && rect.height > 100 && rect.top < innerHeight && rect.bottom > 0,
              studio: Boolean(document.querySelector('iframe[title="图片工作台"]')) };
          })()`);
          ctx.assert(state.source.startsWith("blob:"), "Workspace images must use an authenticated file download, not a page-relative URL.");
          ctx.assert(state.width > 100 && state.height > 100 && state.visible, `Expected a visible decoded image: ${JSON.stringify(state)}`);
          ctx.assert(!state.studio, "Image Studio must not be required for an inline preview.");
          ctx.log(`Inline image: ${state.width} × ${state.height} pixels.`);
        },
        screenshot: { name: "chat-inline-image", hashIncludes: "/session/", rejectText: ["Something went wrong"] },
      });
    },
  }],
};
