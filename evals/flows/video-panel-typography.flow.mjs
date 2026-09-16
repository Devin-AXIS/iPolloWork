async function openTheme(ctx, standalone = false) {
  const origin = await ctx.eval('location.origin');
  await ctx.client.send('Page.navigate', {
    url: `${origin}/tests/video-avatar-proof.html?panel=theme${standalone ? '&standalone=1' : ''}`,
  });
  await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="design-system-drawer"]\'))');
}

export default {
  id: 'video-panel-typography',
  title: 'Shared theme typography in Video and Design panels',
  kind: 'user-facing',
  cdpTarget: {urlIncludes: 'video-avatar-proof.html'},
  preserveTheme: true,
  steps: [
    {name: 'Video theme uses the panel typography hierarchy', run: async ctx => {
      await ctx.prove('Video Theme uses 13px medium section titles and 12px regular field labels and values', {
        voiceover: '视频主题的分组标题、字段和值现在遵循同一套字体层级。',
        action: () => openTheme(ctx),
        assert: async () => {
          const values = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="design-system-drawer"]');
            const title = [...panel.querySelectorAll('h3')].find(el => el.textContent.includes('字体'));
            const label = [...panel.querySelectorAll('label span')].find(el => el.textContent.includes('标题字体'));
            const select = label?.closest('label')?.querySelector('button span');
            const font = el => { const style = getComputedStyle(el); return [style.fontSize, style.fontWeight]; };
            return {title: font(title), label: font(label), value: font(select)};
          })()`);
          ctx.assert(JSON.stringify(values) === JSON.stringify({title:['13px','500'],label:['12px','400'],value:['12px','400']}), JSON.stringify(values));
        },
        screenshot: {name: 'video-theme-type-hierarchy', requireText: ['风格预设', '字体', '标题字体']},
      });
    }},
    {name: 'Design drawer shares the same typography', run: async ctx => {
      await ctx.prove('The Design System drawer uses the same 13px medium heading typography', {
        voiceover: '设计侧的设计系统面板同步使用相同的标题层级。',
        action: () => openTheme(ctx, true),
        assert: async () => {
          const values = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="design-system-drawer"]');
            const title = [...panel.querySelectorAll('p')].find(el => el.textContent.trim() === '设计系统');
            const section = panel.querySelector('h3');
            const font = el => { const style = getComputedStyle(el); return [style.fontSize, style.fontWeight]; };
            return {title: font(title), section: font(section)};
          })()`);
          ctx.assert(JSON.stringify(values) === JSON.stringify({title:['13px','500'],section:['13px','500']}), JSON.stringify(values));
        },
        screenshot: {name: 'design-theme-type-hierarchy', requireText: ['设计系统', '选择设计系统']},
      });
    }},
  ],
};
