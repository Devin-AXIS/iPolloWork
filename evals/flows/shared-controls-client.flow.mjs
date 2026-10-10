/** Read-only check of a shared control in the running desktop client. */
export default {
  id: "shared-controls-client",
  title: "Real client shared controls match the compact component library",
  kind: "user-facing",
  steps: [
    {
      name: "Open the model picker on the current workspace",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { label: "client control API" });
        await ctx.eval("window.dispatchEvent(new CustomEvent('ipollowork-open-model-picker')); true");
        await ctx.waitFor("Boolean(document.querySelector('[role=dialog] input[aria-label]'))", {
          label: "model picker search input",
        });
        ctx.assert(await ctx.eval("Boolean(document.querySelector('[role=dialog] [data-slot=input-group] input[data-slot=input-group-control]'))"), "Model picker still uses a standalone search field.");
        await ctx.screenshot("model-picker-shared-search", {
          claim: "The real client model picker renders its focused search field using the shared compact InputGroup.",
        });
        await ctx.eval("document.querySelector('[role=dialog] [data-slot=dialog-close]')?.click(); true");
      },
    },
    {
      name: "Open the template market from the real sidebar",
      run: async (ctx) => {
        const opened = await ctx.eval("(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '模板' && item.getBoundingClientRect().width > 0); button?.click(); return Boolean(button); })()");
        ctx.assert(opened, "The template market entry is not visible.");
        await ctx.waitFor("Boolean(document.querySelector('[role=dialog] [data-slot=input-group] input[data-slot=input-group-control]'))", { label: "template market shared search" });
        ctx.assert(await ctx.eval("document.querySelectorAll('[role=dialog] button[data-slot=button][aria-pressed]').length >= 2"), "Template categories still use standalone buttons.");
        await ctx.screenshot("template-market-shared-controls", {
          claim: "The real template market uses the shared search field and lightweight category buttons.",
        });
        await ctx.eval("document.querySelector('[role=dialog] [data-slot=dialog-close]')?.click(); true");
      },
    },
    {
      name: "Open the in-conversation find bar",
      run: async (ctx) => {
        await ctx.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true })); true");
        await ctx.waitFor("Boolean(document.querySelector('input[data-slot=input-group-control][aria-label]'))", { label: "shared find input" });
        ctx.assert(await ctx.eval("Boolean(document.querySelector('input[data-slot=input-group-control][aria-label]')?.closest('[data-slot=input-group]'))"), "Conversation find still uses a standalone search field.");
        await ctx.screenshot("conversation-shared-find", {
          claim: "The real conversation find bar uses the shared compact InputGroup.",
        });
        await ctx.eval("document.querySelector('input[data-slot=input-group-control][aria-label]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      },
    },
    {
      name: "Inspect project completion in the real overview",
      run: async (ctx) => {
        await ctx.eval("document.querySelector('[data-testid=session-header-work-navigation-compact]')?.click(); true");
        await ctx.waitFor("document.querySelector('[data-testid=session-header-project-overview-compact]')?.getBoundingClientRect().height > 0", { label: "overview option" });
        await ctx.eval("document.querySelector('[data-testid=session-header-project-overview-compact]')?.click(); true");
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-task-health] [data-slot=progress]'))", { label: "shared project completion progress" });
        await ctx.screenshot("project-overview-shared-progress", {
          claim: "The real project overview renders completion through the shared Progress component.",
        });
        await ctx.eval("document.querySelector('[data-testid=session-header-work-navigation-compact]')?.click(); true");
        await ctx.waitFor("document.querySelector('[data-testid=session-header-work-conversation-compact]')?.getBoundingClientRect().height > 0", { label: "conversation option" });
        await ctx.eval("document.querySelector('[data-testid=session-header-work-conversation-compact]')?.click(); true");
      },
    },
  ],
};
