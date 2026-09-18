import bundledAnnotation, { assertWorkbench } from './data-annotation-bundled.flow.mjs';

export default {
  id: 'data-annotation-startup',
  title: 'Annotation opens without an engine conversation and preserves saved work',
  kind: 'user-facing',
  preserveTheme: true,
  steps: [{
    name: 'Open annotation with no selected task and unavailable engine requests',
    async run(ctx) {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)');
      await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="sidebar-data-annotation"]:not(:disabled)\'))', { timeoutMs: 45000, label: 'local workspace server ready' });
      const workspaceRoute = await ctx.eval(String.raw`location.hash.match(/^#(\/workspace\/[^/]+\/session)/)?.[1]`);
      ctx.assert(Boolean(workspaceRoute), 'A local workspace must be selected');
      await ctx.navigateHash(workspaceRoute);
      await ctx.waitFor(`location.hash === ${JSON.stringify(`#${workspaceRoute}`)}`);
      await ctx.client.send('Network.enable');
      await ctx.client.send('Network.setBlockedURLs', {
        urls: ['*/workspace/*/sessions*', '*/workspace/*/opencode/*', '*/workspace/*/engine/*'],
      });
      try {
        await ctx.prove('The sidebar opens annotation even when no task exists and engine requests are unavailable', {
          voiceover: '没有聊天任务、引擎暂时不可用时，点击左侧数据标注也能直接打开本地工作台。',
          action: async () => {
            await ctx.client.send('Page.bringToFront');
            if (await ctx.eval('document.querySelector(\'[data-testid="sidebar-data-annotation"]\')?.getBoundingClientRect().x < 0')) {
              await ctx.trustedClick('[data-sidebar="trigger"]');
            }
            await ctx.trustedClick('[data-testid="sidebar-data-annotation"]');
          },
          assert: async () => {
            await assertWorkbench(ctx, { timeoutMs: 75000 });
            ctx.assert(await ctx.eval(`location.hash === ${JSON.stringify(`#${workspaceRoute}`)}`), 'Opening annotation must not create or select an engine conversation');
            const scope = await ctx.eval(`JSON.parse(localStorage.getItem('ipollowork:panel-tabs:v1')).state.sessions`);
            ctx.assert(Object.keys(scope).some(key => key.startsWith('workspace:')), 'The panel state is scoped to a workspace without a conversation');
          },
          screenshot: { name: 'annotation-without-engine-session', requireText: ['数据标注'], rejectText: ['数据标注暂时无法打开', '操作未完成', '请求超时'] },
        });
      } finally {
        await ctx.client.send('Network.setBlockedURLs', { urls: [] });
      }
    },
  }, bundledAnnotation.steps[1]],
};
