const origin = process.env.XHS_OPS_ORIGIN || 'http://127.0.0.1:4790';

export default {
  id: 'xiaohongshu-accounts',
  title: '小红书运营台从账号管理开始',
  kind: 'user-facing',
  preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: [{
    name: '旧任务入口转到账号管理，保留接入流程和三个导航入口',
    async run(ctx) {
      await ctx.prove('打开运营台进入账号管理，任务看板和新建任务面板已移除', {
        voiceover: '打开运营台后直接管理账号，导航只保留账号、互动和数据，扫码接入与账号设置继续可用。',
        action: async () => {
          await ctx.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
          await ctx.client.send('Page.bringToFront');
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
          await ctx.client.send('Page.navigate', { url: origin + '/tasks' });
          await ctx.waitFor(`location.pathname === '/accounts' && document.readyState === 'complete'`);
        },
        assert: async () => {
          const state = await ctx.eval(`({
            links: [...document.querySelectorAll('.app-sidebar nav a')].map(a => a.getAttribute('href')),
            active: document.querySelector('.app-sidebar nav a[aria-current="page"]')?.textContent.trim(),
            removed: !document.querySelector('#task-panel, #campaign-form, .kanban-board, a[href="/tasks"]'),
            login: document.querySelector('[data-new-account-login]')?.getAttribute('href'),
            identity: Boolean(document.querySelector('#account-form [name="expectedProfileId"]')),
            position: Boolean(document.querySelector('#account-form [name="position"]')),
            overflow: document.documentElement.scrollWidth > innerWidth + 1
          })`);
          ctx.assert(JSON.stringify(state.links) === JSON.stringify(['/accounts', '/interactions', '/analytics']), 'Navigation still includes a task entry or lost a supported page.');
          ctx.assert(state.active === '账号' && state.removed && !state.overflow, 'Account landing page is incorrect.');
          ctx.assert(state.login === 'https://creator.xiaohongshu.com/login' && state.identity && state.position, 'Account onboarding was removed with the task panel.');
        },
        screenshot: { name: 'account-landing', fromSurface: false, requireText: ['账号管理', '已接入账号', '接入账号'], rejectText: ['任务看板', '新建任务'] },
      });
      try {
        await ctx.prove('窄面板中的三个导航入口仍可切换页面', {
          voiceover: '缩窄面板后，三个入口均匀排列在底部，点击互动可以查看审核和互动记录。',
          action: async () => {
            await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await ctx.eval(`document.querySelector('.app-sidebar nav a[href="/interactions"]').click()`);
            await ctx.waitFor(`location.pathname === '/interactions' && document.readyState === 'complete'`);
          },
          assert: async () => {
            const state = await ctx.eval(`({ active: document.querySelector('.app-sidebar nav a[aria-current="page"]')?.textContent.trim(), columns: getComputedStyle(document.querySelector('.app-sidebar nav')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 })`);
            ctx.assert(state.active === '互动' && state.columns === 3 && !state.overflow, 'Narrow navigation is broken.');
          },
          screenshot: { name: 'three-item-mobile-navigation', fromSurface: false, requireText: ['待人工审核', '最近互动'], rejectText: ['任务看板', '新建任务'] },
        });
      } finally {
        await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      }
    },
  }],
};
