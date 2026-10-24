// Isolated services and host transport; remote WeChat responses and AI delivery are fixtures.
// Real plugin UI, local APIs, SQLite persistence, shared runtime and CSP run unchanged.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { startServer as startDouyin } from '../../examples/plugin-packages/douyin-ops/service/server.mjs';
import { startServer as startChannels } from '../../examples/plugin-packages/wechat-channels-ops/service/server.mjs';
import { serve } from '../../examples/plugin-packages/xiaohongshu-ops/skills/xhs-ops-worker/app/node_modules/@hono/node-server/dist/index.mjs';
import { buildPluginRuntime } from '../../packages/ui/build-plugin-runtime.mjs';
import { OpsDatabase } from '../../examples/plugin-packages/xiaohongshu-ops/skills/xhs-ops-worker/app/src/db.ts';
import { OpsService } from '../../examples/plugin-packages/xiaohongshu-ops/skills/xhs-ops-worker/app/src/service.ts';
import { StudioService } from '../../examples/plugin-packages/xiaohongshu-ops/skills/xhs-ops-worker/app/src/studio.ts';
import { createApp } from '../../examples/plugin-packages/xiaohongshu-ops/skills/xhs-ops-worker/app/src/server.ts';
import createWechat from '../../examples/plugin-packages/wechat-official/service/wechat-official.mjs';

