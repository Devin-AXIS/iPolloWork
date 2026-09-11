import { connect, evaluate, listTargets } from '../runner/cdp.mjs';

const PLUGIN_ID = 'wechat-official';
const RESOURCE_ID = 'wechat-official-service';
const LABEL = '微信公众号';

export default {
  id: 'wechat-official-studio',
  title: '从任务侧栏打开公众号 Studio',
  kind: 'user-facing',
  steps: [{
    name: '打开公众号 Studio 并显示运营入口',
    async run(ctx) {
      await ctx.prove('用户能从右侧插件入口打开公众号 Studio，并看到清晰可用的概览与图文入口', {
        voiceover: '从任务右侧打开微信公众号，Studio 会展示连接状态、运营总览和图文草稿入口。',
        action: async () => {
          await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30_000, label: 'app control ready' });
          const workspaceId = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace') || location.hash.split('/')[2]");
          await ctx.navigateHash(`/workspace/${workspaceId}/session`);
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="right-panel-toggle"]'))`, { timeoutMs: 30_000, label: 'right panel toggle' });
          await ctx.eval(`(() => {
            const toggle = document.querySelector('[data-testid="right-panel-toggle"]');
            if (toggle?.getAttribute('aria-label') === '打开右侧面板' || toggle?.getAttribute('aria-label') === 'Open right panel') toggle.click();
          })()`);
          await ctx.waitFor(`document.querySelector('[data-testid="right-panel-toggle"]')?.getAttribute('aria-label') === '收起右侧面板' || document.querySelector('[data-testid="right-panel-toggle"]')?.getAttribute('aria-label') === 'Close right panel'`, { timeoutMs: 30_000, label: 'right panel open' });
          const launcher = '[aria-label="添加侧面板入口"], [aria-label="Add side panel entry"]';
          const entry = `[data-testid="side-panel-launcher-workspace-app:${PLUGIN_ID}:workspace-app:${RESOURCE_ID}"]`;
          const frame = `iframe[title=${JSON.stringify(LABEL)}]`;
          if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(frame)})?.src)`)) {
            if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(entry)}))`)) {
              await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(launcher)}))`, { timeoutMs: 30_000, label: 'side panel launcher' });
              await ctx.eval(`document.querySelector(${JSON.stringify(launcher)}).click()`);
              await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(entry)}))`, { timeoutMs: 30_000, label: 'WeChat Studio launcher' });
            }
            await ctx.eval(`document.querySelector(${JSON.stringify(entry)}).click()`);
          }
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(frame)})?.src)`, { timeoutMs: 45_000, label: 'WeChat Studio frame' });
          const origin = new URL(await ctx.eval(`document.querySelector(${JSON.stringify(frame)}).src`)).origin;
          for (let attempt = 0; attempt < 40; attempt++) {
            const target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url.startsWith(`${origin}/`));
            if (target) {
              const client = await connect(target.webSocketDebuggerUrl);
              try {
                for (let read = 0; read < 40; read++) {
                  const text = await evaluate(client, 'document.body?.innerText || ""');
                  if (text.includes('公众号 Studio') && text.includes('运营总览') && text.includes('图文草稿')) {
                    ctx.wechatStudioTargetId = target.id;
                    return;
                  }
                  await new Promise(resolve => setTimeout(resolve, 250));
                }
              } finally { client.close(); }
            }
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          ctx.assert(false, '公众号 Studio iframe did not render its main navigation');
        },
        assert: async () => {
          ctx.assert(Boolean(ctx.wechatStudioTargetId), '公众号 Studio target was not found');
          const frameVisible = await ctx.eval(`document.querySelector('iframe[title=${JSON.stringify(LABEL)}]')?.getBoundingClientRect().width > 280`);
          ctx.assert(frameVisible, '公众号 Studio iframe is not visible');
          const target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.id === ctx.wechatStudioTargetId);
          ctx.assert(Boolean(target), '公众号 Studio target disappeared before assertion');
          const client = await connect(target.webSocketDebuggerUrl);
          try {
            const text = await evaluate(client, 'document.body?.innerText || ""');
            for (const label of ['公众号 Studio', '运营总览', '图文草稿', '评论管理', '自定义菜单']) {
              ctx.assert(text.includes(label), `公众号 Studio 缺少“${label}”`);
            }
          } finally { client.close(); }
        },
        screenshot: {
          name: 'wechat-official-studio',
          get textTargetId() { return ctx.wechatStudioTargetId; },
          requireText: ['公众号 Studio', '运营总览', '图文草稿'],
          rejectText: ['Something went wrong', '无法加载'],
        },
      });
    },
  }],
};
