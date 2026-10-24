import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("enterprise-resource-card-management");
const menu = (ctx, name) => ctx.clickText(name, { selector: '[role="menuitem"]' });
const cardText = (name) => `document.querySelector('button[aria-label="${name}的操作"]')?.closest('article, [data-slot=card]')?.innerText`;
const openMenu = async (ctx, name) => {
  await ctx.trustedClick(`button[aria-label="${name}的操作"]`);
  await ctx.waitFor('Boolean(document.querySelector("[role=menu]"))');
};

export default {
  id: "enterprise-resource-card-management",
  title: "企业三类投稿显示状态并从卡片管理（生产组件、隔离传输）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "resource-management" },
  steps: [{ name: "模板投稿状态与退回说明", async run(ctx) {
    await ctx.client.send("Page.reload");
    await ctx.waitForText("企业协作功能验证");
    await ctx.prove("未安装的模板投稿有预览、全部状态和卡片审核入口", {
      voiceover: vo[0], action: async () => {
        await ctx.trustedClick('[data-testid="proof-template-source"]');
        await ctx.waitFor('document.querySelectorAll("[data-testid=remote-template-card]").length === 3');
        await ctx.waitFor('Array.from(document.querySelectorAll("[data-testid=remote-template-card] img")).filter(img => img.complete && img.naturalWidth > 0).length === 3');
        await openMenu(ctx, "模板待审核投稿");
        ctx.assert(await ctx.eval('document.querySelector("[role=menuitem]").getAttribute("aria-disabled") === "true"'), "Pending upload cannot be installed");
        await menu(ctx, "审核投稿");
        await ctx.waitForText("通过并发布");
        ctx.assert(await ctx.eval('Array.from(document.querySelectorAll("[data-testid=enterprise-card-review] button")).find(el => el.innerText === "退回修改").disabled'), "Returning a submission requires a reason");
        await ctx.fill('[data-testid="enterprise-card-review"] textarea', "请补充企业使用场景");
        await ctx.clickText("退回修改");
      }, assert: async () => {
        await ctx.waitFor('!document.querySelector("[data-testid=enterprise-card-review]")');
        await ctx.waitFor(`${cardText("模板待审核投稿")}?.includes('请补充企业使用场景')`);
        ctx.assert(await ctx.eval('document.querySelectorAll("[data-testid=enterprise-resource-status]").length === 3'), "All uploaded template cards show their status");
      }, screenshot: { name: "template-submissions", requireText: ["请补充企业使用场景", "已退回", "已下架"] },
    });
  } }, { name: "插件卡片发布授权下架", async run(ctx) {
    await ctx.trustedClick('[data-slot="dialog-content"] [data-slot="dialog-close"]');
    await ctx.prove("插件管理操作位于卡片菜单，完成后状态更新", {
      voiceover: vo[1], action: async () => {
        await ctx.trustedClick('[data-testid="proof-enterprise-plugins"] [role="tab"]:last-child');
        await ctx.waitForText("插件待审核投稿");
        await openMenu(ctx, "插件待审核投稿"); await menu(ctx, "审核投稿"); await ctx.clickText("通过并发布");
        await ctx.waitFor(`${cardText("插件待审核投稿")}?.includes('已发布')`);
        await openMenu(ctx, "插件待审核投稿"); await menu(ctx, "分配权限");
        await ctx.waitForText("保存并下发");
        await ctx.clickText("全体成员", { selector: '[data-testid="enterprise-card-access"] label' });
        await ctx.clickText("保存并下发");
        await ctx.waitFor('!document.querySelector("[data-testid=enterprise-card-access]")');
        await openMenu(ctx, "插件待审核投稿"); await menu(ctx, "下架");
        await ctx.waitForText("下架企业资源");
        await ctx.clickText("下架", { selector: '[role="alertdialog"] button' });
      }, assert: async () => {
        await ctx.waitFor(`${cardText("插件待审核投稿")}?.includes('已下架')`);
        ctx.assert(await ctx.eval('document.querySelectorAll("[data-testid=proof-enterprise-plugins] [data-testid=enterprise-resource-status]").length === 3'), "Archived and rejected plugins stay visible");
        await ctx.eval('document.querySelector("[data-testid=proof-enterprise-plugins]").scrollIntoView({block:"center"})');
      }, screenshot: { name: "plugin-management", requireText: ["插件待审核投稿", "已下架", "请补充使用说明"] },
    });
  } }, { name: "技能卡片与普通成员权限", async run(ctx) {
    await ctx.prove("技能显示全部投稿状态，普通成员不显示管理菜单", {
      voiceover: vo[2], action: async () => {
        await ctx.trustedClick('[aria-label="技能来源"] [role="tab"]:last-child');
        await ctx.waitForText("技能待审核投稿");
        await openMenu(ctx, "技能待审核投稿");
        ctx.assert(await ctx.hasText("审核投稿"), "Skill administrator has the review entry");
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await ctx.waitFor('!document.querySelector("[role=menu]")');
        await ctx.trustedClick('[data-testid="proof-member"]');
        await ctx.waitForText("我的技能投稿");
        await ctx.trustedClick('[aria-label="技能来源"] [role="tab"]:last-child');
        await openMenu(ctx, "技能待审核投稿");
      }, assert: async () => {
        const text = await ctx.eval('document.querySelector("[role=menu]").innerText');
        ctx.assert(!/审核投稿|分配权限|下架/.test(text), "Members have no resource management actions");
        ctx.assert(await ctx.eval('document.querySelectorAll("[data-testid=skill-card][data-source=enterprise] [data-testid=enterprise-resource-status]").length === 3'), "Members retain their uploaded skill statuses");
      }, screenshot: { name: "member-skill-submissions", requireText: ["技能待审核投稿", "已退回", "已下架"], rejectText: ["通过并发布", "分配权限"] },
    });
  } }],
};
