export default {
  id: "plugin-sidebar-shortcuts",
  title: "个人固定入口与企业统一导航（隔离企业服务）",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "[::1]:5173/tests/enterprise-collaboration-proof.html?navigation" },
  steps: [{ name: "导航权限、保存、同步与缺少插件提示", async run(ctx) {
    await ctx.waitForText("导航快捷入口验证");
    const menu = '[data-testid="proof-admin"] [data-testid="sidebar-plugin-shortcuts-menu"]';
    const option = id => `[data-testid="sidebar-plugin-shortcut-option-${id}"]`;
    const exists = selector => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
    const closeMenu = async () => {
      if (await ctx.eval(exists('[role="menu"]'))) {
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await ctx.waitFor('!document.querySelector(\'[role="menu"]\')');
      }
    };
    await ctx.prove("个人账号固定三个入口，个人与普通成员没有管理入口", {
      voiceover: "个人账号固定显示模板、扩展和日程；只有企业管理员可以打开导航快捷入口管理菜单。",
      assert: async () => {
        for (const id of ["template-market", "extensions", "schedule"]) ctx.assert(await ctx.eval(exists(`[data-testid="proof-personal"] [data-testid="sidebar-navigation-shortcut-${id}"]`)), `${id} is present`);
        for (const role of ["personal", "member"]) ctx.assert(!await ctx.eval(exists(`[data-testid="proof-${role}"] [data-testid="sidebar-plugin-shortcuts-menu"]`)), `${role} has no management menu`);
      }, screenshot: { targetUrlIncludes: "localhost:5173/tests/enterprise-collaboration-proof.html?navigation-frame", textTargetUrlIncludes: "[::1]:5173/tests/enterprise-collaboration-proof.html?navigation", name: "personal-defaults", requireText: ["个人账号", "模板", "扩展", "日程", "导航快捷入口"], rejectText: ["Something went wrong"] },
    });
    await ctx.prove("管理员沿用勾选菜单，内置入口也能选择并同步成员", {
      voiceover: "管理员打开勾选菜单，模板、扩展、日程和插件都能选择。取消日程后，同步的成员导航也会移除日程。",
      action: async () => {
        await ctx.trustedClick(menu);
        for (const id of ["template-market", "extensions", "schedule", "plugin-workshop"]) await ctx.waitFor(exists(option(id)));
        await ctx.trustedClick(option("schedule"));
        await ctx.waitFor('!document.querySelector(\'[data-testid="proof-admin"] [data-testid="sidebar-navigation-shortcut-schedule"]\')');
        await closeMenu();
        await ctx.trustedClick('[data-testid="proof-refresh"]');
      }, assert: async () => {
        await ctx.waitFor('!document.querySelector(\'[data-testid="proof-member"] [data-testid="sidebar-navigation-shortcut-schedule"]\')');
        ctx.assert(await ctx.eval(exists('[data-testid="proof-personal"] [data-testid="sidebar-navigation-shortcut-schedule"]')), "Personal defaults remain independent");
      }, screenshot: { targetUrlIncludes: "localhost:5173/tests/enterprise-collaboration-proof.html?navigation-frame", textTargetUrlIncludes: "[::1]:5173/tests/enterprise-collaboration-proof.html?navigation", name: "enterprise-synced", requireText: ["企业管理员", "普通成员", "导航快捷入口"], rejectText: ["Something went wrong"] },
    });
    await ctx.prove("未安装插件的成员仍看到企业入口，点击提示前往插件市场下载", {
      voiceover: "管理员添加插件工坊后，未安装插件的成员也会看到入口。点击会提示自行下载，并可前往插件市场。",
      action: async () => {
        await ctx.trustedClick(menu); await ctx.trustedClick(option("plugin-workshop"));
        await ctx.waitFor(exists('[data-testid="proof-admin"] [data-testid="sidebar-plugin-shortcut-plugin-workshop"]'));
        await closeMenu(); await ctx.trustedClick('[data-testid="proof-refresh"]');
        await ctx.waitFor(exists('[data-testid="proof-member"] [data-testid="sidebar-plugin-shortcut-plugin-workshop"]'));
        await ctx.trustedClick('[data-testid="proof-member"] [data-testid="sidebar-plugin-shortcut-plugin-workshop"]');
      }, assert: async () => {
        await ctx.waitForText("未安装「插件工坊」");
        await ctx.expectText("前往插件市场");
      }, screenshot: { targetUrlIncludes: "localhost:5173/tests/enterprise-collaboration-proof.html?navigation-frame", textTargetUrlIncludes: "[::1]:5173/tests/enterprise-collaboration-proof.html?navigation", name: "missing-plugin", requireText: ["未安装「插件工坊」", "请前往插件市场自行下载", "前往插件市场"], rejectText: ["Something went wrong"] },
    });
    await ctx.prove("后台撤销管理员角色后，旧菜单无法保存导航", {
      voiceover: "管理员被降为成员后，旧菜单再次保存也会重新验证权限，并提示当前账号没有权限。",
      action: async () => {
        await ctx.trustedClick('[data-testid="proof-stats"]');
        const before = await ctx.eval('document.querySelector(\'[data-testid="proof-result"]\').dataset.writes');
        await ctx.trustedClick('[data-testid="proof-demote"]');
        await ctx.trustedClick(menu); await ctx.trustedClick(option("schedule"));
        await ctx.waitForText("当前企业账号没有执行此操作的权限");
        await closeMenu(); await ctx.trustedClick('[data-testid="proof-stats"]');
        ctx.assert(await ctx.eval('document.querySelector(\'[data-testid="proof-result"]\').dataset.writes') === before, "Demoted administrator sends no navigation write");
      }, assert: async () => ctx.expectText("当前企业账号没有执行此操作的权限"),
      screenshot: { targetUrlIncludes: "localhost:5173/tests/enterprise-collaboration-proof.html?navigation-frame", textTargetUrlIncludes: "[::1]:5173/tests/enterprise-collaboration-proof.html?navigation", name: "demoted-denied", requireText: ["当前企业账号没有执行此操作的权限"], rejectText: ["Something went wrong"] },
    });
  } }],
};
