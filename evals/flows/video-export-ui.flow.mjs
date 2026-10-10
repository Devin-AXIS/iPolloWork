import { createRequire } from "node:module";
const puppeteer = createRequire(new URL("../../vendor/hyperframes/packages/studio/package.json", import.meta.url))("puppeteer-core");

async function studioContext(ctx) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frame = frameTree.childFrames?.find(({ frame }) => frame.urlFragment?.includes("#project/"))?.frame;
  if (!frame) throw new Error("Video Studio iframe is not open");
  const world = await ctx.client.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "fraimz-video-export-ui",
  });
  return world.executionContextId;
}

async function studioEval(ctx, contextId, expression) {
  const response = await ctx.client.send("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitStudio(ctx, contextId, expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await studioEval(ctx, contextId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

export default {
  id: "video-export-ui",
  title: "Video export drawer control consistency",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" },
  preserveTheme: true,
  steps: [{
    name: "Compact Studio toolbar in the real client",
    run: async (ctx) => {
      const original = await ctx.eval("({width:innerWidth,height:innerHeight})");
      const originalFrameStyle = await ctx.eval("document.querySelector('[data-testid=video-panel] iframe').getAttribute('style')");
      const originalPanelStyle = await ctx.eval("document.querySelector('[data-testid=video-panel]').getAttribute('style')");
      await ctx.client.send("Page.bringToFront");
      await ctx.client.send("Emulation.setFocusEmulationEnabled", {enabled:true});
      let contextId = await studioContext(ctx);
      ctx.assert(!await studioEval(ctx, contextId, "document.body.innerText.includes('未保存修改')"), "Save pending Studio edits before reloading");
      const { frameTree } = await ctx.client.send("Page.getFrameTree");
      const frame = frameTree.childFrames.find(({frame}) => frame.urlFragment?.includes("#project/")).frame;
      const refreshedUrl = new URL(frame.url + (frame.urlFragment || ''));
      refreshedUrl.searchParams.set('uiRevision', Date.now());
      await ctx.client.send("Page.navigate", {frameId:frame.id,url:refreshedUrl.toString()});
      let loaded = false;
      const deadline = Date.now() + 15000;
      while (!loaded && Date.now() < deadline) {
        try {
          contextId = await studioContext(ctx);
          loaded = await studioEval(ctx, contextId, "Boolean(document.querySelector('.hf-studio-header-action-label')) && !document.querySelector('.hf-studio-header-title')");
        } catch { /* Navigation replaces the frame execution context. */ }
        if (!loaded) await new Promise(resolve => setTimeout(resolve, 100));
      }
      ctx.assert(loaded, "The rebuilt compact Studio toolbar is loaded");
      try {
        await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:1920,height:1080,deviceScaleFactor:1,mobile:false});
        await ctx.eval("(()=>{const e=document.querySelector('[data-testid=video-panel] iframe');e.style.width='1000px';e.style.minWidth='1000px';e.style.maxWidth='1000px'})()");
        await ctx.eval("(()=>{const e=document.querySelector('[data-testid=video-panel]');e.style.width='1000px';e.style.minWidth='1000px';e.style.maxWidth='1000px'})()");
        await waitStudio(ctx, contextId, "innerWidth === 1000");
        await waitStudio(ctx, contextId, "Boolean(document.querySelector('.hf-studio-header-action-label'))");
        await ctx.prove("Tabs 四边留白一致，使用32px容器和24px选项", {
          voiceover: "视图切换采用统一 Tabs 规范：四边四像素留白，选项间隔四像素，无边框和投影。",
          assert: async () => {
            const geometry = await studioEval(ctx, contextId, `(() => {
              const list = document.querySelector('.hf-studio-header-views');
              const style = getComputedStyle(list);
              return {height:list.getBoundingClientRect().height,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],gap:style.columnGap,radius:style.borderRadius,
                items:[...list.querySelectorAll('[role=tab]')].map(item=>{const s=getComputedStyle(item);return {height:item.getBoundingClientRect().height,padding:s.paddingLeft,radius:s.borderRadius,border:s.borderWidth,shadow:s.boxShadow}})};
            })()`);
            ctx.assert(geometry.height===32 && geometry.padding.every(p=>p==='4px') && geometry.gap==='4px' && geometry.radius==='10px' && geometry.items.length===3 && geometry.items.every(i=>i.height===24 && i.padding==='12px' && i.radius==='6px' && i.border==='0px' && i.shadow==='none'), JSON.stringify(geometry));
          }, screenshot: {name:'studio-tabs-uniform-spacing'},
        });
        await ctx.prove("视图切换在左侧，右侧统一为28px图标文字按钮，选中无投影", {
          voiceover:"脚本表、编辑、预览放在工具栏最前面，移除重复名称。右侧操作统一为紧凑图标文字按钮，选中控件没有投影。",
          assert: async () => {
            const result = await studioEval(ctx,contextId,`(() => {const h=document.querySelector('.hf-studio-header'),tabs=h.querySelector('[role=tablist]'),active=tabs.querySelector('[aria-selected=true]');return {width:innerWidth,title:!!h.querySelector('.hf-studio-header-title'),left:tabs.getBoundingClientRect().left-h.getBoundingClientRect().left,shadow:getComputedStyle(active).boxShadow,actions:[...h.querySelectorAll('.hf-studio-header-action')].map(b=>({height:b.getBoundingClientRect().height,font:getComputedStyle(b).fontSize,icon:!!b.querySelector('svg'),label:getComputedStyle(b.querySelector('.hf-studio-header-action-label')).display}))}})()`);
            ctx.assert(result.width>720&&!result.title&&result.left<=10&&result.shadow==='none'&&result.actions.length>=4&&result.actions.every(a=>a.height===28&&a.font==='12px'&&a.icon&&a.label!=='none'),JSON.stringify(result));
          }, screenshot:{name:"studio-toolbar-wide"},
        });
        await ctx.prove("宽工作区属性面板默认300px，没有独立关闭按钮", {
          voiceover: "属性面板默认三百像素，减少对画布的占用。",
          action: async () => { await studioEval(ctx,contextId,"(()=>{const b=document.querySelector('.hf-studio-properties-action');if(b.getAttribute('aria-pressed')!=='true')b.click()})()"); },
          assert: async () => {
            await waitStudio(ctx,contextId,"document.querySelector('.hf-studio-inspector').getBoundingClientRect().width===300");
            ctx.assert(await studioEval(ctx,contextId,"!document.querySelector('.hf-studio-inspector button[title=\"Close right panel\"]')"),"No separate close button");
          }, screenshot: {name:'studio-compact-inspector-wide'},
        });
        await ctx.eval("(()=>{const e=document.querySelector('[data-testid=video-panel] iframe');e.style.width='640px';e.style.minWidth='640px';e.style.maxWidth='640px'})()");
        await ctx.eval("(()=>{const e=document.querySelector('[data-testid=video-panel]');e.style.width='640px';e.style.minWidth='640px';e.style.maxWidth='640px'})()");
        await waitStudio(ctx,contextId,"innerWidth >= 600 && innerWidth <= 720 && getComputedStyle(document.querySelector('.hf-studio-header-action-label')).display === 'none'");
        await ctx.prove("窄窗口的属性面板覆盖画布，属性按钮收起再打开保留内容", {
          voiceover:"窄工作区使用二百六十像素覆盖面板，去掉右上角关闭按钮，由属性按钮收起展开且保留内容状态。",
          action: async () => {
            await studioEval(ctx, contextId, "(()=>{const b=document.querySelector('.hf-studio-properties-action');if(b.getAttribute('aria-pressed')!=='true')b.click()})()");
            await waitStudio(ctx,contextId,"document.querySelector('.hf-studio-inspector').getBoundingClientRect().width===260");
            await studioEval(ctx, contextId, "globalThis.inspectorProofNode=document.querySelector('.hf-studio-inspector')");
            await studioEval(ctx, contextId, "document.querySelector('.hf-studio-properties-action').click()");
            await waitStudio(ctx,contextId,"document.querySelector('.hf-studio-inspector').getBoundingClientRect().width===0");
            await studioEval(ctx, contextId, "document.querySelector('.hf-studio-properties-action').click()");
            await waitStudio(ctx,contextId,"document.querySelector('.hf-studio-inspector').getBoundingClientRect().width===260");
          },
          assert: async () => {
            const result=await studioEval(ctx,contextId,"(()=>{const e=document.querySelector('.hf-studio-inspector');return {width:e.getBoundingClientRect().width,position:getComputedStyle(e).position,preserved:e===globalThis.inspectorProofNode,close:!!e.querySelector('button[aria-label=\"Close right panel\"]'),pressed:document.querySelector('.hf-studio-properties-action').getAttribute('aria-pressed')}})()");
            ctx.assert(result.width===260&&result.position==='fixed'&&result.preserved&&!result.close&&result.pressed==='true',JSON.stringify(result));
          }, screenshot:{name:"studio-compact-inspector-narrow"},
        });
      } finally {
        await ctx.eval(`(()=>{const e=document.querySelector('[data-testid=video-panel]');${originalPanelStyle === null ? "e.removeAttribute('style')" : `e.setAttribute('style',${JSON.stringify(originalPanelStyle)})`}})()`);
        await ctx.eval(`(()=>{const e=document.querySelector('[data-testid=video-panel] iframe');${originalFrameStyle === null ? "e.removeAttribute('style')" : `e.setAttribute('style',${JSON.stringify(originalFrameStyle)})`}})()`);
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
        await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:original.width,height:original.height,deviceScaleFactor:1,mobile:false});
      }
    },
  }, {
    name: "Inspector search fields and select popup share compact styling",
    run: async (ctx) => {
      const contextId = await studioContext(ctx);
      const selectTab = async label => {
        if (!await studioEval(ctx,contextId,"Boolean(document.querySelector('.hf-inspector-tabs-scroll'))")) {
          await studioEval(ctx,contextId,"document.querySelector('.hf-studio-properties-action').click()");
        }
        await waitStudio(ctx,contextId,"Boolean(document.querySelector('.hf-inspector-tabs-scroll'))");
        await studioEval(ctx,contextId,`[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
        const searchLabel = {组件:'搜索组件',动画:'搜索动画',素材:'搜索素材…'}[label];
        await waitStudio(ctx,contextId,`[...document.querySelectorAll('[data-slot=studio-search] input')].some(e=>e.ariaLabel===${JSON.stringify(searchLabel)} && e.getBoundingClientRect().height>0)`);
      };
      const clickControl = async selector => {
        const outer=await ctx.eval("(()=>{const r=document.querySelector('[data-testid=video-panel] iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()");
        const inner=await studioEval(ctx,contextId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:outer.x+inner.x,y:outer.y+inner.y});
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:outer.x+inner.x,y:outer.y+inner.y});
      };
      await selectTab('组件');
      await ctx.prove("属性侧栏的组件、动画、素材搜索复用32px搜索控件", {
        voiceover:"右侧面板的组件、动画和素材搜索复用同一个搜索控件，统一三十二像素高度、八像素圆角和 Lucide 搜索图标。",
        assert: async () => {
          for (const tab of ['组件','动画','素材']) {
            await selectTab(tab);
            const state=await studioEval(ctx,contextId,"(()=>{const e=[...document.querySelectorAll('[data-slot=studio-search]')].find(e=>e.getBoundingClientRect().height>0),i=e.querySelector('input'),s=getComputedStyle(e);return {height:e.getBoundingClientRect().height,radius:s.borderRadius,font:getComputedStyle(i).fontSize,label:i.ariaLabel,icon:!!e.querySelector('svg.lucide-search')}})()");
            ctx.assert(state.height===32&&state.radius==='8px'&&state.font==='12px'&&state.label&&state.icon,JSON.stringify({tab,...state}));
          }
          await selectTab('组件');
        }, screenshot:{name:'inspector-shared-search'},
      });
      const originalCount = await studioEval(ctx,contextId,"document.querySelectorAll('[data-testid=block-catalog-card]').length");
      await clickControl('[data-testid=block-catalog-search]');
      await ctx.prove("搜索框聚焦只有单层边框，没有内外光环", {
        voiceover: "点击搜索框后只保留一层主题色边框，不叠加蓝色轮廓或绿色光环。",
        assert: async () => {
          const state = await studioEval(ctx, contextId, "(()=>{const i=document.querySelector('[data-testid=block-catalog-search]'),e=i.closest('[data-slot=studio-search]'),s=getComputedStyle(e),t=getComputedStyle(i);return {focused:document.activeElement===i,border:s.borderWidth,shadow:s.boxShadow,outline:s.outlineStyle,inputBorder:t.borderWidth,inputShadow:t.boxShadow,inputOutline:t.outlineStyle}})()");
          ctx.assert(state.focused && state.border==='1px' && state.shadow==='none' && state.outline==='none' && state.inputBorder==='0px' && state.inputShadow==='none' && state.inputOutline==='none', JSON.stringify(state));
        }, screenshot: {name:'inspector-search-single-focus-border'},
      });
      await ctx.client.send('Input.insertText',{text:'Map'});
      await waitStudio(ctx,contextId,`document.querySelector('[data-testid=block-catalog-search]').value==='Map' && document.querySelectorAll('[data-testid=block-catalog-card]').length>0 && document.querySelectorAll('[data-testid=block-catalog-card]').length<${originalCount}`);
      await studioEval(ctx,contextId,"document.querySelector('[data-testid=block-catalog-search]').select()");
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await waitStudio(ctx,contextId,`document.querySelector('[data-testid=block-catalog-search]').value==='' && document.querySelectorAll('[data-testid=block-catalog-card]').length===${originalCount}`);
      await clickControl('button[aria-label="组件分类"]');
      await waitStudio(ctx,contextId,"Boolean(document.querySelector('[role=listbox]'))");
      await ctx.prove("下拉浮层复用紧凑菜单尺度，并跟随主题色", {
        voiceover:"属性下拉浮层统一八像素圆角、二十八像素菜单项和半透明模糊背景，选中项没有投影。",
        assert: async () => {
          const state=await studioEval(ctx,contextId,"(()=>{const e=document.querySelector('[role=listbox]'),s=getComputedStyle(e),o=e.querySelector('[role=option]');return {radius:s.borderRadius,blur:s.backdropFilter,height:o.getBoundingClientRect().height,font:getComputedStyle(o).fontSize,overflow:e.scrollWidth>e.clientWidth}})()");
          ctx.assert(state.radius==='8px'&&state.blur.includes('blur(40px)')&&state.height===28&&state.font==='12px'&&!state.overflow,JSON.stringify(state));
        }, screenshot:{name:'inspector-shared-dropdown'},
      });
      await clickControl('[role=listbox] [role=option][aria-selected=true]');
      await waitStudio(ctx,contextId,"!document.querySelector('[role=listbox]')");
      ctx.assert(await studioEval(ctx,contextId,"document.activeElement.ariaLabel==='组件分类'"),"Selection restores focus to the dropdown trigger");
    },
  }, {
    name: "Layer dropdown aligns with its complete field",
    run: async ctx => {
      const contextId = await studioContext(ctx);
      await studioEval(ctx, contextId, "[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b=>b.textContent.trim()==='图层').click()");
      const browser = await puppeteer.connect({browserURL:ctx.cdpBaseUrl,defaultViewport:null});
      try {
        const page = (await browser.pages()).find(page => page.url().includes('5173'));
        const frame = page.frames().find(frame => frame.url().includes('#project/'));
        await frame.waitForSelector('.hf-timeline-layer-header__select', {timeout:10000});
        const layers = await frame.$$('.hf-timeline-layer-header__select');
        await layers.at(-1).click();
      } finally { await browser.disconnect(); }
      await waitStudio(ctx, contextId, "Boolean(document.querySelector('[data-slot=studio-select-field] button[aria-haspopup=listbox]'))");
      await ctx.prove("图层下拉浮层与整行控件左右对齐", {
        voiceover: "浮层以完整字段为锚点，不再只对齐右侧文字和箭头。",
        action: async () => { await studioEval(ctx, contextId, "document.querySelector('[data-slot=studio-select-field] button[aria-haspopup=listbox]').click()"); },
        assert: async () => {
          const state = await studioEval(ctx, contextId, "(()=>{const e=document.querySelector('[data-slot=studio-select-field]'),m=document.querySelector('[role=listbox]'),r=e.getBoundingClientRect(),s=m.getBoundingClientRect(),t=getComputedStyle(e);return {width:r.width,menuWidth:s.width,left:r.left-s.left,border:t.borderWidth,background:t.backgroundColor}})()");
          ctx.assert(Math.abs(state.width-state.menuWidth)<2 && Math.abs(state.left)<2 && state.border==='0px' && state.background==='rgb(244, 244, 245)', JSON.stringify(state));
        }, screenshot: {name:'layer-dropdown-full-field-anchor'},
      });
      await studioEval(ctx, contextId, "document.querySelector('[data-slot=studio-select-field] button[aria-haspopup=listbox]').click()");
    },
  }, {
    name: "Theme and narration use compact shared dropdowns",
    run: async ctx => {
      const contextId = await studioContext(ctx);
      for (const [tab, selector] of [['主题', '[data-testid=video-style-tab-content] [data-slot=design-panel-select] button[aria-label="标题字体"]'], ['讲解', '[data-testid=video-voice-panel] [data-slot=select-trigger][aria-label="表达风格"]']]) {
        await studioEval(ctx, contextId, `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b=>b.textContent.trim()===${JSON.stringify(tab)}).click()`);
        await ctx.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().height > 0`);
        await ctx.prove(`${tab}下拉控件和浮层使用统一紧凑尺度`, {
          voiceover: `${tab}下拉统一三十二像素控件高度、十二像素文字和二十八像素菜单项。`,
          action: async () => { await ctx.trustedClick(selector); },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[role=listbox] [role=option]'))");
            const state = await ctx.eval(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),e=b.closest('[data-slot=design-panel-select]')||b,s=getComputedStyle(e),m=document.querySelector('[role=listbox]'),o=m.querySelector('[role=option]'),t=getComputedStyle(m.closest('[data-slot=select-content]')||m);return {height:e.getBoundingClientRect().height,font:s.fontSize,shadow:s.boxShadow,radius:t.borderRadius,blur:t.backdropFilter,itemHeight:o.getBoundingClientRect().height,itemFont:getComputedStyle(o).fontSize}})()`);
            ctx.assert(state.height===32&&state.font==='12px'&&state.shadow==='none'&&state.radius==='8px'&&state.blur.includes('blur(40px)')&&state.itemHeight===28&&state.itemFont==='12px',JSON.stringify(state));
            const surface = await ctx.eval(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),e=b.closest('[data-slot=design-panel-select]')||b,s=getComputedStyle(e);return {border:s.borderWidth,background:s.backgroundColor}})()`);
            ctx.assert(surface.border==='0px' && surface.background!=='rgba(0, 0, 0, 0)', JSON.stringify(surface));
            const geometry = await ctx.eval(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),m=document.querySelector('[data-slot=select-content]'),r=b.getBoundingClientRect(),s=m.getBoundingClientRect();return {trigger:r.width,menu:s.width,left:r.left-s.left}})()`);
            ctx.assert(Math.abs(geometry.trigger-geometry.menu)<2 && Math.abs(geometry.left)<2, JSON.stringify(geometry));
            if (tab === '主题') {
              const colors = await ctx.eval("[...document.querySelectorAll('[data-testid=video-style-tab-content] [data-slot=design-color-field] input[data-slot=input]')].map(e=>({border:getComputedStyle(e).borderWidth,shadow:getComputedStyle(e).boxShadow,background:getComputedStyle(e).backgroundColor}))");
              ctx.assert(colors.length>0 && colors.every(e=>e.border==='0px' && e.shadow==='none' && e.background==='rgba(0, 0, 0, 0)'), JSON.stringify(colors));
              ctx.assert(surface.background==='rgb(244, 244, 245)', JSON.stringify(surface));
            }
          }, screenshot: {name:tab==='主题'?'theme-compact-dropdown':'narration-compact-dropdown'},
        });
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        if (await ctx.eval("Boolean(document.querySelector('[role=listbox]'))")) await ctx.trustedClick(selector);
        await ctx.waitFor("!document.querySelector('[role=listbox]')");
      }
      await studioEval(ctx, contextId, "[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b=>b.textContent.trim()==='组件').click()");
    },
  }, {
    name: "Export dropdown and menu follow the Studio control style",
    run: async (ctx) => {
      const contextId = await studioContext(ctx);
      await ctx.prove("The export title, dropdown triggers, popup and action share the Studio visual scale", {
        voiceover: "导出面板的标题、下拉框及展开浮层遵循视频工作室的同一套控件样式。",
        action: async () => {
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('.hf-studio-header-export'))`);
          if (!await studioEval(ctx, contextId, `Boolean(document.querySelector('.hf-export-button'))`)) {
            await studioEval(ctx, contextId, `document.querySelector('.hf-studio-header-export')?.click()`);
          }
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('button[aria-label="格式"]'))`);
          await studioEval(ctx, contextId, `document.querySelector('button[aria-label="格式"]')?.click()`);
          await waitStudio(ctx, contextId, `Boolean(document.querySelector('[role="listbox"][aria-label="格式"]'))`);
        },
        assert: async () => {
          const result = await studioEval(ctx, contextId, `(() => {
            const heading = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '导出');
            const selects = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(el => ['格式', '分辨率', '帧率', '质量'].includes(el.ariaLabel));
            const menu = document.querySelector('[role="listbox"][aria-label="格式"]');
            const button = document.querySelector('.hf-export-button');
            const style = el => getComputedStyle(el);
            return {
              heading: heading && {font: style(heading).fontSize, weight: style(heading).fontWeight},
              selects: selects.map(el => ({label: el.ariaLabel, height: el.getBoundingClientRect().height, radius: style(el).borderRadius, font: style(el).fontSize})),
              menu: menu && {radius: style(menu).borderRadius, background: style(menu).backgroundColor, options: menu.querySelectorAll('[role="option"]').length},
              button: button && {height: button.getBoundingClientRect().height, background: style(button).backgroundColor, color: style(button).color, disabled: button.disabled},
            };
          })()`);
          ctx.assert(result.heading?.font === "13px" && result.heading.weight === "600", JSON.stringify(result));
          ctx.assert(result.selects.length === 4 && result.selects.every(select => select.height === 34 && select.radius === "6px" && select.font === "12px"), JSON.stringify(result));
          ctx.assert(result.menu?.radius === "8px" && result.menu.options === 3 && result.menu.background !== "rgba(0, 0, 0, 0)", JSON.stringify(result));
          ctx.assert(result.button?.height === 34 && result.button.background !== result.button.color && !result.button.disabled, JSON.stringify(result));
        },
        screenshot: { name: "video-export-dropdown" },
      });
    },
  }, {
    name: "Export format selection preserves dependent settings",
    run: async (ctx) => {
      const contextId = await studioContext(ctx);
      await ctx.prove("Selecting MOV hides its inapplicable quality field and MP4 restores it", {
        voiceover: "切换到 MOV 时质量设置会收起，返回 MP4 后可继续调整。",
        action: async () => {
          await studioEval(ctx, contextId, `(() => {
            const mov = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(el => el.textContent.includes('MOV'));
            mov?.click();
          })()`);
        },
        assert: async () => {
          ctx.assert(await studioEval(ctx, contextId, `!document.querySelector('button[aria-label="质量"]')`), "MOV should hide quality");
          await studioEval(ctx, contextId, `document.querySelector('button[aria-label="格式"]')?.click()`);
          await studioEval(ctx, contextId, `(() => {
            const mp4 = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(el => el.textContent.trim() === 'MP4');
            mp4?.click();
          })()`);
          ctx.assert(await studioEval(ctx, contextId, `Boolean(document.querySelector('button[aria-label="质量"]'))`), "MP4 should restore quality");
        },
        screenshot: { name: "video-export-mp4-restored" },
      });
    },
  }],
};
