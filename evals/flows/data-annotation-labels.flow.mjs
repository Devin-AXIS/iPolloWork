import { connect, debuggerUrlFor, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
const hostFrame = 'iframe[title="数据标注"]';
export default {
  id: 'data-annotation-labels', title: 'Media labels apply immediately without an extra annotation save',
  kind: 'user-facing', preserveTheme: true, requiredEnv: ['IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE'],
  steps: [{ name: 'Pointer edit, apply and reopen media label set', async run(ctx) {
    const workspaceId = ctx.env.IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE;
    await ctx.client.send('Page.bringToFront');
    await ctx.navigateHash(`/workspace/${workspaceId}/session`);
    await ctx.waitFor('Boolean(window.__ipolloworkControl)');
    await ctx.eval(`(async () => {
      const { ipolloworkServerInfo } = await import('/src/app/lib/desktop.ts');
      const { createiPolloWorkServerClient } = await import('/src/app/lib/ipollowork-server.ts');
      const info = await ipolloworkServerInfo();
      const client = createiPolloWorkServerClient({baseUrl:info.baseUrl, token:info.ownerToken || info.clientToken, hostToken:info.hostToken});
      const result = await client.listWorkspaces();
      const workspace = (result.workspaces ?? result.items).find(item => item.id === ${JSON.stringify(workspaceId)});
      if (!workspace || !(workspace.name ?? '').startsWith('标注升级验收')) throw new Error('Use a dedicated annotation review test workspace');
      return workspace.path;
    })()`, { awaitPromise: true });
    if (await ctx.eval('Boolean(document.querySelector(\'button[aria-label="Close tab: 数据标注"]\'))')) {
      await ctx.trustedClick('button[aria-label="Close tab: 数据标注"]');
    }
    await ctx.trustedClick('[data-testid="sidebar-data-annotation"]');
    await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(hostFrame)})?.contentDocument?.querySelector('#workbench')?.getAttribute('src'))`, { timeoutMs: 60000 });
    const frameUrl = await ctx.eval(`document.querySelector(${JSON.stringify(hostFrame)}).contentDocument.querySelector('#workbench').src`);
    let target;
    for (let attempt = 0; attempt < 40 && !target; attempt++) {
      target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url === frameUrl);
      if (!target) await new Promise(done => setTimeout(done, 250));
    }
    ctx.assert(Boolean(target), 'Annotation loads as an embedded frame in the main app');
    const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
    const child = new EvalContext({ client, outDir: ctx.outDir, flowId: ctx.flowId });

    try {
      await child.waitFor('Boolean(document.querySelector("#training-tab"))');
      const modality = ctx.env.IPOLLOWORK_ANNOTATION_MEDIA || 'audio';
      const title = modality === 'audio' ? '普通话语音分段' : '交通事件切片';
      const label = modality === 'audio' ? '已应用语音标签' : '已应用视频标签';
      await ctx.prove(modality + ' label edits apply without saving annotations and survive reopening', {
        voiceover: '点击右侧标签集修改名称，直接应用标签即可保存生效，重新打开后标签仍然保留。',
        action: async () => {
          await child.trustedClick('#training-tab');
          await child.clickText(title, { selector: '.template-card' });
          await child.waitFor('Boolean(document.querySelector("#labels-tab"))');
          await child.trustedClick('#labels-tab');
          const input = 'input[aria-label="第 1 个标签名称"]';
          await child.trustedClick(input);
          await child.fill(input, label);
          ctx.assert(await child.eval('document.querySelector(".save-status").textContent === "已保存"'), 'Pointer edits to label drafts do not dirty annotations');
          await child.trustedClick('.annotation-labels-panel .label-editor-actions .primary-button');
          await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
          ctx.assert(await child.eval('document.querySelector(".save-status").textContent === "已保存"'), 'Applying labels leaves the record saved');
          await child.trustedClick('.app-header > .header-button');
          await child.waitFor('Boolean(document.querySelector(".project-row"))');
          await child.clickText(title, { selector: '.project-row' });
          await child.waitFor('Boolean(document.querySelector("#labels-tab"))');
          await child.trustedClick('#labels-tab');
        },
        assert: async () => {
          ctx.assert(await child.eval('document.querySelector(\'input[aria-label="第 1 个标签名称"]\').value === ' + JSON.stringify(label)), 'Reopened record contains the applied label');
          ctx.assert(await child.eval('document.querySelector(".save-status").textContent === "已保存"'), 'No extra save is needed after reopening');
        },
        screenshot: { name: modality + '-labels-applied', requireText: ['数据标注'], rejectText: ['操作未完成', '请求超时'] }
      });
    } finally { client.close(); }
  }}]
};
