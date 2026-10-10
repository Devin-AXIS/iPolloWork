import workbench from "./video-workbench-toolbar.flow.mjs";
const studioOrigin = process.env.IPOLLOWORK_VIDEO_STUDIO_ORIGIN || "http://127.0.0.1:5198";
const appOrigin = process.env.IPOLLOWORK_VIDEO_APP_ORIGIN || "http://127.0.0.1:5197";
const consoleOrigin = process.env.IPOLLOWORK_VIDEO_CONSOLE_ORIGIN || "http://127.0.0.1:5278";
export default {
  id: "video-studio-shared-ui",
  title: "Video Studio shared UI migration",
  kind: "user-facing",
  cdpTarget: { urlIncludes: studioOrigin },
  preserveTheme: true,
  steps: [{
    name: "Shared export controls preserve format behavior",
    run: async ctx => {
      if (!String(await ctx.eval("location.href")).startsWith(studioOrigin)) {
        await ctx.client.send("Page.navigate", {url: studioOrigin + "/#project/shared-ui-export?v=1&tab=renders"});
        await ctx.waitFor(`location.origin === ${JSON.stringify(studioOrigin)}`);
      }
      await ctx.waitForText("Export");
      if (!await ctx.hasText("Format")) await ctx.clickText("Export");
      await ctx.waitForText("Format");
      await ctx.prove("导出选择和按钮采用共享尺寸与字体", {
        voiceover: "导出区使用共享选择器和按钮，统一为三十二像素高度、十三像素文字。",
        assert: async () => {
          const controls = await ctx.eval(`Array.from(document.querySelectorAll('[data-slot="select-trigger"], [data-slot="button"].w-full')).map(e => ({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize,slot:e.dataset.slot,background:getComputedStyle(e).backgroundColor}))`);
          ctx.assert(controls.filter(c => c.slot === "select-trigger").length >= 3 && controls.every(c => c.height === 32 && c.font === "13px"), JSON.stringify(controls));
          ctx.assert(controls.some(c => c.slot === "button" && c.background !== "rgba(0, 0, 0, 0)"), "Shared export action has a visible background");
        }, screenshot: {name: "shared-export-controls"},
      });
      await ctx.prove("MOV选择保留无损格式联动", {
        voiceover: "选择 MOV 后隐藏压缩质量选项，其他导出参数保持不变。",
        action: async () => {
          await ctx.eval(`(()=>{const e=document.querySelector('[data-slot="select-trigger"][aria-label="Format"]');if(e.getAttribute('aria-expanded')!=='true')e.click()})()`);
          await ctx.waitForText("MOV (ProRes)");
          await ctx.trustedClick('[data-slot="select-item"]:nth-child(2)');
          await ctx.waitFor(`document.querySelector('[aria-label="Format"]').textContent.includes('MOV') && !document.querySelector('[aria-label="Quality"]')`);
        },
        assert: async () => {
          const result = await ctx.eval(`({format:document.querySelector('[aria-label="Format"]').textContent,quality:!!document.querySelector('[data-slot="select-trigger"][aria-label="Quality"]'),resolution:!!document.querySelector('[aria-label="Resolution"]')})`);
          ctx.assert(result.format.includes("MOV") && !result.quality && result.resolution, JSON.stringify(result));
        }, screenshot: {name: "shared-export-mov"},
      });
      await ctx.prove("切回MP4恢复质量参数和共享菜单", {
        voiceover: "切回 MP4，质量选项恢复，菜单使用共享选项组件。",
        action: async () => {
          await ctx.eval(`(()=>{const e=document.querySelector('[data-slot="select-trigger"][aria-label="Format"]');if(e.getAttribute('aria-expanded')!=='true')e.click()})()`);
          await ctx.waitFor(`document.querySelector('[role="option"]') !== null`);
          await ctx.trustedClick('[data-slot="select-item"]:first-child');
          await ctx.waitFor(`document.querySelector('[data-slot="select-trigger"][aria-label="Quality"]') !== null`);
          await ctx.eval(`document.querySelector('[data-slot="select-trigger"][aria-label="Quality"]').click()`);
          await ctx.waitFor(`document.querySelector('[data-slot="select-item"]') !== null`);
        },
        assert: async () => {
          const result = await ctx.eval(`({selects:document.querySelectorAll('[data-slot="select-trigger"]').length,options:document.querySelectorAll('[data-slot="select-item"]').length})`);
          ctx.assert(result.selects === 4 && result.options > 0, JSON.stringify(result));
        }, screenshot: {name: "shared-export-quality-menu"},
      });
      await ctx.eval(`document.querySelector('[data-slot="select-trigger"][aria-label="Quality"]').click()`);
      await ctx.prove("长分辨率文字不侵占勾选区", {
        voiceover: "分辨率菜单为勾选图标保留独立空间，长文字截断，勾选垂直居中。",
        action: async () => {
          await ctx.trustedClick('[data-slot="select-trigger"][aria-label="Resolution"]');
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="select-item"][aria-selected="true"]')).some(e=>e.textContent.includes('1280') && e.getBoundingClientRect().width>0)`);
        },
        assert: async () => {
          const geometry = await ctx.eval(`(()=>{const item=Array.from(document.querySelectorAll('[data-slot="select-item"][aria-selected="true"]')).find(e=>e.textContent.includes('1280') && e.getBoundingClientRect().width>0);const text=item.querySelector('[data-slot="select-item-text"]');const icon=item.querySelector('[data-slot="select-item-indicator"]');const t=text.getBoundingClientRect(),i=icon.getBoundingClientRect(),r=item.getBoundingClientRect();return {gap:i.left-t.right,center:Math.abs((i.top+i.bottom-r.top-r.bottom)/2),inside:i.right<=r.right,overflow:getComputedStyle(text).textOverflow}})()`);
          ctx.assert(geometry.gap >= 4 && geometry.center < 1 && geometry.inside && geometry.overflow === "ellipsis", JSON.stringify(geometry));
        }, screenshot: {name: "resolution-checkmark-spacing"},
      });
      await ctx.trustedClick('[data-slot="select-trigger"][aria-label="Resolution"]');
    },
  }, {
    name: "Studio layout regression geometry",
    run: async ctx => {
      await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:1440,height:960,deviceScaleFactor:1,mobile:false});
      const layoutUrl=process.env.IPOLLOWORK_VIDEO_LAYOUT_STUDIO_URL || studioOrigin + "/#project/shared-ui-export?v=1";
      await ctx.client.send("Page.navigate", {url:layoutUrl});
      await ctx.waitFor(`location.port===${JSON.stringify(new URL(layoutUrl).port)}`);
      await ctx.client.send("Page.reload", {ignoreCache:true});
      await ctx.waitForText("Export");
      await ctx.waitFor(`document.querySelector(".hf-timeline-layer-header__select")!==null`);
      await ctx.eval(`window.postMessage({type:'ipollowork:studio-host-context',projectId:decodeURIComponent(location.hash.match(/#project\\/([^?]+)/)[1]),title:'Layout proof',actions:{reload:true,saveAsTemplate:true}},location.origin)`);
      await ctx.waitFor(`document.querySelector('.hf-studio-header-utilities button')!==null`);
      await ctx.prove("四个操作靠右，不挤占左侧视图切换", {
        voiceover:"保存模板、重载、属性、导出保留各自功能，按钮组整体靠右。",
        assert:async()=> {
          const g=await ctx.eval(`(()=>{const h=document.querySelector('header'),a=h.querySelector('.hf-studio-header-actions'),v=h.querySelector('[role=tablist]');return{right:h.getBoundingClientRect().right-a.getBoundingClientRect().right,gap:a.getBoundingClientRect().left-v.getBoundingClientRect().right,count:a.querySelectorAll('button').length}})()`);
          ctx.assert(g.right<=12 && g.gap>200 && g.count===4,JSON.stringify(g));
        },screenshot:{name:"header-actions-right"}
      });
      await ctx.eval(`window.postMessage({type:"ipollowork:studio-theme",theme:"light"},location.origin)`);
      await ctx.waitFor(`document.documentElement.dataset.theme==="light"`);
      if (!await ctx.eval(`document.querySelector('[aria-label="Assets"]')?.getBoundingClientRect().width>0`)) await ctx.trustedClick('[aria-label="Properties"]');
      await ctx.waitFor(`document.querySelector('[aria-label="Assets"]')?.getBoundingClientRect().width>0`);
      for(const label of ["Assets","Components","Animation"]) {
        await ctx.trustedClick('[aria-label="'+label+'"]');
        await ctx.waitFor(`document.querySelector('[data-slot="studio-search"] input')?.getBoundingClientRect().width>0`);
        await ctx.prove(label+"搜索图标与文字分离，使用紧凑字号", {
          voiceover:"三个素材面板的搜索框统一为十二像素字号，图标和文字之间保留六像素间距。",
          assert:async()=>{
            const g=await ctx.eval(`(()=>{const w=document.querySelector('[data-slot="studio-search"]'),e=w.querySelector('input'),i=w.querySelector('svg'),s=getComputedStyle(e);return{font:s.fontSize,gap:e.getBoundingClientRect().left+parseFloat(s.paddingInlineStart)-i.getBoundingClientRect().right,height:e.getBoundingClientRect().height}})()`);
            ctx.assert(g.font==="12px"&&g.gap>=6&&g.height===32,JSON.stringify(g));
          },screenshot:{name:label.toLowerCase()+"-search-spacing"}
        });
        if(label==="Components") await ctx.prove("分类按钮仅一个居中图标，菜单仍能选择分类", {
          voiceover:"分类筛选使用独立图标按钮，不再挤入额外箭头。",
          action:async()=>{await ctx.trustedClick('[aria-label="Component category"]');await ctx.waitFor(`document.querySelector('[role="menuitemradio"]')!==null`);},
          assert:async()=>{
            const g=await ctx.eval(`(()=>{const b=document.querySelector('[aria-label="Component category"]'),i=b.querySelector('svg'),r=b.getBoundingClientRect(),s=i.getBoundingClientRect();return{count:b.querySelectorAll('svg').length,cx:Math.abs((s.left+s.right-r.left-r.right)/2),cy:Math.abs((s.top+s.bottom-r.top-r.bottom)/2),items:document.querySelectorAll('[role="menuitemradio"]').length}})()`);
            ctx.assert(g.count===1&&g.cx<1&&g.cy<1&&g.items>0,JSON.stringify(g));
          },screenshot:{name:"component-category-centered"}
        });
        if(label==="Components") {
          await ctx.trustedClick('[role="menuitemradio"]:nth-child(2)');
          await ctx.waitFor(`document.querySelector('[role="menu"]')===null`);
        }
      }
      await ctx.trustedClick('[aria-label="Layers"]');
      await ctx.trustedClick('.hf-timeline-layer-header__select');
      await ctx.waitFor(`document.querySelector('.hf-panel-accordion-header')!==null`);
      await ctx.prove("属性折叠恢复左对齐独立布局", {
        voiceover:"属性面板保留领域专用控件，不套通用按钮和输入框外观。",
        assert:async()=>{
          const g=await ctx.eval(`Array.from(document.querySelectorAll('.hf-panel-accordion-header')).map(e=>({slot:e.dataset.slot,align:getComputedStyle(e).textAlign,height:e.getBoundingClientRect().height,justify:getComputedStyle(e).justifyContent}))`);
          ctx.assert(g.length>0&&g.every(e=>!e.slot&&e.align==="left"&&e.justify!=="center"),JSON.stringify(g));
        },screenshot:{name:"property-accordion-restored"}
      });
      const textSelector='textarea[aria-label="Content"]';
      const originalText=await ctx.eval(`document.querySelector('${textSelector}').value`);
      await ctx.prove("属性文本默认显示三行，Enter换行不结束编辑", {
        voiceover:"文本编辑默认三行，内容增加时自动扩高，Enter保留在文本框内换行。",
        action:async()=>{
          await ctx.trustedClick(textSelector);
          await ctx.fill(textSelector,"第一行 正负描述的是回路作用方向\n第二行 不是好坏评价\n第三行 正反馈放大变化\n第四行 负反馈抵消变化");
          await ctx.client.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",text:"\r",windowsVirtualKeyCode:13});
          await ctx.client.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
          await ctx.waitFor(`document.querySelector('${textSelector}').value.split('\\n').length===5`);
        },
        assert:async()=>{
          const g=await ctx.eval(`(()=>{const e=document.querySelector('${textSelector}');return{rows:e.rows,height:e.clientHeight,focused:e===document.activeElement,lines:e.value.split('\\n').length}})()`);
          ctx.assert(g.rows===3&&g.height>=100&&g.height<=160&&g.focused&&g.lines===5,JSON.stringify(g));
        },screenshot:{name:"property-text-multiline"}
      });
      await ctx.prove("长文本最多八行高度，内部滚动且不截断内容", {
        voiceover:"超过八行时停止增高，全部文字仍保留，可以在文本框内滚动。",
        action:async()=>{await ctx.fill(textSelector,Array.from({length:12},(_,i)=>"第"+(i+1)+"行 完整保留文本内容").join("\n"));},
        assert:async()=>{
          const g=await ctx.eval(`(()=>{const e=document.querySelector('${textSelector}');return{height:e.clientHeight,scroll:e.scrollHeight,overflow:getComputedStyle(e).overflowY,lines:e.value.split('\\n').length}})()`);
          ctx.assert(g.height===160&&g.scroll>g.height&&g.overflow==="auto"&&g.lines===12,JSON.stringify(g));
        },screenshot:{name:"property-text-bounded-scroll"}
      });
      await ctx.fill(textSelector,originalText);
      await ctx.prove("缩短内容后恢复三行，失焦结束编辑", {
        voiceover:"删除长内容后文本框缩回三行，失焦沿用原有保存逻辑。",
        action:async()=>{await ctx.eval(`document.querySelector('${textSelector}').blur()`);},
        assert:async()=>{
          const g=await ctx.eval(`(()=>{const e=document.querySelector('${textSelector}');return{height:e.clientHeight,value:e.value,focused:e===document.activeElement}})()`);
          ctx.assert(g.height===60&&g.value===originalText&&!g.focused,JSON.stringify(g));
        },screenshot:{name:"property-text-shrink"}
      });
      await ctx.client.send("Page.bringToFront");
      await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:680,height:960,deviceScaleFactor:1,mobile:false});
      await ctx.waitFor(`document.visibilityState === 'visible' && innerWidth === 680 && document.documentElement.scrollWidth <= innerWidth && document.querySelector('.hf-studio-header-actions')?.getBoundingClientRect().right <= innerWidth`);
      await ctx.prove("窄屏顶部操作仍在右侧且无溢出", {
        voiceover:"窄屏收起操作标签，保留图标和提示。",
        assert:async()=>{
          const g=await ctx.eval(`(()=>{const a=document.querySelector('.hf-studio-header-actions'),r=a.getBoundingClientRect();return{right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
          ctx.assert(g.right<=g.width&&!g.overflow,JSON.stringify(g));
        },screenshot:{name:"header-actions-narrow"}
      });
      await ctx.client.send("Emulation.clearDeviceMetricsOverride");
    },
  }, {
    name: "Shared input and textarea single focus border",
    run: async ctx => {
      const fixture = new URL("../support/compact-controls-fixture.html", import.meta.url).pathname;
      await ctx.client.send("Page.navigate", {url: `${appOrigin}/@fs${fixture}?matrix=1`});
      await ctx.waitFor(`document.querySelector('#matrix-name') !== null`, {timeoutMs: 90000});
      for (const id of ["matrix-name", "matrix-text"]) {
        await ctx.prove(`${id}单层聚焦边框`, {
          voiceover: "共享输入框保留清晰的聚焦边框，不叠加外层光圈。",
          action: async () => { await ctx.trustedClick(`#${id}`); },
          assert: async () => {
            const style = await ctx.eval(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),s=getComputedStyle(e);return {focused:e===document.activeElement,slot:e.dataset.slot,border:s.borderWidth,ring:s.getPropertyValue('--tw-ring-shadow'),outline:s.outlineStyle}})()`);
            ctx.assert(style.focused && ["input", "textarea"].includes(style.slot) && style.border === "1px" && style.outline === "none" && style.ring.includes("0px") && !style.ring.includes("3px"), JSON.stringify(style));
          }, screenshot: {name: `${id}-single-focus-border`},
        });
      }
    },
  }, {
    name: "Real avatar and voice forms",
    run: async ctx => {
      await ctx.client.send("Page.navigate", {url:appOrigin + "/tests/video-avatar-proof.html?panel=avatar&profiles=1&audio=1"});
      await ctx.waitForText("创建数字人");
      await ctx.clickText("创建数字人");
      await ctx.waitFor(`document.querySelectorAll('[role="radio"]').length===2`);
      await ctx.prove("横竖屏通过共享单选键盘选择，保存真实表单值", {
        voiceover:"数字人横竖屏使用共享单选，键盘选择后，原有保存逻辑收到正确画幅。",
        action: async () => {
          await ctx.eval(`document.querySelector('[role="radio"][aria-checked="true"]').focus()`);
          await ctx.client.send("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
          await ctx.client.send("Input.dispatchKeyEvent",{type:"keyUp",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
          await ctx.waitFor(`document.querySelectorAll('[role="radio"]')[1].getAttribute('aria-checked')==='true'`);
          await ctx.clickText("保存设置");
        },
        assert:async()=>ctx.assert(await ctx.eval(`window.avatarProof.requests.some(r=>r.action==='avatar-profile-save' && r.args.ratio==='16:9')`),"Landscape ratio reached persistence"),
        screenshot:{name:"avatar-shared-radio"},
      });
      await ctx.client.send("Page.navigate",{url:appOrigin + "/tests/video-avatar-proof.html?mine=1"});
      await ctx.waitFor(`document.querySelector('[data-testid="voice-selection-trigger"]')!==null`);
      await ctx.trustedClick('[data-testid="voice-selection-trigger"]');
      await ctx.clickText("我的声音");
      await ctx.trustedClick('[data-testid="voice-clone-entry"]');
      await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"]')!==null`);
      await ctx.prove("复刻校验错误关联输入，失败保持弹窗",{
        voiceover:"复刻未填写名称时就地提示，错误与输入框关联，弹窗不关闭。",
        action:async()=>{await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');},
        assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const input=document.querySelector('[data-testid="voice-clone-dialog"] input');return input.getAttribute('aria-invalid')==='true' && !!document.getElementById(input.getAttribute('aria-describedby'))?.textContent && !window.avatarProof.requests.some(r=>r.action==='voice_clone_workspace_file')})()`),"Name error associated, no provider request");},
        screenshot:{name:"voice-clone-field-error"},
      });
    },
  }, {
    name:"Storyboard field feedback preserves input",
    run: async ctx => {
      await ctx.client.send("Page.navigate",{url:appOrigin + "/tests/video-avatar-proof.html?panel=storyboard"});
      await ctx.waitFor(`document.querySelector("#shot-material-brief") !== null`);
      await ctx.prove("分镜设置采用共享 Field，失败保留草稿并关联错误",{
        action:async()=>{await ctx.clickText("应用到脚本");await ctx.waitFor(`document.querySelector('[data-slot="field-error"]') !== null`);},
        assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const e=document.querySelector("#shot-material-brief"),id=e.getAttribute("aria-describedby");return e.value==="保留这个描述"&&e.getAttribute("aria-invalid")==="true"&&document.getElementById(id)?.dataset.slot==="field-error"&&!!document.querySelector('[role="dialog"]')})()`),"Failed apply retains real form values and accessible field error");},screenshot:{name:"storyboard-field-error"},
      });
    },
  }, {
    name:"Shared console retains real local editing",
    run: async ctx => {
      await ctx.client.send("Page.navigate",{url:consoleOrigin});
      await ctx.waitFor("document.querySelector('#studio')?.contentDocument?.querySelector('[data-ipw-runtime]')!==null");
      for(const step of workbench.steps) await step.run(ctx);
      await ctx.prove("窄屏暗色共享主题切换不丢失视频",{
        action:async()=>{await ctx.eval(`document.querySelector('#studio').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},location.origin)`);await ctx.waitFor(`document.querySelector('#studio').contentDocument.documentElement.dataset.theme==='dark'`);},
        assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('#studio').contentDocument,e=d.querySelector('[data-tool=rotate]'),s=getComputedStyle(e);return !!d.querySelector('#player').videoWidth&&d.documentElement.scrollWidth<=d.documentElement.clientWidth&&s.color!==s.backgroundColor&&d.querySelector('#downloadVideo').getBoundingClientRect().right<=480})()`),"Shared dark theme preserves preview, contrast, and reachable actions");},screenshot:{name:"console-dark-narrow"},
      });
    },
  }, {
    name:"Current client compiled Studio",
    run:async ctx=>{
      const url=process.env.IPOLLOWORK_VIDEO_CURRENT_STUDIO_URL;
      if(!url)return;
      await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:1180,height:900,deviceScaleFactor:1,mobile:false});
      await ctx.client.send("Page.navigate",{url});
      await ctx.waitFor(`document.querySelectorAll('[data-slot="tabs-trigger"]').length>=3`);
      await ctx.prove("当前客户端的内嵌 Studio 已加载新构建",{
        assert:async()=>{ctx.assert(await ctx.eval(`!!document.querySelector('[data-slot="button"][aria-label="Properties"]')&&!!document.querySelector('[data-slot="button"][aria-label="Export"]')&&document.querySelectorAll('[data-slot="tabs-trigger"]').length===3`),"Current running Studio serves shared Buttons and Tabs");},screenshot:{name:"current-client-built-studio"},
      });
    },
  }],
};
