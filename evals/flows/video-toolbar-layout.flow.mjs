import {evaluate} from '../runner/cdp.mjs';
const iframeSelector='iframe[title*="HyperFrames"]';
async function wait(frame,expression){for(let i=0;i<100;i++){if(await evaluate(frame,expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Studio state did not settle: '+expression);}
async function mouse(ctx,frame,selector){
 const point=await evaluate(frame,"(()=>{const e=document.querySelector("+JSON.stringify(selector)+");e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
 const offset=await ctx.eval("(()=>{const r=document.querySelector("+JSON.stringify(iframeSelector)+").getBoundingClientRect();return{x:r.x,y:r.y};})()");
 const p={x:point.x+offset.x,y:point.y+offset.y};
 await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
 await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
 await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});
 await new Promise(r=>setTimeout(r,250));
}
export default {id:'video-toolbar-layout',title:'真实视频工作室：紧凑工具栏与低频菜单',kind:'user-facing',preserveTheme:true,cdpTarget:{urlIncludes:'localhost:5173'},steps:[{name:'实际客户端只读布局验证',async run(ctx){
 ctx.assert(await ctx.eval("navigator.userAgent.includes('Electron')"),'Real Electron required');
 await ctx.waitFor("!!document.querySelector("+JSON.stringify(iframeSelector)+")");
 const studioOrigin=await ctx.eval("new URL(document.querySelector("+JSON.stringify(iframeSelector)+").src).origin");
 const tree=await ctx.client.send('Page.getFrameTree');
 const studio=tree.frameTree.childFrames.find(entry=>entry.frame.url.startsWith(studioOrigin));
 ctx.assert(studio,'Existing Studio frame required; do not create a project');
 const world=await ctx.client.send('Page.createIsolatedWorld',{frameId:studio.frame.id,worldName:'toolbar-readonly-proof'});
 const frame={send:(method,params)=>ctx.client.send(method,method==='Runtime.evaluate'?{...params,contextId:world.executionContextId}:params)};
 await wait(frame,"!!document.querySelector('[data-testid=studio-enhancement-open]')");
 const headerState=await evaluate(frame,"({width:innerWidth,height:document.querySelector('header').getBoundingClientRect().height,buttons:Array.from(document.querySelectorAll('header button')).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize}))})");
 await ctx.prove('增强与模式、编辑工具合并到同一工具栏',{
  voiceover:'真实客户端把增强入口移入工作室工具栏，左侧先切换视图再管理面板，导出保持主要动作。',
  action:async()=>{},
  assert:async()=>{ctx.assert(headerState.buttons.some(e=>e.text==='面板')&&headerState.buttons.some(e=>e.text==='智能增强'),'Panel and enhancement present');ctx.assert(headerState.buttons.filter(e=>['智能增强','属性','更多','导出','面板'].includes(e.text)).every(e=>e.height===32&&e.font==='13px'),JSON.stringify(headerState));ctx.assert(await ctx.eval("!document.querySelector('[data-testid=video-enhancement-open]')"),'Old separate host row removed');},
  screenshot:{name:'toolbar-single-row'}
 });
 await ctx.prove('更多收纳模板保存与维护动作，不执行',{
  voiceover:'打开更多核对菜单分组，模板保存与重新加载不再占主工具栏；本次不点击任何菜单动作。',
  action:async()=>{await mouse(ctx,frame,'[data-testid=studio-more-actions]');await wait(frame,"Array.from(document.querySelectorAll('[role=menuitem]')).some(e=>e.getBoundingClientRect().width>0)");},
  assert:async()=>{const labels=await evaluate(frame,"Array.from(document.querySelectorAll('[role=menuitem]')).filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent)");ctx.assert(labels.some(e=>e.includes('重新加载'))&&labels.some(e=>e.includes('另存为作品模板')),JSON.stringify(labels));},
  screenshot:{name:'toolbar-more-menu'}
 });
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(frame,"document.querySelector('[data-testid=studio-more-actions]').getAttribute('aria-expanded')==='false'");
 await ctx.prove('增强仍打开原宿主弹窗，不提交生成',{
  voiceover:'工具栏通过现有安全桥接打开原增强弹窗。只检查入口和关闭，不上传、不生成、不保存。',
  action:async()=>{await evaluate(frame,"document.querySelector('[data-testid=studio-enhancement-open]').click()");await ctx.waitFor("!!document.querySelector('[role=dialog]')");},
  assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[role=dialog]').textContent.includes('增强')"),'Actual enhancement dialog opened'),
  screenshot:{name:'toolbar-enhancement-dialog'}
 });
 await ctx.eval("document.querySelector('[role=dialog] [data-slot=dialog-close]').click()");
 await ctx.waitFor("!document.querySelector('[role=dialog]')");
 await ctx.prove('窄容器保留视图切换与导出，不溢出',{
  voiceover:'仅在测试期间缩窄工作室容器，按钮继续使用紧凑尺寸，低频动作隐藏文字，导出保留标签。',
  action:async()=>{await ctx.eval("(()=>{const e=document.querySelector("+JSON.stringify(iframeSelector)+");e.dataset.proofOldStyle=e.getAttribute('style')||'';e.style.width='480px';e.style.maxWidth='480px';})()");await new Promise(r=>setTimeout(r,300));},
  assert:async()=>{const state=await evaluate(frame,"(()=>{const h=document.querySelector('header'),b=h.querySelector('[aria-label=导出]');return{width:innerWidth,right:h.getBoundingClientRect().right,exportRight:b.getBoundingClientRect().right,label:getComputedStyle(b.querySelector('span')).display,height:b.getBoundingClientRect().height};})()");ctx.assert(state.width===480&&state.right<=480&&state.exportRight<=480&&state.label!=='none'&&state.height===32,JSON.stringify(state));},
  screenshot:{name:'toolbar-narrow'}
 });
 await ctx.eval("(()=>{const e=document.querySelector("+JSON.stringify(iframeSelector)+");e.setAttribute('style',e.dataset.proofOldStyle);delete e.dataset.proofOldStyle;})()");
}}]};
