import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, evaluate, listTargets, hostModule } from '../run.mjs';
import { loadVoiceoverParagraphs } from '../run.mjs';

const vo = await loadVoiceoverParagraphs('xiaohongshu-schedule');

function refFor(tree, name) {
  const line = tree.split('\n').find(line => line.includes(JSON.stringify(name)) && /\[@e\d+\]/.test(line));
  const ref = line?.match(/\[(@e\d+)\]/)?.[1];
  if (!ref) throw new Error(`Visible control not found: ${name}\n${tree}`);
  return ref;
}

export default {
  id: 'xiaohongshu-schedule',
  title: '日程触发小红书发布、评论、回复并回写记录（本地模拟）',
  kind: 'internal',
  preserveTheme: true,
  requiredEnv: ['XHS_EVAL_APP_ROOT', 'XHS_EVAL_DESKTOP_CDP'],
  steps: [{
    name: '真实日程调度和桌面浏览器连接插件，模拟平台见证结果',
    async run(ctx) {
      const root = resolve(process.env.XHS_EVAL_APP_ROOT);
      const appImport = name => import(pathToFileURL(resolve(root, name)).href);
      const mockOrigin = 'http://127.0.0.1:4993';
      const origin = 'http://127.0.0.1:4994';
      const overrides = {
        XHS_OPS_DATA_DIR: resolve(ctx.outDir, 'private-plugin-data'), XHS_OPS_ORIGIN: origin,
        XHS_OPS_PORT: '4994', XHS_OPS_EMBED_ORIGINS: 'http://127.0.0.1:*',
        XHS_OPS_WEB_URL: mockOrigin, XHS_OPS_CREATOR_URL: mockOrigin + '/creator?viewer=matrix_author',
        IPOLLOWORK_RUNTIME_DB: resolve(ctx.outDir, 'schedule.sqlite'),
      };
      const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
      Object.assign(process.env, overrides);
      const tabs = new Set();
      let desktop, mockServer, opsServer, db, bridge, work;
      try {
        const target = (await listTargets(process.env.XHS_EVAL_DESKTOP_CDP)).find(target => target.type === 'page' && target.url.includes('localhost:5173'));
        if (!target) throw new Error('Open the iPolloWork desktop conversation before running this proof.');
        desktop = await connect(target.webSocketDebuggerUrl);
        const control = async (name, args) => {
          const result = await evaluate(desktop, `window.__ipolloworkControl.execute(${JSON.stringify(name)}, ${JSON.stringify(args)})`, { awaitPromise: true });
          if (!result?.ok) throw new Error(result?.error || 'Desktop control failed');
          return result.result;
        };
        const workspace = await evaluate(desktop, `(async () => {
          const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const response = await fetch(info.baseUrl + '/workspaces', { headers: { Authorization: 'Bearer ' + info.clientToken } });
          const body = await response.json();
          const id = location.hash.split('/workspace/')[1]?.split('/')[0];
          return (body.items || body.workspaces || body).find(item => item.id === id);
        })()`, { awaitPromise: true });
        if (!workspace?.path) throw new Error('The active local workspace was not found.');
        const privateStorage = resolve(workspace.path, 'evals/results', 'xhs-schedule-media-' + randomUUID());
        await mkdir(privateStorage, { recursive: true });
        const { serve } = createRequire(resolve(root, 'package.json'))('@hono/node-server');
        const [{ createMockXhsApp }, { OpsDatabase }, { OpsService }, { createApp }] = await Promise.all([
          appImport('tests/fixtures/mock-xhs-server.ts'), appImport('src/db.ts'), appImport('src/service.ts'), appImport('src/server.ts'),
        ]);
        db = new OpsDatabase(resolve(ctx.outDir, 'plugin.sqlite'));
        const addAccount = (handle, id, workerThreadId) => db.createAccount({
          handle, displayName: handle === 'matrix_author' ? '矩阵产品号' : '矩阵编辑号', expectedProfileId: id,
          profileUrl: mockOrigin + '/creator?viewer=' + handle, browserProfileId: randomUUID(), workerThreadId,
          position: '产品经验分享', audience: '关注使用体验的用户', noteTone: '自然', commentTone: '自然',
          contentColumns: ['使用技巧'], bannedTopics: [], dailyLimit: 3,
        });
        const author = addAccount('matrix_author', 'profile-author', 'existing-worker');
        const editor = addAccount('matrix_editor', 'profile-editor', null);
        const listen = app => new Promise(done => {
          const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: app === mockApp ? 4993 : 4994 }, () => done(server));
        });
        const mockApp = createMockXhsApp();
        mockServer = await listen(mockApp);
        opsServer = await listen(createApp(new OpsService(db)));
        const { default: createWorkbench } = await import('../../service/workbench.mjs');
        bridge = createWorkbench({ storage: { dataDir: privateStorage }, plugin: { version: '0.3.18' } });
        work = await hostModule('apps/server/src/work-items.ts');
        const config = {
          configPath: resolve(ctx.outDir, 'server.json'), workspaces: [{ id: 'proof', path: ctx.outDir, name: '模拟日程', workspaceType: 'local', preset: 'starter' }],
        };
        const call = (name, input, sessionId) => bridge.actions[name](input, { workspaceId: 'proof', sessionId });
        const open = async (account, url) => {
          const result = await control('browser.open_url', { url, profileId: 'xiaohongshu-ops:' + account.browserProfileId });
          tabs.add(result.tabId);
          await control('browser.snapshot', { tabId: result.tabId });
          await evaluate(desktop, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, { awaitPromise: true });
          const pageTarget = (await listTargets(process.env.XHS_EVAL_DESKTOP_CDP)).find(target => target.url === result.url);
          if (!pageTarget) throw new Error('The account browser target was not created.');
          const page = await connect(pageTarget.webSocketDebuggerUrl);
          try {
            let ready = false;
            for (let attempt = 0; attempt < 50; attempt++) {
              ready = await evaluate(page, 'innerWidth > 300 && innerHeight > 300');
              if (ready) break;
              await new Promise(done => setTimeout(done, 100));
            }
            ctx.assert(ready, 'The native account browser did not acquire visible panel bounds.');
          } finally { page.close(); }
          return result.tabId;
        };
        const snapshot = async (tabId, text, submitted = false) => {
          let lastState;
          for (let attempt = 0; attempt < 30; attempt++) {
            const state = await control('browser.snapshot', { tabId });
            lastState = state;
            if (!text || (submitted ? state.tree?.split('\n').some(line => line.includes('StaticText') && line.includes(text)) : state.tree?.includes(text))) return state;
            await new Promise(done => setTimeout(done, 150));
          }
          await ctx.output('unexpected-browser-page', JSON.stringify(lastState, null, 2));
          throw new Error('The native browser did not show ' + text);
        };
        const act = async (tabId, fields) => {
          const state = await snapshot(tabId);
          const actions = fields.map(field => ({ ...field, ...(field.name ? { ref: refFor(state.tree, field.name) } : {}) }));
          for (const action of actions) delete action.name;
          let result;
          try { result = await control('browser.act', { tabId, snapshotId: state.snapshotId, actions, workspaceRoot: workspace.path }); }
          catch (error) {
            const browserTarget = (await listTargets(process.env.XHS_EVAL_DESKTOP_CDP)).find(target => target.url.startsWith(mockOrigin));
            let visible;
            if (browserTarget) {
              const client = await connect(browserTarget.webSocketDebuggerUrl);
              visible = await evaluate(client, `({width:innerWidth,height:innerHeight,scroll:scrollY,fields:[...document.querySelectorAll('input,textarea,button')].map(e=>({name:e.name,text:e.textContent,value:e.value,bounds:e.getBoundingClientRect().toJSON()}))})`);
              client.close();
            }
            const panel = await evaluate(desktop, `({tabs:[...document.querySelectorAll('[aria-label^="Select tab:"]')].map(e=>({label:e.getAttribute('aria-label'),selected:e.getAttribute('aria-selected'),id:e.closest('[id]')?.id})),address:document.querySelector('[aria-label^="Edit address"],[aria-label^="编辑地址"]')?.parentElement?.outerHTML.slice(0,1800)})`);
            await ctx.output('failed-native-action', JSON.stringify({ actions, tree: state.tree, visible, panel }, null, 2));
            throw error;
          }
          ctx.assert(result.ok !== false, JSON.stringify(result));
          ctx.assert(result.results?.length === actions.length, 'The browser stopped this batch early; remaining actions need a fresh snapshot.');
        };
        const view = async url => {
          await ctx.client.send('Page.navigate', { url: 'about:blank' });
          await ctx.waitFor('location.href === "about:blank"');
          await ctx.client.send('Page.navigate', { url });
          await ctx.waitFor('document.readyState === "complete" && location.href === ' + JSON.stringify(url));
        };
        const platformState = () => fetch(mockOrigin + '/state').then(response => response.json());
        const jobs = [];
        const runScheduled = async (account, operation, perform) => {
          const item = await work.createWorkItem(config, 'proof', {
            title: operation.title || operation.body, description: '用小红书插件和指定账号完成本地模拟操作。',
            startAt: Date.now() - 1000, automation: { enabled: true, recurrence: 'once' },
          });
          let executionError;
          await work.runDueWorkItemAutomationsOnce({ config, limit: 1, dispatch: async due => {
            try {
              const sessionId = 'schedule-' + randomUUID();
              const runKey = work.workItemAutomationPrompt(due).match(/^runKey: (.+)$/m)?.[1];
              ctx.assert(Boolean(runKey), 'Scheduler did not supply its stable occurrence key.');
              const input = { ...operation, accountId: account.id, runKey, operationKey: 'action-1' };
              const { job } = await call('prepare-job', input, sessionId);
              ctx.assert(job.status === 'dispatched' && job.workerThreadId === sessionId, 'The scheduled session could not prepare its operation.');
              ctx.assert(new URL(job.payload.destinationUrl).origin === mockOrigin, 'This proof must only submit to its local mock platform.');
              const tabId = await open(account, job.payload.destinationUrl);
              const visible = await snapshot(tabId, '@' + account.handle);
              ctx.assert(visible.tree.includes(account.expectedProfileId), 'The visible account does not match.');
              const observation = { actualAccount: account.handle, actualProfileId: account.expectedProfileId };
              await call('claim-job', { jobId: job.id, accountId: account.id, ...observation }, sessionId);
              await perform(tabId, job);
              const after = await snapshot(tabId, operation.body, true);
              const result = await call('complete-job', { jobId: job.id, ...observation, resultUrl: after.url }, sessionId);
              ctx.assert(result.job.status === 'succeeded', 'The operation result was not persisted.');
              const duplicate = await call('prepare-job', input, 'retry-' + randomUUID());
              ctx.assert(duplicate.job.id === job.id && duplicate.job.status === 'succeeded', 'Retry created a second operation.');
              jobs.push({ id: job.id, type: job.type, accountId: job.accountId, sessionId, itemId: item.id });
              await view(after.url);
              return sessionId;
            } catch (error) { executionError = error; throw error; }
          } });
          if (executionError) throw executionError;
          ctx.assert(jobs.some(job => job.itemId === item.id), 'The due task did not execute.');
        };
        await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1160, height: 1020, deviceScaleFactor: 1, mobile: false });
        await ctx.prove('到期任务用指定账号发布图文，重试不重复提交', {
          voiceover: vo[0],
          action: () => runScheduled(author, {
            type: 'publish_note', title: '把使用经验记录下来', body: '先记录自己的实际需求，再逐步尝试和复盘。', topics: ['使用体验'],
            cards: [1, 2, 3].map(i => ({ heading: '实践步骤 ' + i, body: '从一个具体场景开始，记录体验与改进。' })),
          }, async (tabId, job) => {
            await act(tabId, [
              { type: 'upload', name: '图片素材', filePaths: job.payload.mediaPaths, extensionId: 'xiaohongshu-ops' },
            ]);
            await act(tabId, [
              { type: 'fill', name: '标题', value: job.payload.title },
              { type: 'fill', name: '正文', value: job.payload.body },
              { type: 'fill', name: '话题', value: job.payload.topics.join(' ') },
            ]);
            await act(tabId, [{ type: 'click', name: '确认发布', expectedName: '确认发布' }]);
          }),
          assert: async () => { const state = await platformState(); ctx.assert(state.publishSubmissions === 1 && state.posts[0].imageNames.length === 4 && state.posts[0].author === author.handle, 'Publishing produced the wrong article or duplicate submissions.'); },
          screenshot: { name: 'scheduled-publish', requireText: ['把使用经验记录下来', '发布成功', '@matrix_author'] },
        });
        const targetUrl = mockOrigin + '/note/note-1?viewer=matrix_editor';
        await ctx.prove('另一账号在他人帖子下评论，结果属于执行账号', {
          voiceover: vo[1],
          action: () => runScheduled(editor, { type: 'create_comment', targetUrl, body: '记录使用场景这个方法很实用，谢谢分享。' }, async (tabId, job) => {
            await act(tabId, [{ type: 'fill', name: '发表评论', value: job.payload.commentBody }]);
            await act(tabId, [{ type: 'click', name: '发送评论', expectedName: '发送评论' }]);
          }),
          assert: async () => { const state = await platformState(); ctx.assert(state.commentSubmissions === 1 && state.posts[0].comments[0].author === editor.handle && db.listInteractions(100, editor.id)[0].status === 'published', 'The comment was not written as the selected account.'); },
          screenshot: { name: 'scheduled-comment', requireText: ['@matrix_editor', '记录使用场景这个方法很实用，谢谢分享。'] },
        });
        // Seed an existing reader comment, then exercise the real reply form.
        await fetch(mockOrigin + '/note/note-1/comment?viewer=real_reader', { method: 'POST', body: new URLSearchParams({ body: '第一次记录时应该关注什么？' }) });
        await ctx.prove('回复指定的他人评论，保留正确的上下文', {
          voiceover: vo[2],
          action: () => runScheduled(editor, { type: 'reply_comment', targetUrl, targetAuthor: 'real_reader', targetCommentText: '第一次记录时应该关注什么？', body: '可以先记录使用场景和实际遇到的问题。' }, async (tabId, job) => {
            await act(tabId, [{ type: 'fill', name: '回复 @real_reader', value: job.payload.commentBody }]);
            await act(tabId, [{ type: 'click', name: '发送给 @real_reader', expectedName: '发送给 @real_reader' }]);
          }),
          assert: async () => { const state = await platformState(); const reply = state.posts[0].comments.find(comment => comment.author === 'real_reader')?.replies[0]; ctx.assert(state.replySubmissions === 1 && reply?.author === editor.handle && db.listInteractions(100, editor.id).length === 2, 'Reply target or account ownership was lost.'); },
          screenshot: { name: 'scheduled-reply', requireText: ['第一次记录时应该关注什么？', '可以先记录使用场景和实际遇到的问题。'] },
        });
        await ctx.prove('结果回写运营台，日程记录执行会话且账号绑定不变', {
          voiceover: vo[3],
          action: async () => {
            await view(origin + '/analytics?account=' + author.id);
            await ctx.expectText('把使用经验记录下来');
            await view(origin + '/interactions?account=' + editor.id);
          },
          assert: async () => {
            await ctx.expectText('记录使用场景这个方法很实用，谢谢分享。');
            await ctx.expectText('可以先记录使用场景和实际遇到的问题。');
            ctx.assert(db.getAccount(author.id).workerThreadId === 'existing-worker' && db.getAccount(editor.id).workerThreadId === null, 'Scheduled tasks rebound the accounts.');
            const schedule = (await work.listWorkItems(config, { workspaceIds: ['proof'] })).items;
            for (const job of jobs) ctx.assert(schedule.find(item => item.id === job.itemId)?.automationLastSessionId === job.sessionId, 'The schedule did not retain its execution session.');
            await ctx.output('schedule-results', JSON.stringify({ jobs, platform: await platformState() }, null, 2));
          },
          screenshot: { name: 'scheduled-records', requireText: ['矩阵编辑号', '最近互动', '记录使用场景这个方法很实用，谢谢分享。', '可以先记录使用场景和实际遇到的问题。'] },
        });
      } finally {
        if (desktop) { for (const tabId of tabs) await evaluate(desktop, `window.__IPOLLOWORK_ELECTRON__.browser.closeTab(${JSON.stringify(tabId)})`, { awaitPromise: true }).catch(() => {}); desktop.close(); }
        bridge?.dispose();
        for (const server of [opsServer, mockServer]) if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
        db?.close();
        if (work) await work.disposeWorkItemStore({ configPath: resolve(ctx.outDir, 'server.json') });
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      }
    },
  }],
};
