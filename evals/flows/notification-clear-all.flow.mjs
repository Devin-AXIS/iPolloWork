const childUrl = "[::1]:5173/tests/enterprise-collaboration-proof.html?notifications";
const parentUrl = "localhost:5173/tests/enterprise-collaboration-proof.html?notification-frame";
const panel = '[data-testid="notification-center"]';
const bell = '[data-testid="notification-center-trigger"]';
const screenshot = (name, requireText) => ({ name, targetUrlIncludes: parentUrl, textTargetUrlIncludes: childUrl, requireText: ["统一通知清除验证", ...requireText], rejectText: ["Something went wrong", "Enterprise · 企业消息"] });
const settled = (ctx) => ctx.waitFor(`document.querySelector('${panel}') && getComputedStyle(document.querySelector('${panel}')).opacity === '1'`);
async function assertEmpty(ctx) {
  await settled(ctx);
  await ctx.waitForText("还没有通知");
  ctx.assert(await ctx.eval(`document.querySelectorAll('${panel} [data-notification-source]').length === 0`), "All local and enterprise rows have disappeared");
  ctx.assert(await ctx.eval(`document.querySelector('${bell}').getAttribute('aria-label') === '通知'`), "Cleared messages no longer contribute to the unread badge");
  ctx.assert(await ctx.eval(`!document.querySelector('${panel}').innerText.includes('加载更多消息')`), "Older cleared pages are not offered again");
}
export default {
  id: "notification-clear-all",
  title: "统一通知列表与全部清除（隔离企业响应）",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: childUrl },
  steps: [{ name: "清除、刷新、新消息及成员隔离", async run(ctx) {
    await ctx.prove("本地与企业通知混排并逐条标注来源", {
      voiceover: "通知统一显示在同一个列表中，每条内容标明来源，不再单独划分企业消息。",
      action: async () => {
        if (await ctx.eval(`Boolean(document.querySelector('${panel}'))`)) await ctx.trustedClick(bell);
        await ctx.trustedClick('[data-testid="notification-proof-reset"]'); await ctx.trustedClick(bell);
      },
      assert: async () => {
        await ctx.waitForText("专注脉冲 · 使用权限已更新");
        await settled(ctx);
        ctx.assert(await ctx.eval(`document.querySelectorAll('${panel} [data-notification-source]').length === 3`), "The list contains one local and two enterprise notifications");
        ctx.assert(await ctx.eval(`!document.querySelector('${panel}').innerText.includes('企业消息')`), "There is no enterprise category heading");
        const sources = await ctx.eval(`Array.from(document.querySelectorAll('${panel} [data-notification-source]')).map(row => row.dataset.notificationSource)`);
        ctx.assert(sources[0] === "iPolloCloud" && sources.slice(1).every(source => source === "星河"), "Messages are ordered by time and carry their own source");
      }, screenshot: screenshot("mixed-sources", ["公开插件更新可用", "来源: 星河"]),
    });
    await ctx.prove("全部清除同时移除本地和企业通知及未读角标", {
      voiceover: "点击全部清除后，本地通知和企业通知一起消失，未读角标也被清空。",
      action: async () => { await ctx.trustedClick('[data-testid="notification-clear-all"]'); },
      assert: async () => assertEmpty(ctx), screenshot: screenshot("all-cleared", ["还没有通知"]),
    });
    await ctx.prove("重开并刷新通知后，旧企业消息不会重新出现", {
      voiceover: "重新读取已保存的清除记录并重开通知中心，再刷新企业消息，旧通知仍保持清除状态。",
      action: async () => {
        await ctx.trustedClick(bell);
        await ctx.trustedClick('[data-testid="notification-proof-reopen"]');
        await ctx.trustedClick(bell);
        await ctx.waitFor(`document.querySelector('${panel} button[aria-label="刷新通知"]').disabled === false`);
        await ctx.trustedClick(`${panel} button[aria-label="刷新通知"]`);
        await ctx.waitFor(`document.querySelector('${panel} button[aria-label="刷新通知"]').disabled === false`);
      }, assert: async () => assertEmpty(ctx), screenshot: screenshot("refresh-stays-cleared", ["还没有通知"]),
    });
    await ctx.prove("清除后新收到的企业通知仍正常显示", {
      voiceover: "清除旧通知后，新到达的企业消息仍然出现，并继续显示来源。",
      action: async () => { await ctx.trustedClick(bell); await ctx.trustedClick('[data-testid="notification-proof-new"]'); await ctx.trustedClick(bell); },
      assert: async () => {
        await ctx.waitForText("清除后新收到的通知");
        await settled(ctx);
        ctx.assert(await ctx.eval(`document.querySelectorAll('${panel} [data-notification-source]').length === 1`), "Only the newly arrived enterprise notification is shown");
      }, screenshot: screenshot("new-message", ["清除后新收到的通知", "全部清除"]),
    });
    await ctx.prove("只有企业通知时也可以使用全部清除", {
      voiceover: "即使列表中只有企业通知，全部清除按钮仍然可用，并能清空消息。",
      action: async () => { await ctx.trustedClick('[data-testid="notification-clear-all"]'); },
      assert: async () => assertEmpty(ctx), screenshot: screenshot("enterprise-only-cleared", ["还没有通知"]),
    });
    await ctx.prove("另一成员的消息不受当前成员清除记录影响", {
      voiceover: "切换为另一位企业成员后，他自己的通知正常显示，清除记录按成员隔离。",
      action: async () => { await ctx.trustedClick(bell); await ctx.trustedClick('[data-testid="notification-proof-member"]'); await ctx.trustedClick('[data-testid="notification-proof-theme"]'); await ctx.trustedClick(bell); },
      assert: async () => {
        await ctx.waitForText("另一成员的通知");
        await settled(ctx);
        ctx.assert(await ctx.eval(`document.querySelectorAll('${panel} [data-notification-source]').length === 1`), "The other member retains their notification");
      }, screenshot: screenshot("member-isolation-dark", ["另一成员的通知", "来源: 星河"]),
    });
  } }],
};
