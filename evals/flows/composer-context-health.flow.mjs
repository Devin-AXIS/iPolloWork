const flow = {
  id: "composer-context-health",
  title: "Composer shows context usage instead of the engine badge",
  kind: "user-facing",
  steps: [
    {
      name: "Inspect current context health",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "control API",
        });
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=composer-context-health]'))", {
          timeoutMs: 60_000,
          label: "context health control",
        });
        await ctx.prove("Every engine uses one compact context-usage control in the composer", {
          voiceover: "输入框右下角现在统一显示当前上下文、模型上限和占比，接近上限时还会提前提示压缩。",
          action: async () => {
            await ctx.eval(`document.querySelector('[data-testid=composer-context-health]')?.click()`);
            await ctx.waitFor(`(() => {
              const popover = document.querySelector('[data-slot=popover-content]');
              return Boolean(popover && /Current context|当前上下文/.test(popover.innerText || ''));
            })()`, {
              timeoutMs: 10_000,
              label: "context health popover",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const control = document.querySelector('[data-testid=composer-context-health]');
              const popover = document.querySelector('[data-slot=popover-content]');
              return {
                height: control?.getBoundingClientRect().height || 0,
                label: control?.getAttribute('aria-label') || '',
                summary: control?.innerText.trim() || '',
                detail: popover?.innerText || '',
                insideComposer: Boolean(control?.closest('[data-session-surface-id], [data-testid=initial-project-task-starter], [data-testid=new-conversation-starter-composer-shell]')),
                engineId: control?.getAttribute('data-engine-id') || '',
                oldBadgeCount: document.querySelectorAll('[data-testid=session-composer-engine-badge], [data-testid=initial-project-engine-badge]').length,
              };
            })()`);
            ctx.assert(state.height === 32, `Expected a 32px context control, found ${state.height}px.`);
            ctx.assert(state.insideComposer, "Context health should render inside the conversation composer.");
            ctx.assert(/Context health|上下文体检/.test(state.label), `Unexpected context label: ${state.label}`);
            ctx.assert(state.summary.includes("/"), `Context summary should compare used and maximum tokens: ${state.summary}`);
            ctx.assert(!/Unknown|未知/.test(`${state.summary}\n${state.detail}`), "The selected model context limit should be resolved.");
            ctx.assert(/Current context|当前上下文/.test(state.detail), "Context details should show the current usage.");
            ctx.assert(/Selected model limit|所选模型上限/.test(state.detail), "Context details should show the selected model limit.");
            ctx.assert(state.engineId === "", "The context control must not retain the old engine identity attribute.");
            ctx.assert(state.oldBadgeCount === 0, "The former composer engine badge should be removed.");
          },
          screenshot: {
            name: "composer-context-health",
            fromSurface: true,
            rejectText: ["Something went wrong", "Request timed out", "请求超时"],
          },
        });
      },
    },
  ],
};

if (process.env.IPOLLOWORK_EVAL_TODO_LAYOUT === "1") {
  flow.steps = [{name: "Task progress columns stay aligned across widths and statuses", run: async ctx => {
    try {
      await ctx.eval(`(async()=>{
const s=await(await fetch('/src/react-app/domains/session/surface/session-surface.tsx')).text();
const part=s.slice(s.indexOf('function TodoPanel('),s.indexOf('_s2(TodoPanel')).replace('_s2();','');
const React=(await import('/node_modules/.vite/deps/react.js')).default;const {jsxDEV}=(await import('/node_modules/.vite/deps/react_jsx-dev-runtime.js')).default;const icons=await import('/node_modules/.vite/deps/lucide-react.js');const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const Panel=new Function('useState','jsxDEV','Minimize2','Check','t',part+';return TodoPanel;')(React.useState,jsxDEV,icons.Minimize2,icons.Check,()=> '进度');
const host=document.createElement('div');host.id='todo-layout-check';host.style.cssText='position:fixed;inset:20px auto auto 20px;background:var(--background);z-index:99999';document.body.append(host);const root=createRoot(host); window.__todoLayout={root,host,React,Panel};
})()`, {awaitPromise:true});
      for (const width of [320,480,760]) {
        await ctx.prove(`Progress layout at ${width}px`, {
          action: async () => {
            await ctx.eval(`(() => {const {host,root,React,Panel}=window.__todoLayout;host.style.width='${width}px';root.render(React.createElement(Panel,{visible:true,todos:Array.from({length:12},(_,i)=>({id:String(i),status:['completed','in_progress','pending','cancelled'][i%4],content:i%2 ? 'https://example.com/'+'long_filename_'.repeat(20) : '读取模板、简报与参考证据，确定叙事结构。'.repeat(3)}))}));})()`);
            await ctx.waitFor("Boolean(document.querySelector('#todo-layout-check button'))");
            if (!await ctx.eval("Boolean(document.querySelector('#todo-layout-check .max-h-60'))")) await ctx.eval("document.querySelector('#todo-layout-check button').click()");
            await ctx.waitFor("document.querySelectorAll('#todo-layout-check .max-h-60 > div').length===12");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`(() => {const list=document.querySelector('#todo-layout-check .max-h-60');const rows=[...list.children];const start=rows[0].lastElementChild.getBoundingClientRect().left;return list.scrollWidth===list.clientWidth && rows.every(row=>{const icon=row.firstElementChild.firstElementChild.getBoundingClientRect();const text=row.lastElementChild.getBoundingClientRect();return icon.width===18 && Math.abs(text.left-start)<1 && text.right<=list.getBoundingClientRect().right;});})()`), "All states keep 18px icons, aligned text columns and no horizontal overflow");
          },
          screenshot: {name:`todo-layout-${width}`,requireText:['进度']},
        });
        await ctx.eval("document.querySelector('#todo-layout-check button').click()");
        await ctx.waitFor("!document.querySelector('#todo-layout-check .max-h-60')");
      }
      await ctx.prove('Completed task removes stale progress above the composer', {
        action: async () => {
          await ctx.eval("(() => {const {root,React,Panel}=window.__todoLayout;root.render(React.createElement(Panel,{visible:false,todos:Array.from({length:3},(_,i)=>({id:String(i),status:'completed',content:'已完成的任务 '+i}))}));})()");
          await ctx.waitFor("!document.querySelector('#todo-layout-check button')");
        },
        assert: async () => { ctx.assert(await ctx.eval("!document.querySelector('#todo-layout-check').textContent.trim()"), 'Completed todos still occupy the composer accessory area'); },
        screenshot: {name:'todo-progress-settled',rejectText:['进度 · 3/3']},
      });
    } finally {await ctx.eval("window.__todoLayout?.root.unmount();window.__todoLayout?.host.remove();delete window.__todoLayout;");}
  }}];
}
export default flow;
