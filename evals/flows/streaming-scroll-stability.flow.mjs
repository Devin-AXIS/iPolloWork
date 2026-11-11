import { mountFixture } from "./conversation-streaming-result.flow.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "streaming-scroll-stability";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const PROMPT = "滚动稳定性验证：不要调用工具或创建文件。直接逐条输出 180 条 Markdown 列表，每条独占一行，格式为‘- 第 N 项：稳定输出，用于验证长回复持续增长时，用户可以自由阅读前面的内容而不会被拉回底部。’。不要省略，不要合并，不要总结。";
const fixture = process.env.IPOLLOWORK_EVAL_STREAMING_FIXTURE === "1";
const draft = process.env.IPOLLOWORK_EVAL_STREAMING_DRAFT === "1";
const scroll = fixture ? "document.querySelector('#streaming-answer-proof')" : "document.querySelector('[data-testid=session-message-scroll]')";
const running = fixture ? "Boolean(document.querySelector('#streaming-answer-proof .chat-live-activity'))" : "window.__ipolloworkControl.listActions().some(a=>a.id==='composer.stop'&&!a.disabled)";
const chars = `[...${scroll}.querySelectorAll('[data-message-role=assistant]')].reduce((n,e)=>n+e.innerText.length,0)`;

export default {
  id: FLOW_ID,
  title: fixture ? `Deterministic streaming replay: ${draft ? "draft promotion" : "final answer"} preserves reading` : "Live streaming output respects manual scrolling and completion",
  kind: "user-facing",
  precondition: async ctx => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
    return null;
  },
  steps: [{
    name: "Continuous scrolling remains stable while output grows",
    run: async ctx => {
      let sessionHash;
      const wheel = async deltaY => {
        const p = await ctx.eval(`(()=>{const r=${scroll}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,top:${scroll}.scrollTop}})()`);
        await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x:p.x, y:p.y, deltaX: 0, deltaY });
        if(Math.abs(deltaY)>100) {
          await ctx.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))", {awaitPromise:true});
          await ctx.waitFor(`${scroll}.scrollHeight-${scroll}.clientHeight-${scroll}.scrollTop>150 && Boolean(document.querySelector('[data-testid=jump-to-latest]'))`, {label:"native wheel exits follow mode before measuring"});
        }
      };
      try {
        ctx.log(fixture ? `Controlled stream through real message components and scroll controller; draft=${draft}` : "Live model stream in a new session");
        await ctx.prove("Live output follows native wheel gestures, holds reading position and only follows the tail after an explicit jump", {
          voiceover: vo[0],
          action: async () => {
            if(fixture) {
              sessionHash=await ctx.eval("location.hash");
              await ctx.eval(`(${mountFixture.toString()})({scrolling:true})`, { awaitPromise:true });
              await ctx.waitFor("Boolean(window.__streamingAnswerProof?.showLongAnswer)");
              await ctx.eval(`window.__streamingAnswerProof.showLongAnswer(${draft});window.__scrollStreamTicks=0;window.__scrollStreamTimer=setInterval(()=>{window.__streamingAnswerProof.appendLongAnswer();if(++window.__scrollStreamTicks>=80)clearInterval(window.__scrollStreamTimer)},120)`);
            } else {
            const before = await ctx.eval("location.hash");
            await ctx.control("session.create_task");
            sessionHash = await ctx.waitFor(`location.hash!==${JSON.stringify(before)} && location.hash.includes('/session/ses_') && location.hash`, { timeoutMs: 30_000, label: "new session route" });
            await ctx.waitFor("window.__ipolloworkControl.listActions().some(a=>a.id==='composer.set_text'&&!a.disabled) && !document.querySelector('[data-message-role=user]')");
            await ctx.control("composer.set_text", { text: PROMPT });
            await ctx.control("composer.send");
            }
            await ctx.waitFor(`location.hash===${JSON.stringify(sessionHash)} && ${scroll}.scrollHeight>${scroll}.clientHeight+600 && ${running}`, { timeoutMs: 120_000, label: "new session is still streaming and overflows" });
            await wheel(-600);
            await ctx.waitFor(`${scroll}.scrollHeight-${scroll}.clientHeight-${scroll}.scrollTop>150`);
            await ctx.eval(`(()=>{const s=${scroll};window.__streamingScrollProof={hash:location.hash,scroller:s,original:Element.prototype.scrollIntoView,forced:0,events:0,jump:0,last:s.scrollTop,start:s.scrollTop,chars:${chars}};const p=window.__streamingScrollProof;p.listener=()=>{p.jump=Math.max(p.jump,Math.abs(s.scrollTop-p.last));p.last=s.scrollTop;p.events++};s.addEventListener('scroll',p.listener);Element.prototype.scrollIntoView=function(...args){p.forced++;return p.original.apply(this,args)}})()`);
            for(let i=0;i<65;i++) { await wheel(8); await new Promise(resolve=>setTimeout(resolve,32)); }
          },
          assert: async () => {
            const metrics = await ctx.eval(`(()=>{const p=window.__streamingScrollProof,s=p.scroller;s.removeEventListener('scroll',p.listener);Element.prototype.scrollIntoView=p.original;return {sameRoute:location.hash===p.hash,connected:s.isConnected,forced:p.forced,events:p.events,jump:p.jump,start:p.start,end:s.scrollTop,charsStart:p.chars,charsEnd:${chars},running:${running}}})()`);
            ctx.log(JSON.stringify(metrics));
            ctx.assert(metrics.sameRoute&&metrics.connected, "Sampling stayed in the new conversation");
            ctx.assert(metrics.charsEnd>metrics.charsStart, "Visible assistant text grew during native scrolling");
            ctx.assert(metrics.events>=20&&metrics.end>metrics.start, "Native downward wheel gestures moved the transcript");
            ctx.assert(metrics.forced===0&&metrics.jump<=24, "No forced anchors or jumps during manual scrolling");
            await wheel(-400);
            await ctx.waitFor(`${scroll}.scrollHeight-${scroll}.clientHeight-${scroll}.scrollTop>200`);
            const held = await ctx.eval(`({top:${scroll}.scrollTop,chars:${chars}})`);
            await ctx.waitFor(`${chars}>${held.chars}+100`, { timeoutMs: 30_000, label: "text grows while reading is held" });
            const drift = await ctx.eval(`Math.abs(${scroll}.scrollTop-${held.top})`);
            ctx.assert(drift<=2, `Reading position drift: ${drift}px`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=jump-to-latest]'))");
            await ctx.trustedClick('[data-testid=jump-to-latest]');
            await ctx.waitFor(`${scroll}.scrollHeight-${scroll}.clientHeight-${scroll}.scrollTop<3`, { label: "explicit jump returns to live tail" });
            ctx.log(`Reading drift ${drift}px; explicit jump returned to latest`);
          },
          screenshot: { name: "stable-streaming-scroll", requireText: fixture ? ["新增内容"] : ["滚动稳定性验证", "稳定输出"], rejectText: ["Something went wrong"] },
        });
        await ctx.prove("Completion preserves a manually chosen reading position", {
          voiceover: vo[0],
          action: async () => {
            await wheel(-600);
            await ctx.waitFor(`${scroll}.scrollHeight-${scroll}.clientHeight-${scroll}.scrollTop>200`);
            await ctx.eval(`(()=>{const s=${scroll},paragraphs=[...s.querySelectorAll('p,li')],n=paragraphs.find(n=>n.getBoundingClientRect().top>s.getBoundingClientRect().top+20);if(!n)throw Error('No reading anchor');window.__streamingHeldTop={body:s.querySelector('[data-testid=assistant-reply-draft],[data-assistant-result]'),scrollTop:s.scrollTop,text:n.textContent,occurrence:paragraphs.filter(p=>p.textContent===n.textContent).indexOf(n),top:n.getBoundingClientRect().top}})()`);
            if(fixture) await ctx.eval("clearInterval(window.__scrollStreamTimer);window.__streamingAnswerProof.finishLongAnswer()");
            await ctx.waitFor(`!(${running})`, { timeoutMs:120_000, label:"response completion" });
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`location.hash===${JSON.stringify(sessionHash)}`), "Completion stayed in the same conversation");
            await ctx.waitFor(`[...${scroll}.querySelectorAll('.chat-result-enter')].every(n=>n.getAnimations().every(a=>a.playState==='finished'))`, {label:"completion motion settled"});
            const reading=await ctx.eval(`(()=>{const p=window.__streamingHeldTop,s=${scroll},n=[...s.querySelectorAll('p,li')].filter(n=>n.textContent===p.text)[p.occurrence];return {drift:n?Math.abs(n.getBoundingClientRect().top-p.top):null,scrollDelta:s.scrollTop-p.scrollTop}})()`);
            ctx.assert(await ctx.eval(`${scroll}.querySelector('[data-assistant-result]')===window.__streamingHeldTop.body`), "Completion reuses the visible response node");
            const drift=reading.drift;
            ctx.assert(drift!==null&&drift<=2, `Completion reading drift: ${JSON.stringify(reading)}`);
            ctx.assert(await ctx.eval("document.querySelectorAll('.chat-live-activity').length===0"), "Completion stops activity animation");
            ctx.log(`Completion reading drift ${drift}px; scroll adjustment ${reading.scrollDelta}px`);
          },
          screenshot: { name: "stable-completion-reading", requireText: fixture ? ["新增内容"] : ["稳定输出"], rejectText: ["Something went wrong"] },
        });
      } finally {
        await ctx.eval("(()=>{const p=window.__streamingScrollProof;if(p){p.scroller.removeEventListener('scroll',p.listener);Element.prototype.scrollIntoView=p.original;delete window.__streamingScrollProof}delete window.__streamingHeldTop})()");
        if(fixture)await ctx.eval("clearInterval(window.__scrollStreamTimer);delete window.__scrollStreamTimer;delete window.__scrollStreamTicks;window.__streamingAnswerProof?.cleanup?.()");
        if(!fixture&&sessionHash&&await ctx.eval(`location.hash===${JSON.stringify(sessionHash)}&&window.__ipolloworkControl.listActions().some(a=>a.id==='composer.stop'&&!a.disabled)`))await ctx.control("composer.stop");
      }
    },
  }],
};
