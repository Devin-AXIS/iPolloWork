import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer } from '../../examples/plugin-packages/douyin-ops/service/server.mjs';
import { ApiError } from '../../examples/plugin-packages/douyin-ops/service/api.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

export default {
  id: 'douyin-ops', title: '抖音运营台：配置、草稿、API 回执与超时核对（模拟平台）', kind: 'user-facing',
  steps: [{ name: '真实工作台与本地持久化，模拟抖音响应', async run(ctx) {
    const vo = await loadVoiceoverParagraphs('douyin-ops');
    const root = resolve(ctx.outDir, 'workspace'); await mkdir(root, { recursive: true });
    const path = resolve(root, 'desk.mp4');
    await writeFile(path, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)]));
    let identity = 'fixture-account-a', published = 0, replied = 0;
    const api = {
      async exchangeCode() { return { open_id: identity, access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, refresh_expires_in: 7200, scope: 'user_info,video.create.bind,video.list,video.data,item.comment' }; },
      async userInfo({ openId }) { return { open_id: openId, nickname: openId.endsWith('a') ? '桌面日记 · 测试账号' : '生活记录 · 测试账号' }; },
      async uploadVideo() { return { video: { video_id: 'fixture-upload' } }; },
      async createVideo() { published++; return { item_id: 'fixture-published-item' }; },
      async listComments() { return { list: [{ comment_id: 'fixture-comment', content: '这张桌面的收纳有什么建议？', nickname: '测试评论者' }], cursor: 0, has_more: false }; },
      async replyComment() { replied++; throw new ApiError('模拟接口超时，请核对操作结果。', { code: 'TIMEOUT', uncertain: true }); },
    };
    const service = await startServer({ dataDir: resolve(root, 'data'), workspaceRoot: root, api });
    const click = selector => ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const settled = () => ctx.waitFor(`document.body.getAttribute('aria-busy') === 'false'`);
    const has = value => ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(value)})`);
    const select = async (selector, value) => {
      await ctx.eval(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await settled();
    };
    try {
      await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 920, deviceScaleFactor: 1, mobile: false });
      await ctx.client.send('Page.navigate', { url: `${service.origin}/#token=${service.token}` });
      await has('本地服务已连接'); await settled();
      await ctx.prove('未配置时给出真实空状态和接入入口', {
        voiceover: vo[0], assert: async () => {
          ctx.assert(service.operations.state().accounts.length === 0, 'No fake accounts ship with the workbench');
          ctx.assert(await ctx.eval(`document.querySelectorAll('.tabs button').length === 6`), 'All six workbench sections are reachable');
        }, screenshot: { name: 'empty-workbench', requireText: ['尚未连接抖音账号', '开放平台应用配置'] },
      });
      await ctx.prove('配置与测试授权经 UI 持久化，密钥不回显', {
        voiceover: vo[1], action: async () => {
          await ctx.fill('#client-key', 'fixture-client'); await ctx.fill('#client-secret', 'fixture-client-secret');
          await ctx.fill('#redirect-uri', 'https://example.com/callback');
          await ctx.fill('#requested-scopes', 'user_info,video.create.bind,video.list,video.data,item.comment');
          await click('#settings-form button[type=submit]'); await settled(); await has('应用配置已保存');
          for (identity of ['fixture-account-a', 'fixture-account-b']) {
            await click('#start-authorization'); await settled();
            const authUrl = await ctx.eval(`document.querySelector('#feedback a').href`);
            const callback = new URL('https://example.com/callback');
            callback.search = new URLSearchParams({ code: 'fixture-code', state: new URL(authUrl).searchParams.get('state') }).toString();
            await ctx.fill('#callback-url', callback.href); await click('#authorization-form button[type=submit]'); await settled();
          }
          await ctx.eval(`document.querySelector('#settings-panel').open = false`);
        }, assert: async () => {
          ctx.assert(service.operations.state().accounts.length === 2, 'Both identities are stored after actual UI callback submission');
          ctx.assert(await ctx.eval(`document.querySelector('#client-secret').value === ''`), 'Secret field is cleared');
          ctx.assert(!JSON.stringify(service.operations.state()).includes('fixture-client-secret'), 'Public state contains no app secret');
        }, screenshot: { name: 'connected-test-accounts', requireText: ['桌面日记 · 测试账号', '生活记录 · 测试账号', 'video.create.bind'] },
      });
      const a = service.operations.state().accounts.find(item => item.openId === 'fixture-account-a');
      const b = service.operations.state().accounts.find(item => item.openId === 'fixture-account-b');
      await ctx.prove('草稿、素材与切换账号前的修改保存到各自账号', {
        voiceover: vo[2], action: async () => {
          await select('#account', a.id); await click('.tabs [data-view=studio]');
          await ctx.fill('#draft-title', '把桌面留给喜欢的东西'); await ctx.fill('#draft-text', '按使用频率分区，让常用物品伸手可及。 #桌面收纳');
          await ctx.eval(`document.querySelector('#media-form').closest('details').open = true`);
          await ctx.fill('#media-path', path); await click('#media-form button'); await settled();
          await click('#draft-form button[type=submit]'); await settled();
          await ctx.fill('#draft-text', '每天留两分钟，恢复桌面的清爽。 #桌面收纳');
          await select('#account', b.id); await select('#account', a.id);
          await ctx.eval(`document.querySelector('#media-form').closest('details').open = false`);
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1050, deviceScaleFactor: 1, mobile: false });
        }, assert: async () => {
          const draft = service.operations.state().drafts.find(item => item.accountId === a.id);
          ctx.assert(draft.text.startsWith('每天留两分钟'), 'Account switch persisted the unsaved text');
          ctx.assert(Boolean(draft.assetId), 'Saved draft references imported video');
          ctx.assert(await ctx.eval(`document.documentElement.scrollWidth <= innerWidth`), 'Workbench fits a 480px side panel');
          ctx.assert(await ctx.eval(`document.querySelector('#draft-text').value.startsWith('每天留两分钟')`), 'Restored account shows its saved draft');
        }, screenshot: { name: 'saved-draft-narrow', requireText: ['视频创作', '保存草稿', 'desk.mp4'] },
      });
      await ctx.prove('模拟平台回执保存，同一草稿提交去重', {
        voiceover: vo[3], action: async () => {
          await click('#publish-draft'); await settled();
          await click('.tabs [data-view=jobs]');
        }, assert: async () => {
          const draft = service.operations.state().drafts.find(item => item.accountId === a.id);
          const repeated = await service.operations.publishDraft({ accountId: a.id, draftId: draft.id, operationKey: 'test-repeat' });
          ctx.assert(published === 1, 'Exactly one simulated platform create request');
          ctx.assert(repeated.job.result.item_id === 'fixture-published-item', 'Stored receipt is reused');
          ctx.assert(repeated.job.status === 'succeeded', 'A valid simulated API receipt sets success');
        }, screenshot: { name: 'saved-publish-receipt', requireText: ['操作记录', '已完成', '提交回执'] },
      });
      await ctx.prove('回复超时显示待核对，未被当作成功或自动重发', {
        voiceover: vo[4], action: async () => {
          await click('.tabs [data-view=comments]'); await ctx.fill('#comment-item', 'fixture-published-item');
          await click('#comments-form button'); await settled();
          await ctx.fill('#comments-list textarea', '建议把最常用的小物件集中放在伸手可及的位置。');
          await click('#comments-list button'); await settled(); await click('.tabs [data-view=jobs]');
        }, assert: async () => {
          ctx.assert(replied === 1, 'Timed-out reply is not automatically retried');
          ctx.assert(service.operations.state().jobs.some(job => job.kind === 'reply' && job.status === 'uncertain'), 'Uncertain reply is durably stored');
          ctx.assert(await ctx.eval(`document.documentElement.scrollWidth <= innerWidth`), 'History fits narrow panel');
        }, screenshot: { name: 'uncertain-reply', requireText: ['结果待核实', '保存核对结果'] },
      });
    } finally { await service.close(); }
  } }],
};
