const dialog = '[data-testid="enterprise-resource-management"]';
const access = '[data-testid="enterprise-resource-access"]';
const types = [["template", "模板"], ["extension", "插件"], ["skill", "技能"]];

async function counts(ctx) {
  return ctx.eval(`(async () => {
    document.querySelector('[data-testid="proof-stats"]').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const stats = document.querySelector('[data-testid="proof-result"]');
    return { requests: Number(stats.dataset.managementRequests), writes: Number(stats.dataset.managementWrites) };
  })()`, { awaitPromise: true });
}

async function expectMember(ctx) {
  await ctx.waitFor(`['template','extension','skill'].every((type, index) =>
    document.querySelector('[data-testid="enterprise-' + type + '-manage"]')?.textContent.includes(['我的模板投稿','我的插件投稿','我的技能投稿'][index]))`);
  await ctx.waitFor("!document.body.innerText.includes('分配资源权限') && !document.body.innerText.includes('通过并发布')");
  await ctx.expectNoText("分配资源权限");
  await ctx.expectNoText("通过并发布");
}

async function close(ctx) {
  await ctx.trustedClick(`${dialog} [data-slot="dialog-close"]`);
  await ctx.waitFor(`!document.querySelector('${dialog}')`);
}

export default {
  id: "enterprise-resource-permissions",
  title: "后台降级后模板、插件、技能仅保留投稿（隔离企业服务）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [{ name: "管理入口和已打开的管理操作重新校验角色", async run(ctx) {
    await ctx.client.send("Page.reload");
    await ctx.waitForText("企业协作功能验证");
    await ctx.prove("管理员在后台降为成员后，三类资源只能投稿，旧弹窗也不能继续管理", {
      voiceover: "后台把管理员降为成员后，再打开模板、插件或技能时只显示自己的投稿；已经打开的授权、审核和下架操作也会重新检查权限并停止。",
      action: async () => {
        for (const [type, label] of types) {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          const entry = `[data-testid="enterprise-${type}-manage"]`;
          await ctx.waitFor(`document.querySelector('${entry}')?.textContent.includes('${label}管理')`);
          const before = await counts(ctx);
          // Changes only the isolated service role, leaving the cached administrator untouched.
          await ctx.eval(`document.querySelector('[data-testid="proof-demote-member"]').click()`);
          await ctx.trustedClick(entry);
          await ctx.waitFor(`Boolean(document.querySelector('${dialog}'))`);
          await expectMember(ctx);
          ctx.assert((await counts(ctx)).requests === before.requests, `${label} opens submissions without requesting the management catalog`);
          await close(ctx);
        }
        for (const [type, label] of types) {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          const entry = `[data-testid="enterprise-${type}-manage"]`;
          await ctx.waitFor(`document.querySelector('${entry}')?.textContent.includes('${label}管理')`);
          await ctx.trustedClick(entry);
          await ctx.waitFor(`document.querySelectorAll('${dialog} article').length === 2`);
          if (type === "template") {
            await ctx.trustedClick(`${dialog} article:first-child button:first-of-type`);
            await ctx.waitFor(`Boolean(document.querySelector('${access} [aria-label="访问范围"]'))`);
          } else if (type === "extension") {
            await ctx.trustedClick(`${dialog} article:last-child button:last-child`);
            await ctx.waitForText("通过并发布");
          }
          const before = await counts(ctx);
          await ctx.eval(`document.querySelector('[data-testid="proof-demote-member"]').click()`);
          if (type === "template") await ctx.clickText("保存并下发");
          else if (type === "extension") await ctx.clickText("通过并发布");
          else await ctx.trustedClick(`${dialog} article:first-child button:last-child`);
          await expectMember(ctx);
          const after = await counts(ctx);
          ctx.assert(after.requests === before.requests && after.writes === before.writes, `Stale ${label} management operation sends no privileged request after demotion`);
          if (type !== "skill") await close(ctx);
        }
      },
      assert: async () => {
        await expectMember(ctx);
        await ctx.expectText("我的技能投稿");
        await ctx.expectNoText("全部企业技能");
        ctx.assert(await ctx.eval(`!document.querySelector('${dialog} input[type="file"] ~ button').disabled`), "Member submission remains available");
        ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "All three stale management entries and open grant/review/archive dialogs recheck the service role; no privileged request is sent after demotion" });
        await close(ctx);
      },
      screenshot: { name: "member-submissions-only", requireText: ["我的模板投稿", "我的插件投稿", "我的技能投稿"], rejectText: ["分配资源权限", "通过并发布", "全部企业技能"] },
    });
  } }],
};
