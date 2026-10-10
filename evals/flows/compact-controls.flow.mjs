import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const voiceovers = await loadVoiceoverParagraphs("compact-controls");
const access = 'button[aria-label^="权限:"]';
const popup = '[data-slot="popover-content"]';
const editor = '[contenteditable="true"][data-lexical-editor="true"]';
const paste = (ctx, text) => ctx.eval(`(() => {const el=document.querySelector(${JSON.stringify(editor)});el.focus();const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));return true;})()`);
const escape = async ctx => {
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
};
const surface = ctx => ctx.eval(`(() => {const el=document.querySelector(${JSON.stringify(popup)}),s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,forcedDark:el.classList.contains('dark'),overflow:el.scrollWidth>el.clientWidth};})()`);
const imageEval = (ctx, code) => ctx.eval(`document.getElementById('image-plugin-proof').contentWindow.eval(${JSON.stringify(code)})`);
async function imagePoint(ctx, selector, x = .5, y = .5) {
  return ctx.eval(`(()=>{const f=document.getElementById('image-plugin-proof'),a=f.getBoundingClientRect(),b=f.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:a.left+f.clientLeft+b.left+b.width*${x},y:a.top+f.clientTop+b.top+b.height*${y}}})()`);
}
async function imageClick(ctx, selector, x, y) {
  const point = await imagePoint(ctx, selector, x, y);
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
}
let lightSurface;

