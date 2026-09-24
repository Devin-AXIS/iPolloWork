export default {
  id: "cloud-marketplace-layout",
  title: "Cloud marketplace keeps one aligned page heading",
  kind: "user-facing",
  steps: [
    {
      name: "Open the Cloud marketplace",
      run: async (ctx) => {
        await ctx.prove("The Cloud marketplace shows one aligned content heading without a duplicate page header", {
          voiceover: "插件市场现在只保留一层清晰的页面标题，市场操作区和内容列表统一对齐。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 30_000,
              label: "iPolloWork control surface",
            });
            await ctx.navigateHash("/settings/cloud-marketplaces");
            await ctx.waitFor(`(() => {
              const content = document.querySelector('[data-settings-content]');
              return Boolean(content && content.innerText.includes('扩展市场'));
            })()`, {
              timeoutMs: 30_000,
              label: "Cloud marketplace content",
            });
          },
          assert: async () => {
            const layout = await ctx.eval(`(() => {
              const content = document.querySelector('[data-settings-content]');
              const visible = (element) => Boolean(element && element.getClientRects().length > 0);
              const headings = [...content.querySelectorAll('h1, h2')]
                .filter(visible)
                .map((element) => ({ text: element.innerText.trim(), left: element.getBoundingClientRect().left }));
              const marketplaceHeading = headings.find((heading) => heading.text === '扩展市场');
              const search = content.querySelector('input');
              const searchGroup = search?.closest('[data-slot="input-group"]');
              return {
                headings,
                marketplaceHeading,
                searchLeft: searchGroup?.getBoundingClientRect().left ?? null,
              };
            })()`);
            ctx.assert(
              layout.headings.filter((heading) => heading.text === "插件市场").length === 0,
              `Duplicate marketplace page heading is still visible: ${JSON.stringify(layout.headings)}`,
            );
            ctx.assert(Boolean(layout.marketplaceHeading), `Marketplace content heading is missing: ${JSON.stringify(layout.headings)}`);
            ctx.assert(layout.searchLeft !== null, "Marketplace search field is missing.");
            ctx.assert(
              Math.abs(layout.marketplaceHeading.left - layout.searchLeft) <= 1,
              `Marketplace heading and search are misaligned: ${JSON.stringify(layout)}`,
            );
          },
          screenshot: {
            name: "cloud-marketplace-single-heading",
            requireText: ["扩展市场", "刷新"],
            hashIncludes: "/settings/cloud-marketplaces",
          },
        });
      },
    },
  ],
};
