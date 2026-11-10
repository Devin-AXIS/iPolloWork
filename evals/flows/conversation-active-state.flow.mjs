import { mountFixture } from "./conversation-streaming-result.flow.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("conversation-active-state");
const host = "#streaming-answer-proof";
const heading = `${host} .chat-process-heading[aria-expanded]`;
const phase = (ctx, name, text) => ctx.eval(`window.__streamingAnswerProof.showAgentPhase(${JSON.stringify(name)}${text === undefined ? "" : ","+JSON.stringify(text)})`);
const clickProcess = ctx => ctx.eval(`document.querySelector(${JSON.stringify(heading)}).click()`);
export default {
  id: "conversation-active-state", title: "Compact process, stable response, truthful delivery and restrained motion", kind: "user-facing", preserveTheme: true,
  steps: [
    { name: "Compact thinking", run: ctx => ctx.prove("Long reasoning stays closed behind one active status", {
      voiceover: vo[0], action: async () => {
        await ctx.client.send("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
        await ctx.eval(`(${mountFixture.toString()})({scrolling:true})`, {awaitPromise:true});
        await ctx.waitFor("Boolean(window.__streamingAnswerProof?.showAgentPhase)");
        await phase(ctx,"thinking");
        await ctx.waitFor(`document.querySelector('${host} [data-testid=assistant-current-state]')?.textContent.includes('正在思考')`);
      }, assert: async () => {
        const s=await ctx.eval(`(()=>{const h=document.querySelector('${host}'),d=h.querySelector('.chat-process-disclosure');return {open:d.dataset.open,inert:d.inert,height:d.getBoundingClientRect().height,pulses:h.querySelectorAll('.chat-live-activity').length,text:h.innerText,animation:getComputedStyle(h.querySelector('.chat-live-activity')).animationName}})()`);
        ctx.assert(s.open==='false'&&s.inert&&s.height<1&&s.pulses===1&&!s.text.includes('generationPath')&&s.animation==='chat-live-activity',JSON.stringify(s));
      }, screenshot:{name:"compact-thinking",requireText:["正在思考"],rejectText:["generationPath"]},
    })},
    { name: "User-controlled disclosure", run: ctx => ctx.prove("Process reveals with a bounded transition and retains manual expansion", {
      voiceover:vo[1],action:()=>clickProcess(ctx),assert:async()=>{
        await ctx.waitFor(`document.querySelector('${host} .chat-process-disclosure').getBoundingClientRect().height>100`);
        const s=await ctx.eval(`(()=>{const d=document.querySelector('${host} .chat-process-disclosure');return {height:d.getBoundingClientRect().height,inert:d.inert,transition:getComputedStyle(d).transitionDuration}})()`);
        ctx.assert(!s.inert&&s.height<=440&&s.transition.includes('0.18'),JSON.stringify(s));
        await phase(ctx,"tools");
        await ctx.waitFor(`document.querySelector('${host} .chat-process-disclosure')?.dataset.open==='true'`);
      },screenshot:{name:"expanded-process",requireText:["generationPath","正在生成图片"]},
    })},
    { name: "Tool activity and approval",run:ctx=>ctx.prove("Tool updates have one active icon; approval stops motion",{
      voiceover:vo[2],action:async()=>{await clickProcess(ctx);await phase(ctx,"tools");},assert:async()=>{
        await ctx.waitFor(`document.querySelector('${host} [data-testid=assistant-current-state]')?.textContent.includes('正在生成图片')`);
        ctx.assert(await ctx.eval(`document.querySelectorAll('${host} .chat-live-activity').length===1&&!document.querySelector('${host} [data-assistant-result]')`),"One active status and no final answer during tools");
        ctx.assert(await ctx.eval(`document.querySelectorAll('${host} .chat-tool-pulse').length===0&&[...document.querySelectorAll('${host} [data-testid=assistant-tool-action] button')].every(n=>n.getAttribute('aria-expanded')==='false')`),"Only the shared status pulses; tool summaries start collapsed");
        ctx.assert(await ctx.eval(`(()=>{const h=document.querySelector('${host}'),p=h.querySelector('[data-testid=assistant-progress-timeline]');return p?.innerText.includes('研究已完成')&&p.checkVisibility()&&h.querySelector('.chat-process-disclosure').dataset.open==='false'&&!!p.querySelector('[data-testid=assistant-tool-action]')&&[...p.querySelectorAll('pre')].every(n=>!n.checkVisibility())})()`),"Progress narration and tool summaries remain visible with reasoning and code collapsed");
        await ctx.waitFor(`document.querySelector('${host} .chat-process-disclosure').getBoundingClientRect().height<1`);
        const pulse = await ctx.eval(`(()=>{const n=document.querySelector('${host} .chat-live-activity');const k=n.getAnimations()[0].effect.getKeyframes();return k.map(f=>({opacity:Number(f.opacity),transform:f.transform}))})()`);
        ctx.assert(Math.max(...pulse.map(k=>k.opacity))-Math.min(...pulse.map(k=>k.opacity))>=0.6&&pulse.every(k=>!k.transform||k.transform==='none'),"Pulse changes opacity without scaling");
        await phase(ctx,"approval");
        await ctx.waitFor(`document.querySelector('${host} [data-testid=assistant-current-state]')?.textContent.includes('等待你确认')`);
        ctx.assert(await ctx.eval(`document.querySelectorAll('${host} .chat-live-activity').length===0`),"Approval is waiting, not running");
        ctx.assert(await ctx.eval(`document.querySelectorAll('${host} .chat-tool-pulse').length===0`),"Approval pauses tool pulse");
      },screenshot:{name:"waiting-for-confirmation",requireText:["等待你确认"]},
    })},
    {name:"Inspectable response draft",run:ctx=>ctx.prove("Unclassified agent text is a draft, not a final response",{
      voiceover:vo[3],action:async()=>{await phase(ctx,"draft");await clickProcess(ctx);},assert:async()=>{
        await ctx.waitFor(`Boolean(document.querySelector('${host} [data-testid=assistant-reply-draft]'))`);
        await ctx.waitFor(`Boolean(document.querySelector('${host} [data-testid=assistant-live-tool][data-phase=confirmed]'))`);
        await ctx.waitFor(`!document.querySelector('${host} [data-testid=assistant-live-tool]')`);
        const s=await ctx.eval(`({answer:!!document.querySelector('${host} [data-assistant-result]'),draft:document.querySelector('${host} [data-testid=assistant-reply-draft]')?.textContent,codeVisible:document.querySelector('${host} pre')?.checkVisibility()})`);
        ctx.assert(!s.answer&&s.draft.includes('三张配图')&&!s.codeVisible,JSON.stringify(s));
      },screenshot:{name:"inspectable-draft",requireText:["回复草稿","三张配图"]},
    })},
    {name:"Stable streamed answer",run:ctx=>ctx.prove("Final answer grows in the same DOM node without process text",{
      voiceover:vo[4],action:async()=>{await clickProcess(ctx);await phase(ctx,"answer","三张配图已生成，");},assert:async()=>{
        await ctx.waitFor(`document.querySelector('${host} [data-assistant-result]')?.textContent.includes('三张配图')`);
        await ctx.eval(`void(window.__compactAnswerNode=document.querySelector('${host} [data-assistant-result]'))`);
        await phase(ctx,"answer","三张配图已生成，正在核对报告与配图。 ");
        await ctx.waitFor(`document.querySelector('${host} [data-assistant-result]')?.textContent.includes('正在核对报告')`);
        ctx.assert(await ctx.eval(`window.__compactAnswerNode===document.querySelector('${host} [data-assistant-result]')&&!document.querySelector('${host} [data-assistant-result]').innerText.includes('generationPath')&&!document.querySelector('${host} [data-testid=artifact-file-card]')`),"Stable answer with no raw execution details or premature cards");
      },screenshot:{name:"stable-final-answer",requireText:["正在回复","正在核对报告"]},
    })},
    {name:"Post-processing then delivery",run:ctx=>ctx.prove("Export remains active and cards enter only after completion",{
      voiceover:vo[5],action:async()=>{await phase(ctx,"finishing");await ctx.waitFor(`document.querySelector('${host} [data-testid=assistant-current-state]')?.textContent.includes('正在收尾')`);await ctx.screenshot("post-processing",{voiceover:vo[5],claim:"Export is still running",requireText:["正在收尾"]});await phase(ctx,"done");},assert:async()=>{
        await ctx.waitFor(`Boolean(document.querySelector('${host} [data-testid=artifact-file-card]'))`);
        await ctx.waitFor(`!document.querySelector('${host} [data-testid=assistant-live-tool]')`);
        ctx.assert(await ctx.eval(`document.querySelector('${host} .chat-process-disclosure').querySelectorAll('[data-testid=assistant-tool-action]').length===3&&document.querySelector('${host} [data-testid=assistant-progress-timeline]').innerText.includes('研究已完成')`),"Completed tools move to closed history; progress text remains visible");
        const s=await ctx.eval(`({animated:document.querySelector('${host} .chat-result-enter')?getComputedStyle(document.querySelector('${host} .chat-result-enter')).animationName:null,pulses:document.querySelectorAll('${host} .chat-live-activity').length,collapsed:document.querySelector('${host} .chat-process-disclosure').dataset.open})`);
        ctx.assert(s.animated==='chat-content-enter'&&s.pulses===0&&s.collapsed==='false',JSON.stringify(s));
        await ctx.eval(`document.querySelector('${host} [data-testid=artifact-file-card]').click()`);
        ctx.assert(await ctx.eval("Boolean(window.__streamingAnswerProof.openedPath)"),"Completed file opens");
      },screenshot:{name:"delivered-results",requireText:["三张配图","report.pdf"]},
    })},
    {name:"Stopped and reduced motion",run:ctx=>ctx.prove("Stopped runs and reduced motion have no continuing animation",{
      voiceover:vo[6],action:async()=>{await phase(ctx,"stopped");await ctx.waitFor(`document.querySelector('${host} [data-testid=assistant-current-state]')?.textContent.includes('已停止')`);await ctx.client.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});await phase(ctx,"tools");await clickProcess(ctx);},assert:async()=>{
        await ctx.waitFor(`document.querySelector('${host} .chat-process-disclosure')?.dataset.open==='true'`);
        const s=await ctx.eval(`(()=>{const h=document.querySelector('${host}');return {animation:getComputedStyle(h.querySelector('.chat-live-activity')).animationName,transition:getComputedStyle(h.querySelector('.chat-process-disclosure')).transitionDuration,spinners:[...h.querySelectorAll('.animate-spin,.chat-tool-pulse')].map(n=>getComputedStyle(n).animationName)}})()`);
        ctx.assert(s.animation==='none'&&s.transition==='0s'&&s.spinners.every(n=>n==='none'),JSON.stringify(s));
      },screenshot:{name:"reduced-motion",requireText:["正在生成图片"]},
    })},
    {name:"Reading position stays put",run:ctx=>ctx.prove("Selection holds reading position while output grows; jump returns to latest",{
      voiceover:vo[7],action:async()=>{
        await ctx.eval("window.__streamingAnswerProof.showLongAnswer();window.__streamingAnswerProof.scrollStore.getState().setStickyBottom('proof',null)");
        await ctx.waitFor(`document.querySelector('${host}').scrollHeight>innerHeight*2`);
        await ctx.eval(`(()=>{const h=document.querySelector('${host}');h.scrollTop=200;const p=[...h.querySelectorAll('p')].find(n=>n.getBoundingClientRect().top>80);const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));window.__heldChatTop=h.scrollTop;})()`);
        await ctx.waitFor("window.__streamingAnswerProof.scrollStore.getState().sessions.proof?.mode==='manual'");
        await ctx.eval("window.__streamingAnswerProof.appendLongAnswer()");
      },assert:async()=>{
        await ctx.waitFor(`document.querySelector('${host}').innerText.includes('新增内容')`);
        const delta=await ctx.eval(`Math.abs(document.querySelector('${host}').scrollTop-window.__heldChatTop)`);ctx.assert(delta<=2,`Reading position drift: ${delta}`);
        await ctx.eval("getSelection().removeAllRanges();window.__streamingAnswerProof.scroll.jumpToLatest('smooth')");
        await ctx.waitFor(`(()=>{const h=document.querySelector('${host}');return h.scrollHeight-h.clientHeight-h.scrollTop<2})()`);
      },screenshot:{name:"stable-reading-and-jump",requireText:["新增内容"]},
    })},
    {name:"Release fixture",run:async ctx=>{await ctx.eval("window.__streamingAnswerProof?.cleanup?.()");await ctx.client.send("Emulation.setEmulatedMedia",{features:[]});}},
  ],
};