const [host, bundled] = await Promise.all(['host', 'bundled'].map(mode => buildPluginRuntime(mode)));
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const drafts = new Map([['fixture-draft', {title:'桌面整理的三个习惯', content:'<p>每天留五分钟，整理桌面。</p>', thumb_media_id:'fixture-cover', need_open_comment:1}]]); let saves = 0, failSave = false;
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.local'); let input = '';
  for await (const chunk of req) input += chunk;
  const args = input ? JSON.parse(input) : {};
  res.setHeader('content-type', 'application/json');
  if (url.pathname.endsWith('/draft/add') && failSave) { failSave=false; res.end(JSON.stringify({errcode:40013,errmsg:'isolated save failure'})); return; }
  const result = url.pathname.endsWith('/token') ? { access_token: 'isolated-fixture-token', expires_in: 7200 }
    : url.pathname.endsWith('/batchget') ? { total_count: drafts.size, item_count: drafts.size, item: [...drafts].map(([media_id, article]) => ({ media_id, content: { news_item: [article] } })) }
    : url.pathname.endsWith('/add') ? (() => { const id = 'draft-' + ++saves; drafts.set(id, args.articles[0]); return { media_id: id }; })()
    : url.pathname.endsWith('/draft/get') ? { news_item: [drafts.get(args.media_id)] }
    : url.pathname.endsWith('/draft/update') ? (() => { saves++; drafts.set(args.media_id, args.articles); return { errcode: 0 }; })()
    : url.pathname.endsWith('/user/get') ? { total: 1, count: 1, data: { openid: ['fixture-follower'] }, next_openid: '' }
    : url.pathname.endsWith('/menu/get') ? { menu: { button: [{ name: '文章', type: 'view', url: 'https://example.com/' }] } }
    : { errcode: 0 };
  res.end(JSON.stringify(result));
});
process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE = await listen(upstream);
// The service deliberately gates alternate API origins behind this existing development switch.
process.env.IPOLLOWORK_DEV_MODE = '1';
const credentials = new Map([['品牌主号', { appId: 'wx-fixture', appSecret: 'fixture-only' }], ['品牌副号', { appId: 'wx-fixture-other', appSecret: 'fixture-only-other' }]]);
const authorization = {
  listConnections: async () => [...credentials.keys()].map(accountId => ({ accountId, methodId: 'wechat-official-account', status: 'connected', updatedAt: 0 })),
  getCredential: async (_method, accountId) => credentials.get(accountId || '品牌主号'),
  readCredential: async accountId => credentials.get(accountId),
  saveCredential: async (_method, accountId, values) => { credentials.set(accountId, values); },
  setActiveAccount: async (_method, accountId) => credentials.has(accountId),
  revokeAccount: async accountId => credentials.delete(accountId),
};
const targets = new Map(), closers = [];
for (const mode of ['host', 'bundled']) {
  const db = new OpsDatabase(':memory:'), ops = new OpsService(db), studio = new StudioService(ops);
  const account = db.createAccount({ handle: '品牌主号', displayName: '品牌主号', expectedProfileId: 'fixture-xhs', profileUrl: 'https://creator.xiaohongshu.com/', browserProfileId: null, workerThreadId: null, position: '桌面收纳', audience: '上班族', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 5 });
  const draft = studio.saveDraft({ accountId: account.id, name: '桌面整理', brief: '写一篇桌面整理经验', title: '整洁桌面的三个习惯', body: '每天留五分钟，整理桌面。', topics: ['桌面整理'] });
  const port = mode === 'host' ? 5921 : 5923;
  const server = serve({ fetch: createApp(ops, { origin: `http://127.0.0.1:${port}`, ...(mode === 'bundled' ? { uiRuntime: bundled.script } : {}) }).fetch, hostname: '127.0.0.1', port });
  targets.set(`xhs-${mode}`, `http://127.0.0.1:${port}/publishing?account=${account.id}&draft=${draft.id}`);
  const wx = await createWechat({ plugin: { id: 'wechat-official', version: '0.3.2' }, workspace: { root: process.cwd() }, authorization }, mode === 'bundled' ? { uiRuntime: bundled.script } : {});
  targets.set(`wechat-${mode}`, (await wx.actions['open-workbench']({}, {})).url);
  closers.push(() => server.close(), () => db.close(), () => wx.dispose());
}
for (const [id, start] of [['douyin', startDouyin], ['channels', startChannels]]) {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'social-style-reference-'));
  const reference = await start({ dataDir, workspaceRoot:process.cwd(), uiRuntime:bundled.script });
  reference.operations.store.put('account', {id:'reference-account', nickname:'品牌主号', name:'品牌主号', browserProfileId:'fixture-reference', scopes:[]});
  targets.set(id, reference.origin + '/#token=' + reference.token);
  closers.push(() => reference.close(), async () => { if(dirname(dataDir)!==resolve(tmpdir()))throw Error('Unexpected fixture location'); await rm(dataDir,{recursive:true,force:true}); });
}
const parent = createServer((req, res) => {
  if(req.url === '/fixture/fail-save' && req.method === 'POST'){failSave=true;res.end('ok');return;}
  if (req.url === '/evidence') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ saves, drafts: [...drafts] })); return; }
  const target = targets.get(req.url.slice(1).split('?')[0]) || targets.get('xhs-host');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><style>body{margin:0}iframe{width:${req.url.includes("narrow=1") ? "390px" : "100%"};height:100vh;border:0}</style></head><body><nav style="position:fixed;bottom:0;right:0;z-index:100;background:white;padding:4px;font:12px sans-serif"><a href="${target}">打开独立预览</a><button id="theme">切换主题</button> <output id="receipt">尚未发送 AI 请求</output></nav><script>
    window.deliveries=[];window.contexts=[];window.theme='light';document.getElementById('theme').onclick=()=>{window.theme=window.theme==='light'?'dark':'light';document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:window.theme}},'*');};
    window.addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow||!e.data.id)return;const {id,method,params}=e.data;let result={};
      if(method==='ui/initialize')result={hostContext:{theme:window.theme,'ai.ipollo/ui-runtime':${JSON.stringify(host.script)},'ai.ipollo/workspace':{sessionId:'isolated-social-proof'}},hostCapabilities:{message:true,experimental:{'ai.ipollo/browser-profiles':true}}};
      else if(method==='ui/update-model-context'){window.contexts.push(params);if(window.failContext){window.failContext=false;result={isError:true};}}
      else if(method==='ui/message'){window.deliveries.push(params);document.getElementById('receipt').textContent=params.content[0].text+' / 上下文已接收 '+window.contexts.length;}
      e.source.postMessage({jsonrpc:'2.0',id,result},'*');});
  </script><iframe title="运营台" src="${target}"></iframe><script>document.querySelector("iframe").addEventListener("load",function(){if(this.src.includes("#"))this.src=this.src.split("#")[0];});</script></body></html>`);
});
await new Promise(resolve => parent.listen(5920, '127.0.0.1', resolve));
console.log('Social UI isolated fixture: http://127.0.0.1:5920/xhs-host');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { parent.close(); upstream.close(); for (const close of closers) await close(); process.exit(0); });
