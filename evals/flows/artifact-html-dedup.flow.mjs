export default {
  id: "artifact-html-dedup",
  title: "A completed video reply has one HTML card and retains its source image",
  kind: "user-facing",
  steps: [{ name: "Inspect the currently open completed video reply", async run(ctx) {
    const state = `(() => {
      const columns = [...document.querySelectorAll('[data-message-role="assistant"]')];
      const column = columns.at(-1);
      if (!column) return null;
      const inline = [...column.querySelectorAll('[data-ipollowork-link-href]')];
      const cards = [...column.querySelectorAll('[data-testid="artifact-file-card"]')];
      return { htmlCards: cards.filter(c => /HTML/.test(c.innerText)).length,
        inlineHtml: inline.filter(c => /\\.html?(?:$|[?#])/i.test(c.getAttribute('data-ipollowork-link-href'))).length,
        imageLinks: inline.filter(c => /\\.png(?:$|[?#])/i.test(c.getAttribute('data-ipollowork-link-href'))).length };
    })()`;
    await ctx.waitFor(`Boolean((${state})?.htmlCards)`, { timeoutMs: 30000 });
    await ctx.prove("The same HTML appears once, with its separate PNG reference still available", {
      action: async () => { await ctx.eval("[...document.querySelectorAll('[data-testid=artifact-file-card]')].at(-1)?.scrollIntoView({block:'center'})"); },
      assert: async () => {
        const result = await ctx.eval(state);
        ctx.assert(result.htmlCards === 1 && result.inlineHtml === 0, JSON.stringify(result));
        ctx.assert(result.imageLinks > 0, "The independent source-image card remains available");
      },
      screenshot: { name: "single-html-output", requireText: ["HTML"] },
    });
  } }],
};
