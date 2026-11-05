async function openSettings(ctx, panel) {
  const origin = await ctx.eval('location.origin');
  await ctx.client.send('Emulation.setDeviceMetricsOverride', {width: 960, height: 1000, deviceScaleFactor: 1, mobile: false});
  await ctx.client.send('Page.navigate', {url: `${origin}/tests/video-avatar-proof.html?panel=${panel}&applied=single`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-${panel}-panel"] [class~=\"text-[13px]\"]'))`);
  await ctx.eval('document.documentElement.classList.add("ipollowork-electron", "ipollowork-platform-mac")');
  if (panel === 'avatar') {
    await ctx.clickText('切换 Key 配置');
    await ctx.waitForText('生成按 RunningHub 实际用量计费。');
  }
  await ctx.waitFor(`getComputedStyle(document.querySelector('[data-testid="video-${panel}-panel"] [class~=\"text-[11px]\"]')).fontWeight === "500"`);
}

async function verifySettingsTypography(ctx, panel, selector) {
  const values = await ctx.eval(`(() => {
    const panel = document.querySelector('[data-testid="video-${panel}-panel"]');
    const font = el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.color]; };
    return {heading: font(panel.querySelector('h3')), caption: font(panel.querySelector('[class~=\"text-[11px]\"]')), value: font(panel.querySelector(${JSON.stringify(selector)}))};
  })()`);
  ctx.assert(values.heading[0] === '13px' && values.heading[1] === '500', JSON.stringify(values));
  ctx.assert(values.caption[0] === '11px' && values.caption[1] === '500', JSON.stringify(values));
  ctx.assert(values.value[0] === '12px' && values.value[1] === '500', JSON.stringify(values));
  ctx.assert(values.value[2] !== values.caption[2], 'Values and helper text need distinct semantic colors');
  const cta = await ctx.eval(`(() => {const e = [...document.querySelectorAll('[data-testid="video-${panel}-panel"] button')].find(el => /生成数字人|整段配音/.test(el.textContent)); const s = getComputedStyle(e); return {color: s.color, background: s.backgroundColor, height: e.getBoundingClientRect().height};})()`);
  ctx.assert(cta.color !== cta.background && cta.height === 34, JSON.stringify(cta));
  await ctx.client.send('DOM.enable');
  await ctx.client.send('CSS.enable');
  const {root} = await ctx.client.send('DOM.getDocument');
  const {nodeId} = await ctx.client.send('DOM.querySelector', {nodeId: root.nodeId, selector: `[data-testid="video-${panel}-panel"] ${panel === "avatar" ? "label.text-xs" : selector}`});
  const {fonts} = await ctx.client.send('CSS.getPlatformFontsForNode', {nodeId});
  ctx.assert(fonts.length > 0 && fonts.every(font => !/ExtraLight|Thin/.test(font.postScriptName)), JSON.stringify(fonts));
  ctx.recordEvidence({type: 'assertion', status: 'passed', assertion: 'Panel follows shared type sizes with readable macOS Chinese glyphs and distinct caption colors', actual: {values, fonts}});
}

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
  cdpTarget: {urlIncludes: process.env.IPOLLOWORK_PANEL_PROOF_ORIGIN || 'video-avatar-proof.html'},
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
    {name: 'Voice hierarchy and readable Chinese controls', run: async ctx => {
      await ctx.prove('Applied voice, parameter labels and helper text have distinct hierarchy without thin Chinese glyphs', {
        voiceover: '声音面板突出当前配音，参数与说明使用统一字号；中文不再比数字纤细。',
        action: () => openSettings(ctx, 'voice'),
        assert: async () => {
          await verifySettingsTypography(ctx, 'voice', '[data-testid="voice-applied"]');
          await ctx.expectText('已应用：龙应沐');
          await ctx.trustedClick('button[aria-label="选择一个官方音色"]');
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-picker"] [data-testid="voice-auto-match"]'))`);
          const popupFont = await ctx.eval(`getComputedStyle(document.querySelector('[data-testid="voice-auto-match"] [class~=\"text-[11px]\"]')).fontWeight`);
          ctx.assert(popupFont === '500', 'Portaled picker lost its Chinese typography');
          await ctx.client.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
          await ctx.client.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-picker"]')`);
          const heights = await ctx.eval(`[...document.querySelectorAll('[data-testid="voice-delivery-controls"] button[role="combobox"]')].map(el => el.getBoundingClientRect().height)`);
          ctx.assert(heights.length === 4 && heights.every(height => height === 34), JSON.stringify(heights));
        },
        screenshot: {name: 'voice-readable-hierarchy', requireText: ['自动生成配音', '声音参数', '已应用：龙应沐']},
      });
    }},
    {name: 'Avatar shares the voice typography hierarchy', run: async ctx => {
      await ctx.prove('Avatar titles, entered content and supporting hints follow the same readable hierarchy', {
        voiceover: '数字人面板沿用相同字体层级，上传入口和输入内容清晰可读，计费说明只保留一处。',
        action: () => openSettings(ctx, 'avatar'),
        assert: async () => {
          await verifySettingsTypography(ctx, 'avatar', 'textarea');
          const content = await ctx.eval(`document.querySelector('[data-testid="video-avatar-panel"]').textContent`);
          ctx.assert((content.match(/计费/g) || []).length === 1, 'Duplicated billing guidance');
        },
        screenshot: {name: 'avatar-readable-hierarchy', requireText: ['上传人物图片', '画面设置', '动作描述', '生成数字人']},
      });
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
    }},
  ],
};
