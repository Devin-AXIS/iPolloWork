import { evaluate } from '../runner/cdp.mjs';

export default {
  id: 'video-script-inspector-readonly',
  title: '真实开发版：脚本展开与宿主属性恢复，明暗主题，只取消确认',
  kind: 'user-facing', preserveTheme: true,
  cdpTarget: { urlIncludes: 'localhost:5173' },
  steps: [{ name: '只读布局走查，不保存或提交任务', async run(ctx) {
    ctx.assert(await ctx.eval("navigator.userAgent.includes('Electron')"), 'Real Electron client');
    const tree = await ctx.client.send('Page.getFrameTree');
    const src = await ctx.eval("document.querySelector('iframe[title*=HyperFrames]').src");
    const entry = tree.frameTree.childFrames.find(e => e.frame.url.startsWith(new URL(src).origin));
    ctx.assert(entry, 'Existing video Studio iframe');
    const world = await ctx.client.send('Page.createIsolatedWorld', { frameId: entry.frame.id, worldName: 'script-inspector-readonly' });
    const frame = { send: (method, params) => ctx.client.send(method, method === 'Runtime.evaluate' ? { ...params, contextId: world.executionContextId } : params) };
    const studio = expression => evaluate(frame, expression, { awaitPromise: true });
    const wait = async (expression, host = false) => {
      for (let i = 0; i < 60; i++) {
        if (await (host ? ctx.eval(expression) : studio(expression))) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('State did not settle: ' + expression);
    };
    const choose = label => studio("Array.from(document.querySelectorAll('.hf-studio-inspector button')).find(e=>e.textContent===" + JSON.stringify(label) + ").click()");
    const toggle = () => studio("document.querySelector('[data-testid=script-expand-table]').click()");
    const theme = await ctx.eval("import('/src/app/theme.ts').then(m=>m.getInitialThemeMode())", { awaitPromise: true });
    const tab = await studio("Array.from(document.querySelectorAll('.hf-studio-inspector button[aria-pressed=true]')).find(e=>['图层','主题','组件','动画','素材','讲解'].includes(e.textContent))?.textContent");
    const originalExpanded = await studio("document.querySelector('.hf-script-sidebar').dataset.expanded==='true'");
    const fields = () => studio("Array.from(document.querySelectorAll('.hf-script-sidebar input,.hf-script-sidebar textarea')).map(e=>({label:e.getAttribute('aria-label'),value:e.value}))");
    const before = await fields();
    try {
      if (originalExpanded) await toggle();
      for (const mode of ['light', 'dark']) {
        await ctx.eval("import('/src/app/theme.ts').then(m=>m.setThemeMode(" + JSON.stringify(mode) + "))", { awaitPromise: true });
        await wait("document.documentElement.dataset.ipolloworkTheme===" + JSON.stringify(mode));
        for (const label of ['讲解', '主题']) {
          await choose(label);
          if (label === '讲解') await choose('配音');
          // Inspect the existing host overlay by its actual bounded inspector container.
          const visible = "Array.from(document.querySelectorAll('[data-testid=video-voice-panel],[data-testid=video-style-tab-content],[data-testid=video-avatar-tab-content]')).some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).display!=='none')";
          await wait(visible, true);
          await ctx.prove(mode + ' · ' + label + ' · 展开脚本不重叠', {
            voiceover: '只展开脚本表，宿主属性隐藏；不修改作品或任务。',
            action: async () => { await toggle(); await wait("document.querySelector('.hf-script-sidebar').dataset.expanded==='true'"); await wait('!(' + visible + ')', true); },
            assert: async () => {
              ctx.assert(await ctx.eval('!(' + visible + ')'), 'No visible host inspector above expanded script');
              ctx.assert(await studio("document.querySelector('.hf-script-sidebar').getBoundingClientRect().width>innerWidth*.8"), 'Expanded table fills available workspace');
              ctx.assert(JSON.stringify(await fields()) === JSON.stringify(before), 'Script input values unchanged');
            }, screenshot: { name: mode + '-' + label + '-expanded' },
          });
          await ctx.prove(mode + ' · ' + label + ' · 收起恢复属性', {
            voiceover: '只收起表格，恢复原属性页签与可见面板。',
            action: async () => { await toggle(); await wait("document.querySelector('.hf-script-sidebar').dataset.expanded==='false'"); await wait(visible, true); },
            assert: async () => {
              ctx.assert(await studio("Array.from(document.querySelectorAll('.hf-studio-inspector button')).some(e=>e.textContent===" + JSON.stringify(label) + "&&e.getAttribute('aria-pressed')==='true')"), 'Original inspector tab restored');
              ctx.assert(await ctx.eval(visible), 'Host inspector visible again');
              ctx.assert(await studio("document.documentElement.dataset.ipolloworkTheme===" + JSON.stringify(mode)), 'Host light/dark theme propagated');
            }, screenshot: { name: mode + '-' + label + '-restored' },
          });
        }
        await ctx.prove(mode + ' · 删除镜头确认只打开并取消', {
          voiceover: '打开原生删除确认，协议明确选择取消；不删除镜头、不保存。',
          action: async () => {
            await toggle();
            await ctx.client.send('Page.enable');
            const click = studio("document.querySelector('button[aria-label^=删除镜头]').click()");
            let dismissed = false;
            for (let i = 0; i < 20; i++) {
              try { await ctx.client.send('Page.handleJavaScriptDialog', { accept: false }); dismissed = true; break; }
              catch { await new Promise(resolve => setTimeout(resolve, 100)); }
            }
            ctx.assert(dismissed, 'Native confirmation was opened and cancelled with accept:false');
            await click;
          },
          assert: async () => ctx.assert(JSON.stringify(await fields()) === JSON.stringify(before), 'Cancellation preserves all script inputs'),
          screenshot: { name: mode + '-confirmation-cancelled' },
        });
        await toggle();
      }
    } finally {
      if (await studio("document.querySelector('.hf-script-sidebar').dataset.expanded==='true'") !== originalExpanded) await toggle();
      if (tab) await choose(tab);
      await ctx.eval("import('/src/app/theme.ts').then(m=>m.setThemeMode(" + JSON.stringify(theme) + "))", { awaitPromise: true });
    }
  } }],
};
