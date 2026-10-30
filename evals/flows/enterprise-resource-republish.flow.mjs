const card = name => `document.querySelector('button[aria-label="${name}的操作"]')?.closest('article, [data-slot=card]')`;
const openMenu = async (ctx, name) => {
  await ctx.waitFor(`(() => {
    const button = document.querySelector('button[aria-label="${name}的操作"]');
    const dialog = button?.closest('[role=dialog]');
    return Boolean(button) && (!dialog || !dialog.getAnimations().some(animation => animation.playState === 'running'));
  })()`);
  await ctx.trustedClick(`button[aria-label="${name}的操作"]`);
  await ctx.waitFor('Boolean(document.querySelector("[role=menu]"))');
};

async function restore(ctx, name, screenshot) {
  await ctx.waitFor(`${card(name)}?.innerText.includes('已下架')`);
  await ctx.prove(`${name}可从卡片重新上架，列表恢复已发布状态`, {
    voiceover: "管理员从卡片菜单重新上架已下架的资源，列表随即更新为已发布，原有权限与审核记录保持不变。",
    action: async () => {
      await openMenu(ctx, name);
      await ctx.clickText("重新上架", { selector: '[role="menuitem"]' });
      await ctx.waitFor('Boolean(document.querySelector("[data-testid=enterprise-card-restore]"))');
      await ctx.clickText("重新上架", { selector: '[data-testid="enterprise-card-restore"] button' });
    },
    assert: async () => {
      await ctx.waitFor('!document.querySelector("[data-testid=enterprise-card-restore]")');
      await ctx.waitFor(`${card(name)}?.innerText.includes('已发布')`);
      await openMenu(ctx, name);
      const menu = await ctx.eval('document.querySelector("[role=menu]").innerText');
      ctx.assert(menu.includes("下架") && !menu.includes("重新上架"), "Published resources offer archive instead of relisting");
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
      await ctx.waitFor('!document.querySelector("[role=menu]")');
      await ctx.eval(`${card(name)}.scrollIntoView({block:'center'}); true`);
    },
    screenshot: { name: screenshot, requireText: [name, "已发布"] },
  });
}

export default {
  id: "enterprise-resource-republish",
  title: "模板、插件、技能从卡片重新上架（生产组件、隔离传输）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "resource-management" },
  steps: [{ name: "模板重新上架", async run(ctx) {
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await ctx.client.send("Page.reload");
    await ctx.waitForText("企业协作功能验证");
    await ctx.trustedClick('[data-testid="proof-template-source"]');
    await restore(ctx, "模板已下架投稿", "template-restored");
  } }, { name: "插件重新上架", async run(ctx) {
    await ctx.trustedClick('[data-slot="dialog-content"] [data-slot="dialog-close"]');
    await ctx.trustedClick('[data-testid="proof-enterprise-plugins"] [role="tab"]:last-child');
    await restore(ctx, "插件已下架投稿", "plugin-restored");
  } }, { name: "技能重新上架", async run(ctx) {
    await ctx.trustedClick('[aria-label="技能来源"] [role="tab"]:last-child');
    await restore(ctx, "技能已下架投稿", "skill-restored");
  } }],
};
