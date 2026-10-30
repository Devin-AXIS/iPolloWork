const design = "document.querySelector('iframe[title^=\"Design preview:\"]')?.contentDocument";
const image = "document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument";
const witness = (ctx) =>
  ctx.eval("fetch('http://127.0.0.1:5274/witness').then(r=>r.json())", { awaitPromise: true });
const select = async (ctx, id) => {
  await ctx.eval(`${design}.getElementById('${id}').click()`);
  await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"在图片工作台编辑\"]'))");
  await ctx.eval("document.querySelector('[aria-label=\"在图片工作台编辑\"]').click()");
  await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width===800 && document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width>0`, {timeoutMs:60000});
};
const openSaveMenu = async (ctx) => {
  await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width===800 && ${image}?.querySelector('#downloadImage')?.disabled===false`);
  await ctx.eval(`${image}.querySelector('#downloadImage').click()`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=media-save-copy]'))");
};
const closeSaveMenu = ctx => ctx.client.send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
export default {
  id: "media-return",
  title: "Edit, save a new asset, and replace only the selected project asset",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5274" },
  steps: [
    {
      name: "Real project, plugin and filesystem with a simulated image provider",
      async run(ctx) {
        await ctx.client.send("Page.reload");
        await ctx.waitFor(`${design}?.getElementById('hero')?.complete`, { timeoutMs: 60000 });
        await ctx.clickText("编辑", { selector: "button" });
        await ctx.waitFor(
          `${design}?.documentElement.getAttribute('data-ipollowork-design-mode')==='editing'`,
        );
        await ctx.prove("Replacement and save actions are visible before editing and disabled", {
          action: async () => { await select(ctx, "hero"); await openSaveMenu(ctx); },
          assert: async () =>
            ctx.assert(
              await ctx.eval(
                "document.querySelector('[data-testid=media-replace-return]').getAttribute('aria-disabled')==='true' && document.querySelector('[data-testid=media-save-copy]').getAttribute('aria-disabled')==='true'",
              ),
              "Cannot apply an unchanged source",
            ),
          screenshot: { name: "actions-before-edit" },
        });
        await closeSaveMenu(ctx);
        await ctx.prove("A toolbar edit enables replacement without another save step", {
          action: async () => {
            await ctx.eval(`${image}.querySelector('[aria-label=矩形选区]').click()`);
            const points = await ctx.eval(
              `(()=>{const f=document.querySelector('iframe[title="图片工作台"]'),fr=f.getBoundingClientRect(),r=f.contentDocument.querySelector('#selectionCanvas').getBoundingClientRect();return {x:fr.x+r.x+r.width*.35,y:fr.y+r.y+r.height*.3,x2:fr.x+r.x+r.width*.6,y2:fr.y+r.y+r.height*.6}})()`,
            );
            await ctx.client.send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: points.x,
              y: points.y,
              button: "left",
              clickCount: 1,
            });
            await ctx.client.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: points.x2,
              y: points.y2,
              buttons: 1,
            });
            await ctx.client.send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: points.x2,
              y: points.y2,
              button: "left",
              clickCount: 1,
            });
            await ctx.eval(`${image}.querySelector('[aria-label=消除笔]').click()`);
            await ctx.eval(`${image}.querySelector('#selectionErase').click()`);
            await openSaveMenu(ctx);
            await ctx.waitFor(
              "document.querySelector('[data-testid=media-replace-return]')?.getAttribute('aria-disabled')!=='true'",
              { timeoutMs: 30000 },
            );
          },
          assert: async () => {
            ctx.assert(
              await ctx.eval(`${image}.querySelector('#saveReview').hidden`),
              "Host owns the save choices, no duplicate overwrite controls",
            );
            ctx.assert(
              (await witness(ctx)).saved.originalPreserved,
              "Original file remains unchanged",
            );
          },
          screenshot: { name: "edit-ready" },
        });
        await ctx.prove("Saving a new asset preserves the original project", {
          action: async () => {
            await ctx.trustedClick("[data-testid=media-save-copy]");
            await ctx.waitFor(`${image}?.querySelector('#workbenchHint')?.textContent.includes('已保存新素材')`);
          },
          assert: async () => {
            const w = await witness(ctx);
            ctx.assert(
              /id="hero" src="assets\/source.png"/.test(w.designHtml) &&
                /id="other" src="assets\/source.png"/.test(w.designHtml),
              "Both references remain unchanged",
            );
            ctx.assert(w.saved.originalPreserved, "Original bytes preserved");
            ctx.assert(
              await ctx.eval(
                `(()=>{const c=${image}.querySelector('#imageCanvas'),p=c.getContext('2d').getImageData(Math.floor(c.width*.48),Math.floor(c.height*.45),1,1).data;return p[2]>p[0]})()`,
              ),
              "Editor retains edited pixels after saving",
            );
          },
          screenshot: { name: "saved-copy" },
        });
        await ctx.prove("Replace and return changes only the selected element", {
          action: async () => {
            // Let the provisional HTML frame finish before media hydration. Selection must survive the final frame too.
            await ctx.eval(`window.__proofMediaDelay=${Number(ctx.env.IPOLLOWORK_EVAL_MEDIA_DELAY_MS ?? 400)}`);
            await openSaveMenu(ctx);
            await ctx.trustedClick("[data-testid=media-replace-return]");
            await ctx.waitFor("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width===0");
            await ctx.waitFor(
              `${design}?.getElementById('hero')?.naturalWidth===800 && ${design}?.getElementById('hero')?.hasAttribute('data-ipollowork-design-primary')`,
            );
          },
          assert: async () => {
            const w = await witness(ctx);
            ctx.assert(
              !/id="hero" src="assets\/source.png"/.test(w.designHtml),
              "Selected reference changed",
            );
            ctx.assert(
              /id="other" src="assets\/source.png"/.test(w.designHtml),
              "Other reference unchanged",
            );
            ctx.assert(
              w.saved.originalPreserved && !w.designHtml.includes("blob:"),
              "Original bytes preserved and only durable file paths persisted",
            );
          },
          screenshot: { name: "returned-to-project" },
        });
        // Drive the completion event used by the chat route. The provider result is a real local fixture file.
        await ctx.prove(
          "A correlated chat edit returns to this workbench; unrelated results are ignored",
          {
            action: async () => {
              await select(ctx, "other");
              await ctx.eval("window.addEventListener('ipollowork:add-image-reference', e=>{window.__proofReference=e.detail},{once:true})");
              await ctx.eval(`${image}.querySelector('#askAi').click()`);
              const point=await ctx.eval(`(()=>{const f=document.querySelector('iframe[title="图片工作台"]'),r=f.contentDocument.querySelector('#selectionCanvas').getBoundingClientRect(),p=f.getBoundingClientRect();return{x:p.x+r.x+r.width*.4,y:p.y+r.y+r.height*.4};})()`);
              await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
              await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
              await ctx.waitFor("Boolean(window.__proofReference)");
              ctx.assert(await ctx.eval("window.__proofReference.sessionId==='selection-proof' && !!window.__proofReference.reference.workbenchRequestId"), "AI annotation uses conversation ID, not source-project ID");
              await openSaveMenu(ctx);
              const sourcePath = "design/selection-proof/assets/source.png";
              const ready = await ctx.eval(
                "fetch('http://127.0.0.1:5274/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'edit-image',pluginId:'image-studio',args:{sourcePath:'design/selection-proof/assets/source.png',prompt:'blue fixture'}})}).then(r=>r.json())",
                { awaitPromise: true },
              );
              ctx.assert(ready.ok, "Local simulated result created");
              const requestId = await ctx.eval(
                "document.querySelector('[data-testid=media-workbench]').dataset.requestId",
              );
              await ctx.eval(
                `window.dispatchEvent(new CustomEvent('ipollowork:image-studio:edit-result',{cancelable:true,detail:${JSON.stringify({ workspaceId: "selection-proof", sessionId: "selection-proof", requestId: "unrelated", sourcePath, path: ready.result.path })}}))`,
              );
              ctx.assert(
                await ctx.eval(
                  "document.querySelector('[data-testid=media-replace-return]').getAttribute('aria-disabled')==='true'",
                ),
                "Unrelated result rejected",
              );
              await ctx.eval(`(async()=>{const usePanelTabStore=window.__proofPanels;usePanelTabStore.getState().openTab('selection-proof',{id:'other-preview',type:'artifact',label:'Other preview',preview:'text'});})()`, {awaitPromise:true});
              await ctx.waitFor("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width===0");
              const delivered = await ctx.eval(
                `(async()=>{const usePanelTabStore=window.__proofPanels;const store=usePanelTabStore.getState();const edit=store.completeMediaEdit('selection-proof','selection-proof',${JSON.stringify(requestId)},${JSON.stringify(ready.result.path)});if(!edit)return false;store.resumeMediaEdit(edit,${JSON.stringify(ready.result.path)},window.__proofImageSurface);return true;})()`, {awaitPromise:true}
              );
              ctx.assert(delivered, "Result routing restored the owning project without opening another studio");
              await ctx.waitFor(
                "document.querySelector('[data-testid=media-replace-return]')?.getAttribute('aria-disabled')!=='true'",
              );
            },
            assert: async () =>
              ctx.assert(
                await ctx.eval("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width>0 && !document.querySelector('[data-testid=design-panel] [data-testid=media-workbench]') && window.__proofPanels.getState().sessions['selection-proof'].tabs.filter(tab=>tab.type==='workspace-app' && tab.surface.pluginId==='image-studio').length===1"),
                "Result stays attached to project",
              ),
            screenshot: { name: "chat-result-attached" },
          },
        );
        await closeSaveMenu(ctx);
        await ctx.prove("The compact image toolbar fits a narrow canvas without covering its hint", {
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:520,height:850,deviceScaleFactor:1,mobile:false});
          },
          assert: async () => {
            await ctx.waitFor(`(()=>{const d=${image}; const h=d.querySelector('#workbenchHint').getBoundingClientRect(), tools=d.querySelector('#toolbar').getBoundingClientRect(), back=d.querySelector('#workbenchBack').getBoundingClientRect(), tabs=d.querySelector('#modeSwitch').getBoundingClientRect();return h.bottom<tools.top && back.right<=tabs.left && d.documentElement.scrollWidth<=520;})()`);
          },
          screenshot: {name:"narrow-image-toolbar"},
        });
        await ctx.prove("The horizontal toolbar remains below the hint at medium width", {
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:1000,height:850,deviceScaleFactor:1,mobile:false});
            await ctx.eval(`(()=>{const d=${image};d.querySelector('#stage').scrollTop=100;})()`);
          },
          assert: async () => {
            await ctx.waitFor(`(()=>{const d=${image};return d.querySelector('#workbenchHint').getBoundingClientRect().bottom<d.querySelector('#toolbar').getBoundingClientRect().top;})()`);
          },
          screenshot: {name:"medium-image-toolbar"},
        });
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
        await ctx.prove("The generated card can reopen an unapplied edit with its replacement target", {
          action: async () => {
            await ctx.eval(`${image}.querySelector('#workbenchBack').click()`);
            await ctx.waitFor("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width===0");
            await ctx.trustedClick('[data-testid=generated-result-card] button');
            await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width===800`);
            await openSaveMenu(ctx);
          },
          assert: async () => {
            ctx.assert(await ctx.eval("document.querySelector('[data-testid=media-replace-return]').getAttribute('aria-disabled')!=='true'"), "Result card restores replacement without selecting the source again");
          },
          screenshot: {name:"result-card-ready-to-replace"},
        });
        await closeSaveMenu(ctx);
        await openSaveMenu(ctx);
        await ctx.trustedClick('[data-testid=media-replace-return]');
        await ctx.waitFor("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width===0");
        await ctx.prove("Opening a generated result card restores its origin and already-replaced state", {
          action: async () => {
            await ctx.trustedClick('[data-testid=generated-result-card] button');
            await ctx.waitFor(`${image}?.querySelector('#workbenchHint')?.textContent.includes('已替换回原项目')`);
            await openSaveMenu(ctx);
          },
          assert: async () => {
            ctx.assert(await ctx.eval("document.querySelector('[data-testid=media-replace-return]').getAttribute('aria-disabled')==='true'"), "An already replaced result cannot replace twice");
            ctx.assert(await ctx.eval(`${image}.querySelector('#workbenchBack').hidden===false`), "The result card retains the return path");
          },
          screenshot: {name:"result-card-keeps-origin"},
        });
        await closeSaveMenu(ctx);
        await ctx.eval(`${image}.querySelector('#workbenchBack').click()`);
        await ctx.waitFor("document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width===0");
        const video = "document.querySelector('iframe[title=\"视频工作台\"]')?.contentDocument";
        await ctx.prove("Video editing uses the same return button and Save as menu", {
          action: async () => {
            await ctx.eval(`${design}.getElementById('clip').click()`);
            await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"在视频工作台编辑\"]'))");
            await ctx.eval("document.querySelector('[aria-label=\"在视频工作台编辑\"]').click()");
            await ctx.waitFor(`${video}?.querySelector('#downloadVideo')?.disabled===false`, {timeoutMs:30000});
            await ctx.eval(`${video}.querySelector('#downloadVideo').click()`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=media-save-copy]'))");
          },
          assert: async () => {
            ctx.assert(await ctx.eval(`${video}.querySelector('#workbenchBack').hidden===false && ${video}.querySelector('#openVideo').textContent.includes('打开视频') && ${video}.querySelector('#downloadVideo').textContent.includes('另存为')`), "Video labels and back action are unified");
          },
          screenshot: {name:"video-save-menu"},
        });
        await ctx.prove("Save as creates a video copy while keeping the selected project open", {
          action: async () => {
            await ctx.trustedClick('[data-testid=media-save-copy]');
            await ctx.waitFor(`${video}.querySelector('#workbenchHint').textContent.includes('已保存新素材')`, {timeoutMs:30000});
          },
          assert: async () => {
            const result=await witness(ctx);
            ctx.assert(result.actions.some(a=>a.action==='local-edit'&&a.mode==='copy'), "Local video copy was written");
            ctx.assert(result.designHtml.includes('assets/background.mp4'), "The project's video remains unchanged");
          },
          screenshot: {name:"video-copy-saved"},
        });
      },
    },
  ],
};
