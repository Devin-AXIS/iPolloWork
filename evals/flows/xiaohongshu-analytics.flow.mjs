const origin = process.env.XHS_OPS_ORIGIN;

export default {
  id: 'xiaohongshu-analytics',
  title: '小红书互动与数据面板：原地切换账号',
  kind: 'user-facing',
  requiredEnv: ['XHS_OPS_ORIGIN'],
  preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: [{
    name: '展开账号列表，切换后保留面板与账号',
    async run(ctx) {
      const waitForAccount = (panel, id) => ctx.waitFor("location.pathname === '/" + panel + "' && document.readyState === 'complete' && document.querySelector('.account-menu a[aria-current]')?.getAttribute('href') === '/" + panel + "?account=" + id + "' && new URL(location.href).searchParams.get('account') === '" + id + "'");
      const assertMenu = async (panel, accounts) => {
        const state = await ctx.eval("(() => { const menu = document.querySelector('.account-menu'); const bounds = menu.getBoundingClientRect(); return { panel: location.pathname, open: document.querySelector('.account-picker').open, links: [...menu.querySelectorAll('a')].map(a => a.getAttribute('href')), text: menu.innerText, overflow: document.documentElement.scrollWidth > innerWidth + 1, fits: bounds.left >= 0 && bounds.right <= innerWidth }; })()");
        ctx.assert(state.panel === '/' + panel && state.open, 'Account header navigated away instead of opening its list.');
        ctx.assert(!state.overflow && state.fits, 'The account list is clipped or overflows.');
        for (const account of accounts) ctx.assert(state.links.includes('/' + panel + '?account=' + account.id) && state.text.includes(account.name), 'The list is missing a bound account.');
      };
      const assertSelected = async (panel, account) => {
        await waitForAccount(panel, account.id);
        ctx.assert(await ctx.eval("document.querySelector('.account-switcher strong').textContent === " + JSON.stringify(account.name)), 'The header shows the wrong account.');
        const other = panel === 'analytics' ? 'interactions' : 'analytics';
        ctx.assert(await ctx.eval("Boolean(document.querySelector('.app-sidebar a[href=\"/" + other + "?account=" + account.id + "\"]'))"), 'Navigation lost the selected account.');
      };
      try {
        await ctx.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
        await ctx.client.send('Page.navigate', { url: origin + '/interactions' });
        await ctx.waitFor('document.readyState === "complete" && Boolean(document.querySelector(".account-picker"))');
        const accounts = await ctx.eval("[...document.querySelectorAll('.account-menu a')].map(a => ({id: new URL(a.href).searchParams.get('account'), name: a.querySelector('strong').textContent, current: a.hasAttribute('aria-current')}))");
        ctx.assert(accounts.length >= 2, 'Use a workbench with at least two bound accounts.');
        const first = accounts.find(account => account.current);
        const second = accounts.find(account => !account.current);
        await ctx.prove('点击互动页账号栏展开已绑定账号，不跳转到账号管理', {
          voiceover: '在互动页点击账号名称或箭头，直接展开所有已绑定账号，并标记当前账号。',
          action: () => ctx.trustedClick('.account-switcher'),
          assert: () => assertMenu('interactions', accounts),
          screenshot: { name: 'interactions-account-menu', requireText: ['最近互动', first.name, second.name] },
        });
        await ctx.prove('选择另一账号后仍在互动页，并显示该账号为当前账号', {
          voiceover: '选择另一个账号，留在互动页查看它的审核内容和最近互动。',
          action: async () => {
            await ctx.trustedClick('.account-menu a[href="/interactions?account=' + second.id + '"]');
            await waitForAccount('interactions', second.id);
          },
          assert: async () => {
            await assertSelected('interactions', second);
            ctx.assert(await ctx.eval("!document.querySelector('.account-picker').open && document.querySelector('.app-sidebar a[aria-current]').textContent.trim() === '互动'"), 'Switching changed the wrong panel or left its menu open.');
          },
          screenshot: { name: 'interactions-account-selected', requireText: [second.name, '待人工审核', '最近互动'] },
        });
        await ctx.prove('进入数据页保留所选账号，账号栏同样展开列表', {
          voiceover: '从互动进入数据页时，继续查看同一个账号；点击顶部仍能展开账号列表。',
          action: async () => {
            await ctx.trustedClick('.app-sidebar a[href="/analytics?account=' + second.id + '"]');
            await waitForAccount('analytics', second.id);
            await ctx.trustedClick('.account-switcher');
          },
          assert: async () => {
            await assertSelected('analytics', second);
            await assertMenu('analytics', accounts);
          },
          screenshot: { name: 'analytics-account-menu', requireText: ['账号与文章数据', first.name, second.name] },
        });
        await ctx.prove('数据页直接切换账号，窄面板中的下拉列表完整可用', {
          voiceover: '在数据页直接选择账号，文章和数据随之更新。窄面板里也能完整展开列表，按 Escape 或点击外部即可收起。',
          action: async () => {
            await ctx.trustedClick('.account-menu a[href="/analytics?account=' + first.id + '"]');
            await waitForAccount('analytics', first.id);
            await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await ctx.trustedClick('.account-switcher');
            await ctx.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await ctx.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            ctx.assert(await ctx.eval("!document.querySelector('.account-picker').open && document.activeElement.matches('.account-switcher')"), 'Escape did not close the list and return focus.');
            await ctx.trustedClick('.account-switcher');
            await ctx.trustedClick('.analytics-profile h2');
            ctx.assert(await ctx.eval("!document.querySelector('.account-picker').open"), 'Clicking outside did not close the list.');
            await ctx.trustedClick('.account-switcher');
          },
          assert: async () => {
            await assertSelected('analytics', first);
            await assertMenu('analytics', accounts);
            ctx.assert(await ctx.eval('innerWidth === 390'), 'The narrow layout was not exercised.');
          },
          screenshot: { name: 'analytics-account-menu-narrow', requireText: ['账号与文章数据', first.name, second.name] },
        });
      } finally {
        await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      }
    },
  }],
};
