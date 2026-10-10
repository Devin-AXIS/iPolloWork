import { mountFixture } from './conversation-streaming-result.flow.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
const vo = await loadVoiceoverParagraphs('conversation-active-state');
const state = `(() => {const h=document.querySelector('#streaming-answer-proof');const s=h.querySelector('[data-testid=assistant-current-state]');return {label:s?.textContent,pulse:s?getComputedStyle(s).animationName:null,pulses:h.querySelectorAll('.chat-live-activity').length,pending:h.querySelectorAll('[data-testid=assistant-result-pending]').length,body:[...h.querySelectorAll('[data-assistant-result]')].map(n=>n.textContent)};})()`;
export default {
 id:'conversation-active-state', title:'Streaming text stays in place and only the current state pulses',kind:'user-facing',preserveTheme:true,
 steps:[
 {name:'Current reasoning and tool state',run:ctx=>ctx.prove('One current state pulses and no duplicate thinking placeholder appears',{
 voiceover:vo[0],action:()=>ctx.eval(`(${mountFixture.toString()})()`,{awaitPromise:true}),assert:async()=>{
 await ctx.waitFor(`Boolean(window.__streamingAnswerProof?.showOpenCodePhase)`);
 for(const [phase,label] of [['reasoning','正在思考'],['tool','检查项目文件']]){
 await ctx.eval(`window.__streamingAnswerProof.showOpenCodePhase('${phase}')`);
 await ctx.waitFor(`document.querySelector('#streaming-answer-proof [data-testid=assistant-current-state]')?.textContent.includes('${label}')`);
 const s=await ctx.eval(state);ctx.assert(s.pulses===1&&s.pending===0&&s.pulse==='chat-live-activity',JSON.stringify(s));ctx.recordEvidence({type:'assertion',status:'passed',assertion:phase+' current state only',actual:s});
 }
 },screenshot:{name:'current-tool',requireText:['检查项目文件']}})},
 {name:'Unphased text retains DOM through later tools and completion',run:ctx=>ctx.prove('OpenCode text streams in one body and both text nodes survive completion',{
 voiceover:vo[1],action:async()=>{
 await ctx.eval(`window.__streamingAnswerProof.showOpenCodePhase('answer')`);
 await ctx.waitFor(`document.querySelector('#streaming-answer-proof [data-assistant-result]')?.textContent.includes('已找到相关文件。')`);
 await ctx.eval(`void(window.__stableText=document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-assistant]'))`);
 },assert:async()=>{
 const s=await ctx.eval(state);ctx.assert(s.label.includes('正在回复')&&s.pulses===1&&s.pending===0,JSON.stringify(s));
 await ctx.eval(`window.__streamingAnswerProof.appendOpenCodeStep()`);
 await ctx.waitFor(`document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-final]')?.textContent.includes('目录确认完成。')`);
 ctx.assert(await ctx.eval(`window.__stableText===document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-assistant]')`),'First body node survived subsequent tool/text');
 await ctx.eval(`void(window.__stableFinal=document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-final]'))`);
 await ctx.eval(`window.__streamingAnswerProof.finishOpenCode()`);
 await ctx.waitFor(`!document.querySelector('#streaming-answer-proof .chat-live-activity')`);
 ctx.assert(await ctx.eval(`window.__stableText===document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-assistant]')&&window.__stableFinal===document.querySelector('#streaming-answer-proof [data-message-id=opencode-proof-final]')`),'Both body nodes survived completion');
 const done=await ctx.eval(state);ctx.assert(done.body.length===2&&done.pulses===0&&done.pending===0,JSON.stringify(done));ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Stable streamed body before and after completion',actual:done});
 },screenshot:{name:'stable-completed-text',requireText:['已找到相关文件。','目录确认完成。']}})},
 {name:'Post-processing pulses and interrupted history stops',run:ctx=>ctx.prove('Finishing pulses while actual work remains; interrupted history has no animated status or spinners',{
 voiceover:vo[2],action:async()=>{
 await ctx.eval(`window.__streamingAnswerProof.showCompletedWhilePostProcessing()`);
 await ctx.waitFor(`document.querySelector('#streaming-answer-proof [data-testid=assistant-current-state]')?.textContent.includes('正在收尾')`);
 const processing=await ctx.eval(state);ctx.assert(processing.pulses===1,JSON.stringify(processing));ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Post-processing remains active',actual:processing});
 await ctx.eval(`window.__streamingAnswerProof.showHistoricalInterruption()`);
 await ctx.waitFor(`!document.querySelector('#streaming-answer-proof .chat-live-activity')`);
 },assert:async()=>{
 const s=await ctx.eval(state);ctx.assert(s.pulses===0&&s.pending===0,JSON.stringify(s));
 const animations=await ctx.eval(`Array.from(document.querySelectorAll('#streaming-answer-proof .animate-spin')).map(n=>getComputedStyle(n).animationName)`);ctx.assert(animations.every(a=>a==='none'),JSON.stringify(animations));
 },screenshot:{name:'static-interrupted-history',requireText:['已完成部分内容。']}})}
 ,{name:'Compact image file card',run:ctx=>ctx.prove('Image file card shows a contained 64×44 thumbnail with two-line title and hover actions',{
 voiceover:vo[3],action:async()=>{
 await ctx.eval(`window.__streamingAnswerProof.showUnmatchedImage()`);
 await ctx.waitFor(`Boolean(document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]'))`);
 await ctx.eval(`document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]').scrollIntoView({block:'center'})`);
 await ctx.waitFor(`document.querySelector('#streaming-answer-proof .artifact-thumbnail')?.naturalWidth>0`);
 },assert:async()=>{
 const s=await ctx.eval(`(() => {const c=document.querySelector('#streaming-answer-proof [data-testid=artifact-file-card]');const i=c.querySelector('[data-artifact-thumbnail]');const title=c.querySelector('.chat-output-title');const a=c.parentElement.querySelector('[data-testid=artifact-file-actions]');return {card:c.getBoundingClientRect().toJSON(),thumb:i.getBoundingClientRect().toJSON(),fit:getComputedStyle(i.querySelector('img')).objectFit,lines:getComputedStyle(title).webkitLineClamp,actionsOpacity:getComputedStyle(a).opacity,border:getComputedStyle(c).borderTopWidth,shadow:getComputedStyle(c).boxShadow,background:getComputedStyle(c).backgroundColor,surface:getComputedStyle(document.querySelector('#streaming-answer-proof')).backgroundColor,actionShadow:getComputedStyle(a).boxShadow,buttonBackground:getComputedStyle(a.querySelector('button')).backgroundColor,buttonShadow:getComputedStyle(a.querySelector('button')).boxShadow};})()`);
 ctx.assert(s.card.height===64&&s.thumb.width===64&&s.thumb.height===44&&s.fit==='contain'&&s.lines==='2'&&s.border==='1px'&&s.shadow==='none'&&s.actionShadow==='none'&&s.background===s.surface&&s.buttonBackground==='rgba(0, 0, 0, 0)'&&s.buttonShadow==='none',JSON.stringify(s));
 await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:s.card.left+20,y:s.card.top+20});
 await ctx.waitFor(`getComputedStyle(document.querySelector('#streaming-answer-proof [data-testid=artifact-file-actions]')).opacity==='1'`);
 ctx.recordEvidence({type:'assertion',status:'passed',assertion:'Compact card thumbnail and hover',actual:s});
 },screenshot:{name:'compact-thumbnail-card',requireText:['cover.png']}})}
 ,{name:'Release fixture' ,run:ctx=>ctx.eval(`window.__streamingAnswerProof?.cleanup?.()`)}
 ]
};
