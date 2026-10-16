import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
const vo = await loadVoiceoverParagraphs('workspace-panel-motion');
const left = '[data-slot="sidebar-rail"]';
const right = '[data-testid="workspace-resize-handle"]';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function metrics(ctx) {
  return ctx.eval(`(() => {
    const width = s => document.querySelector(s).getBoundingClientRect().width;
    const main = document.querySelector('[data-testid="main-workspace"]');
    const work = document.querySelector('[data-testid="right-workspace"]');
    return {left:width('[data-slot="sidebar-gap"]'),main:main.getBoundingClientRect().width,right:work.getBoundingClientRect().width,
      viewport:innerWidth,mainHidden:main.inert,rightHidden:work.inert,transition:getComputedStyle(work).transitionProperty,
      sameContent:(!window.__workspaceProofContent || work.firstElementChild===window.__workspaceProofContent) && (!window.__workspaceProofFrame || (document.querySelector('iframe[title*="HyperFrames"]')===window.__workspaceProofFrame && window.__workspaceProofFrame.src===window.__workspaceProofFrameSrc))};
  })()`);
}
async function down(ctx, selector) {
  const p = await ctx.eval(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:Math.min(innerHeight-100,r.y+r.height/2)};})()`);
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
  return p;
}
async function move(ctx,p,x) {
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:p.y,button:'left',buttons:1});
  await pause(40);
}
async function up(ctx,p,x) {
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:p.y,button:'left',buttons:0,clickCount:1});
  await pause(1100);
}
async function click(ctx,selector) {
  const p=await down(ctx,selector); await up(ctx,p,p.x);
}
async function sample(ctx,selector='[data-testid="right-workspace"]') {
  await ctx.eval(`(() => {window.__workspaceProofSamples=[];window.__workspaceProofSidebarWidths=[];let start=null;const tick=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e.dataset.slot==='sidebar-gap'){const sidebar=document.querySelector('[data-slot="sidebar-container"]');const r=sidebar.getBoundingClientRect();if(r.right>0.5&&e.getBoundingClientRect().width>0.5)window.__workspaceProofSidebarWidths.push(r.width);}const content=e.querySelector('[data-testid="workspace-panel-content"]');const rect=content?.getBoundingClientRect();const clip=content?getComputedStyle(content).clipPath:'none';const clipValues=clip.startsWith('inset(')?clip.slice(6,-1).split(' '):[];const clipRight=clipValues.length>1?parseFloat(clipValues[1]):0;const area=document.querySelector('[data-testid="main-workspace"]').parentElement.getBoundingClientRect();const visible=rect && content.getAnimations().length ? Math.max(0,Math.min(area.right,rect.right-clipRight)-Math.max(area.left,rect.left)) : e.getBoundingClientRect().width;if(start===null)start=performance.now();window.__workspaceProofSamples.push(visible);if(performance.now()-start<900)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`);
}
function animated(ctx, samples, from, to) {
  ctx.assert(samples.some(w=>w>Math.min(from,to)+2 && w<Math.max(from,to)-2),`Animation must contain intermediate rendered widths: ${JSON.stringify({samples,from,to})}`);
  ctx.assert(Math.abs(samples.at(-1)-to)<2,`Animation did not reach destination: ${samples.at(-1)} / ${to}`);
}
export default {
 id:'workspace-panel-motion',title:'三个区域：拖动、吸附、平滑展开与恢复',kind:'user-facing',preserveTheme:true,
 cdpTarget:{urlIncludes:'localhost:5174'},
 steps:[{name:'Three-region interaction',async run(ctx){
  ctx.assert(await ctx.eval("navigator.userAgent.includes('Electron')"),'Actual Electron required');
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:100,button:'left',buttons:0,clickCount:1});
  await ctx.waitFor("!!document.querySelector('[data-testid=main-workspace]')");
  if(await ctx.eval(`document.querySelector('${right}').tabIndex>=0`)) {
   await ctx.eval(`document.querySelector('${right}').focus()`);
   await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await ctx.waitFor("!document.querySelector('[data-testid=main-workspace]').inert && !document.querySelector('[data-testid=right-workspace]').inert && !document.querySelector('[data-testid=right-workspace]').getAnimations().length");
  }
  // Open only the existing panel UI; no task, artifact, generation or save is created.
  if((await metrics(ctx)).right<1) await click(ctx,'button[aria-label="Open right panel"],button[aria-label="打开右侧面板"]');
  await ctx.waitFor("document.querySelector('[data-testid=right-workspace]').getBoundingClientRect().width>100");
  if((await metrics(ctx)).left<1) await click(ctx,'[data-testid=workspace-expand-sidebar]');
  await pause(300);
  const initial=await metrics(ctx);
  await ctx.eval("void(window.__workspaceProofContent=document.querySelector('[data-testid=right-workspace]').firstElementChild)");
  await ctx.eval('void(window.__workspaceProofFrame=document.querySelector(\'iframe[title*="HyperFrames"]\'))');
  await ctx.eval('void(window.__workspaceProofFrameSrc=window.__workspaceProofFrame?.src)');
  let split;
  try {
   await ctx.prove('拖动跟手，松手保留宽度', {voiceover:vo[0],action:async()=>{
    const p=await down(ctx,left);await move(ctx,p,p.x+40);await ctx.waitFor(`document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width>=${initial.left+Math.min(35,280-initial.left)}`);const m=await metrics(ctx);ctx.assert(m.left<=280,'Sidebar drag remains bounded');
    await up(ctx,p,p.x+40);split=await metrics(ctx);
   },assert:async()=>ctx.assert(split.main>=480&&split.right>0,'Both workspaces remain usable'),screenshot:{name:'split-drag',rejectText:['Something went wrong']}});
   await ctx.prove('左侧先到边界停住，再继续拖才收起', {voiceover:vo[1],action:async()=>{
    const p=await down(ctx,left);const edge=p.x-(split.left-200);
    await move(ctx,p,edge);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).left-200)<2,'Sidebar stops at minimum');
    await move(ctx,p,edge-50);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).left-200)<2,'Short continuation does not collapse sidebar');
    await sample(ctx,'[data-slot="sidebar-gap"]');await move(ctx,p,edge-100);
    await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width<1");
    ctx.assert((await metrics(ctx)).left<1,'Sidebar collapses only after further travel, before release');await up(ctx,p,edge-100);
   },assert:async()=>{ctx.assert((await metrics(ctx)).left<1,'Sidebar collapsed');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),200,0);ctx.assert(await ctx.eval('window.__workspaceProofSidebarWidths.length>0 && Math.max(...window.__workspaceProofSidebarWidths)<=200.5'),'Visible sidebar never widens while collapsing');},screenshot:{name:'sidebar-collapsed',rejectText:['Something went wrong']}});
   await click(ctx,'[data-testid=workspace-expand-sidebar]');
   ctx.assert(Math.abs((await metrics(ctx)).left-split.left)<2,'Sidebar restored remembered width');
   await ctx.prove('导航有上限，快速越界也先停住', {voiceover:vo[2],action:async()=>{
    let p=await down(ctx,left);await move(ctx,p,p.x+400);await up(ctx,p,p.x+400);ctx.assert((await metrics(ctx)).left<=280,'Sidebar cannot maximize');
    p=await down(ctx,left);await move(ctx,p,p.x-140);await pause(300);
    ctx.assert(Math.abs((await metrics(ctx)).left-200)<2,'Fast overshoot still stops at boundary');
    await move(ctx,p,p.x-190);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).left-200)<2,'Fast-contact travel starts at actual pointer contact');
    await move(ctx,p,p.x-240);await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width<1");
    await move(ctx,p,p.x-30);await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width>100");
    await up(ctx,p,p.x-30);split=await metrics(ctx);
   },assert:async()=>ctx.assert(split.left>0,'Sidebar reverses while still held'),screenshot:{name:'sidebar-bounded',rejectText:['Something went wrong']}});
   await ctx.prove('对话区先停住，继续拖才展开操作区', {voiceover:vo[3],action:async()=>{
    const p=await down(ctx,right);const max=split.viewport-split.left-480;const edge=p.x-(max-split.right);
    await move(ctx,p,edge);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).main-480)<2,'Conversation stops at minimum');
    await move(ctx,p,edge-50);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).main-480)<2&&!((await metrics(ctx)).mainHidden),'Small continuation keeps split');
    await sample(ctx);await move(ctx,p,edge-100);await ctx.waitFor("document.querySelector('[data-testid=main-workspace]').inert");
    const m=await metrics(ctx);ctx.assert(m.main<2&&Math.abs(m.right-(m.viewport-m.left))<2,'Tools expand before release, leaving sidebar');
    await up(ctx,p,edge-100);animated(ctx,await ctx.eval('window.__workspaceProofSamples'),max,m.right);
    const q=await down(ctx,right);const restoreFrom=(await metrics(ctx)).right;await sample(ctx);await move(ctx,q,q.x+100);
    await ctx.waitFor("!document.querySelector('[data-testid=main-workspace]').inert");await up(ctx,q,q.x+100);
    animated(ctx,await ctx.eval('window.__workspaceProofSamples'),restoreFrom,split.right);
    const fast=await down(ctx,right);await move(ctx,fast,fast.x-(max-split.right)-150);await pause(300);
    ctx.assert(Math.abs((await metrics(ctx)).main-480)<2,'Fast main overshoot stops without focus');
    await move(ctx,fast,fast.x+20);await up(ctx,fast,fast.x+20);split=await metrics(ctx);
   },assert:async()=>{const m=await metrics(ctx);ctx.assert(!m.mainHidden&&!m.rightHidden&&m.sameContent,'Reverse at boundary cancels expansion and retains content');},screenshot:{name:'work-restored',rejectText:['Something went wrong']}});
   await ctx.prove('操作区先停住，继续拖才展开对话区', {voiceover:vo[4],action:async()=>{
    const p=await down(ctx,right);const edge=p.x+split.right-320;
    await move(ctx,p,edge);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).right-320)<2,'Tools stop at minimum');
    await move(ctx,p,edge+50);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).right-320)<2&&!((await metrics(ctx)).rightHidden),'Short continuation keeps tools visible');
    await sample(ctx);await move(ctx,p,edge+100);await ctx.waitFor("document.querySelector('[data-testid=right-workspace]').inert");
    ctx.assert((await metrics(ctx)).right<1,'Conversation expands after additional travel, before release');
    await move(ctx,p,edge);await ctx.waitFor("!document.querySelector('[data-testid=right-workspace]').inert");
    ctx.assert((await metrics(ctx)).sameContent,'Same held gesture reverses focus without replacing content');
    const secondEdge=edge+split.right-320;
    await move(ctx,p,secondEdge);await pause(300);ctx.assert(Math.abs((await metrics(ctx)).right-320)<2,'Restored split must stop again');
    await sample(ctx);await move(ctx,p,secondEdge+100);await ctx.waitFor("document.querySelector('[data-testid=right-workspace]').inert");await up(ctx,p,secondEdge+100);
    animated(ctx,await ctx.eval('window.__workspaceProofSamples'),320,0);ctx.assert((await metrics(ctx)).sameContent,'Right content retained while focused');
   },assert:async()=>ctx.assert(await ctx.eval("(() => {const b=document.querySelector('[data-testid=workspace-restore-split]');return !!b && b.textContent.trim()==='' && !!b.querySelector('svg');})()"),'Restore icon remains visible'),screenshot:{name:'conversation-focused',rejectText:['Something went wrong']}});
   await sample(ctx);await click(ctx,'[data-testid=workspace-restore-split]');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),0,split.right);ctx.assert(Math.abs((await metrics(ctx)).right-split.right)<2,'Restore button remembers split');
   await ctx.prove('取消拖动、键盘和减少动态效果均可用', {voiceover:vo[5],action:async()=>{
    const canceledLeft=await down(ctx,left);const edge=canceledLeft.x-(split.left-200);
    await move(ctx,canceledLeft,edge);await move(ctx,canceledLeft,edge-100);
    await ctx.eval(`document.querySelector('${left}').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))`);
    await up(ctx,canceledLeft,edge-100);ctx.assert(Math.abs((await metrics(ctx)).left-split.left)<2,'Cancel during sidebar motion restores remembered width');
    const p=await down(ctx,right);await move(ctx,p,p.x+100);
    await ctx.eval(`document.querySelector('${right}').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))`);
    await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});await pause(300);
    ctx.assert(Math.abs((await metrics(ctx)).right-split.right)<2,'Cancel rolls back width');
    await ctx.eval(`document.querySelector('${right}').focus()`);
    await ctx.client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(80);
    await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await pause(100);
    ctx.assert((await metrics(ctx)).transition==='none','Reduced motion disables transition');
    await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(100);
   },assert:async()=>{const m=await metrics(ctx);ctx.assert(!m.mainHidden&&!m.rightHidden&&Math.abs(m.right-split.right)<2,'Keyboard restores original split');},screenshot:{name:'keyboard-restored',rejectText:['Something went wrong']}});
   const viewportHeight=await ctx.eval('innerHeight');
   try {
    await ctx.prove('窄窗口单区域切换，恢复宽度后回到分栏', {voiceover:vo[6],action:async()=>{
     await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:850,height:viewportHeight,deviceScaleFactor:0,mobile:false});await pause(500);
     let m=await metrics(ctx);ctx.assert(m.right>320&&m.mainHidden,'Narrow window gives active tools usable space');
     await click(ctx,'[data-testid=workspace-restore-split]');m=await metrics(ctx);ctx.assert(m.main>480&&m.rightHidden,'Conversation remains reachable in compact mode');
     await click(ctx,'[data-testid=workspace-restore-split]');
     await ctx.client.send('Emulation.clearDeviceMetricsOverride');await pause(500);
    },assert:async()=>{const m=await metrics(ctx);ctx.assert(!m.mainHidden&&!m.rightHidden&&Math.abs(m.right-split.right)<2&&m.sameContent,`Wide split and content restored: ${JSON.stringify({m,split})}`);},screenshot:{name:'narrow-restored',rejectText:['Something went wrong']}});
   } finally {await ctx.client.send('Emulation.clearDeviceMetricsOverride');}
   await ctx.client.send('Emulation.setEmulatedMedia',{features:[]});
   await ctx.prove('按钮开合同样连续伸缩', {voiceover:vo[7],action:async()=>{
    const before=(await metrics(ctx)).right;await sample(ctx);await click(ctx,'button[aria-label="Close right panel"],button[aria-label="关闭右侧面板"]');
    ctx.assert((await metrics(ctx)).right<1,'Close button collapses tools');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),before,0);
    await sample(ctx);await click(ctx,'button[aria-label="Open right panel"],button[aria-label="打开右侧面板"]');
    const opened=(await metrics(ctx)).right;animated(ctx,await ctx.eval('window.__workspaceProofSamples'),0,opened);
   },assert:async()=>ctx.assert((await metrics(ctx)).right>100,'Tools reopen beside conversation'),screenshot:{name:'button-restored',rejectText:['Something went wrong']}});
  } finally {
   await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:100,button:'left',buttons:0,clickCount:1});
   await ctx.client.send('Emulation.setEmulatedMedia',{features:[]});
   await ctx.eval("delete window.__workspaceProofContent;delete window.__workspaceProofSamples;delete window.__workspaceProofSidebarWidths;delete window.__workspaceProofFrame;delete window.__workspaceProofFrameSrc");
  }
 }}]
};
