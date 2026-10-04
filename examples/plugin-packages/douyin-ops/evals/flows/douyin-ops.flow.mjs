import { createServer, request as proxyRequest } from 'node:http';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startServer } from '../../service/server.mjs';
import { loadVoiceoverParagraphs, evaluate } from '../run.mjs';

export default {
  id: 'douyin-ops', title: '普通用户抖音运营：真实工作台，模拟 AI 与抖音结果', kind: 'user-facing',
  steps: [{ name: '扫码入口、搜索回写、搜索后评论和防重复提交', async run(ctx) {
    const vo = await loadVoiceoverParagraphs('douyin-ops');
    const service = await startServer({ dataDir: resolve(ctx.outDir, 'fixture-data'), workspaceRoot: ctx.outDir });
    // Fixture of the documented host bridge. No real AI or social writes.
    const fixture = createServer((req, res) => {
      if (req.url === '/fixture') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="/#token=${service.token}"></iframe><script>window.sent=[];window.opened=[];window.displays=[];addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow||!e.data.id)return;const m=e.data;if(m.method==='ui/message')sent.push(m.params);if(m.method==='ui/open-link')opened.push(m.params);if(m.method==='ui/request-display-mode')displays.push(m.params);e.source.postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*')});</script>`); return;
      }
      const headers = { ...req.headers, host: new URL(service.origin).host }; delete headers.origin;
      const upstream = proxyRequest(service.origin + req.url, { method: req.method, headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
    });
    await new Promise(done => fixture.listen(0, '127.0.0.1', done));
    const originalClient = ctx.client;
    const originalEval = expression => evaluate(originalClient, expression);
    const click = selector => ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const settled = () => ctx.waitFor(`document.body.getAttribute('aria-busy') === 'false'`);
    try {
      await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await ctx.client.send('Page.navigate', { url: `http://127.0.0.1:${fixture.address().port}/fixture` });
      await ctx.waitFor(`Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#add-account'))`);
      const { frameTree } = await ctx.client.send('Page.getFrameTree');
      const { executionContextId } = await ctx.client.send('Page.createIsolatedWorld', { frameId: frameTree.childFrames[0].frame.id, worldName: 'douyin-ui-proof' });
      // Keep screenshot pixels on the page, but evaluate its visible iframe DOM.
      ctx.client = { send: (method, args) => originalClient.send(method, method === 'Runtime.evaluate' ? { ...args, contextId: executionContextId } : args) };
      await settled();
      await ctx.prove('普通用户添加账号无需应用密钥', {
        voiceover: vo[0], action: async () => { await click('#add-account'); await click('#connect-browser'); await settled(); },
        assert: async () => {
          ctx.assert(service.operations.state().accounts.length === 1, 'A browser account persists');
          ctx.assert(!service.operations.settings().secretConfigured, 'No developer secret is required');
          ctx.assert((await originalEval('window.opened'))[0]?.browserProfileId === service.operations.state().accounts[0].browserProfileId, 'Host receives isolated profile');
          ctx.assert(await ctx.eval(`document.querySelector('#account-details-dialog').open`), 'Login identification stays visible');
        }, screenshot: { name: 'ordinary-login', requireText: ['已登录，识别账号', '等待登录识别'] },
      });
      const account = service.operations.state().accounts[0];
      const identity = { accountId: account.id, actualProfileId: `douyin-ops:${account.browserProfileId}`, actualAccount: 'fixture-user', nickname: '普通用户 · 测试', profileUrl: 'https://www.douyin.com/user/fixture-user', evidence: '模拟自己账号页面：抖音号 fixture-user' };
      await ctx.prove('识别入口派发 AI 请求，模拟身份回写后功能可用', {
        voiceover: vo[1], action: async () => {
          await ctx.eval(`[...document.querySelectorAll('#accounts-list button')].find(b=>b.textContent==='已登录，识别账号').click()`); await settled();
          await service.operations.action('observe-browser-session', { browserProfileId: account.browserProfileId, url: 'https://www.douyin.com/user/self',
            tree: 'heading "普通用户 · 测试" level=1\nStaticText "抖音号："\nStaticText "fixture-user"\n[@e1] button "批量管理"\n[@e2] tab "私密作品"' });
          await ctx.waitFor(`!document.querySelector('#account-details-dialog').open && document.querySelector('#account').selectedOptions[0].textContent.includes('普通用户 · 测试')`, { timeoutMs: 8000 }); await click('[data-view="search"]');
        }, assert: async () => {
          ctx.assert((await originalEval('window.sent')).some(m => m.content[0].text.includes('verify-browser-account')), 'UI dispatches identity verification');
          ctx.assert(!await ctx.eval(`document.querySelector('#search-form button[type=submit]').disabled`), 'Search works without API scopes');
          ctx.assert(!await ctx.eval(`document.querySelector('#search-device').required`), 'No device identifier required');
          ctx.assert(await ctx.eval(`document.querySelector('#account').selectedOptions[0].textContent.includes('fixture-user')`), 'Account selector includes the verified identity, not only a nickname');
        }, screenshot: { name: 'browser-search-ready', requireText: ['普通用户 · 测试', '搜索视频'] },
      });
      await click('[data-view="videos"]'); await click('#load-videos'); await settled();
      const videosJob = service.operations.state().jobs.find(job => job.browserAction === 'list-videos');
      const videosClaim = await service.operations.action('claim-browser-job', { jobId: videosJob.id, ...identity });
      await service.operations.action('finish-browser-job', { jobId: videosJob.id, ...identity, executionToken: videosClaim.executionToken, outcome: 'succeeded', evidence: '模拟读取七条作品', items: Array.from({ length: 7 }, (_, i) => ({ title: '自动同步作品' + (i + 1), link: 'https://www.douyin.com/video/' + (1234567800 + i) })) });
      await ctx.waitFor(`document.querySelector('#videos-list').innerText.includes('自动同步作品7')`, { timeoutMs: 8000 });
      await ctx.prove('没有 API ID 的网页作品仍可查数据、读评论并精确回复', {
        voiceover: '网页作品使用真实链接查询数据和评论。回复会锁定作者及原评论，结果自动返回运营台。此处模拟平台结果。',
        action: async () => {
          await ctx.eval(`[...document.querySelectorAll('#videos-list button')].find(b=>b.textContent==='读取数据').click()`); await settled();
          const data = service.operations.state().jobs.find(j => j.browserAction === 'video-data');
          ctx.assert(data.targetUrl === 'https://www.douyin.com/video/1234567800', 'Data retains actual URL');
          const finish = async (job, result) => { const claim = await service.operations.action('claim-browser-job', { ...identity, jobId: job.id }); await service.operations.action('finish-browser-job', { ...identity, jobId: job.id, executionToken: claim.executionToken, outcome: 'succeeded', ...result }); };
          await finish(data, { evidence: '模拟读取数据', items: [{ title: '自动同步作品1', link: data.targetUrl, statistics: { play_count: '100', comment_count: '1' } }] });
          await ctx.waitFor(`document.body.dataset.view === 'jobs'`, { timeoutMs: 8000 });
          await click('[data-view="videos"]');
          await ctx.eval(`[...document.querySelectorAll('#videos-list button')].find(b=>b.textContent==='查看评论').click()`); await settled();
          const comments = service.operations.state().jobs.find(j => j.browserAction === 'list-comments');
          await finish(comments, { evidence: '模拟读取评论', items: [{ title: '如何收纳充电线？', content: '如何收纳充电线？', nickname: '提问者', link: data.targetUrl }] });
          await ctx.waitFor(`document.querySelector('#comments-list').innerText.includes('如何收纳充电线')`, { timeoutMs: 8000 });
          await ctx.fill('#comments-list textarea', '可以先按设备分类。'); await click('#comments-list button[type=submit]'); await settled();
          const reply = service.operations.state().jobs.find(j => j.browserAction === 'reply-comment');
          ctx.assert(reply.payload.targetAuthor === '提问者' && reply.payload.targetComment === '如何收纳充电线？', 'Reply locks original author and content without fake IDs');
          await finish(reply, { evidence: '模拟回复已出现；没有发送真实评论', resultUrl: data.targetUrl });
          await ctx.waitFor(`document.body.dataset.view === 'jobs'`, { timeoutMs: 8000 });
        },
        assert: async () => { ctx.assert(service.operations.state().jobs.filter(j => ['video-data', 'list-comments', 'reply-comment'].includes(j.browserAction)).every(j => j.status === 'succeeded'), 'All three browser receipts persist'); },
        screenshot: { name: 'browser-data-reply', requireText: ['回复评论', '没有发送真实评论'] },
      });
      const { job: interruptedRead } = await service.operations.action('search-videos', { accountId: account.id, keyword: '中断读取' });
      const interruptedClaim = await service.operations.action('claim-browser-job', { ...identity, jobId: interruptedRead.id });
      await ctx.prove('中断读取可从记录结束，保留原发布并拒绝旧结果', {
        voiceover: vo[4],
        action: async () => {
          await click('[data-view="studio"]'); await click('#ai-draft'); await settled();
          const draft = service.operations.state().drafts[0];
          service.operations.saveDraft({ ...draft, title: 'AI 生成标题', text: '模拟 AI 完成的作品文案' });
          await ctx.waitFor(`document.querySelector('#draft-title').value === 'AI 生成标题'`, { timeoutMs: 8000 });
          const media = resolve(ctx.outDir, 'fixture-video.mp4'); await writeFile(media, Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom'), Buffer.alloc(20)]));
          await ctx.fill('#media-path', media); await click('#media-form button[type=submit]'); await settled();
          await click('#publish-draft'); await settled();
          const job = service.operations.state().jobs.find(j => j.browserAction === 'publish-draft');
          ctx.assert(job.status === 'pending', 'Publish record exists before browser upload');
          ctx.assert(service.operations.state().accounts.length === 1, 'Existing logged-in account is reused');
          ctx.assert(service.operations.state().accounts[0].capabilities.publish.transport === 'browser', 'AI and UI share browser route without API scopes');
          ctx.assert((await originalEval('window.sent')).some(m => m.content[0].text.includes('本轮返回的新 tabId') && m.content[0].text.includes('最多2次')), 'Dispatched task requires fresh browser identity and bounded pre-submit recovery');
          const blocked = await service.operations.action('claim-browser-job', { ...identity, jobId: job.id });
          ctx.assert(blocked.queued && blocked.blockedByJobId === interruptedRead.id && blocked.canCancelRead, 'Interrupted read blocks publish with an actionable task ID');
          await click('[data-view="jobs"]');
          await ctx.waitFor(`[...document.querySelectorAll('#jobs-list button')].some(b=>b.textContent==='结束读取任务')`, { timeoutMs: 8000 });
          await ctx.eval(`[...document.querySelectorAll('#jobs-list button')].find(b=>b.textContent==='结束读取任务').click()`); await settled();
          ctx.assert(service.operations.state().jobs.find(j => j.id === interruptedRead.id).errorCode === 'read_cancelled', 'UI uses durable cancellation action');
          ctx.assert(service.operations.store.secret('browser-job:' + interruptedRead.id) === null, 'Old executor token is revoked');
          let lateReceiptRejected = false;
          try { await service.operations.action('finish-browser-job', { ...identity, jobId: interruptedRead.id, executionToken: interruptedClaim.executionToken, outcome: 'succeeded', evidence: '迟到的旧读取', items: [] }); }
          catch { lateReceiptRejected = true; }
          ctx.assert(lateReceiptRejected, 'Cancelled executor cannot overwrite the record');
          ctx.assert(service.operations.state().jobs.filter(j => j.browserAction === 'publish-draft').length === 1, 'Queued publish was not duplicated');
          const claim = await service.operations.action('claim-browser-job', { ...identity, jobId: job.id });
          ctx.assert(job.payload.title === 'AI 生成标题' && job.payload.text === '模拟 AI 完成的作品文案' && claim.mediaPath.endsWith('.mp4'), 'Locked publish includes title, text and imported media');
          await service.operations.action('finish-browser-job', { ...identity, jobId: job.id, executionToken: claim.executionToken, outcome: 'uncertain', evidence: '模拟点击发布后要求短信验证，等待用户验证；没有真实发布。' });
          await ctx.waitFor(`document.body.dataset.view === 'jobs' && document.querySelector('#jobs-list').innerText.includes('短信验证')`, { timeoutMs: 8000 });
        },
        assert: async () => { ctx.assert(service.operations.state().drafts[0].status === 'uncertain', 'Draft and SMS-blocked job status sync'); },
        screenshot: { name: 'browser-publish', requireText: ['发布视频', '短信验证', '结果待核实', '没有真实发布', '读取任务已结束'] },
      });
      await ctx.prove('验证后的实际作品链接回到原任务，不重复发布', {
        voiceover: vo[5],
        action: async () => {
          await ctx.eval(`(() => { const select = document.querySelector('#jobs-list form select'); select.value = 'succeeded'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await ctx.fill('#jobs-list form textarea', '模拟验证后核对到对应作品，未重新发送。');
          await ctx.fill('#jobs-list form input[type=url]', 'https://www.douyin.com/video/1234567801');
          await click('#jobs-list form button[type=submit]'); await settled();
        },
        assert: async () => {
          const jobs = service.operations.state().jobs.filter(j => j.browserAction === 'publish-draft');
          ctx.assert(jobs.length === 1 && jobs[0].status === 'succeeded', 'Same task reconciled without a duplicate');
          ctx.assert(jobs[0].result.url === 'https://www.douyin.com/video/1234567801', 'Verified link persists');
          ctx.assert(service.operations.state().drafts[0].status === 'succeeded', 'Draft status follows receipt');
          ctx.assert(await ctx.eval(`document.querySelector('#jobs-list').innerText.includes('查看作品')`), 'User can open the saved work');
        },
        screenshot: { name: 'browser-publish-reconciled', requireText: ['已完成', '查看作品', '未重新发送'] },
      });
      await click('[data-view="search"]');
      await ctx.prove('搜索经 AI 桥接派发，模拟网页结果回到卡片', {
        voiceover: vo[2], action: async () => {
          await ctx.fill('#search-keyword', '桌面收纳'); await click('#search-form button[type=submit]'); await settled();
          const job = service.operations.state().jobs.find(job => job.browserAction === 'search-videos');
          ctx.assert(job?.status === 'pending', 'Search queues browser work');
          const claim = await service.operations.action('claim-browser-job', { jobId: job.id, ...identity });
          await service.operations.action('finish-browser-job', { jobId: job.id, ...identity, executionToken: claim.executionToken, outcome: 'succeeded', evidence: '模拟搜索页面显示一条收纳作品', items: [{ title: '三步整理桌面 · 模拟结果', nickname: '示例作者', link: 'https://www.douyin.com/video/1234567890' }] });
          await ctx.waitFor(`document.querySelector('#search-list').innerText.includes('三步整理桌面')`, { timeoutMs: 8000 });
        }, assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('#search-list').innerText.includes('发送评论')`), 'Search cards expose comments');
          ctx.assert((await originalEval('window.sent')).some(m => m.content[0].text.includes('get-job')), 'Search sends host AI request');
          ctx.assert((await originalEval('window.displays')).length >= 3, 'Login, works and search completion request return to the plugin');
        }, screenshot: { name: 'search-comment-card', requireText: ['三步整理桌面 · 模拟结果', '发送评论'] },
      });
      await ctx.prove('评论目标与内容锁定，待核对结果不会重复提交', {
        voiceover: vo[3], action: async () => {
          await ctx.fill('#search-list textarea', '按使用频率分区的思路很清楚。'); await click('#search-list button[type=submit]'); await settled();
          const job = service.operations.state().jobs.find(job => job.browserAction === 'comment-video');
          ctx.assert(job?.payload.targetUrl === 'https://www.douyin.com/video/1234567890', 'Comment locks selected video');
          ctx.assert(job.payload.content === '按使用频率分区的思路很清楚。', 'Comment locks user text');
          const claim = await service.operations.action('claim-browser-job', { jobId: job.id, ...identity });
          await service.operations.action('finish-browser-job', { jobId: job.id, ...identity, executionToken: claim.executionToken, outcome: 'uncertain', evidence: '模拟提交后连接中断：待核对，没有向真实抖音发送。' });
          await ctx.waitFor(`document.querySelector('#jobs-list').innerText.includes('模拟提交后连接中断')`, { timeoutMs: 8000 }); await click('[data-view="jobs"]');
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1000, deviceScaleFactor: 1, mobile: false });
        }, assert: async () => {
          let blocked = false;
          try { await service.operations.action('comment-video', { accountId: account.id, targetUrl: 'https://www.douyin.com/video/1234567890', content: '再试一次', operationKey: 'another-key' }); } catch { blocked = true; }
          ctx.assert(blocked, 'Unknown submission blocks another write');
          ctx.assert(await ctx.eval('document.documentElement.scrollWidth <= innerWidth'), '480px panel does not overflow');
        }, screenshot: { name: 'comment-reconcile', requireText: ['结果待核实', '没有向真实抖音发送'] },
      });
    } finally {
      ctx.client = originalClient;
      await new Promise(done => { fixture.close(done); fixture.closeAllConnections(); }); await service.close();
    }
  } }],
};
