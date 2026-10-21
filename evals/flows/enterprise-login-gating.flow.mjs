// The isolated fixture uses the production login hook and collaboration controls.
// Only enterprise transport and account controls use synthetic test data.
const hidden = "!document.querySelector('[data-testid=\"proof-share\"], [data-testid=\"enterprise-template-manage\"], [data-testid=\"enterprise-extension-manage\"], [data-testid=\"enterprise-session-share\"]')";

export default {
  id: "enterprise-login-gating",
  title: "企业协作功能仅在有效企业登录下显示",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [
    { name: "登录身份与角色", async run(ctx) {
      await ctx.trustedClick('[data-testid="proof-owner"]');
      await ctx.prove("企业超管保留资源管理入口，员工可投稿插件", {
        voiceover: "企业超管仍可管理模板和插件。切换员工后，可以打开自己的模板、插件和技能投稿，企业消息仍然可用。",
        action: async () => {
          await ctx.expectText("模板管理");
          await ctx.expectText("插件管理");
          await ctx.trustedClick('[data-testid="proof-member"]');
        },
        assert: async () => {
          await ctx.expectText("我的模板投稿");
          await ctx.expectText("我的插件投稿");
          await ctx.expectText("我的技能投稿");
          await ctx.expectText("企业消息");
        },
        screenshot: { name: "enterprise-member", requireText: ["企业消息", "我的模板投稿", "我的插件投稿", "我的技能投稿"] },
      });
    } },
    { name: "资源管理员按类型分工", async run(ctx) {
      await ctx.prove("管理员同时拥有模板和插件管理入口", {
        voiceover: "管理员可以管理两类资源，并给员工或部门下发模板和插件的使用权限。",
        action: async () => { await ctx.trustedClick('[data-testid="proof-admin"]'); },
        assert: async () => { ctx.assert(await ctx.eval('Boolean(document.querySelector(\'[data-testid="enterprise-template-manage"]\')) && Boolean(document.querySelector(\'[data-testid="enterprise-extension-manage"]\'))'), "administrator has both resource controls"); },
        screenshot: { name: "admin-both-resources", requireText: ["模板管理", "插件管理"] },
      });
      for (const [role, type, name, other] of [["template_admin", "template", "模板", "插件"], ["extension_admin", "extension", "插件", "模板"]]) {
        await ctx.prove(`${name}管理员只显示对应管理入口，并可为${name}分配权限`, {
          voiceover: `${name}管理员只管理${name}。另一类资源的管理入口隐藏，范围内的资源仍可分配权限。`,
          action: async () => {
            await ctx.trustedClick(`[data-testid="proof-${role}"]`);
            ctx.assert(await ctx.eval(`(() => {
              const own = document.querySelector('[data-testid="enterprise-${type}-manage"]');
              const other = document.querySelector('[data-testid="enterprise-${type === "template" ? "extension" : "template"}-manage"]');
              return own?.textContent.includes('${name}管理') && !other?.textContent.includes('${other}管理');
            })()`), `${role} only manages its assigned resource type`);
            await ctx.trustedClick(`[data-testid="enterprise-${type}-manage"]`);
            await ctx.waitForText(`全部企业${name}`);
            await ctx.waitForText(type === "template" ? "产品提案模板" : "产品调研助手");
          },
          assert: async () => {
            ctx.assert(await ctx.eval('Array.from(document.querySelectorAll(\'[data-testid="enterprise-resource-management"] button\')).some(button => button.textContent.includes("分配权限") && !button.disabled)'), `${role} can grant its own resource type`);
          },
          screenshot: { name: `${role}-scoped`, requireText: [`企业${name}管理`, "分配权限"], rejectText: [`企业${other}管理`] },
        });
        await ctx.trustedClick('[data-testid="enterprise-resource-management"] [data-slot="dialog-close"]');
      }
    } },
    { name: "模板和插件统一企业名称", async run(ctx) {
      for (const [name, suffix] of [["星河科技", "normal"], ["星河科技企业协作与数字创意研发中心企业资源管理服务平台", "long"]]) {
        await ctx.prove("模板和插件来源使用相同企业全称，长名称保留完整提示", {
          voiceover: "模板和插件都显示当前企业名称。名称较长时按钮省略显示，完整名称仍保留在提示中。",
          action: async () => {
            if (suffix === "long") await ctx.trustedClick('[data-testid="proof-long-source-name"]');
            await ctx.trustedClick('[data-testid="proof-template-source"]');
            await ctx.waitForText("我的模板");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`Array.from(document.querySelectorAll('button[title="${name}"]')).length === 2 && Array.from(document.querySelectorAll('button[title="${name}"]')).every(button => button.textContent.trim() === "${name}")`), "template and plugin labels equal the full enterprise name and title");
            if (suffix === "long") ctx.assert(await ctx.eval(`Array.from(document.querySelectorAll('button[title="${name}"] span')).every(span => span.scrollWidth > span.clientWidth && getComputedStyle(span).textOverflow === "ellipsis")`), "long names truncate visually without losing their full text");
          },
          screenshot: { name: `enterprise-source-name-${suffix}`, requireText: [name, "我的模板"] },
        });
        await ctx.trustedClick('[data-slot="dialog-content"][data-open] [data-slot="dialog-close"]');
      }
    } },
    { name: "个人模式与退出", async run(ctx) {
      await ctx.prove("切回个人或退出登录后，企业入口隐藏", {
        voiceover: "切回个人空间时企业入口隐藏，退出登录会隐藏当前企业，绑定缓存只供原账号再次登录时恢复。",
        action: async () => {
          await ctx.trustedClick('[data-testid="proof-personal-mode"]');
          await ctx.waitFor(hidden);
          ctx.assert(await ctx.eval(hidden), "personal context hides enterprise controls even with a saved connection");
          await ctx.trustedClick('[data-testid="proof-owner"]');
          await ctx.trustedClick('[data-testid="proof-share"]');
          await ctx.waitForText("分享会话总结");
          await ctx.trustedClick('[data-testid="enterprise-session-share"] [data-slot="dialog-close"]');
          await ctx.trustedClick('[data-testid="proof-sign-out"]');
        },
        assert: async () => {
          await ctx.expectText("企业协作入口已隐藏");
          ctx.assert(await ctx.eval(hidden), "signed-out account has no enterprise controls");
          await ctx.expectText("企业登录记录 0");
        },
        screenshot: { name: "personal-no-enterprise", requireText: ["企业协作入口已隐藏"], rejectText: ["分享产品讨论", "分享会话总结"] },
      });
    } },
    { name: "过期与停用", async run(ctx) {
      await ctx.trustedClick('[data-testid="proof-owner"]');
      await ctx.prove("登录自然到期或成员停用后，企业入口自动隐藏", {
        voiceover: "企业登录到期后无需切换页面，协作入口自动隐藏；成员被停用后也无法继续使用。",
        action: async () => {
          await ctx.trustedClick('[data-testid="proof-expire"]');
          await ctx.trustedClick('[data-testid="proof-share"]');
          await ctx.waitForText("分享会话总结");
          await ctx.waitFor(hidden);
          ctx.assert(await ctx.eval(hidden), "expiry closes the existing share dialog without navigation");
          await ctx.trustedClick('[data-testid="proof-owner"]');
          await ctx.trustedClick('[data-testid="proof-suspend"]');
        },
        assert: async () => {
          await ctx.expectText("企业协作入口已隐藏");
          ctx.assert(await ctx.eval(hidden), "suspended membership hides all enterprise controls");
        },
        screenshot: { name: "inactive-no-enterprise", requireText: ["企业协作入口已隐藏"], rejectText: ["分享产品讨论", "分享会话总结"] },
      });
    } },
    { name: "换号后恢复各自企业绑定", async run(ctx) {
      await ctx.trustedClick('[data-testid="proof-login-account-a"]');
      await ctx.waitForText("验证账号 A");
      await ctx.prove("账号 A 的企业绑定显示在真实账号设置控件中", {
        voiceover: "账号 A 绑定企业后，企业出现在工作空间列表中。",
        action: async () => { await ctx.trustedClick('[data-testid="proof-bind-account"]'); await ctx.waitForText("星河科技"); },
        assert: async () => { await ctx.expectText("account-a@example.test"); await ctx.expectText("星河科技"); },
        screenshot: { name: "account-a-enterprise-bound", requireText: ["account-a@example.test", "星河科技"] },
      });
      await ctx.prove("退出账号后企业入口隐藏，缓存继续保留", {
        voiceover: "退出账号 A 后，企业入口隐藏。退出不会删除账号 A 的绑定缓存。",
        action: async () => { await ctx.trustedClick('[data-testid="cloud-account-identity"] button'); await ctx.waitForText("当前未登录"); },
        assert: async () => { await ctx.expectNoText("星河科技"); },
        screenshot: { name: "signed-out-bindings-hidden", requireText: ["当前未登录"], rejectText: ["星河科技"] },
      });
      await ctx.prove("账号 B 不会显示账号 A 的企业绑定", {
        voiceover: "换成账号 B 后，列表只读取账号 B 的企业。账号 A 的企业不会出现在这里。",
        action: async () => { await ctx.trustedClick('[data-testid="proof-login-account-b"]'); await ctx.waitForText("验证账号 B"); },
        assert: async () => { await ctx.expectText("account-b@example.test"); await ctx.expectNoText("星河科技"); },
        screenshot: { name: "account-b-isolated", requireText: ["account-b@example.test", "验证账号 B"], rejectText: ["星河科技"] },
      });
      await ctx.prove("重新登录账号 A 后无需再次绑定就恢复原企业", {
        voiceover: "退出账号 B，再登录账号 A，之前绑定的企业自动回到列表，无需重新输入加入码。",
        action: async () => {
          await ctx.trustedClick('[data-testid="cloud-account-identity"] button'); await ctx.waitForText("当前未登录");
          await ctx.trustedClick('[data-testid="proof-login-account-a"]'); await ctx.waitForText("验证账号 A"); await ctx.waitForText("星河科技");
        },
        assert: async () => { await ctx.expectText("account-a@example.test"); await ctx.expectText("星河科技"); },
        screenshot: { name: "account-a-bindings-restored", requireText: ["account-a@example.test", "星河科技"] },
      });
    } },
  ],
};
