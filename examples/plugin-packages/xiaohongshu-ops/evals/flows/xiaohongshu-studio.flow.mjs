import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect, evaluate, listTargets } from '../run.mjs';
import { loadVoiceoverParagraphs } from '../run.mjs';

const vo = await loadVoiceoverParagraphs('xiaohongshu-studio');
export default {
  id: 'xiaohongshu-studio', title: '发帖、素材回填、关键词筛选与批量评论（隔离演练）', kind: 'internal', preserveTheme: true,
  requiredEnv: ['XHS_EVAL_APP_ROOT'],
  steps: [{ name: '从真实按钮驱动草稿、素材与评论闭环', async run(ctx) {
    const root = resolve(process.env.XHS_EVAL_APP_ROOT);
    const origin = 'http://127.0.0.1:4994';
    const overrides = { XHS_OPS_DATA_DIR: resolve(ctx.outDir, 'private-plugin-data'), XHS_OPS_ORIGIN: origin, XHS_OPS_PORT: '4994', XHS_OPS_EMBED_ORIGINS: 'http://localhost:* http://127.0.0.1:*', XHS_OPS_WEB_URL: origin, XHS_OPS_CREATOR_URL: origin + '/creator' };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]])); Object.assign(process.env, overrides);
    const require = createRequire(resolve(root, 'package.json'));
    const { serve } = require('@hono/node-server'); const { Hono } = require('hono'); const sharp = require('sharp');
    const imp = file => import(pathToFileURL(resolve(root, file)).href);
    let server, frame, db, bridge, restoreUrl;
    const previousHash = await ctx.eval('location.hash');
    try {
      const [{ OpsDatabase }, { OpsService }, { createApp }, { StudioService }] = await Promise.all([imp('src/db.ts'), imp('src/service.ts'), imp('src/server.ts'), imp('src/studio.ts')]);
      db = new OpsDatabase(resolve(ctx.outDir, 'studio.sqlite'));
      const ops = new OpsService(db), studio = new StudioService(ops);
      const add = (name, profile) => db.createAccount({ handle: name, displayName: name, expectedProfileId: profile, profileUrl: origin + '/creator', browserProfileId: profile === 'demo-1' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', workerThreadId: null, position: '桌面与生活经验', audience: '关注实用技巧的用户', noteTone: '自然', commentTone: '自然', contentColumns: ['桌面收纳'], bannedTopics: [], dailyLimit: 10 });
      const account = add('演练生活号', 'demo-1'), other = add('演练视频号', 'demo-2');
      db.setAccountSession(account.id, 'healthy'); db.setAccountSession(other.id, 'healthy');
      await mkdir(resolve(ctx.outDir, 'workspace'), { recursive: true });
      const workspaceRoot = resolve(ctx.outDir, 'workspace');
      const imagePath = resolve(workspaceRoot, 'desk.png'), videoPath = resolve(workspaceRoot, 'desk.mp4');
      await sharp(Buffer.from('<svg width="600" height="800"><rect width="600" height="800" fill="#e9eddf"/><rect x="60" y="340" width="480" height="40" rx="8" fill="#c89d74"/><rect x="90" y="380" width="24" height="200" fill="#a77e58"/><rect x="490" y="380" width="24" height="200" fill="#a77e58"/><rect x="175" y="175" width="250" height="160" rx="12" fill="#333d35"/><rect x="187" y="188" width="226" height="132" rx="5" fill="#d3dfd2"/><rect x="80" y="260" width="75" height="80" rx="8" fill="#eee5d4"/><circle cx="460" cy="296" r="37" fill="#63886a"/><rect x="60" y="650" width="260" height="14" rx="7" fill="#91a28c"/><rect x="60" y="685" width="180" height="10" rx="5" fill="#b7c2b0"/></svg>')).png().toFile(imagePath);
      await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', imagePath, '-t', '1', '-vf', 'scale=300:400', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { windowsHide: true, timeout: 30000 });
      const { default: createWorkbench } = await import('../../service/workbench.mjs');
      bridge = createWorkbench({ storage: { dataDir: resolve(workspaceRoot, 'plugin-storage') }, workspace: { root: workspaceRoot }, plugin: { version: '0.4.0' } });
      const calls = [], submitted = new Set();
      const call = async (action, input) => { calls.push(action); return bridge.actions[action](input, { workspaceId: 'studio-proof', sessionId: 'studio-proof-session' }); };
      const execute = async job => {
        if (job.status === 'succeeded') return;
        const a = db.getAccount(job.accountId);
        const claimed = await call('claim-job', { jobId: job.id, accountId: a.id, actualAccount: a.handle, actualProfileId: a.expectedProfileId });
        ctx.assert(!submitted.has(job.id), 'An operation was externally submitted twice.'); submitted.add(job.id);
        await call('complete-job', { jobId: claimed.job.id, actualAccount: a.handle, actualProfileId: a.expectedProfileId, resultUrl: job.type === 'publish_note' ? origin + '/explore/published-' + job.id : job.payload.targetUrl + '#comment-' + job.id });
      };
      const candidates = [
        { url: origin + '/explore/desk-a', title: '我的小桌面收纳方法', author: '小林', excerpt: '把常用工具放在右手侧，给桌面留出空白。', likes: 32, comments: 4, collections: 9 },
        { url: origin + '/explore/desk-b', title: '租房也能有清爽的工作区', author: '小陈', excerpt: '用两只收纳盒整理桌面，附尺寸比较。', likes: 128, comments: 8, collections: 36 },
        { url: origin + '/explore/desk-c', title: '周末整理书桌的三个步骤', author: '阿米', excerpt: '先分类再决定每件物品的位置。', likes: 61, comments: 2, collections: 18 },
      ];
      const app = new Hono();
      app.get('/proof', c => c.html(`<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe id="studio" src="/publishing?account=${account.id}"></iframe><script src="/proof-host.js"></script></body></html>`));
      app.get('/proof-host.js', c => c.body(`window.addEventListener('message',async e=>{const iframe=document.querySelector('#studio');if(e.source!==iframe.contentWindow||!e.data?.method)return;const {id,method,params}=e.data;let result;try{if(method==='ui/initialize')result={hostCapabilities:{message:true},hostContext:{'ai.ipollo/workspace':{sessionId:'studio-proof-session'}}};else if(method==='ui/message'){const r=await fetch('/proof-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});result=await r.json()}else return;e.source.postMessage({jsonrpc:'2.0',id,result},location.origin)}catch(error){e.source.postMessage({jsonrpc:'2.0',id,error:{message:error.message}},location.origin)}});`, 200, { 'Content-Type': 'text/javascript' }));
      app.post('/proof-action', async c => {
        try {
          const prompt = (await c.req.json()).content[0].text;
          const draft = studio.state(account.id).drafts[0];
          if (prompt.includes('根据创作要求和账号定位完成标题')) await call('save-post-draft', { ...draft, title: '把桌面留给真正喜欢的东西', body: '按使用频率分区，让常用物品伸手可及。\n每天留两分钟恢复桌面的清爽。', topics: ['桌面收纳', '生活技巧'] });
          else if (prompt.includes('为这篇帖子生成图片') || prompt.includes('为这篇帖子生成视频')) {
            const video = prompt.includes('为这篇帖子生成视频');
            const { asset } = await call('import-media', { sourcePath: video ? videoPath : imagePath });
            await call('save-post-draft', { ...draft, mediaKind: video ? 'video' : 'image', assetIds: [asset.id] });
          } else if (prompt.includes('用户已点击发布帖子')) await execute((await call('prepare-draft-publish', { accountId: account.id, draftId: draft.id })).job);
          else {
            let search = studio.state(account.id).searches[0];
            if (prompt.includes('调用 save-search-results')) search = (await call('save-search-results', { accountId: account.id, searchId: search.id, results: candidates })).search;
            if (prompt.includes('调用 update-comment-candidates')) {
              const polish = prompt.includes('只润色');
              search = (await call('update-comment-candidates', { accountId: account.id, searchId: search.id, items: search.results.filter(item => !item.jobId).map((item, index) => ({ id: item.id, selected: polish ? item.selected : index < search.limit, comment: polish ? '这个分区思路很实用，常用物品终于有固定位置了。' : `关于“${item.title}”，想了解你如何决定物品的摆放顺序？`, reason: '与桌面收纳主题相关' })) })).search;
            }
            if (prompt.includes('用户已授权发送选中帖子的评论')) for (const job of (await call('prepare-comment-batch', { accountId: account.id, searchId: search.id })).jobs) await execute(job);
          }
          return c.json({});
        } catch (error) { return c.json({ isError: true, error: error.message }); }
      });
      app.route('/', createApp(ops));
      server = await new Promise(done => { const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4994 }, () => done(s)); });
      // Exercise the real bridge's workspace and symlink containment before UI actions.
      await writeFile(resolve(ctx.outDir, 'outside.png'), 'not a workspace asset');
      let rejected = 0;
      try { await call('import-media', { sourcePath: resolve(ctx.outDir, 'outside.png') }); } catch { rejected++; }
      await symlink(ctx.outDir, resolve(workspaceRoot, 'outside-link'), 'junction');
      try { await call('import-media', { sourcePath: 'outside-link/outside.png' }); } catch { rejected++; }
      ctx.assert(rejected === 2, 'Workspace path containment failed.');
      if (process.env.XHS_EVAL_SESSION_HASH) { await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH); await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"Select tab: 小红书运营台\"]'))"); await ctx.eval("document.querySelector('[aria-label=\"Select tab: 小红书运营台\"]').click()"); }
      let target;
      for(let i=0;i<40;i++){target=(await listTargets(ctx.cdpBaseUrl)).find(t=>t.type==='iframe'&&t.url.includes('127.0.0.1:4790'));if(target)break;await new Promise(done=>setTimeout(done,150));}
      ctx.assert(target, 'Open the Xiaohongshu workbench in the desktop right panel first.');
      restoreUrl = target.url; frame = await connect(target.webSocketDebuggerUrl);
      await ctx.eval(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
      await ctx.client.send('Page.bringToFront');
      await frame.send('Page.navigate', { url: origin + '/proof' });
      const ui = script => evaluate(frame, `(()=>{const w=document.querySelector('#studio')?.contentWindow;const d=w?.document;${script}})()`, { awaitPromise: true });
      const wait = async script => { for (let i=0;i<100;i++) { if (await ui('return ' + script).catch(()=>false)) return; await new Promise(done=>setTimeout(done,150)); } await ctx.output('ui-wait-failure',JSON.stringify(await ui('return {hidden:d.hidden,ready:d.readyState,url:w.location.href,feedback:[...d.querySelectorAll(\"[data-studio-feedback]\")].map(n=>n.textContent),toasts:d.querySelector(\"#toast-region\")?.textContent,buttons:[...d.querySelectorAll(\"[data-studio-action]\")].map(n=>({kind:n.dataset.studioAction,disabled:n.disabled})),state:d.querySelector(\"#page-data\")?.textContent}'),null,2)); throw new Error('UI did not reach: '+script); };
      const fill = async (name, value) => ui(`const el=d.querySelector(${JSON.stringify('[name="'+name+'"]')});el.value=${JSON.stringify(value)};el.dispatchEvent(new w.Event('input',{bubbles:true}));`);
      const click = async selector => ui(`d.querySelector(${JSON.stringify(selector)}).click()`);
      const shot = name => ({ name, requireText: ['小红书运营台'] });
      await wait('d?.querySelector("#post-draft-form") && d.readyState === "complete"');
      await ctx.prove('发帖与评论独立导航，AI 草稿保存后刷新仍保留', { voiceover: vo[0], action: async () => {
        await fill('name','桌面收纳预设'); await fill('brief','写一篇自然的桌面整理经验，配清爽的桌面图片。'); await click('[data-studio-action="draft"]');
        await wait('d.querySelector("[name=title]").value === "把桌面留给真正喜欢的东西"');
        await click('#post-draft-form button[type=submit]'); await wait('d.querySelector("[name=title]").value === "把桌面留给真正喜欢的东西"');
      }, assert: async () => {
        ctx.assert(studio.state(account.id).drafts[0]?.body.includes('两分钟'), 'AI result was not persisted.');
        ctx.assert(await ui('return !!d.querySelector("nav a[href^=\\"/comments\\"]") && !d.querySelector("nav a[href^=\\"/interactions\\"]")'), 'Modules were not split.');
      }, screenshot: shot('draft-saved') });
      await ctx.prove('图片素材回填、预览和发布完成状态形成闭环', { voiceover: vo[1], action: async () => {
        await click('[data-studio-action="image"]'); await wait('d.querySelector("[data-preview-media] img")?.complete && d.querySelector("[data-preview-media] img").naturalWidth > 0');
        await click('[data-studio-action="publish"]'); await wait('d.body.innerText.includes("内容已锁定") && d.body.innerText.includes("已完成")');
        const count=submitted.size; await click('[data-studio-action="publish"]'); await new Promise(done=>setTimeout(done,500)); ctx.assert(submitted.size===count,'Publish retry submitted twice.');
        await ui('d.querySelector(".studio-media").scrollIntoView({block:"center"})');
      }, assert: async () => { ctx.assert(studio.state(account.id).drafts[0].status==='succeeded','Publish did not complete.'); ctx.assert(calls.includes('import-media'),'Media import bridge was not called.'); }, screenshot: shot('image-publish') });
      await ctx.prove('视频工作台素材保留视频类型并可播放', { voiceover: vo[2], action: async () => {
        await ui(`w.location.href='/publishing?account=${account.id}&draft=new'`); await wait('d.querySelector("[name=title]")?.value === ""');
        await fill('name','视频预设'); await fill('title','一分钟整理桌面'); await fill('body','演示整理过程。'); await click('[data-studio-action="video"]');
        await wait('d.querySelector("[data-preview-media] video")?.readyState >= 1'); await ui('const v=d.querySelector("[data-preview-media] video");v.muted=true;v.play().catch(()=>{})'); await wait('d.querySelector("[data-preview-media] video").currentTime > 0'); await ui('d.querySelector("[data-preview-media] video").pause()'); await ui('d.querySelector(".studio-media").scrollIntoView({block:"center"})');
      }, assert: async () => { ctx.assert(studio.state(account.id).drafts[0].mediaKind==='video','Video draft lost its media type.'); ctx.assert(await ui('return d.querySelector("[data-preview-media] video").duration > 0'),'MP4 preview is not playable.'); }, screenshot: shot('video-material') });
      await ctx.prove('搜索、排序、选择与润色结果可在评论面板编辑保存', { voiceover: vo[3], action: async () => {
        await click('nav a[href^="/comments"]'); await wait('d.querySelector("#post-search-form")'); await fill('query','桌面收纳'); await fill('limit','2'); await click('#post-search-form button[type=submit]'); await wait('d.querySelectorAll("[data-post-id]").length === 3');
        await ui('const s=d.querySelector("[data-result-sort]");s.value="likes";s.dispatchEvent(new w.Event("change",{bubbles:true}))');
        ctx.assert(await ui('return d.querySelector("[data-post-id]").dataset.postId === "desk-b"'),'Sorting did not change visible order.');
        await click('[data-select-posts]'); await click('[data-studio-action="polish"]'); await wait('d.querySelector("[data-post-comment]")?.value.includes("分区思路")');
        await ui('const el=d.querySelector("[data-post-id=desk-b] [data-post-comment]");el.value="盒子的尺寸方便分享一下吗？";el.dispatchEvent(new w.Event("input",{bubbles:true}))'); await click('[data-save-comments]'); await wait('d.body.innerText.includes("选择和评论已保存")');
        await ui('d.querySelector(".result-actions").scrollIntoView({block:"start"})');
      }, assert: async () => { const search=studio.state(account.id).searches[0]; ctx.assert(search.results.find(p=>p.id==='desk-b').comment==='盒子的尺寸方便分享一下吗？','Edited comment was not saved.'); ctx.assert(search.results.filter(p=>p.selected).length===2,'Selection did not persist.'); }, screenshot: shot('comments-selected') });
      await ctx.prove('批量评论与自动找帖均回写结果并跳过重复帖子，切换账号留在评论模块', { voiceover: vo[4], action: async () => {
        await click('[data-studio-action="comment"]'); await wait('d.querySelectorAll(".candidate-card .status-succeeded").length===2');
        await click('[data-studio-action="auto-comment"]'); await wait('d.body.innerText.includes("已有评论记录")');
        const total=db.listInteractions(100,account.id).length; ctx.assert(total===3,'Autonomous retry repeated a handled post.');
        await click('.account-picker summary'); await click(`.account-menu a[href="/comments?account=${other.id}"]`); await wait('d.querySelector(".account-switcher")?.innerText.includes("演练视频号")');
        ctx.assert(await ui('return w.location.pathname === "/comments" && d.querySelectorAll("[data-post-id]").length === 0'),'Account switch leaked results or left comments.');
        await click('.account-picker summary'); await click(`.account-menu a[href="/comments?account=${account.id}"]`); await wait('d.body.innerText.includes("已有评论记录")'); await ui('d.querySelector(".candidate-list").scrollIntoView({block:"start"})');
      }, assert: async () => { ctx.assert(db.listInteractions(100,other.id).length===0,'Wrong account received comments.'); await ctx.output('studio-evidence',JSON.stringify({simulatedAgentAndExternalSubmit:true,actions:calls,posts:db.listContent(100).length,comments:db.listInteractions(100,account.id).length,submittedOnce:[...submitted]},null,2)); }, screenshot: shot('batch-completed') });
    } finally {
      if(frame && restoreUrl) await frame.send('Page.navigate',{url:restoreUrl}).catch(()=>{});
      frame?.close(); if(process.env.XHS_EVAL_SESSION_HASH && previousHash !== process.env.XHS_EVAL_SESSION_HASH) await ctx.navigateHash(previousHash); bridge?.dispose(); if(server) await new Promise(done=>server.close(done)); db?.close();
      for(const [key,value] of Object.entries(previous)) value===undefined ? delete process.env[key] : process.env[key]=value;
    }
  }}],
};
