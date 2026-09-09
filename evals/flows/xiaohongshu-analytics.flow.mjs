import { connect, listTargets } from '../runner/cdp.mjs';

export default {
  id: 'xiaohongshu-analytics',
  title: '小红书数据页：账号切换与数据来源',
  kind: 'user-facing',
  steps: [{
    name: '从运营台导航查看当前账号数据',
    async run(ctx) {
      const frame = `document.querySelector('iframe[title="小红书运营台"]')`;
      await ctx.waitFor(`Boolean(${frame})`);
      const origin = new URL(await ctx.eval(`${frame}.src`)).origin;
      const target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url.startsWith(origin + '/'));
      ctx.assert(Boolean(target), 'Missing workbench frame.');
      const client = await connect(target.webSocketDebuggerUrl);
      const evaluate = async expression => (await client.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
      const waitFor = async expression => {
        for (let i = 0; i < 40; i++) {
          if (await evaluate(expression)) return;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        throw new Error('Analytics page did not reach the expected state.');
      };
      try {
        await ctx.eval(`${frame}.style.width = ''`);
        await ctx.prove('数据页使用统一的账号卡片，选择后直接查看账号数据', {
          voiceover: '数据页顶部改成头像、账号名称和连接状态的卡片，右侧可添加账号；选择账号后直接更新数据，无需再点查看。',
          action: async () => {
            await evaluate(`window.__analyticsNavigating = true; document.querySelector('nav a[href="/analytics"]').click()`);
            await waitFor(`!window.__analyticsNavigating && document.readyState === 'complete' && Boolean(document.querySelector('[data-analytics-account]'))`);
            await evaluate(`document.querySelector('[data-analytics-account]').dispatchEvent(new Event('change', {bubbles:true}))`);
            await waitFor(`Boolean(new URL(location.href).searchParams.get('account'))`);
          },
          assert: async () => {
            const state = await evaluate(`({text:document.body.innerText, selected:document.querySelector('[data-analytics-account]').value, account:new URL(location.href).searchParams.get('account'), active:document.querySelector('nav a[aria-current="page"]').textContent.trim(), overflow:document.documentElement.scrollWidth > innerWidth + 1})`);
            ctx.assert(state.selected === state.account && state.active === '数据', 'Selected account or active navigation is incorrect.');
            ctx.assert(await evaluate(`Boolean(document.querySelector('.account-bar .account-avatar')) && Boolean(document.querySelector('.account-bar .add-account-link')) && !document.querySelector('.analytics-switch')`), 'Shared account card is missing.');
            for (const label of ['账号与文章数据', '平台数据', '运营台文章记录', '导入 / 更新平台数据']) ctx.assert(state.text.includes(label), `Missing ${label}`);
            ctx.assert(!state.overflow, 'The data page overflows the workbench width.');
            const template = await fetch(origin + '/analytics/template.csv');
            ctx.assert(template.ok && (await template.text()).includes('小红书号'), 'CSV template is unavailable.');
          },
          screenshot: 'account-analytics',
        });
        await ctx.prove('窄面板仍能完整显示数据与四个导航入口', {
          voiceover: '面板缩窄后，统计卡片分为两列，四个导航入口排列在底部。',
          action: async () => {
            await ctx.eval(`${frame}.style.width = '390px'`);
            await waitFor('innerWidth === 390');
          },
          assert: async () => {
            const state = await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth > innerWidth + 1, nav:getComputedStyle(document.querySelector('.app-sidebar')).position, links:document.querySelectorAll('.app-sidebar nav a').length})`);
            ctx.assert(state.width === 390 && !state.overflow && state.links === 4, 'Narrow layout lost navigation or overflowed.');
          },
          screenshot: 'account-analytics-narrow',
        });
      } finally {
        await ctx.eval(`${frame}.style.width = ''`);
        client.close();
      }
    },
  }],
};
