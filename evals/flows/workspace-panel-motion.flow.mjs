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
  await ctx.eval(`(() => {window.__workspaceProofSamples=[];let start=null;const tick=()=>{const e=document.querySelector(${JSON.stringify(selector)});const content=e.querySelector('[data-testid="workspace-panel-content"]');const rect=content?.getBoundingClientRect();const clip=content?getComputedStyle(content).clipPath:'none';const clipValues=clip.startsWith('inset(')?clip.slice(6,-1).split(' '):[];const clipRight=clipValues.length>1?parseFloat(clipValues[1]):0;const area=document.querySelector('[data-testid="main-workspace"]').parentElement.getBoundingClientRect();const visible=rect && content.getAnimations().length ? Math.max(0,Math.min(area.right,rect.right-clipRight)-Math.max(area.left,rect.left)) : e.getBoundingClientRect().width;if(start===null)start=performance.now();window.__workspaceProofSamples.push(visible);if(performance.now()-start<900)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`);
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
   await ctx.prove('左侧越界收起，恢复之前的宽度', {voiceover:vo[1],action:async()=>{
    const p=await down(ctx,left);const x=p.x-(split.left-200)-60;await sample(ctx,'[data-slot="sidebar-gap"]');await move(ctx,p,x);
    ctx.assert(await ctx.eval(`document.querySelector('${left}').dataset.snapPending==='collapse'`),'Collapse hint armed');
    await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width<1");
    ctx.assert((await metrics(ctx)).left<1,'Sidebar collapsed before pointer release');await up(ctx,p,x);
   },assert:async()=>{ctx.assert((await metrics(ctx)).left<1,'Sidebar collapsed');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),200,0);},screenshot:{name:'sidebar-collapsed',rejectText:['Something went wrong']}});
   await click(ctx,'[data-testid=workspace-expand-sidebar]');
   ctx.assert(Math.abs((await metrics(ctx)).left-split.left)<2,'Sidebar restored remembered width');
   await ctx.prove('导航宽度有上限，拖回取消收起', {voiceover:vo[2],action:async()=>{
    let p=await down(ctx,left);await move(ctx,p,p.x+400);await up(ctx,p,p.x+400);ctx.assert((await metrics(ctx)).left<=280,'Sidebar cannot maximize');
    p=await down(ctx,left);await move(ctx,p,p.x-140);ctx.assert(await ctx.eval(`document.querySelector('${left}').dataset.snapPending==='collapse'`),'Collapse candidate');
    await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width<1");
    await move(ctx,p,p.x-30);await ctx.waitFor("document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width>100");ctx.assert(await ctx.eval(`document.querySelector('${left}').dataset.snapPending!== 'collapse'`),'Candidate canceled after returning');await up(ctx,p,p.x-30);split=await metrics(ctx);
   },assert:async()=>ctx.assert(split.left>0,'Sidebar stays open'),screenshot:{name:'sidebar-bounded',rejectText:['Something went wrong']}});
   await ctx.prove('右侧平滑展开并通过拖动恢复原比例', {voiceover:vo[3],action:async()=>{
    const p=await down(ctx,right);const max=split.viewport-split.left-480;const x=p.x-(max-split.right)-60;
    await sample(ctx);await move(ctx,p,x);ctx.assert(await ctx.eval(`document.querySelector('${right}').dataset.snapPending==='expand'`),'Expand hint armed');
    await ctx.waitFor("document.querySelector('[data-testid=main-workspace]').inert");ctx.assert((await metrics(ctx)).main<2,'Tools expanded before pointer release');await up(ctx,p,x);const m=await metrics(ctx);animated(ctx,await ctx.eval('window.__workspaceProofSamples'),split.right,m.right);
    ctx.assert(m.mainHidden&&m.main<2&&Math.abs(m.right-(m.viewport-m.left))<2,'Work region occupies workspace, navigation remains');
    const held=await down(ctx,right);await move(ctx,held,held.x+60);await ctx.waitFor("!document.querySelector('[data-testid=main-workspace]').inert");
    ctx.assert(Math.abs((await metrics(ctx)).right-split.right)<2,'Held gesture restores split');
    await move(ctx,held,held.x+60+split.right-320+60);await ctx.waitFor("document.querySelector('[data-testid=right-workspace]').inert");
    ctx.assert((await metrics(ctx)).right<1,'Same gesture can collapse tools');
    await move(ctx,held,held.x+60+split.right-320);await ctx.waitFor("!document.querySelector('[data-testid=right-workspace]').inert");
    ctx.assert(Math.abs((await metrics(ctx)).right-split.right)<2,'Same gesture reverses conversation focus');await up(ctx,held,held.x+60+split.right-320);
    const again=await down(ctx,right);await move(ctx,again,again.x-(max-split.right)-60);await ctx.waitFor("document.querySelector('[data-testid=main-workspace]').inert");await up(ctx,again,again.x-(max-split.right)-60);
    const q=await down(ctx,right);const restoreFrom=(await metrics(ctx)).right;await sample(ctx);await move(ctx,q,q.x+60);await ctx.waitFor("!document.querySelector('[data-testid=main-workspace]').inert");await up(ctx,q,q.x+60);animated(ctx,await ctx.eval('window.__workspaceProofSamples'),restoreFrom,split.right);
   },assert:async()=>{const m=await metrics(ctx);ctx.assert(Math.abs(m.right-split.right)<2&&!m.mainHidden&&m.sameContent,'Original split and content restored');},screenshot:{name:'work-restored',rejectText:['Something went wrong']}});
   await ctx.prove('对话平滑展开，右侧内容保留', {voiceover:vo[4],action:async()=>{
    const p=await down(ctx,right);const x=p.x+split.right-320+60;await sample(ctx);await move(ctx,p,x);
    ctx.assert(await ctx.eval(`document.querySelector('${right}').dataset.snapPending==='collapse'`),'Conversation focus hint armed');
    await ctx.waitFor("document.querySelector('[data-testid=right-workspace]').inert");ctx.assert((await metrics(ctx)).right<1,'Conversation expanded before pointer release');await up(ctx,p,x);const m=await metrics(ctx);animated(ctx,await ctx.eval('window.__workspaceProofSamples'),split.right,0);ctx.assert(m.rightHidden&&m.right<1&&m.sameContent,'Right content retained while hidden');
   },assert:async()=>ctx.assert(await ctx.eval("(() => {const button=document.querySelector('[data-testid=workspace-restore-split]');return !!button && button.textContent.trim()==='' && !!button.querySelector('svg') && !!button.getAttribute('aria-label');})()"),'Restore action remains visible'),screenshot:{name:'conversation-focused',rejectText:['Something went wrong']}});
   await sample(ctx);await click(ctx,'[data-testid=workspace-restore-split]');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),0,split.right);ctx.assert(Math.abs((await metrics(ctx)).right-split.right)<2,'Restore button remembers split');
   await ctx.prove('取消拖动、键盘和减少动态效果均可用', {voiceover:vo[5],action:async()=>{
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
    },assert:async()=>{const m=await metrics(ctx);ctx.assert(!m.mainHidden&&!m.rightHidden&&Math.abs(m.right-split.right)<2&&m.sameContent,'Wide split and content restored');},screenshot:{name:'narrow-restored',rejectText:['Something went wrong']}});
   } finally {await ctx.client.send('Emulation.clearDeviceMetricsOverride');}
   await ctx.client.send('Emulation.setEmulatedMedia',{features:[]});
   await ctx.prove('按钮开合同样连续伸缩', {voiceover:vo[7],action:async()=>{
    const before=(await metrics(ctx)).right;await sample(ctx);await click(ctx,'button[aria-label="Close right panel"],button[aria-label="关闭右侧面板"]');
    ctx.assert((await metrics(ctx)).right<1,'Close button collapses tools');animated(ctx,await ctx.eval('window.__workspaceProofSamples'),before,0);
    await sample(ctx);await click(ctx,'button[aria-label="Open right panel"],button[aria-label="打开右侧面板"]');
    const opened=(await metrics(ctx)).right;animated(ctx,await ctx.eval('window.__workspaceProofSamples'),0,opened);
   },assert:async()=>ctx.assert((await metrics(ctx)).right>100,'Tools reopen beside conversation'),screenshot:{name:'button-restored',rejectText:['Something went wrong']}});
  } finally {
   await ctx.client.send('Emulation.setEmulatedMedia',{features:[]});
   await ctx.eval("delete window.__workspaceProofContent;delete window.__workspaceProofSamples;delete window.__workspaceProofFrame;delete window.__workspaceProofFrameSrc");
  }
 }}]
};