export default {
  id: "compact-controls", title: "紧凑公共控件、真实 Composer 与 Design 工具栏（隔离传输）", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "compact-controls-fixture.html" },
  steps: [
    { name: "剩余分类紧凑样式与切换语义", async run(ctx) {
      await ctx.client.send("Page.bringToFront");
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await ctx.client.send("Page.reload");
      await ctx.waitFor("Boolean(document.querySelector('#remaining-categories'))", { timeoutMs: 90000 });
      await ctx.prove("表格、标签、导航和切换组共用紧凑规范且不裁字", {
        voiceover: voiceovers[6], action: async () => {
          await ctx.trustedClick('button[aria-label="居中"]');
          await ctx.eval("document.querySelector('#remaining-categories').scrollIntoView({block:'start'})");
        }, assert: async () => {
          const value = await ctx.eval(`(() => {const root=document.querySelector('#remaining-categories'),badge=root.querySelector('[data-slot=badge]'),toggle=root.querySelector('button[aria-label="居中"]'),head=root.querySelector('th'),alert=root.querySelector('[role=alert]');return {head:head.getBoundingClientRect().height,toggle:toggle.getBoundingClientRect().height,pressed:toggle.getAttribute('aria-pressed'),badge:badge.getBoundingClientRect().height,clipped:badge.scrollHeight>badge.clientHeight,alertPadding:getComputedStyle(alert).paddingTop};})()`);
          ctx.assert(value.head===32&&value.toggle===32&&value.pressed==='true'&&value.badge>=20&&!value.clipped&&value.alertPadding==='12px',JSON.stringify(value));
          const layout=await ctx.eval("(()=>{const c=document.querySelector('[data-slot=card]'),e=document.querySelector('[data-slot=empty]');return {cardPadding:getComputedStyle(c).paddingTop,cardRadius:getComputedStyle(c).borderRadius,emptyPadding:getComputedStyle(e).paddingTop,emptyRadius:getComputedStyle(e).borderRadius}})()");
          ctx.assert(layout.cardPadding==='12px'&&layout.cardRadius==='16px'&&layout.emptyPadding==='24px'&&layout.emptyRadius==='12px',JSON.stringify(layout));
        }, screenshot: {name:"remaining-families",requireText:["需要补充信息","组件规范"]},
      });
      await ctx.clickText("空状态"); await ctx.waitForText("暂无匹配结果"); await ctx.clickText("数据表格");
    } },
    { name: "普通与确认弹窗", async run(ctx) {
      await ctx.prove("紧凑弹窗保留取消、确认和焦点返回", {
        voiceover: voiceovers[7], action: async () => {await ctx.trustedClick('#remaining-categories [data-slot=dialog-trigger]');await ctx.waitFor("Boolean(document.querySelector('[data-slot=dialog-content]'))");},
        assert: async () => {const v=await ctx.eval("(()=>{const e=document.querySelector('[data-slot=dialog-content]'),s=getComputedStyle(e);return {padding:s.paddingTop,radius:s.borderRadius,scroll:s.overflowY,inside:e.getBoundingClientRect().width<innerWidth}})()");ctx.assert(v.padding==='16px'&&v.radius==='16px'&&v.scroll==='auto'&&v.inside,JSON.stringify(v));},
        screenshot:{name:"compact-dialog",requireText:["紧凑设置弹窗","保存设置"]},
      });
      await escape(ctx);await ctx.waitFor("!document.querySelector('[data-slot=dialog-content][data-open]')");
      await ctx.waitFor("document.activeElement.textContent.includes('打开设置弹窗')");
      await ctx.clickText("打开确认弹窗");await ctx.waitForText("确认采用结果？");await ctx.clickText("取消");await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content][data-open]')");
      ctx.assert(await ctx.eval("!document.querySelector('p[role=status]').textContent.includes('结果已采用')"),"Cancel does not adopt result");
      await ctx.clickText("打开确认弹窗");await ctx.waitForText("确认采用结果？");await ctx.clickText("确认采用");await ctx.waitForText("结果已采用");
      await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
      await ctx.trustedClick('#remaining-categories [data-slot=sheet-trigger]');await ctx.waitFor("Boolean(document.querySelector('[data-slot=sheet-content]'))");
      ctx.assert(await ctx.eval("getComputedStyle(document.querySelector('[data-slot=sheet-header]')).paddingTop==='16px' && getComputedStyle(document.querySelector('[data-slot=sheet-content]')).overflowY==='auto'"),"Sheet uses 16px padding and scrollable content");
      await ctx.clickText("关闭抽屉");await ctx.waitFor("!document.querySelector('[data-slot=sheet-content][data-open]')");
    } },
    { name: "提醒与结果确认", async run(ctx) {
      await ctx.prove("Alert 与 Toast 共用语义浅背景且无边框、圆形图标及右侧关闭入口，四种状态不截断", {
        voiceover: voiceovers[8], action: async () => {await ctx.clickText("显示轻提醒");await ctx.waitForText("统一完成");},
        assert: async () => {const v=await ctx.eval("(()=>{const e=[...document.querySelectorAll('[data-slot=toast-card]')].find(e=>e.textContent.includes('统一完成')),p=[...e.querySelectorAll('p')].find(p=>p.textContent==='统一完成'),s=getComputedStyle(e),icon=e.querySelector('.lucide-circle-check');return {radius:s.borderRadius,clipped:p.scrollHeight>p.clientHeight,icon:!!icon&&!!icon.closest('span.rounded-full'),border:s.borderTopWidth,background:s.backgroundColor,iconColor:getComputedStyle(icon.closest('span')).backgroundColor,close:!!e.querySelector('[aria-label=\"Close notification\"] .lucide-x'),alerts:[...document.querySelectorAll('#remaining-categories [data-slot=alert]')].map(x=>({icon:!!x.querySelector('svg.lucide'),border:getComputedStyle(x).borderTopWidth,background:getComputedStyle(x).backgroundColor,iconColor:getComputedStyle(x.querySelector('svg')).backgroundColor,close:!!x.querySelector('button[aria-label=\"关闭\"]'),clipped:x.scrollHeight>x.clientHeight}))}})()");ctx.assert(v.radius==='10px'&&!v.clipped&&v.icon&&v.border==='0px'&&v.background!==v.iconColor&&v.close&&v.alerts.length===4&&v.alerts.every(a=>a.icon&&a.border==='0px'&&a.background!==a.iconColor&&a.close&&!a.clipped),JSON.stringify(v));ctx.assert(await ctx.eval('(()=>{const e=document.querySelector("[data-business-notice] > div"),s=getComputedStyle(e);return s.borderTopWidth==="0px" && s.backgroundColor===getComputedStyle(document.querySelector("#remaining-categories [data-slot=alert].bg-feedback-error")).backgroundColor})()'),"business notice reuses error background without border");},
        screenshot:{name:"compact-toast",requireText:["统一完成","标签和提醒完整显示"]},
      });
      await ctx.prove("页面提醒和轻提醒无投影，内容垂直居中，关闭按钮真实移除通知", {
        voiceover: voiceovers[12],
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const center = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
            const toast = document.querySelector('[data-slot=toast-card]');
            const icon = toast.firstElementChild, content = icon.nextElementSibling, close = toast.lastElementChild;
            return { shadow: getComputedStyle(toast).boxShadow, aligned: Math.abs(center(icon)-center(content))<1 && Math.abs(center(close)-center(content))<1,
              alerts: [...document.querySelectorAll('#remaining-categories [data-slot=alert]')].map(el => ({shadow:getComputedStyle(el).boxShadow,aligned:Math.abs(center(el.querySelector('svg'))-center(el))<1 && Math.abs(center(el.querySelector('button'))-center(el))<1})) };
          })()`);
          const invisibleShadow = value => value === 'none' || value.split(', rgba').every(part => part.includes('0, 0, 0, 0) 0px 0px 0px 0px'));
          ctx.assert(invisibleShadow(state.shadow) && state.aligned && state.alerts.every(item => invisibleShadow(item.shadow) && item.aligned), JSON.stringify(state));
        },
        screenshot: { name: "shadowless-centered-notifications" },
      });
      await ctx.trustedClick('[data-slot=toast-card] button[aria-label="Close notification"]');
      await ctx.waitFor("!document.querySelector('[data-slot=toast-card]')", {timeoutMs:3000});
      await ctx.clickText("显示结果确认");await ctx.waitForText("需要确认");await ctx.clickText("确认采用");
      await ctx.waitForText("结果已采用");
      await ctx.clickText("显示信息提醒");await ctx.waitForText("需要补充信息");
      await ctx.clickText("显示错误提醒");await ctx.waitForText("连接失败");
      const lightSurface = await ctx.eval("getComputedStyle(document.querySelector('[data-slot=toast-card]')).backgroundColor");
      await ctx.eval("document.documentElement.dataset.theme='dark'");await ctx.clickText("显示轻提醒");await ctx.waitForText("统一完成");
      ctx.assert(await ctx.eval("getComputedStyle(document.querySelector('[data-slot=toast-card]')).backgroundColor") !== lightSurface, "Toast follows dark surface token");
      await ctx.eval("document.documentElement.dataset.theme='light';window.scrollTo(0,0)");
    } },
    { name: "32px 控件与轻量按钮", async run(ctx) {
      const previousOrigin = await ctx.eval("performance.timeOrigin");
      await ctx.client.send("Page.reload");
      await ctx.waitFor(`performance.timeOrigin !== ${previousOrigin} && Boolean(document.querySelector('#project'))`, { timeoutMs: 90000 });
      await ctx.waitFor("Boolean(document.querySelector('#project'))", { timeoutMs: 90000 });
      await ctx.prove("真实公共控件采用紧凑尺寸，保留主操作与禁用状态", {
        voiceover: voiceovers[0],
        assert: async () => {
          const values = await ctx.eval(`(() => {const bs=[...document.querySelectorAll('[data-slot="button"]')];const h=e=>e.getBoundingClientRect().height;const edit=bs.find(b=>b.textContent==='编辑');return {input:h(document.querySelector('#project')),select:h(document.querySelector('[aria-label="外观选择"]')),edit:h(edit),save:h(bs.find(b=>b.textContent==='保存')),icon:!!edit.querySelector('.lucide-pencil'),disabled:bs.find(b=>b.textContent==='不可用').disabled,background:getComputedStyle(edit).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
          ctx.assert(values.input === 32 && values.select === 32 && values.edit === 32 && values.save === 36, JSON.stringify(values));
          ctx.assert(values.icon && values.disabled && values.background === "rgba(0, 0, 0, 0)" && !values.overflow, "Lightweight icon+label and safe layout");
        }, screenshot: { name: "compact-form", requireText: ["设置表单", "正文不缩小"] },
      });
    } },
    { name: "浅色权限菜单与焦点返回", async run(ctx) {
      await ctx.prove("权限菜单跟随浅色，没有横向裁切，Escape 返回入口", {
        voiceover: voiceovers[1], action: async () => { await ctx.trustedClick(access); await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(popup)}))`); },
        assert: async () => {
          lightSurface = await surface(ctx);
          ctx.assert(!lightSurface.forcedDark && !lightSurface.overflow, JSON.stringify(lightSurface));
          ctx.assert(await ctx.eval("document.documentElement.dataset.theme !== 'dark'"), "Light theme is active");
          ctx.assert(await ctx.eval("document.querySelector('[data-access-mode-option=default]').getAttribute('aria-pressed')==='true'"), "Current permission remains selected");
        }, screenshot: { name: "light-permission", requireText: ["沿用当前智能体配置", "只读"] },
      });
      await escape(ctx); await ctx.waitFor(`!document.querySelector(${JSON.stringify(popup)})`);
      ctx.assert(await ctx.eval(`document.activeElement?.matches(${JSON.stringify(access)})`), "Escape restores focus to permission trigger");
    } },
    { name: "深色浮层保持相同结构", async run(ctx) {
      await ctx.prove("深浅色共用菜单，只切换主题颜色", {
        voiceover: voiceovers[2], action: async () => { await ctx.clickText("切换深色"); await ctx.trustedClick(access); await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(popup)}))`); },
        assert: async () => { const darkSurface = await surface(ctx); ctx.assert(darkSurface.background !== lightSurface.background && darkSurface.color !== lightSurface.color && !darkSurface.forcedDark && !darkSurface.overflow, JSON.stringify({ lightSurface, darkSurface })); },
        screenshot: { name: "dark-permission", requireText: ["只读", "智能体默认"] },
      });
      await escape(ctx); await ctx.waitFor(`!document.querySelector(${JSON.stringify(popup)})`); await ctx.clickText("切换浅色");
    } },
    { name: "真实画布工具栏与提示", async run(ctx) {
      await ctx.prove("画布工具栏收紧留白，Lucide 图标和公共 Tooltip 可用", {
        voiceover: voiceovers[3], action: async () => {
          await ctx.eval("[...document.querySelectorAll('[data-slot=toggle-group-item]')].find(b=>b.textContent==='编辑').click()");
          await ctx.waitFor("document.querySelector('iframe').contentDocument.documentElement.getAttribute('data-ipollowork-design-mode')==='editing'");
          await ctx.eval("document.querySelector('iframe').contentDocument.getElementById('headline').click()");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=design-floating-toolbar]'))");
          const point=await ctx.eval("(()=>{const r=document.querySelector('[data-testid=design-floating-toolbar] button:has(.lucide-type)').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
          await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
          await ctx.waitFor("Boolean(document.querySelector('[data-slot=tooltip-content]'))");
        }, assert: async () => {
          const result=await ctx.eval("(()=>{const t=document.querySelector('[data-testid=design-floating-toolbar]'),s=getComputedStyle(t),tip=document.querySelector('[data-slot=tooltip-content]');return {padding:s.paddingTop,gap:s.columnGap,height:t.getBoundingClientRect().height,customImage:!!t.querySelector('img'),type:!!t.querySelector('.lucide-type'),ai:!!t.querySelector('.lucide-sparkles'),tooltip:!!tip,tooltipRadius:getComputedStyle(tip).borderRadius}})()");
          ctx.assert(result.padding==='4px'&&result.gap==='8px'&&result.height<=38&&!result.customImage&&result.type&&result.ai&&result.tooltipRadius==='8px',JSON.stringify(result));
        }, screenshot: { name: "compact-toolbar", requireText: ["设置表单"] },
      });
      await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 });
    } },
    { name: "执行、排队、停止（模拟传输）", async run(ctx) {
      await ctx.prove("真实 Composer 保留执行与排队的单一主操作切换", {
        voiceover: voiceovers[4], action: async () => {
          await paste(ctx,"验证紧凑输入框");
          await ctx.waitFor(`document.querySelector(${JSON.stringify(editor)})?.innerText.includes('验证紧凑输入框')`);
          await ctx.eval("document.querySelector('.composer-card button[title=\"运行任务\"]').click()");
          await ctx.waitFor("Boolean(document.querySelector('button[aria-label=\"停止\"]'))");
          await paste(ctx,"接下来检查排队");
          await ctx.waitFor("Boolean(document.querySelector('button[aria-label=\"智能体完成后发送\"]'))");
          await ctx.eval("document.querySelector('button[aria-label=\"智能体完成后发送\"]').click()");
          await ctx.waitForText("已排队（模拟）");
        }, assert: async () => { ctx.assert(await ctx.eval("Boolean(document.querySelector('button[aria-label=\"停止\"]')) && !document.querySelector('button[aria-label=\"智能体完成后发送\"]')"),"After queuing the empty draft shows only Stop"); },
        screenshot: { name: "composer-queued", requireText: ["已排队（模拟）"] },
      });
      await ctx.trustedClick('button[aria-label="停止"]'); await ctx.waitForText("任务已停止（模拟）");
    } },
    { name: "模板搜索与选择键盘操作", async run(ctx) {
      await ctx.prove("实际模板目录继承控件尺寸，公共 Select 保留键盘选择", {
        voiceover: voiceovers[9], action: async () => {await ctx.clickText('打开真实模板目录');await ctx.waitFor("document.querySelector('[data-testid=template-catalog-dialog] input')?.getBoundingClientRect().height===32");},
        assert: async () => {const v=await ctx.eval("(()=>{const d=document.querySelector('[data-testid=template-catalog-dialog]');return {padding:getComputedStyle(d).paddingTop,input:d.querySelector('input').getBoundingClientRect().height,scroll:d.getBoundingClientRect().height<=innerHeight-32}})()");ctx.assert(v.padding==='16px'&&v.input===32&&v.scroll,JSON.stringify(v));},
        screenshot:{name:'template-search',requireText:['模板目录验收']},
      });
      await escape(ctx);await ctx.waitFor("!document.querySelector('[data-testid=template-catalog-dialog]')");
      await ctx.trustedClick('[aria-label="外观选择"]');
      await ctx.waitFor("Boolean(document.querySelector('[data-slot=select-content] [role=option]'))");
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
      await ctx.waitFor("document.querySelector('[data-slot=select-item][data-highlighted]')?.textContent.includes('浅色')");
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await ctx.waitFor("document.querySelector('[aria-label=\"外观选择\"]').getAttribute('aria-expanded')==='false'");
      await ctx.waitFor("document.activeElement.matches('[aria-label=\"外观选择\"]') && document.activeElement.textContent.includes('浅色')");
      ctx.assert(await ctx.eval("document.activeElement.matches('[aria-label=\"外观选择\"]') && document.activeElement.textContent.includes('浅色')"),'Keyboard selected Light and focus returned');
    } },
    { name: "图片插件 Tooltip 与 AI 引用", async run(ctx) {
      await ctx.eval("document.getElementById('image-plugin-proof').scrollIntoView({block:'center'})");
      await ctx.waitFor("Boolean(document.getElementById('image-plugin-proof').contentDocument.querySelector('#askAi'))");
      await imageEval(ctx, "(async()=>{const c=document.createElement('canvas');c.width=480;c.height=240;const g=c.getContext('2d');g.fillStyle='#e5edf0';g.fillRect(0,0,480,240);g.fillStyle='#1c2024';g.font='24px sans-serif';g.fillText('隔离样图 · AI 批注',60,120);await renderImage({path:'evals/isolated-sample.png',name:'隔离样图.png',dataUrl:c.toDataURL()});setMode('edit');return true})()");
      await ctx.prove("插件 Tooltip 主题、聚焦和边界一致；批注点随缩放保持位置", {
        voiceover:voiceovers[10],action:async()=>{await imageEval(ctx,"(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.activeElement.blur();document.querySelector('#askAi').focus();return true})()");await ctx.waitFor("!document.getElementById('image-plugin-proof').contentDocument.querySelector('#instantTooltip').hidden");},
        assert:async()=>{
          const light=await imageEval(ctx,"(()=>{const e=document.querySelector('#instantTooltip'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {hidden:e.hidden,radius:s.borderRadius,padding:s.padding,font:s.fontSize,bg:s.backgroundColor,fg:s.color,inside:r.left>=8&&r.right<=innerWidth-8&&r.top>=8&&r.bottom<=innerHeight-8,aria:document.querySelector('#askAi').getAttribute('aria-describedby')}})()");
          ctx.assert(!light.hidden&&light.radius==='8px'&&light.padding==='4px 8px'&&light.font==='12px'&&light.inside&&light.aria==='instantTooltip',JSON.stringify(light));
          await imageEval(ctx,"document.documentElement.style.colorScheme='dark';true");
          const dark=await imageEval(ctx,"(()=>{const s=getComputedStyle(document.querySelector('#instantTooltip'));return {bg:s.backgroundColor,fg:s.color}})()");
          ctx.assert(dark.bg!==light.bg&&dark.fg!==light.fg,JSON.stringify({light,dark}));
          await escape(ctx);ctx.assert(await imageEval(ctx,"document.querySelector('#instantTooltip').hidden && !document.querySelector('#askAi').hasAttribute('aria-describedby')"),'Escape hides tooltip and clears description');
          await imageEval(ctx,"document.documentElement.style.colorScheme='light';true");
          await imageClick(ctx,'#askAi');
          ctx.assert(await imageEval(ctx,"!document.querySelector('#annotationHint').hidden && document.querySelector('#askAi').getAttribute('aria-pressed')==='true'"),'Annotation mode shows status hint');
          await imageClick(ctx,'#selectionCanvas',.25,.5);
          await ctx.waitFor("window.imagePluginReference?.kind==='point'");
          const ref=await ctx.eval('window.imagePluginReference');ctx.assert(Math.abs(ref.point.x-.25)<.02&&Math.abs(ref.point.y-.5)<.02&&ref.sourcePath==='evals/isolated-sample.png',JSON.stringify(ref));
          await imageClick(ctx,'#zoomIn');
          ctx.assert(await imageEval(ctx,"document.querySelector('#annotationMarker').style.left==='25%' && document.querySelector('#annotationMarker').style.top==='50%'"),'Zoom preserves normalized marker coordinates');
        },screenshot:{name:'image-plugin-annotation',requireText:['迁移验收']},
      });
      await imageClick(ctx,'[data-tool="rectangle"]');
      const from=await imagePoint(ctx,'#selectionCanvas',.3,.3),to=await imagePoint(ctx,'#selectionCanvas',.6,.7);
      await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...from});
      await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...to});
      await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...to});
      ctx.assert(await imageEval(ctx,"!document.querySelector('#selectionActions').hidden && document.querySelector('#selectionAskAi [data-lucide=sparkles]')!==null"),'Selection actions keep Lucide Sparkles');
      await imageClick(ctx,'#selectionAskAi');await ctx.waitFor("window.imagePluginReference?.kind==='selection'");
      const ref=await ctx.eval('window.imagePluginReference');ctx.assert(ref.selection.left>=.28&&ref.selection.right<=.63,JSON.stringify(ref));
      await ctx.prove('真实选区工具栏保持 28px 控件与结构化选区引用', {voiceover:voiceovers[10],assert:async()=>{ctx.assert(await imageEval(ctx,"getComputedStyle(document.querySelector('#selectionAskAi')).height==='28px' && document.querySelector('#toolbar').getBoundingClientRect().height===38"),'Selection control 28px, main toolbar 38px');},screenshot:{name:'image-selection-reference',requireText:['迁移验收']}});
      await ctx.eval("document.getElementById('image-plugin-proof').style.width='340px'");
      await imageEval(ctx,"(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.activeElement.blur();document.querySelector('#askAi').focus();return true})()");
      await ctx.waitFor("(()=>{const d=document.getElementById('image-plugin-proof').contentDocument,e=d.querySelector('#instantTooltip'),r=e.getBoundingClientRect();return !e.hidden && r.left>=8 && r.right<=d.documentElement.clientWidth-8})()");
      ctx.assert(await imageEval(ctx,"(()=>{const r=document.querySelector('#instantTooltip').getBoundingClientRect();return r.left>=8&&r.right<=innerWidth-8&&!document.querySelector('#instantTooltip').hidden})()"),'Narrow tooltip remains inside plugin viewport');
      await escape(ctx);await ctx.eval("document.getElementById('image-plugin-proof').style.width='100%';window.scrollTo(0,0)");
    } },
    { name: "任务进度区分真实数值与阶段加载", async run(ctx) {
      await ctx.prove("任务进度使用 6px 轨道，未知总量不显示伪造百分比", {
        voiceover: voiceovers[11],
        action: async () => { await ctx.eval("document.querySelector('#task-progress-proof').scrollIntoView({block:'center'})"); },
        assert: async () => {
          const state = await ctx.eval("(()=>{const bars=[...document.querySelectorAll('#task-progress-proof [role=progressbar]')];return bars.map(bar=>({value:bar.getAttribute('aria-valuenow'),indeterminate:bar.hasAttribute('data-indeterminate'),height:getComputedStyle(bar.querySelector('[data-slot=progress-track]')).height,fill:getComputedStyle(bar.querySelector('[data-slot=progress-indicator]')).backgroundColor,label:bar.getAttribute('aria-label')}))})()");
          ctx.assert(state.length===2&&state.every(bar=>bar.height==='6px'&&bar.fill==='rgb(31, 186, 192)')&&state[0].value==='45'&&!state[0].indeterminate&&state[1].value===null&&state[1].indeterminate,JSON.stringify(state));
        },
        screenshot: {name:'compact-task-progress',requireText:['下载进度 45%','正在连接，暂时无法计算百分比']},
      });
      await ctx.prove("图片插件在预估阶段显示 6px 青绿色进度", {
        voiceover: voiceovers[11],
        action: async () => {
          await ctx.eval("document.getElementById('image-plugin-proof').scrollIntoView({block:'center'})");
          await imageEval(ctx, "setMode('generate');state.generating=true;state.generationStartedAt=Date.now()-30000;renderGallery();true");
        },
        assert: async () => {
          const value = await imageEval(ctx, "(()=>{const p=document.querySelector('.generation-pending progress'),s=getComputedStyle(p);return {height:s.height,track:s.backgroundColor,accent:s.accentColor,label:document.querySelector('.generation-label').textContent,hidden:p.hidden}})()");
          ctx.assert(value.height==='6px'&&value.accent==='rgb(31, 186, 192)'&&value.label.includes('预估')&&!value.hidden,JSON.stringify(value));
        },
        screenshot: {name:'image-plugin-estimated-progress',requireText:['迁移验收']},
      });
      await ctx.prove("图片生成超过两分钟只显示等待时长，不停留在 95%", {
        voiceover: voiceovers[11],
        action: async () => { await imageEval(ctx, "state.generationStartedAt=Date.now()-121000;refreshImageProgress();true"); },
        assert: async () => {
          const waiting = await imageEval(ctx, "(()=>({label:document.querySelector('.generation-label').textContent,hidden:document.querySelector('.generation-pending progress').hidden}))()");
          ctx.assert(waiting.hidden&&waiting.label.includes('已等待')&&!waiting.label.includes('%'),JSON.stringify(waiting));
        },
        screenshot: {name:'image-plugin-waiting',requireText:['迁移验收']},
      });
      await imageEval(ctx, "state.generating=false;state.generationStartedAt=0;renderGallery();true");
    } },
    { name: "底部所有入口共享浮层外观", async run(ctx) {
      for (const [name, selector, content] of [
        ["add", '.composer-card button[aria-haspopup="dialog"]', '[data-testid="composer-plus-menu"]'],
        ["model", 'button[aria-label^="切换模型"]', popup],
        ["mode", 'button[aria-label^="工作模式:"]', popup],
        ["context", 'button[aria-label^="上下文体检:"]', popup],
      ]) {
        await ctx.prove(`${name} 浮层共用主题且不挤压输入区`, {
          voiceover: voiceovers[5],
          action: async () => { await ctx.trustedClick(selector); await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(content)}))`); },
          assert: async () => {
            const value=await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(content)}),s=getComputedStyle(e),r=e.getBoundingClientRect();return {background:s.backgroundColor,position:s.position,overflow:e.scrollWidth>e.clientWidth,outside:r.left<0||r.right>innerWidth};})()`);
            ctx.assert(value.background===lightSurface.background&&!value.overflow&&!value.outside,JSON.stringify(value));
            if(name==='add')ctx.assert(value.position==='absolute',"Add menu stays floating instead of participating in composer layout");
          }, screenshot: { name: `composer-${name}-surface`, requireText: ["对话输入框"] },
        });
        await escape(ctx); await ctx.waitFor(`!document.querySelector(${JSON.stringify(content)})`);
      }
    } },
  ],
};
