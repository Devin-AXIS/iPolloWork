import { connect, evaluate, listTargets } from '../runner/cdp.mjs';

const PLUGIN_ID = 'wechat-official';
const RESOURCE_ID = 'wechat-official-service';
const LABEL = '微信公众号';

export default {
  id: 'wechat-official-studio',
  title: '打开公众号 Studio 并管理多个账号',
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
          const frameSrc = await ctx.eval(`document.querySelector(${JSON.stringify(frame)}).src`);
          const origin = new URL(frameSrc).origin;
          for (let attempt = 0; attempt < 40; attempt++) {
            const target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url.startsWith(`${origin}/`));
            if (target) {
              const client = await connect(target.webSocketDebuggerUrl);
              try {
                for (let read = 0; read < 40; read++) {
                  const text = await evaluate(client, 'document.body?.innerText || ""');
                  if (text.includes('公众号 Studio') && text.includes('运营总览') && text.includes('图文草稿')) {
                    ctx.assert(await ctx.eval(`document.querySelector('iframe[title=${JSON.stringify(LABEL)}]')?.getBoundingClientRect().width > 280`), '公众号 Studio iframe is not visible');
                    await ctx.eval(`setTimeout(() => window.open(${JSON.stringify(frameSrc)}, '_blank'), 500); true`);
                    const proofTarget = await ctx.switchToNewTab({
                      match: item => item.url.startsWith(`${origin}/`),
                      timeoutMs: 30_000,
                      label: 'WeChat Studio proof window',
                    });
                    ctx.wechatStudioTargetId = proofTarget.id;
                    await ctx.waitFor(`document.body?.innerText.includes('公众号 Studio') && document.body?.innerText.includes('运营总览')`, { timeoutMs: 30_000, label: 'WeChat Studio proof content' });
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
          const text = await ctx.eval('document.body?.innerText || ""');
          for (const label of ['公众号 Studio', '运营总览', '图文草稿', '评论管理', '自定义菜单', '添加账号']) {
            ctx.assert(text.includes(label), `公众号 Studio 缺少“${label}”`);
          }
        },
        screenshot: {
          name: 'wechat-official-studio',
          requireText: ['公众号 Studio', '运营总览', '图文草稿'],
          rejectText: ['Something went wrong', '无法加载'],
        },
      });
    },
  }, {
    name: '打开多账号管理入口',
    async run(ctx) {
      await ctx.prove('用户可以直接在公众号 Studio 添加独立账号，并看到账号标识、AppID 与 AppSecret 输入项', {
        voiceover: '点击添加账号后，可以为每个公众号设置独立标识和凭据；凭据会进入 iPolloWork 的加密授权仓库。',
        action: async () => {
          await ctx.eval(`document.querySelector('#add-account')?.click()`);
          await ctx.waitFor(`document.querySelector('#account-dialog')?.open === true`, { timeoutMs: 10_000, label: 'multi-account dialog' });
        },
        assert: async () => {
          const text = await ctx.eval('document.body?.innerText || ""');
          for (const label of ['添加公众号', '账号标识', 'AppID', 'AppSecret', '验证并保存', '加密授权仓库']) {
            ctx.assert(text.includes(label), `账号管理弹窗缺少“${label}”`);
          }
        },
        screenshot: {
          name: 'wechat-official-multi-account',
          requireText: ['添加公众号', '账号标识', 'AppID', 'AppSecret', '验证并保存'],
          rejectText: ['Something went wrong', '无法加载'],
        },
      });
      await ctx.eval('window.close()').catch(() => undefined);
      await ctx.switchBack();
    },
  }],
};
