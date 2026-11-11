import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("design-slide-editing");
const activeSlideIndex = "[...document.querySelectorAll('.slide')].findIndex((slide) => slide.getAttribute('aria-hidden') === 'false')";

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.eval(`(() => {
    const stop = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Stop' && !button.disabled);
    stop?.click();
    return Boolean(stop);
  })()`);
  await ctx.waitFor("window.__ipolloworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)", { timeoutMs: 30_000, label: "create task action" });
  await ctx.control("session.create_task");
  await ctx.waitFor("window.__ipolloworkControl.snapshot().route.includes('/session/')", { timeoutMs: 60_000, label: "active task" });
}

async function withPreviewClient(ctx, callback) {
  const targets = await listTargets(ctx.cdpBaseUrl);
  const target = targets.find((entry) => entry.type === "iframe" && entry.url === "about:srcdoc" && entry.webSocketDebuggerUrl);
  if (!target) return null;
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

async function frameEval(ctx, expression) {
  return withPreviewClient(ctx, (client) => evaluate(client, expression));
}

async function waitForFrame(ctx, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (await frameEval(ctx, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function clickFrame(ctx, selector, label) {
  const clicked = await withPreviewClient(ctx, async (client) => evaluate(client, `(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return null;
      target.click();
      return true;
    })()`));
  ctx.assert(clicked, `${label} was not available.`);
}

async function openDeck(ctx) {
  await ctx.control("eval.design.seed_deck");
  await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", { timeoutMs: 30_000, label: "initial Design preview" });
  await waitForFrame(ctx, "document.title === 'iPolloWork Slide Editing Demo'", "deck preview");
}

const flow = {
  id: "design-slide-editing",
  title: "Multi-slide Design editing preserves the active page and native navigation",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the deck Design flow can run."
      : null;
  },
  steps: [
    {
      name: "Entering edit mode preserves the current slide",
      run: async (ctx) => {
        await ctx.prove("Opening Edit page on slide two keeps the same loaded deck and exposes a compact page indicator", {
          voiceover: vo[0],
          action: async () => {
            await ensureSession(ctx);
            await openDeck(ctx);
            await clickFrame(ctx, '[data-action="next"]', "Preview next slide");
            await waitForFrame(ctx, `${activeSlideIndex} === 1`, "second preview slide");
            await ctx.eval(`(() => {
              const frame = document.querySelector('[data-testid="design-panel"] iframe');
              if (!frame) return false;
              frame.dataset.slideEditingIdentity = crypto.randomUUID();
              return true;
            })()`);
            await ctx.trustedClick('[aria-label="Edit page"]');
          },
          assert: async () => {
            await waitForFrame(ctx, `${activeSlideIndex} === 1 && document.documentElement.dataset.ipolloworkDesignMode === 'editing'`, "slide two remains in edit mode");
            await ctx.waitFor(`(() => {
              const frame = document.querySelector('[data-testid="design-panel"] iframe');
              const pager = document.querySelector('[data-testid="design-deck-navigation"]');
              return Boolean(frame?.dataset.slideEditingIdentity) && pager?.textContent?.includes('2 / 3');
            })()`, { timeoutMs: 10_000, label: "slide two remains in edit mode" });
          },
          screenshot: { name: "edit-mode-keeps-second-slide", requireText: ["Edit page", "2 / 3", "Edit second slide"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Native and compact controls continue navigation while editing",
      run: async (ctx) => {
        await ctx.prove("The deck's native next button and the compact pager both work during editing, so another slide can be selected immediately", {
          voiceover: vo[1],
          action: async () => {
            await clickFrame(ctx, '[data-action="next"]', "Edit-mode native next slide");
            await waitForFrame(ctx, `${activeSlideIndex} === 2`, "third slide after native navigation");
            await ctx.trustedClick('[aria-label="Previous slide"]');
            await waitForFrame(ctx, `${activeSlideIndex} === 1`, "second slide after compact navigation");
            await clickFrame(ctx, "h1", "Select second-slide heading");
          },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"design-floating-toolbar\"]'))", { timeoutMs: 10_000, label: "second-slide editing toolbar" });
            const page = await frameEval(ctx, activeSlideIndex);
            const state = await ctx.eval(`(() => ({
              editing: document.querySelector('[aria-label="Edit page"]')?.getAttribute('data-state') || '',
              pager: document.querySelector('[data-testid="design-deck-navigation"]')?.textContent || '',
              textTools: Boolean(document.querySelector('[aria-label="Edit selected text"]')),
              hasWorkspaceFilePicker: Boolean(document.querySelector('[aria-label="HTML file"]')),
              hasVersionPicker: Boolean(document.querySelector('[aria-label="Design version"]')),
            }))()`);
            ctx.assert(page === 1 && state.pager.includes("2 / 3") && state.textTools && !state.hasWorkspaceFilePicker && !state.hasVersionPicker, `Editing navigation state is wrong: ${JSON.stringify({ ...state, page })}`);
          },
          screenshot: { name: "native-and-compact-navigation-in-edit-mode", requireText: ["2 / 3", "Edit second slide", "Edit text"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};

// Verify the already-open user deck without seeding or writing its source.
if (process.env.IPOLLOWORK_EVAL_SLIDE_NAVIGATION_LIVE === "1") {
  const state = ctx => ctx.eval(`(()=>{const p=document.querySelector('[data-testid=design-panel]'),f=p?.querySelector('iframe'),d=f?.contentDocument,s=d?[...d.querySelectorAll('[data-ipw-slide]')]:[];return {index:s.findIndex(n=>n.getAttribute('aria-hidden')==='false'),total:s.length,visible:s.filter(n=>n.checkVisibility()).length,mode:d?.documentElement.dataset.ipolloworkDesignMode,pager:p?.querySelector('[data-testid=design-deck-navigation]')?.innerText}})()`);
  const mode = (ctx, label) => ctx.eval(`(()=>{const b=[...document.querySelectorAll('[data-testid=design-panel] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Mode button missing');b.click();return true})()`);
  const waitIndex = (ctx,index) => ctx.waitFor(`(()=>{const d=document.querySelector('[data-testid=design-panel] iframe')?.contentDocument,s=d?[...d.querySelectorAll('[data-ipw-slide]')]:[];return s.findIndex(n=>n.getAttribute('aria-hidden')==='false')===${index}&&s.filter(n=>n.checkVisibility()).length===1&&document.querySelector('[data-testid=design-deck-navigation]')?.innerText.includes('${index+1} / '+s.length)})()`);
  const host = (ctx,direction) => ctx.trustedClick(`[data-testid=design-panel] [aria-label="${direction} slide"]`);
  const native = async (ctx,direction) => {
    const selector=direction==='next'?"button[aria-label*='下一页'],button[aria-label*='Next' i]":"button[aria-label*='上一页'],button[aria-label*='Previous' i]";
    const p=await ctx.eval(`(()=>{const f=document.querySelector('[data-testid=design-panel] iframe'),b=f.contentDocument.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect(),fr=f.getBoundingClientRect();return {x:fr.left+(r.left+r.width/2)*fr.width/f.clientWidth,y:fr.top+(r.top+r.height/2)*fr.height/f.clientHeight}})()`);
    await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
    await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  };
  flow.precondition=async ctx=>{const s=await state(ctx);return s.total>=3?null:'Open the affected presentation with at least three slides first';};
  flow.steps=[
    {name:'Host navigation and edit mode preserve the active slide',run:ctx=>ctx.prove('The affected deck advances in Edit mode and keeps the same slide across Browse/Edit toggles',{
      voiceover:vo[0],action:async()=>{
        const s=await state(ctx);await ctx.eval(`void(window.__liveDeckBefore=${JSON.stringify(s)})`);
        let current=await state(ctx);while(current.index>0){await host(ctx,'Previous');await waitIndex(ctx,current.index-1);current=await state(ctx);}
        await mode(ctx,'编辑');await host(ctx,'Next');await waitIndex(ctx,1);
        await mode(ctx,'浏览');await mode(ctx,'编辑');
      },assert:async()=>{await waitIndex(ctx,1);const s=await state(ctx);ctx.assert(s.mode==='editing'&&s.visible===1,JSON.stringify(s));},
      screenshot:{name:'live-deck-host-edit-navigation',requireText:['2 /'],rejectText:['Something went wrong']},
    })},
    {name:'Native arrows and keyboard work without blocking content selection',run:ctx=>ctx.prove('Native controls, host controls and arrow keys navigate while editing; slide text remains selectable',{
      voiceover:vo[1],action:async()=>{
        await native(ctx,'next');await waitIndex(ctx,2);await host(ctx,'Previous');await waitIndex(ctx,1);
        await ctx.eval("document.querySelector('[data-testid=design-panel] iframe').contentWindow.focus()");
        for(const [key,index,code] of [['ArrowRight',2,39],['ArrowLeft',1,37]]){await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});await waitIndex(ctx,index);}
        const total=(await state(ctx)).total;
        for(let index=2;index<total;index++){await host(ctx,'Next');await waitIndex(ctx,index);}
        for(let index=total-2;index>=1;index--){await host(ctx,'Previous');await waitIndex(ctx,index);}
        ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-floating-toolbar]')"),'Navigation clears the previous editing selection');
        await ctx.eval("document.querySelector('[data-testid=design-panel] iframe').contentDocument.querySelector('[data-ipw-slide][aria-hidden=false] h1,[data-ipw-slide][aria-hidden=false] h2').click()");
      },assert:async()=>{await waitIndex(ctx,1);await ctx.waitFor("Boolean(document.querySelector('[data-testid=design-floating-toolbar]'))");ctx.assert((await state(ctx)).mode==='editing','Editing remains enabled');},
      screenshot:{name:'live-deck-native-keyboard-edit-navigation',requireText:['2 /'],rejectText:['Something went wrong']},
    })},
    {name:'Restore original viewing position',run:async ctx=>{
      await mode(ctx,'浏览');const original=await ctx.eval('window.__liveDeckBefore');let current=await state(ctx);
      while(current.index!==original.index){const expected=current.index+(current.index>original.index?-1:1);await host(ctx,current.index>original.index?'Previous':'Next');await waitIndex(ctx,expected);current=await state(ctx);}
      if(original.mode==='editing')await mode(ctx,'编辑');await ctx.eval('delete window.__liveDeckBefore');
    }},
  ];
}
export default flow;
