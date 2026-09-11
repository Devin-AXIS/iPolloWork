import { connect, evaluate, listTargets } from '../run.mjs';

export default {
  id: 'xiaohongshu-installed', title: '独立安装的小红书运营台从主软件打开', kind: 'user-facing', preserveTheme: true,
  steps: [{ name: '打开已安装插件', async run(ctx) {
    const entry = `document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]')`;
    const frame = `document.querySelector('iframe[title="小红书运营台"]')`;
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="添加侧面板入口"]'))`);
    if (!await ctx.eval(`Boolean(${entry})`)) await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
    await ctx.waitFor(`Boolean(${entry})`);
    await ctx.eval(`${entry}.click()`);
    await ctx.waitFor(`Boolean(${frame}?.src)`, { timeoutMs: 60_000 });
    const origin = new URL(await ctx.eval(`${frame}.src`)).origin;
    let target;
    for (let attempt = 0; attempt < 40; attempt++) {
      target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url.startsWith(origin + '/'));
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    ctx.assert(Boolean(target), 'Installed workbench did not create an iframe.');
    const client = await connect(target.webSocketDebuggerUrl);
    try {
      let text = '';
      for (let attempt = 0; attempt < 40; attempt++) {
        text = await evaluate(client, 'document.body.innerText');
        if (text.includes('账号管理')) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await ctx.prove('独立插件仍可从主软件右侧打开', {
        voiceover: '小红书运营台通过主软件的通用插件入口打开，账号和运行数据继续保留。',
        assert: async () => {
          ctx.assert(text.includes('账号管理'), 'Account management did not load.');
          ctx.assert(await ctx.eval(`${frame}.getBoundingClientRect().width > 200`), 'Workbench is not visible.');
        },
        screenshot: { name: 'installed-xiaohongshu', textTargetId: target.id, requireText: ['账号管理'] },
      });
    } finally { client.close(); }
  } }],
};
