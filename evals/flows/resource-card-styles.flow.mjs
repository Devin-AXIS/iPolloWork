import { connect, debuggerUrlFor, pickAppTarget } from "../runner/cdp.mjs";

const childUrl = "[::1]:5173/tests/plugin-cloud-proof.html?sources";
const parentUrl = "localhost:5173/tests/plugin-cloud-proof.html?source-frame";
const screenshot = name => ({ name, targetUrlIncludes: parentUrl, textTargetUrlIncludes: childUrl, requireText: ["插件与技能来源卡片验证", "整理团队协作流程"], rejectText: ["Something went wrong", "暂时无法加载"] });

async function assertRows(ctx, selector) {
  await ctx.waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length > 0`);
  const sizes = await ctx.eval(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(card => ({
    icon: card.querySelector('span.size-12')?.getBoundingClientRect().width,
    border: getComputedStyle(card).borderTopWidth,
    width: card.getBoundingClientRect().width,
    actions: card.querySelectorAll('button').length,
    overflow: card.scrollWidth > card.clientWidth + 1,
  }))`);
  ctx.assert(sizes.every(row => row.icon === 48 && row.border === "0px" && row.width > 200 && row.actions > 0 && !row.overflow), "Every source uses the personal row layout, 48px icon and usable actions without overflow");
}

export default {
  id: "resource-card-styles",
  title: "插件与技能六个来源统一个人卡片样式（隔离响应）",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: childUrl },
  steps: [{ name: "插件与技能在个人、公开和企业中的卡片一致", async run(ctx) {
    await ctx.waitForText("插件与技能来源卡片验证");
    for (const [kind, label] of [["plugins", "插件"], ["skills", "技能"]]) {
      await ctx.trustedClick(`[data-testid="proof-${kind}"]`);
      for (const [index, source] of [[1, "个人"], [2, "公开"], [3, "企业"]]) {
        const selector = kind === "plugins" ? `[role="tablist"] button:nth-child(${index})` : `[aria-label="技能来源"] > button:nth-child(${index})`;
        await ctx.prove(`${label}${source}来源使用统一卡片`, {
          voiceover: `${label}的${source}列表采用与个人页一致的图标、标题、简介和版本排版，相关操作继续保留。`,
          action: async () => { await ctx.trustedClick(selector); },
          assert: async () => {
            await ctx.waitFor("!document.querySelector('[data-testid=\"plugin-library-loading\"]') && !document.body.innerText.includes('正在加载技能')");
            await assertRows(ctx, kind === "skills" ? '[data-testid="skill-resource-card"]' : source === "企业" ? '[data-testid="enterprise-plugin-card"]' : '[data-testid="plugin-package-list-item"]');
          }, screenshot: screenshot(`${kind}-${index}`),
        });
      }
    }
    await ctx.prove("暗色主题中的企业技能保持统一卡片和操作", {
      voiceover: "切换暗色主题后，企业技能卡片保持相同布局和可读的文字、图标及按钮。",
      action: async () => { await ctx.trustedClick('[data-testid="proof-theme"]'); await ctx.waitFor("document.documentElement.dataset.theme === 'dark'"); },
      assert: async () => assertRows(ctx, '[data-testid="skill-resource-card"]'), screenshot: screenshot("skills-dark"),
    });
    const topTarget = await pickAppTarget(ctx.cdpBaseUrl, { urlIncludes: parentUrl });
    const top = await connect(debuggerUrlFor(ctx.cdpBaseUrl, topTarget));
    try {
      await ctx.prove("窄屏长名称与多个操作正常换行", {
        voiceover: "窄屏下，长名称自动截断，多个操作按钮换行，卡片不会撑出页面。",
        action: async () => { await top.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 900, deviceScaleFactor: 1, mobile: false }); },
        assert: async () => {
          await ctx.waitFor("innerWidth <= 640");
          await assertRows(ctx, '[data-testid="skill-resource-card"]');
          ctx.assert(await ctx.eval("document.documentElement.scrollWidth <= innerWidth + 1"), "No horizontal page overflow");
        }, screenshot: screenshot("skills-narrow"),
      });
    } finally { await top.send("Emulation.clearDeviceMetricsOverride"); top.close(); }
  } }],
};
