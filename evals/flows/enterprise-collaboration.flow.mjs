import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Open /tests/enterprise-collaboration-proof.html in the worktree's Vite server.
// Production controls are real; enterprise/model transport is synthetic.
// SQLite persistence and engine isolation are covered by owning-layer tests.
const vo = await loadVoiceoverParagraphs("enterprise-collaboration");
const share = '[data-testid="enterprise-session-share"]';
const manage = '[data-testid="enterprise-resource-management"]';
const access = '[data-testid="enterprise-resource-access"]';
const close = async (ctx) => {
  await ctx.trustedClick('[data-slot="dialog-content"][data-open] [data-slot="dialog-close"]');
  await ctx.waitFor('!document.querySelector(\'[data-slot="dialog-content"][data-open]\')');
};
const stats = (ctx) => ctx.eval('document.querySelector(\'[data-testid="proof-result"]\').innerText.replace(/\\s+/g," ")');

export default {
  id: "enterprise-collaboration",
  title: "企业协作控件：选人、总结分享、独立会话与资源管理（隔离传输）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [
    { name: "部门选人与搜索", async run(ctx) {
      await ctx.client.send("Page.reload");
      await ctx.waitForText("企业协作功能验证");
      await ctx.prove("部门树选择后支持跨部门搜索", {
        voiceover: vo[0], action: async () => {
          await ctx.trustedClick('[data-testid="proof-share"]');
          await ctx.trustedClick(`${share} button[aria-label="展开星河科技"]`);
          await ctx.trustedClick(`${share} [role="checkbox"][aria-label="选择部门 产品部"]`);
          await ctx.waitForText("已选 2 人");
          await ctx.fill(`${share} input`, "王磊");
          await ctx.waitForText("wanglei@example.com");
          await ctx.trustedClick(`${share} [role="checkbox"][aria-label="选择 王磊"]`);
        }, assert: async () => {
          await ctx.expectText("已选 3 人"); await ctx.expectText("张敏"); await ctx.expectText("李晨");
        }, screenshot: { name: "people-search", requireText: ["已选 3 人", "王磊"] },
      });
    } },
    { name: "发送失败重试", async run(ctx) {
      await close(ctx); await ctx.trustedClick('[data-testid="proof-fail-send"]');
      await ctx.prove("发送失败保留总结并使用同一份总结重试", {
        voiceover: vo[1], action: async () => {
          await ctx.trustedClick('[data-testid="proof-share"]');
          await ctx.trustedClick(`${share} [role="checkbox"][aria-label="选择部门 星河科技"]`);
          await ctx.waitForText("已选 3 人"); await ctx.clickText("确定并分享");
          await ctx.waitForText("确认发送"); await ctx.expectText("企业服务请求失败");
          ctx.assert(await ctx.eval(`document.querySelector('${share} textarea').value.includes('关键结论')`), "summary retained after failure");
          await ctx.clickText("确认发送"); await ctx.waitFor(`!document.querySelector('${share}')`);
          await ctx.trustedClick('[data-testid="proof-stats"]');
        }, assert: async () => {
          const value = await stats(ctx); ctx.assert(value.includes("总结生成次数 1") && value.includes("分享次数 1") && value.includes("分享对象 3 人"), value);
        }, screenshot: { name: "share-retry", requireText: ["总结生成次数 1", "分享次数 1"] },
      });
    } },
    { name: "接收独立会话", async run(ctx) {
      await ctx.prove("分享导入独立会话且重复接收不重复创建", {
        voiceover: vo[2], action: async () => {
          await ctx.clickText("产品方案讨论总结"); await ctx.waitForText("接收并新建会话");
          await ctx.clickText("接收并新建会话"); await ctx.waitForText("产品方案讨论 · 独立会话");
          await ctx.clickText("产品方案讨论总结"); await ctx.waitForText("在本机打开分享会话");
          await ctx.clickText("在本机打开分享会话");
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="enterprise-snapshot-context"] summary\'))');
          await ctx.trustedClick('[data-testid="enterprise-snapshot-context"] summary');
        }, assert: async () => {
          await ctx.expectText("等待用户继续提问，未启动模型执行。");
          ctx.assert((await stats(ctx)).includes("本机创建次数 1"), "duplicate accepts reused the session");
        }, screenshot: { name: "independent-session", requireText: ["独立会话", "本机创建次数 1", "首次提问"] },
      });
    } },
    { name: "企业资源授权", async run(ctx) {
      await ctx.prove("超管可查看待审核资源并组合授权部门和员工", {
        voiceover: vo[3], action: async () => {
          await ctx.trustedClick('[data-testid="enterprise-template-manage"]');
          await ctx.waitForText("待审核报告模板"); await ctx.expectText("产品提案模板");
          await ctx.clickText("分配权限"); await ctx.waitFor(`Boolean(document.querySelector('${access} input'))`);
          await ctx.trustedClick(`${access} button[aria-label="展开星河科技"]`);
          await ctx.trustedClick(`${access} [role="checkbox"][aria-label="选择部门 产品部"]`);
          await ctx.fill(`${access} input`, "王磊"); await ctx.waitForText("wanglei@example.com");
          await ctx.trustedClick(`${access} [role="checkbox"][aria-label="选择 王磊"]`);
          await ctx.expectText("1 个已有访问组授权"); await ctx.clickText("保存并下发");
        }, assert: async () => { await ctx.expectText("权限已保存并下发。"); },
        screenshot: { name: "resource-granted", requireText: ["权限已保存并下发。", "待审核报告模板"] },
      });
      await close(ctx);
    } },
    { name: "员工插件投稿入口", async run(ctx) {
      await ctx.trustedClick('[data-testid="proof-member"]');
      await ctx.prove("员工保留插件投稿和企业消息，模板投稿入口继续隐藏", {
        voiceover: vo[4], action: async () => {
          await ctx.expectText("企业消息");
        }, assert: async () => {
          await ctx.expectNoText("我的模板投稿"); await ctx.expectText("我的插件投稿");
          ctx.assert(await ctx.eval('!document.querySelector(\'[data-testid="enterprise-template-manage"]\')'), "employee template submissions remain hidden");
        }, screenshot: { name: "member-plugin-submission", requireText: ["企业消息", "我的插件投稿"], rejectText: ["我的模板投稿"] },
      });
    } },
    { name: "旧企业服务兼容", async run(ctx) {
      await ctx.prove("旧企业服务明确禁用未开放的新功能", {
        voiceover: vo[5], action: async () => {
          await ctx.trustedClick('[data-testid="proof-legacy"]');
          ctx.assert(await ctx.eval('document.querySelector(\'[data-testid="proof-share"]\').disabled'), "sharing disabled");
          await ctx.trustedClick('[data-testid="enterprise-template-manage"]');
        }, assert: async () => {
          await ctx.expectText("请联系管理员升级");
          ctx.assert(await ctx.eval(`Array.from(document.querySelectorAll('${manage} button')).some(el => el.textContent.includes('选择模板包') && el.disabled)`), "upload disabled");
        }, screenshot: { name: "legacy-gated", requireText: ["请联系管理员升级"] },
      });
    } },
  ],
};
