// Local MCP Apps protocol harness; never fabricates provider results.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import createService from '../src/service.mjs';
import { execFileSync } from 'node:child_process';
import { buildPluginRuntime } from '@ipollowork/ui/build-plugin-runtime';
const bundledUi = process.env.SHORT_VIDEO_UI_MODE !== 'host';
execFileSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname, ...(bundledUi ? ['--bundled-ui'] : [])], { stdio: 'inherit' });
const hostRuntime = bundledUi ? '' : (await buildPluginRuntime('host')).script;
const uiFile = new URL(bundledUi ? '../dist/development/ui/studio.html' : '../dist/package/ui/studio.html', import.meta.url);
const root = resolve(process.env.SHORT_VIDEO_DEV_ROOT || '.dev-data/workspace');
const dataDir = resolve('.dev-data/private');
await mkdir(root, { recursive: true }); await mkdir(dataDir, { recursive: true });
const fallbackHost = { callAction: async name => {
  if (name.endsWith('/status')) return { ok: true, result: { models: [], configured: false } };
  throw new Error('独立预览没有 Work 渠道；请导入 Work 后使用真实生成。');
} };
const host = process.env.SHORT_VIDEO_USE_WORK === '1' ? await (await import('./work-dev-host.mts')).workDevHost(root) : fallbackHost;
const service = await createService({ workspace: { root }, storage: { dataDir }, host });
const token = randomBytes(24).toString('hex');
const page = html => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>短片插件 · 独立开发预览</title><style>body{margin:0;font:13px system-ui;background:#eee}header{height:40px;display:flex;align-items:center;gap:12px;padding:0 16px}button{padding:3px 10px}iframe{border:0;width:100%;height:calc(100vh - 40px);display:block}#message{display:none}</style><header>独立开发预览 · 渠道生成请在 Work 内测试 <button id="theme">切换亮暗主题</button><button id="narrow">窄屏</button></header><iframe id="app" sandbox="allow-scripts"></iframe><pre id="message"></pre><script>
const frame=document.getElementById('app');let theme='light';frame.srcdoc=${JSON.stringify(html).replaceAll('<','\\u003c')};
const send=(id,result)=>frame.contentWindow.postMessage({jsonrpc:'2.0',id,result},'*');
addEventListener('message',async e=>{if(e.source!==frame.contentWindow||!e.data?.method)return;const m=e.data;
try {if(m.method==='ui/initialize')send(m.id,{protocolVersion:'2025-11-21',hostInfo:{name:'Work development harness',version:'1'},hostCapabilities:{message:{},serverTools:{}},hostContext:{theme,'ai.ipollo/workspace':{workspaceRoot:${JSON.stringify(root)},sessionId:'dev_session'}}});
else if(m.method==='tools/call'){const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json','x-dev-token':${JSON.stringify(token)}},body:JSON.stringify(m.params)});const data=await response.json();send(m.id,data.error?{isError:true,content:[{type:'text',text:data.error}]}:{structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}]});}
else if(m.method==='ui/message'){const el=document.getElementById('message');el.style.display='block';el.textContent=m.params.content[0].text;send(m.id,{});}
else if(m.id!==undefined)send(m.id,{});
}catch(error){send(m.id,{isError:true,content:[{type:'text',text:error.message}]});}});
document.getElementById('theme').onclick=()=>{theme=theme==='light'?'dark':'light';frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme}},'*')};
document.getElementById('narrow').onclick=()=>{frame.style.width=frame.style.width?'':'540px'};
</script></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET' && req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); const html = await readFile(uiFile, 'utf8'); res.end(page(hostRuntime ? html.replace('<head>', () => `<head><script>${hostRuntime.replaceAll('</script', '<\\/script')}</script>`) : html)); return; }
  if (req.method !== 'POST' || req.url !== '/rpc' || req.headers['x-dev-token'] !== token || req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); res.end(); return; }
  try {
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)throw new Error('请求过大');chunks.push(chunk)}
    const {name,arguments:args}=JSON.parse(Buffer.concat(chunks));
    if(!Object.hasOwn(service.actions,name))throw new Error('未知操作');
    const result=await service.actions[name](args||{},{sessionId:'dev_session'});
    res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
  } catch(e){res.setHeader('content-type','application/json');res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.PORT || 5894),'127.0.0.1',()=>console.log(`Short-video plugin preview: http://127.0.0.1:${server.address().port}`));
