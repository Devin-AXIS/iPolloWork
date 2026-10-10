import { connect, evaluate, listTargets } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
import { fileURLToPath } from 'node:url';
const vo=await loadVoiceoverParagraphs('shared-ui-runtime');
const contractModule='http://127.0.0.1:5193/@fs'+fileURLToPath(new URL('../../packages/ui/src/plugin/runtime-contract.ts',import.meta.url));

// Isolated protocol harness: real plugin service/files, one injected transport failure.
async function click(parent, frame, selector) {
  await evaluate(frame, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  for (const type of ['keyDown','keyUp']) await parent.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
}
export default {
  id:'shared-ui-runtime', title:'共享 UI：开发打包与宿主运行时注入（隔离协议预览）', kind:'user-facing', preserveTheme:true,
  cdpTarget:{urlIncludes:'127.0.0.1:589'},
  steps: ['bundled','host'].map((mode,index)=>({name:`${mode}：保留草稿、真实重试、亮暗与窄屏`,async run(ctx){
    const parent=ctx.client;
    const previousFrames=new Set((await listTargets(ctx.cdpBaseUrl)).filter(target=>target.type==='iframe').map(target=>target.id));
    await parent.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await parent.send('Page.navigate',{url:`http://127.0.0.1:${5896+index}`});
    await parent.send('Page.bringToFront');
    let frame;
    for(let attempt=0;attempt<80&&!frame;attempt++) {
      const targets=await listTargets(ctx.cdpBaseUrl);
      for(const target of targets.filter(target=>target.type==='iframe'&&target.url==='about:srcdoc'&&!previousFrames.has(target.id))) {
        const client=await connect(target.webSocketDebuggerUrl).catch(()=>null);
        if(!client)continue;
        const matches=await evaluate(client,`window.ipolloworkUi?.mode===${JSON.stringify(mode)} && Boolean(document.querySelector('[aria-label="新建项目"]'))`).catch(()=>false);
        if(matches){frame=client;break;}client.close();
      }
      if(!frame)await new Promise(resolve=>setTimeout(resolve,250));
    }
    ctx.assert(Boolean(frame),`${mode} plugin loaded`);ctx.client=frame;
    const shot=name=>({name:`${mode}-${name}`,targetId:parent.targetId,textTargetId:frame.targetId,requireText:['新建短片']});
    const draft=`共享运行时验证 ${mode} ${Date.now()}`;
    await click(parent,frame,'[aria-label="新建项目"]');
    await ctx.waitFor('Boolean(document.querySelector("#dialog"))');
    await ctx.fill('#dialog input',draft);
    await evaluate(parent,`(()=>{const original=fetch;window.__uiRequests=0;window.fetch=async(...args)=>{if(args[0]==='/rpc'&&JSON.parse(args[1].body).name==='project-create'){window.__uiRequests++;if(window.__uiRequests===1)return new Promise(resolve=>window.__uiReject=()=>resolve(new Response(JSON.stringify({error:'验证：存储暂不可用，请重试'}),{headers:{'content-type':'application/json'}})));}return original(...args);};})()`);
    await ctx.prove(`${mode} 提交中禁用重复操作，共享 Input 保留输入`,{
      voiceover:vo[0],
      action:()=>click(parent,frame,'[data-dialog="ok"]'),
      assert:async()=>{await ctx.waitFor('document.querySelector("#dialog").getAttribute("aria-busy")==="true"');ctx.assert(await ctx.eval(`document.querySelector('#dialog input').value===${JSON.stringify(draft)} && [...document.querySelectorAll('#dialog button')].every(e=>e.disabled&&e.dataset.slot==='button')`),'busy and shared native controls');},screenshot:shot('pending')});
    await ctx.prove(`${mode} 失败就地提示且草稿不丢失（注入一次传输故障）`,{
      voiceover:vo[1],
      action:()=>evaluate(parent,'window.__uiReject()'),
      assert:async()=>{await ctx.waitFor('!document.querySelector("#dialog-error").hidden');ctx.assert(await ctx.eval(`Boolean(document.querySelector('#dialog')) && document.querySelector('#dialog input').value===${JSON.stringify(draft)} && document.querySelector('#dialog input').getAttribute('aria-describedby')==='dialog-error'`),'draft retained and error associated');},screenshot:shot('failed')});
    await ctx.prove(`${mode} 共享 Token 跟随暗色主题且窄弹窗不越界`,{
      voiceover:vo[2],
      action:async()=>{await evaluate(parent,'document.querySelector("#theme").click()');await parent.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});},
      assert:async()=>{await ctx.waitFor(`(()=>{const d=document.querySelector('#dialog'),r=d.getBoundingClientRect();return document.documentElement.dataset.theme==='dark'&&r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth})()`);ctx.assert(await ctx.eval('(()=>{const s=getComputedStyle(document.documentElement);return s.getPropertyValue("--sv-text").trim()===s.getPropertyValue("--foreground").trim()})()'),'plugin tokens resolve to shared semantics');},screenshot:shot('dark-narrow')});
    await click(parent,frame,'[data-dialog="ok"]');
    await ctx.waitFor('!document.querySelector("#dialog")');
    ctx.log(JSON.stringify(await ctx.eval(`({selected:document.querySelector('#project-picker').textContent})`)));
    await ctx.waitFor(`document.body.textContent.includes(${JSON.stringify(draft)})`);
    ctx.assert(await ctx.eval(`document.body.textContent.includes(${JSON.stringify(draft)})`),'real service retry creates project');
    ctx.assert(await evaluate(parent,'window.__uiRequests===2'),'one failed request, one real retry');
    ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label")==="新建项目"'),'focus returns to entry');
    await evaluate(parent, `document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{locale:'zh-CN'}},'*')`);
    ctx.assert(await ctx.eval('document.documentElement.dataset.theme==="dark"'),'unrelated context preserves host theme');
    await click(parent,frame,'[aria-label="新建项目"]');await ctx.waitFor('Boolean(document.querySelector("#dialog"))');
    for(const type of ['keyDown','keyUp'])await parent.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await ctx.waitFor('!document.querySelector("#dialog")');
    ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label")==="新建项目"'),'Escape returns focus to entry');
    frame.close();ctx.client=parent;
    if(mode==='host'){
      const demo=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;box-sizing:border-box;font:13px system-ui}h1{font-size:20px;overflow-wrap:anywhere}</style><meta name="ipollowork-ui-runtime" content="1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline'"></head><body><h1>共享运行时 · React 控件</h1><div id="react"></div><button id="native-button" data-ipw-control="button">HTML 按钮</button><input id="native-input" data-ipw-control="input" aria-label="HTML 输入"><textarea id="native-textarea" data-ipw-control="textarea" aria-label="HTML 多行"></textarea><output id="result">等待操作</output><script>const ui=window.ipolloworkUi;ui.enhance(document.body);ui.createRoot(document.querySelector('#react')).render(ui.React.createElement('div',null,ui.React.createElement(ui.Button,{id:'react-button',onClick:()=>document.querySelector('#result').textContent='React 操作完成'},'React 按钮'),ui.React.createElement(ui.Input,{id:'react-input','aria-label':'React 输入'}),ui.React.createElement(ui.Textarea,{id:'react-textarea','aria-label':'React 多行'})));</script></body></html>`;
      await evaluate(parent,`(async()=>{const {withSharedUiRuntime}=await import('http://127.0.0.1:5193/src/react-app/plugin-ui/shared-ui-runtime.ts');const untouched='<html>无运行时声明</html>';if(withSharedUiRuntime(untouched)!==untouched)throw Error('Unexpected opt-in');document.querySelector('iframe').srcdoc=withSharedUiRuntime(${JSON.stringify(demo)});})()`,{awaitPromise:true});
      let demoFrame;
      for(let attempt=0;attempt<80&&!demoFrame;attempt++){
        for(const target of (await listTargets(ctx.cdpBaseUrl)).filter(t=>t.type==='iframe')){const c=await connect(target.webSocketDebuggerUrl).catch(()=>null);if(!c)continue;if(await evaluate(c,'Boolean(document.querySelector("#react-button"))').catch(()=>false)){demoFrame=c;break;}c.close();}
        if(!demoFrame)await new Promise(resolve=>setTimeout(resolve,250));
      }
      ctx.assert(Boolean(demoFrame),'actual host injection helper mounts React controls under inline-only CSP');ctx.client=demoFrame;
      await ctx.prove('真实宿主注入函数支持 React 与 HTML 共用控件样式，版本不兼容明确拒绝',{
        voiceover:vo[3],
        action:()=>click(parent,demoFrame,'#react-button'),
        assert:async()=>{await ctx.waitFor('document.querySelector("#result").textContent==="React 操作完成"');ctx.assert(await ctx.eval(`['button','input','textarea'].every(kind=>{const x=document.querySelector('#react-'+kind),y=document.querySelector('#native-'+kind),a=x.getBoundingClientRect(),b=y.getBoundingClientRect();return a.height===b.height&&getComputedStyle(x).borderRadius===getComputedStyle(y).borderRadius&&(kind==='textarea'||a.height===32)})`),'React and HTML share control geometry');const rejected=await evaluate(parent,`(async()=>{const {requireRuntime}=await import(${JSON.stringify(contractModule)});let count=0;for(const value of [undefined,{version:'2.0.0'}]){window.ipolloworkUi=value;try{requireRuntime()}catch(e){if(e.message.includes('更新'))count++;}}delete window.ipolloworkUi;return count===2})()`,{awaitPromise:true});ctx.assert(rejected,'missing and incompatible versions reject');},
        screenshot:{name:'host-react-html',targetId:parent.targetId,textTargetId:demoFrame.targetId,requireText:['React 操作完成','HTML 按钮']}});
      demoFrame.close();ctx.client=parent;
    }
  }})),
};
