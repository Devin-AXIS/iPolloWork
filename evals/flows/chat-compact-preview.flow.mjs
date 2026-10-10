import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
const vo = await loadVoiceoverParagraphs('chat-compact-preview');
const route = process.env.IPOLLOWORK_EVAL_CHAT_ROUTE;
const geometry = `(() => {
 const rect = el => { const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}; };
 const composer=document.querySelector('.composer-card');
 const columns=[...document.querySelectorAll('[data-testid="assistant-process-column"],[data-testid="assistant-message-column"],[data-testid="assistant-streaming-previews"]')];
 const bubble=[...document.querySelectorAll('[data-testid="user-message-bubble"]')].at(-1);
 const card=document.querySelector('[data-testid="artifact-file-card"]');
 if(!composer||!columns.length||!bubble||!card)return null;
 return {composer:rect(composer),lefts:columns.map(el=>rect(el).left+parseFloat(getComputedStyle(el).paddingLeft)),bubble:rect(bubble),card:rect(card),overflow:document.documentElement.scrollWidth>innerWidth};
})()`;
async function size(ctx,width){
 await ctx.client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 await ctx.waitFor(`innerWidth === ${width}`,{label:'viewport reflow'});
 await ctx.eval(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`,{awaitPromise:true});
}
function aligned(ctx,g){
 ctx.assert(g,'All live conversation targets exist');
 ctx.assert(g.lefts.every(x=>Math.abs(x-g.composer.left)<=1),'Assistant columns align with composer');
 ctx.assert(Math.abs(g.card.left-g.composer.left)<=1,'File card left aligns with composer');
 ctx.assert(Math.abs(g.bubble.right-g.composer.right)<=1,'User bubble right aligns with composer');
 ctx.assert(!g.overflow,'No horizontal document overflow');
 ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Live content and composer share edges',actual:g});
}
export default {
 id:'chat-compact-preview',title:'Compact aligned conversation with complete image previews',kind:'user-facing',preserveTheme:true,
 requiredEnv:['IPOLLOWORK_EVAL_CHAT_ROUTE','IPOLLOWORK_EVAL_TYPOGRAPHY_ROUTE'],
 steps:[
 {name:'Shared conversation edges',run:async ctx=>ctx.prove('Messages and file cards align with the composer at desktop width',{
 voiceover:vo[0],action:async()=>{
 await ctx.client.send('Page.bringToFront');await ctx.client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await size(ctx,1104);await ctx.client.send('Page.navigate',{url:new URL(route,await ctx.eval('location.origin')).href});
 await ctx.waitFor(`Boolean(document.querySelector('[data-testid="artifact-file-card"]'))`,{timeoutMs:60000,label:'persisted conversation'});
 await ctx.waitFor(`!document.querySelector('[data-testid="startup-logo-animation"]')`,{timeoutMs:60000,label:'startup overlay removed'});
 await ctx.waitFor(`(() => {const b=[...document.querySelectorAll('[data-testid="user-message-bubble"]')].at(-1);const c=document.querySelector('.composer-card');return b?.textContent.includes('测试一下排队的效果')&&Math.abs(b.getBoundingClientRect().right-c.getBoundingClientRect().right)<=1;})()`,{label:'conversation navigation and layout settled'});
 await ctx.eval(`document.querySelector('[data-testid="artifact-file-card"]').scrollIntoView({block:'center',behavior:'instant'})`);
 },assert:async()=>aligned(ctx,await ctx.eval(geometry)),screenshot:{name:'aligned-chat',requireText:['测试一下排队的效果','本轮生成的文件'],rejectText:['Loading...']}})},
 {name:'Compact conversation spacing',run:async ctx=>ctx.prove('Turn spacing is compact while readable body text remains comfortable',{
 voiceover:vo[1],action:async()=>{await size(ctx,960);await ctx.eval(`document.querySelector('[data-testid="user-message-bubble"]').scrollIntoView({block:'center',behavior:'instant'})`);},
 assert:async()=>{
 const m=await ctx.eval(`(() => {const turn=document.querySelector('[data-message-role="user"]'); const group=[...document.querySelectorAll('[data-testid="assistant-message-group"]')].at(-1); const text=document.querySelector('[data-chat-readable-text="true"]');return {turnMargin:parseFloat(getComputedStyle(turn.parentElement).marginTop),groupGap:parseFloat(getComputedStyle(group).gap),fontSize:parseFloat(getComputedStyle(text).fontSize),lineHeight:parseFloat(getComputedStyle(text).lineHeight)};})()`);
 ctx.assert(m.turnMargin<=16&&m.groupGap<=8,'Turn and group spacing are compact');ctx.assert(m.fontSize===13&&m.lineHeight===20,'Body typography remains readable');ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Compact spacing and readable text',actual:m});
 },screenshot:{name:'compact-spacing',requireText:['测试一下排队的效果','本次任务未完成']}})},
 {name:'Complete image thumbnail and keyboard toggle',run:async ctx=>ctx.prove('Full image fits 420×260 and keyboard expansion and collapse work',{
 voiceover:vo[2],action:async()=>{
 await ctx.waitFor(`(() => {const i=document.querySelector('[data-chat-transcript] img');return i?.naturalWidth>0;})()`,{label:'decoded persisted image'});
 await ctx.eval(`document.querySelector('[data-chat-transcript] img').scrollIntoView({block:'center',behavior:'instant'})`);
 },assert:async()=>{
 const measure=()=>ctx.eval(`(() => {const i=document.querySelector('[data-chat-transcript] img');const r=i.getBoundingClientRect();return {w:r.width,h:r.height,ratio:i.naturalWidth/i.naturalHeight,expanded:i.closest('button')?.getAttribute('aria-expanded')};})()`);
 const before=await measure();ctx.assert(before.w<=420&&before.h<=260,'Thumbnail bounded by 420×260');ctx.assert(Math.abs(before.w/before.h-before.ratio)<0.01,'Image retains whole intrinsic ratio');
 await ctx.eval(`document.querySelector('[data-chat-transcript] img').closest('button').focus()`);
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await ctx.waitFor(`document.querySelector('[data-chat-transcript] img').closest('button').getAttribute('aria-expanded')==='true'`);
 const after=await measure();ctx.assert(after.w>before.w&&after.h>before.h,'Expansion shows larger image');
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await ctx.waitFor(`document.querySelector('[data-chat-transcript] img').closest('button').getAttribute('aria-expanded')==='false'`);
 ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Image is complete and keyboard toggles full view',actual:{before,after}});
 },screenshot:{name:'complete-image-preview',requireText:['查看完整图片','本轮生成的文件']}})},
 {name:'Refined details and narrow layout',run:async ctx=>ctx.prove('Compact composer and cards stay aligned in a narrow window',{
 voiceover:vo[3],action:async()=>{await size(ctx,620);await ctx.eval(`document.querySelector('[data-testid="artifact-file-card"]').scrollIntoView({block:'center',behavior:'instant'})`);},assert:async()=>{
 aligned(ctx,await ctx.eval(geometry));
 const m=await ctx.eval(`(() => {const i=document.querySelector('[data-chat-transcript] img'); const icon=document.querySelector('.chat-output-icon');const b=document.querySelector('[data-testid="user-message-bubble"]');const c=document.querySelector('.composer-card');return {image:i.getBoundingClientRect().toJSON(),parent:i.closest('button').getBoundingClientRect().toJSON(),icon:icon.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(b).paddingLeft),radius:parseFloat(getComputedStyle(b).borderRadius),composerHeight:c.getBoundingClientRect().height};})()`);
 ctx.assert(m.image.right<=m.parent.right+1,'Thumbnail fits narrow content width');ctx.assert(m.icon===32&&m.padding===16&&m.radius>=12&&m.radius<=16,'File icon and bubble detail sizes');ctx.assert(m.composerHeight<=100,'Empty composer is about96px');ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Narrow layout and compact details',actual:m});
 },screenshot:{name:'narrow-compact-chat',requireText:['本轮生成的文件','测试一下排队的效果']}})}
 ,{name:'Shared typography in real explanatory response',run:ctx=>ctx.prove('Body, headings, code, metadata and composer use shared roles with consistent spacing',{
 voiceover:vo[4],action:async()=>{await size(ctx,1104);await ctx.client.send('Page.navigate',{url:new URL(process.env.IPOLLOWORK_EVAL_TYPOGRAPHY_ROUTE,await ctx.eval('location.origin')).href});await ctx.waitFor(`Array.from(document.querySelectorAll('.markdown-content h2')).some(n=>n.textContent.includes('本地 API'))`);await ctx.waitFor(`!document.querySelector('[data-testid="startup-logo-animation"]')`);await ctx.eval(`Array.from(document.querySelectorAll('.markdown-content h2')).find(n=>n.textContent.includes('本地 API')).scrollIntoView({block:'center'})`);},
 assert:async()=>{
 const s=await ctx.eval(`(() => {const m=[...document.querySelectorAll('.markdown-content')].at(-1);const read=n=>{const s=getComputedStyle(n);return {tag:n.tagName,size:s.fontSize,line:s.lineHeight,weight:s.fontWeight,top:s.marginTop,bottom:s.marginBottom}};return {body:[...m.querySelectorAll('p,li')].map(read),headings:[...m.querySelectorAll('h2')].map(read),code:[...m.querySelectorAll('code')].map(read),strong:[...m.querySelectorAll('strong')].map(read),blocks:[...m.children].map(read),items:[...m.querySelectorAll('li')].map(read),editor:read(document.querySelector('[contenteditable=true][data-lexical-editor=true]')),meta:[...document.querySelectorAll('.chat-process-heading')].map(read)};})()`);
 ctx.assert(s.body.length>0&&s.headings.length>0&&s.code.length>0,'Real explanation includes paragraphs, lists, heading and code');
 ctx.assert(s.body.every(n=>n.size==='13px'&&n.line==='20px'&&n.weight==='400'),'Body uses shared 13/20 regular');ctx.assert(s.headings.every(n=>n.size==='14px'&&n.line==='20px'&&n.weight==='600'),'Section headings use shared 14/20 semibold');ctx.assert(s.code.every(n=>n.size==='13px'&&n.line==='20px'),'Code matches body size and line height');ctx.assert(s.strong.every(n=>n.size==='13px'&&n.weight==='600'),'Emphasis changes weight only');
 ctx.assert(s.blocks.every((n,i)=>n.bottom==='0px'&&n.top===(i===0?'0px':n.tag==='H2'?'16px':'8px')),'Block spacing follows 8/16 rhythm');ctx.assert(s.items.every(n=>n.bottom==='0px'&&['0px','4px'].includes(n.top)),'List rows use 4px gap without paragraph margins');ctx.assert(s.editor.size==='13px'&&s.editor.line==='20px','Composer shares body typography');ctx.assert(s.meta.every(n=>n.size==='12px'&&n.line==='18px'),'Status uses shared Meta');ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Real response uses shared typography',actual:s});
 },screenshot:{name:'shared-chat-typography',requireText:['本地 API','sidecar']}})}
 ]
};
