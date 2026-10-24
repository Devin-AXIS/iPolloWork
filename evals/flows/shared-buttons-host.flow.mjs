/** Read-only proof that main-client navigation actions use the shared Button. */
export default {
  id: "shared-buttons-host",
  title: "Main-client help categories use shared compact buttons",
  kind: "user-facing",
  steps: [
    {
      name: "Help category buttons render and switch selection",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { label: "client control API" });
        await ctx.navigateHash("/help");
        await ctx.waitFor("document.querySelectorAll('aside button[data-slot=button][aria-pressed]').length >= 2", { label: "shared help category buttons" });
        const before = await ctx.eval("[...document.querySelectorAll('aside button[data-slot=button][aria-pressed]')].map((button) => button.getAttribute('aria-pressed'))");
        ctx.assert(before[0] === "true", "The all-categories button is not selected initially.");
        await ctx.eval("document.querySelectorAll('aside button[data-slot=button][aria-pressed]')[1]?.click(); true");
        await ctx.waitFor("document.querySelectorAll('aside button[data-slot=button][aria-pressed]')[1]?.getAttribute('aria-pressed') === 'true'", { label: "selected help category" });
        await ctx.screenshot("help-shared-category-buttons", {
          claim: "The real client's help categories render with the shared compact Button and update their selected state on click.",
        });
      },
    },
  ],
};
