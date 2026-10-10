import { buildPluginRuntime } from '../../packages/ui/build-plugin-runtime.mjs';
import { coreDemoHtml } from '../support/shared-ui-core-fixture.mjs';
import { connect, evaluate, listTargets } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('shared-ui-core');
const origin = process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN || 'http://127.0.0.1:5193';
const preview = origin+'/@fs'+new URL('../support/shared-ui-core.html',import.meta.url).pathname;
async function key(parent,name) {
  const code=name===' '?'Space':name;
  for(const type of ['keyDown','keyUp'])await parent.send('Input.dispatchKeyEvent',{type,key:name,code,windowsVirtualKeyCode:name==='Escape'?27:name===' '?32:name==='ArrowDown'?40:13,...(type==='keyDown'&&(name==='Enter'||name===' ')?{text:name==='Enter'?'\r':' '}:{})});
}
async function click(parent,frame,selector) {
  for(let attempt=0;attempt<100;attempt++) {
    if(await evaluate(frame,`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;
    if(attempt===99)throw Error('Missing interaction target: '+selector);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await evaluate(frame,`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await key(parent,'Enter');
}
async function findFrame(ctx,mode) {
  for(let attempt=0;attempt<80;attempt++) {
    for(const target of (await listTargets(ctx.cdpBaseUrl)).filter(t=>t.type==='iframe')) {
      const c=await connect(target.webSocketDebuggerUrl);
      if(await evaluate(c,`window.ipolloworkUi?.mode===${JSON.stringify(mode)} && Boolean(document.querySelector('#receipt')) && Boolean(document.querySelector('#name'))`).catch(()=>false))return c;
      c.close();
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Core demo did not mount');
}
export default {
  id:'shared-ui-core',title:'核心共享组件：公共运行时实际调用',kind:'user-facing',preserveTheme:true,
  cdpTarget:{urlIncludes:origin},
  steps:['bundled','host'].map(mode=>({name:mode+' 调用',async run(ctx){
    const parent=ctx.client;
    await parent.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await parent.send('Page.navigate',{url:preview+'?mode='+mode});
    await parent.send('Page.bringToFront');
    if(mode==='bundled') {
      const {script}=await buildPluginRuntime('bundled');
      await ctx.waitFor('Boolean(document.querySelector("iframe"))');
      await evaluate(parent,`document.querySelector('iframe').srcdoc=${JSON.stringify(coreDemoHtml(script))}`);
    }
    const frame=await findFrame(ctx,mode);ctx.client=frame;
    const shot=name=>({name:mode+'-'+name,targetId:parent.targetId,textTargetId:frame.targetId});
    try {
      await ctx.prove('公共组件可调用，字段失败保留草稿，多选与搜索选择工作',{
        voiceover:vo[0],action:async()=>{
          const foundations = await ctx.eval(`(async()=>{const tiers=[['page-title',16,24,600],['section-title',14,20,600],['control',13,18,500],['body',13,20,400],['meta',12,18,400],['caption',11,16,400],['micro',10,14,600]];const results=[];for(const theme of ['light','dark'])for(const rootSize of [13,16]){document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=rootSize+'px';await new Promise(r=>setTimeout(r,250));for(const [name,size,line,weight]of tiers){const p=document.createElement('span');p.className='text-ui-'+name;p.textContent='字体';document.body.append(p);const s=getComputedStyle(p);results.push({name,theme,rootSize,size:s.fontSize,line:s.lineHeight,weight:s.fontWeight,pass:s.fontSize===size+'px'&&s.lineHeight===line+'px'&&s.fontWeight===String(weight)});p.remove();}const b=document.querySelector('#fail'),s=getComputedStyle(b);results.push({name:'primary-button',theme,pass:s.backgroundColor===(theme==='light'?'rgb(22, 30, 36)':'rgb(31, 186, 192)')&&s.color===(theme==='light'?'rgb(255, 255, 255)':'rgb(22, 30, 36)')});const i=document.querySelector('#name').getBoundingClientRect(),d=document.querySelector('[data-slot=field-description]').getBoundingClientRect();results.push({name:'field-hint',theme,gap:d.top-i.bottom,pass:Math.abs(d.top-i.bottom-8)<0.5});}document.documentElement.dataset.theme='light';document.documentElement.style.fontSize='16px';return results})()`,{awaitPromise:true});
          ctx.assert(foundations.every(result=>result.pass),'public foundations in both themes and root font sizes: '+JSON.stringify(foundations));
          await ctx.fill('#name','保留我的草稿');await click(parent,frame,'#fail');
          ctx.assert(await ctx.eval('document.querySelector("#name").value==="保留我的草稿" && document.querySelector("#name").getAttribute("aria-invalid")==="true"'),'field draft and error association');
          await click(parent,frame,'#retry');
          await ctx.eval('document.querySelector("[role=checkbox]").focus()');await key(parent,' ');
          await ctx.eval('document.querySelector("[role=switch]").focus()');await key(parent,' ');
          await ctx.waitFor('document.querySelector("[role=switch]").getAttribute("aria-checked")==="true"');
          await ctx.eval('document.querySelector("[aria-label=方案甲][role=radio]").focus()');await key(parent,'ArrowDown');
          await ctx.waitFor('document.querySelector("[aria-label=方案乙][role=radio]").getAttribute("aria-checked")==="true"');
          await click(parent,frame,'[aria-label=加粗]');
          await ctx.waitFor('document.querySelector("[aria-label=加粗]").getAttribute("aria-pressed")==="true"');
          await ctx.eval('document.querySelector("[aria-label=搜索选择]").focus()');
          await parent.send('Input.insertText',{text:'产品'});
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=autocomplete-item]"))');
          await key(parent,'Enter');
        },assert:async()=>{
          await ctx.waitFor('document.querySelector("#receipt").textContent==="搜索选择：产品"');
          ctx.assert(await ctx.eval('document.querySelector("[role=checkbox]").getAttribute("aria-checked")==="true"'),'checkbox checked');
          ctx.assert(await ctx.eval('window.__libraryRequired.every(name=>typeof window.ipolloworkUi[name]==="function")'),'all declared public components present');
        },screenshot:shot('form'),
      });
      await ctx.prove('菜单执行回调，命令搜索可以选择',{
        voiceover:vo[1],action:async()=>{
          await click(parent,frame,'[id="group-菜单与浮层"]');await click(parent,frame,'#menu');
          await ctx.waitFor('Boolean(document.querySelector("#menu-action"))');await click(parent,frame,'#menu-action');
          await ctx.waitFor('document.querySelector("#receipt").textContent==="菜单已执行"');
          await click(parent,frame,'#popover');
          await ctx.waitFor('document.querySelector("[data-slot=popover-content]")?.textContent==="浮层内容"');await key(parent,'Escape');
          await ctx.waitFor('!document.querySelector("[data-slot=popover-content]")');
          await ctx.eval('document.querySelector("[aria-label=搜索命令]").focus()');
          await parent.send('Input.insertText',{text:'角色'});await key(parent,'Enter');
        },assert:()=>ctx.waitFor('document.querySelector("#receipt").textContent==="命令：角色"'),screenshot:shot('menus'),
      });
      await ctx.prove('确认取消不执行，确认和抽屉具有明确操作结果',{
        voiceover:vo[2],action:async()=>{
          await click(parent,frame,'[id="group-对话框与抽屉"]');
          await click(parent,frame,'#dialog-trigger');await ctx.waitFor('Boolean(document.querySelector("[aria-label=弹窗输入]"))');await key(parent,'Escape');
          await ctx.waitFor('!document.querySelector("[aria-label=弹窗输入]")');
          await click(parent,frame,'#confirm-trigger');
          await ctx.waitFor('Boolean(document.querySelector("#confirm-cancel"))');await click(parent,frame,'#confirm-cancel');
          await ctx.waitFor('!document.querySelector("#confirm-cancel")');
          ctx.assert(await ctx.eval('document.querySelector("#receipt").textContent==="命令：角色"'),'cancel does not execute');
          await click(parent,frame,'#confirm-trigger');await ctx.waitFor('Boolean(document.querySelector("#confirm-action"))');await click(parent,frame,'#confirm-action');
          await ctx.waitFor('!document.querySelector("#confirm-action")');
          await click(parent,frame,'#sheet-trigger');await ctx.waitFor('Boolean(document.querySelector("[data-slot=sheet-content]"))');
          await ctx.waitFor('document.querySelector("[data-slot=sheet-content]").contains(document.activeElement)');await key(parent,'Escape');
        },assert:async()=>{
          await ctx.waitFor('!document.querySelector("[data-slot=sheet-content]")');
          await ctx.waitFor('document.activeElement.id==="sheet-trigger"');
          ctx.assert(await ctx.eval('document.querySelector("#receipt").textContent==="确认已执行"'),'confirmation callback');
        },screenshot:shot('dialogs'),
      });
      await ctx.prove('数据、反馈与布局组件在暗色窄容器保持可用',{
        voiceover:vo[3],action:async()=>{
          await click(parent,frame,'[id="group-数据、状态与布局"]');await click(parent,frame,'#tab-two');await click(parent,frame,'#accordion');
          await click(parent,frame,'[data-slot=collapsible-trigger]');await ctx.waitFor('document.querySelector("[data-slot=collapsible-content]")?.textContent==="详情已展开"');
          await click(parent,frame,'#descriptive');await ctx.waitFor('document.querySelector("#receipt").textContent==="描述按钮已执行"');
          await ctx.eval('document.querySelector("[aria-label=可滚动内容]").scrollTop=80');
          await ctx.waitFor('document.querySelector("[aria-label=可滚动内容]").scrollTop>0');
          await click(parent,frame,'#notify');
          await evaluate(frame,'document.documentElement.dataset.theme="dark"');
          await parent.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
        },assert:async()=>{
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=toast-card]")) && document.querySelector("[data-sonner-toaster]").dataset.sonnerTheme==="dark"');
          ctx.assert(await ctx.eval('document.querySelector("[data-slot=tabs-content]").textContent==="详情内容"'),'tabs switch');
          ctx.assert(await ctx.eval('document.querySelector("[data-slot=accordion-content]").textContent==="说明已展开"'),'accordion expands');
          ctx.assert(await ctx.eval('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow")==="40"'),'actual progress value');
          await ctx.waitFor('getComputedStyle(document.querySelector("[data-slot=table-cell]")).color===getComputedStyle(document.querySelector("[data-slot=card]")).color',{label:'dark table inherits readable card text'});
          ctx.assert(await ctx.eval('getComputedStyle(document.querySelector("[data-feedback=warning]")).borderTopWidth==="0px"'),'warning alert has no border');
          ctx.assert(await ctx.eval('document.documentElement.scrollWidth<=innerWidth'),'narrow document fits');
        },screenshot:shot('dark-narrow'),
      });
      await ctx.prove('Toast关闭按钮图标居中，不依赖宿主全局重置',{
        voiceover:vo[4],action:async()=>{
          await ctx.eval('window.ipolloworkUi.toast.dismiss();window.ipolloworkUi.toast.success("关闭按钮居中验证",{duration:Infinity})');
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=toast-close]"))');
          for(const theme of ['light','dark'])for(const width of [1280,390])for(const fontSize of [13,16])for(const zoom of [1,1.25,1.5]) {
            await parent.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
            await ctx.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.fontSize=${JSON.stringify(fontSize+'px')};document.documentElement.style.zoom=${zoom}`);
            const selector='[aria-label="Close notification"]';
            const point=await ctx.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
            for(const state of ['normal','hover','focus']) {
              await parent.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:state==='hover'?point.x:1,y:state==='hover'?point.y:1});
              await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).${state==='focus'?'focus':'blur'}()`);
              const metrics=await ctx.eval(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),s=b.querySelector('svg'),r=b.getBoundingClientRect(),i=s.getBoundingClientRect(),c=getComputedStyle(b);return {dx:Math.abs(r.x+r.width/2-i.x-i.width/2)/${zoom},dy:Math.abs(r.y+r.height/2-i.y-i.height/2)/${zoom},width:r.width/${zoom},height:r.height/${zoom},icon:i.width/${zoom},padding:c.padding,border:c.borderTopWidth}})()`);
              ctx.assert(metrics.dx<=1&&metrics.dy<=1&&Math.abs(metrics.width-28)<=1&&Math.abs(metrics.height-28)<=1&&Math.abs(metrics.icon-16)<=1&&metrics.padding==='0px'&&metrics.border==='0px',`${mode}/${theme}/${width}/${fontSize}px/${zoom}/${state}: ${JSON.stringify(metrics)}`);
            }
          }
          await ctx.eval('document.documentElement.style.zoom="1";document.documentElement.style.fontSize="13px"');
          await click(parent,frame,'[aria-label="Close notification"]');
          await ctx.waitFor('!document.querySelector("[data-slot=toast-card]")');
          await ctx.eval('window.ipolloworkUi.toast.success("鼠标关闭验证",{duration:Infinity})');
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=toast-close]"))');
          await ctx.waitFor('document.querySelector("[data-sonner-toast]").dataset.mounted==="true" && document.querySelector("[data-sonner-toast]").getAnimations({subtree:true}).every(a=>a.playState!=="running")');
          const point=await ctx.eval('(()=>{const r=document.querySelector("[data-slot=toast-close]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
          for(const type of ['mousePressed','mouseReleased'])await parent.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
          await ctx.waitFor('!document.querySelector("[data-slot=toast-card]")');
          await ctx.eval('window.ipolloworkUi.toast.success("居中回归通过",{duration:Infinity})');
        },assert:async()=>{
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=toast-close]"))');
          await ctx.waitFor('document.querySelector("[data-sonner-toast]").dataset.mounted==="true" && document.querySelector("[data-sonner-toast]").getAnimations({subtree:true}).every(a=>a.playState!=="running") && document.querySelector("[data-slot=toast-close]").getBoundingClientRect().top>=0');
        },screenshot:shot('close-centered'),
      });
      await ctx.prove('四种语义提醒和Toast使用亮暗浅背景，关闭与重试可用',{
        voiceover:vo[5],action:async()=>{
          await ctx.eval('window.ipolloworkUi.toast.dismiss()');
          for(const theme of ['light','dark'])for(const width of [1280,390]) {
            await parent.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
            await ctx.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            for(const [variant,semantic] of [['default','info'],['success','success'],['warning','warning'],['destructive','error']]) {
              const expression=`(()=>{const e=document.querySelector('[data-feedback=${variant}]'),s=getComputedStyle(e),probe=document.createElement('span');probe.style.backgroundColor='var(--feedback-${semantic}-background)';document.body.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return s.borderTopWidth==='0px'&&s.borderRightWidth==='0px'&&s.borderBottomWidth==='0px'&&s.borderLeftWidth==='0px'&&s.backgroundColor===expected&&expected!=='rgba(0, 0, 0, 0)'&&e.scrollWidth<=e.clientWidth})()`;
              await ctx.waitFor(expression,{label:`${mode}/${theme}/${width}/${variant}: semantic soft Alert background`});
              const contrast=await ctx.eval(`(()=>{const e=document.querySelector('[data-feedback=${variant}]'),canvas=document.createElement('canvas'),c=canvas.getContext('2d');function luminance(color){c.fillStyle=color;c.fillRect(0,0,1,1);const s=[...c.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return s[0]*0.2126+s[1]*0.7152+s[2]*0.0722}const a=luminance(getComputedStyle(e).backgroundColor),b=luminance(getComputedStyle(e.querySelector('[data-slot=alert-description]')).color);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)})()`);
              ctx.assert(contrast>=4.5,`${mode}/${theme}/${width}/${variant}: description contrast ${contrast.toFixed(2)} >= 4.5`);
            }
            for(const kind of ['default','info','success','warning','error']) {
              await ctx.eval(`window.ipolloworkUi.toast${kind==='default'?'':'.'+kind}('语义背景：${kind}',{duration:Infinity})`);
              await ctx.waitFor('Boolean(document.querySelector("[data-slot=toast-card]"))');
              await ctx.waitFor(`(()=>{const e=document.querySelector('[data-slot=toast-card]'),s=getComputedStyle(e),p=document.createElement('span');p.style.backgroundColor='var(--feedback-${kind==='default'?'info':kind}-background)';document.body.append(p);const expected=getComputedStyle(p).backgroundColor;p.remove();return s.backgroundColor===expected&&s.borderTopWidth==='0px'&&s.borderRightWidth==='0px'&&s.borderBottomWidth==='0px'&&s.borderLeftWidth==='0px'&&e.scrollWidth<=e.clientWidth})()`,{label:`${mode}/${theme}/${width}/${kind}: semantic soft Toast background`});
              await click(parent,frame,'[data-slot=toast-close]');
              await ctx.waitFor('!document.querySelector("[data-slot=toast-card]")');
            }
          }
          await click(parent,frame,'#alert-retry');
          await click(parent,frame,'[aria-label=关闭default]');
        },assert:async()=>{
          await ctx.waitFor('document.querySelector("#receipt").textContent==="提醒重试已执行" && !document.querySelector("[data-feedback=default]")');
          ctx.assert(await ctx.eval('document.querySelectorAll("[data-slot=alert]").length===3'),'dismiss removes only the selected Alert');
        },screenshot:shot('soft-feedback'),
      });
      await ctx.prove('公共图标及按钮组合在双模式亮暗窄容器可操作', {
        voiceover:vo[6], action:async()=>{
          await click(parent,frame,'[id="group-图标与按钮"]');
          await ctx.waitFor('Boolean(document.querySelector("#icon-gallery"))');
          for(const theme of ['light','dark'])for(const width of [1280,390])for(const fontSize of [13,16]) {
            await parent.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
            await ctx.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.fontSize=${JSON.stringify(fontSize+'px')}`);
            const metrics=await ctx.eval(`(()=>{
              const ui=window.ipolloworkUi;
              const all=Array.from(document.querySelectorAll('#icon-gallery svg'));
              const glyphs=all.length===ui.ICON_NAMES.length&&all.every(svg=>svg.children.length>0&&svg.getBoundingClientRect().width===16&&svg.getAttribute('aria-label')===svg.dataset.iconName);
              const sizes=['s','m','l'].every((size,i)=>{const svg=document.querySelector('[aria-label="搜索 '+size+'"]'),r=svg.getBoundingClientRect();return r.width===[14,16,20][i]&&r.height===[14,16,20][i]});
              const buttons=[['sm',28,14],['default',32,16],['lg',36,20]].every(([size,height,icon])=>{const b=document.querySelector('#icon-leading-'+size),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.height===height&&s.width===icon&&s.height===icon&&Math.abs(r.y+r.height/2-s.y-s.height/2)<=1&&b.querySelector('svg').getAttribute('aria-hidden')==='true'});
              const only=document.querySelector('#icon-only'),r=only.getBoundingClientRect();
              return {glyphs,sizes,buttons,only:r.width===32&&r.height===32&&only.getAttribute('aria-label')==='图标搜索',fits:document.documentElement.scrollWidth<=innerWidth,version:ui.version};
            })()`);
            ctx.assert(Object.values(metrics).every(Boolean),`${mode}/${theme}/${width}/${fontSize}px: ${JSON.stringify(metrics)}`);
          }
          await click(parent,frame,'#icon-leading-default');
          await ctx.waitFor('document.querySelector("#icon-click-count").textContent==="1"');
          await ctx.eval('document.querySelector("#icon-leading-default").scrollIntoView({block:"center"})');
          const point=await ctx.eval('(()=>{const r=document.querySelector("#icon-leading-default").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
          for(const type of ['mouseMoved','mousePressed','mouseReleased'])await parent.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
          await ctx.waitFor('document.querySelector("#icon-click-count").textContent==="2"');
          await click(parent,frame,'#icon-trailing');
          await ctx.waitFor('document.querySelector("#receipt").textContent==="后置图标已执行"');
          await click(parent,frame,'#icon-only');
          await ctx.waitFor('document.querySelector("#receipt").textContent==="纯图标已执行"');
          await ctx.eval('document.querySelector("#icon-disabled").click()');
          ctx.assert(await ctx.eval('document.querySelector("#icon-disabled").disabled && document.querySelector("#receipt").textContent==="纯图标已执行"'),'disabled button cannot execute');
          await click(parent,frame,'#icon-loading');
          await ctx.waitFor('document.querySelector("#icon-loading").disabled && document.querySelector("#icon-loading").getAttribute("aria-busy")==="true" && document.querySelector("#icon-loading svg").dataset.iconName==="LoaderCircle"');
        }, assert:async()=>{
          await ctx.waitFor('!document.querySelector("#icon-loading").disabled && document.querySelector("#receipt").textContent==="保存完成" && document.querySelector("#icon-loading svg").dataset.iconName==="Save"');
          ctx.assert(await ctx.eval('document.querySelector("#icon-loading").getAttribute("aria-busy")==="false"'),'loading state recovers');
        }, screenshot:shot('icons-buttons'),
      });
    } finally {frame.close();ctx.client=parent;}
  }})),
};
