import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("settings-resource-cards");
const shadowFree = shadow => shadow === "none" || (shadow.includes("rgba(") && [...shadow.matchAll(/rgba?\(([^)]+)\)/g)].every(match => Number(match[1].split(",")[3]) === 0));
const moveOutside = ctx => ctx.client.send("Input.dispatchMouseEvent", {type:"mouseMoved", x:4, y:4});
const settle = ctx => ctx.waitFor("document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).every(animation => animation.playState !== 'running')", {label:"finite theme and hover transitions settled"});
const hover = async (ctx, selector) => {
  const point=await ctx.eval(`(() => {const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await ctx.client.send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
};
const verifyRows = async (ctx, selector) => {
  const rows=await ctx.eval(`([...document.querySelectorAll(${JSON.stringify(selector)})].map(node=>{const style=getComputedStyle(node);return {minHeight:node.getBoundingClientRect().height,radius:style.borderRadius,padding:style.padding,border:style.borderTopWidth,shadow:style.boxShadow};}))`);
  ctx.assert(rows.length>0 && rows.every(row=>row.minHeight>=64 && ['0px','1px'].includes(row.border) && shadowFree(row.shadow)),JSON.stringify(rows));
};

export default {
  id:"settings-resource-cards",
  title:"真实客户端工作空间与资源行样式",
  kind:"user-facing",
  preserveTheme:true,
  cdpTarget:{urlIncludes:"localhost:5173"},
  steps:[
    {name:"工作空间选择与悬停",async run(ctx){
      const hash=await ctx.eval("location.hash");
      const activeProject=await ctx.eval(`(()=>{try{return JSON.parse(localStorage.getItem('ipollowork.work-context-projects.v1')??'{}')[localStorage.getItem('ipollowork.work-context.v1')??'personal'];}catch{return null;}})()`);
      const prefix=activeProject?`/workspace/${activeProject}`:hash.startsWith('#/workspace/')?hash.split('/').slice(0,3).join('/').slice(1):'';
      ctx.settingsPrefix=prefix;
      ctx.originalSettingsTheme=await ctx.eval("document.documentElement.dataset.theme");
      if(await ctx.eval("Boolean(document.querySelector('[data-slot=dialog-content][data-open]'))")) {
        await ctx.trustedClick('[data-slot="dialog-content"][data-open] [data-slot="dialog-close"]');
        await ctx.waitFor("!document.querySelector('[data-slot=dialog-content][data-open]')");
      }
      await ctx.navigateHash(`${prefix}/settings/cloud-account`);
      await ctx.waitFor("document.querySelectorAll('[data-testid=cloud-workspaces] button[aria-pressed]').length>=2");
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await moveOutside(ctx);
        await ctx.prove(`${theme}：紧凑分组工作空间，加入操作位于标题，更多菜单承载退出`,{
          voiceover:vo[0],action:async()=>{
            await ctx.waitFor(`(()=>{const buttons=[...document.querySelectorAll('[data-testid=cloud-workspaces] button[aria-pressed]')];return buttons.every(button=>{const row=button.parentElement.classList.contains('min-h-16')?button.parentElement:button;return (getComputedStyle(row).backgroundColor!=='rgba(0, 0, 0, 0)') === (button.getAttribute('aria-pressed')==='true');});})()`);
            ctx.assert(await ctx.eval(`(()=>{const buttons=[...document.querySelectorAll('[data-testid=cloud-workspaces] button[aria-pressed]')];return buttons.filter(button=>button.getAttribute('aria-pressed')==='true').length===1 && buttons.every(button=>{const selected=button.getAttribute('aria-pressed')==='true';return Boolean(button.querySelector('svg.lucide-check'))===selected;});})()`),"selected source is exposed by aria-pressed and a trailing check only");
            await hover(ctx,'[data-testid="cloud-workspaces"] button[aria-pressed]:first-child');
            await ctx.waitFor("getComputedStyle(document.querySelector('[data-testid=cloud-workspaces] button[aria-pressed]')).backgroundColor!=='rgba(0, 0, 0, 0)'");
          },assert:async()=>{
            const rows=await ctx.eval(`([...document.querySelectorAll('[data-testid=cloud-workspaces] button[aria-pressed]')].map(button=>{const row=button.parentElement.classList.contains('min-h-16')?button.parentElement:button;const style=getComputedStyle(row);return {join:button.dataset.testid==='join-enterprise-workspace',border:style.borderTopWidth,shadow:style.boxShadow,before:getComputedStyle(button,'::before').boxShadow};}))`);
            ctx.assert(rows.every(row=>['0px','1px'].includes(row.border)&&shadowFree(row.shadow)&&shadowFree(row.before)),JSON.stringify(rows));
            await settle(ctx);
            ctx.assert(await ctx.eval(`(()=>{const icons=[...document.querySelectorAll('[data-testid=cloud-workspaces] button[aria-pressed] > div:first-child')];return icons.length>=2&&icons.every(icon=>{const s=getComputedStyle(icon);return s.backgroundColor==='rgb(0, 0, 0)'&&s.color==='rgb(255, 255, 255)';});})()`),"workspace icon tiles are black with white symbols in both themes");
            ctx.assert(await ctx.eval(`(()=>{const options=document.querySelector('[data-testid=workspace-options]');const join=document.querySelector('[data-testid=join-enterprise-workspace]');const s=getComputedStyle(options);return s.borderTopWidth==='1px'&&join.getBoundingClientRect().bottom<=options.getBoundingClientRect().top&&join.offsetHeight===28&&![...options.querySelectorAll('button')].some(button=>button.querySelector('button'));})()`),"workspace rows share one outline; compact join action sits in the header without nested buttons");
          },screenshot:{name:`workspace-hover-${theme}`,requireText:['工作空间','个人','加入企业']},
        });
        await hover(ctx,'[data-testid="cloud-workspaces"] div.min-h-16 > button[aria-pressed]');
        ctx.assert(await ctx.eval(`(()=>{const button=document.querySelector('[data-testid=cloud-workspaces] div.min-h-16 > button[aria-pressed]');return button.parentElement.classList.contains('min-h-16') && getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)';})()`),"enterprise inner button stays transparent instead of forming an inset gray strip");
        await moveOutside(ctx);
        await ctx.prove(`${theme}：企业更多菜单可键盘关闭，不触发退出`,{
          voiceover:vo[0],action:async()=>{await ctx.trustedClick('[data-testid="workspace-actions"]');await ctx.waitFor("Boolean(document.querySelector('[role=menu][data-open]'))");},
          assert:async()=>{ctx.assert(await ctx.eval("Boolean(document.querySelector('[role=menu] svg.lucide-log-out'))"),"leave action is available in the secondary menu");},
          screenshot:{name:`workspace-actions-${theme}`,requireText:['工作空间','退出']},
        });
        for(const type of ['keyDown','keyUp'])await ctx.client.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await ctx.waitFor("!document.querySelector('[role=menu][data-open]')");
        await ctx.waitFor("document.activeElement?.dataset.testid==='workspace-actions'");
      }
      await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:1,mobile:false});
      try {
        await ctx.prove('窄窗口：工作空间列表与加入操作不溢出',{
          voiceover:vo[0],action:async()=>{await moveOutside(ctx);await settle(ctx);},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const options=document.querySelector('[data-testid=workspace-options]').getBoundingClientRect();const join=document.querySelector('[data-testid=join-enterprise-workspace]').getBoundingClientRect();return options.right<=innerWidth&&join.right<=innerWidth&&options.left>=0&&join.width>0&&document.documentElement.scrollWidth<=innerWidth;})()`),"workspace choices and compact header action remain within narrow viewport");},
          screenshot:{name:'workspace-compact-narrow',requireText:['工作空间','加入企业']},
        });
      } finally {await ctx.client.send('Emulation.clearDeviceMetricsOverride');}
    }},
    {name:"引擎单列分组与来源说明",async run(ctx){
      await ctx.navigateHash(`${ctx.settingsPrefix}/settings/engines`);
      await ctx.waitFor("document.querySelectorAll('[data-testid=engine-package-row]').length>=2");
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await moveOutside(ctx);
        await ctx.prove(`${theme}：引擎单列分组对齐名称状态操作，保留真实安装状态`,{
          voiceover:vo[1],action:async()=>{await hover(ctx,'[data-testid="engine-package-row"]');},
          assert:async()=>{
            await verifyRows(ctx,'[data-testid="engine-package-row"]');
            ctx.assert(await ctx.eval(`(()=>{const list=document.querySelector('[data-testid=engine-package-list]');const rows=[...list.children];return getComputedStyle(list).borderTopWidth==='1px'&&rows.every(row=>Math.abs(row.getBoundingClientRect().width-list.clientWidth)<2);})()`),'engines share one full-width grouped list');
            ctx.assert(await ctx.eval(`(()=>{const rows=[...document.querySelectorAll('[data-testid=engine-package-row]')];return rows.every(row=>row.querySelector('img')&&row.querySelector('h3'))&&!rows[0].parentElement.className.includes('shadow-')&&!rows[0].parentElement.className.includes('backdrop-blur');})()`),"engine names, icons and source states remain outside floating card containers");
            await settle(ctx);
          },screenshot:{name:`engine-plugin-rows-${theme}`,requireText:['引擎管理','OpenCode','DeepSeek Harness']},
        });
        if(await ctx.eval("Boolean(document.querySelector('[data-testid=engine-source-details]'))")) {
          await ctx.trustedClick('[data-testid="engine-source-details"]');
          await ctx.waitFor("document.querySelector('[data-testid=engine-source-details]').getAttribute('aria-expanded')==='true'");
          ctx.assert(await ctx.eval("document.querySelector('[data-testid=engine-package-list]').innerText.includes('不支持')"),'official source restriction remains available on demand');
          await ctx.trustedClick('[data-testid="engine-source-details"]');
          await settle(ctx);
        }
      }
    }},
    {name:"AI提供商分组与次操作",async run(ctx){
      await ctx.navigateHash(`${ctx.settingsPrefix}/settings/ai`);
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=ai-providers]'))");
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await ctx.prove(`${theme}：提供商独立等高卡片，名称与直接操作一致`,{
          voiceover:vo[3],action:async()=>{await moveOutside(ctx);await settle(ctx);},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const root=document.querySelector('[data-testid=ai-providers]');const list=root.querySelector('[data-testid=connected-provider-list]');return !root.innerText.includes('opencode.jsonc')&&(!list||getComputedStyle(list).borderTopWidth==='0px')&&[...root.querySelectorAll('[data-testid=connected-provider-row]')].every(row=>!row.querySelector('.font-mono')&&row.getBoundingClientRect().height===72&&getComputedStyle(row).borderTopWidth==='1px'&&row.dataset.variant==='resource');})()`),'provider identifiers stay out of primary content and cloud text avoids implementation details');},
          screenshot:{name:`providers-grouped-${theme}`,requireText:['提供商']},
        });
        if(await ctx.eval("Boolean(document.querySelector('[data-testid=provider-disconnect]:not([disabled])'))")) {
          await ctx.trustedClick('[data-testid="provider-disconnect"]:not([disabled])');
          await ctx.waitFor("Boolean(document.querySelector('[role=alertdialog][data-open]'))");
          ctx.assert(await ctx.eval("Boolean(document.querySelector('[role=alertdialog] [data-slot=alert-dialog-cancel]'))"),'direct disconnect still opens confirmation before changing credentials');
          await ctx.trustedClick('[role="alertdialog"] [data-slot="alert-dialog-cancel"]');
          await ctx.waitFor("!document.querySelector('[role=alertdialog][data-open]')");
        }
      }
    }},
    {name:"插件技能信息层级",async run(ctx){
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await ctx.navigateHash(`${ctx.settingsPrefix}/settings/extensions/plugins`);
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=plugin-package-list-item]'))");
        await ctx.prove(`${theme}：插件只显示名称和关键说明，操作放在右侧`,{
          voiceover:vo[4],action:async()=>{await hover(ctx,'[data-testid="plugin-package-list-item"]');await settle(ctx);},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const rows=[...document.querySelectorAll('[data-testid=plugin-package-list-item]')];return rows.length>0&&rows.every(row=>{const copy=row.querySelector('[data-testid=plugin-package-card-copy]');return !!copy&&row.scrollWidth<=row.clientWidth+1&&row.title&&row.querySelector('[data-slot=card-footer] button')&&row.dataset.variant==='resource'&&row.dataset.surface==='plain'&&getComputedStyle(row).borderTopWidth==='0px'&&[...row.querySelectorAll('[data-slot=card-footer] button')].every(button=>getComputedStyle(button).borderTopWidth==='1px');});})()`),'plugin cards are borderless with outlined actions and preserve full title hints');
            ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('[data-testid=plugin-package-list-item]')).backgroundColor!=='rgba(0, 0, 0, 0)'`),'hover adds a neutral background');
            ctx.assert(await ctx.eval(`(()=>{const slot=document.querySelector('[data-testid=plugin-package-list-item] [data-slot=card-icon]');const icon=slot.querySelector('img,svg');return slot.getBoundingClientRect().width===32&&icon.getBoundingClientRect().width===24&&(!icon.matches('svg.lucide')||getComputedStyle(icon).strokeWidth==='1.5px');})()`),'logos render at 24px within a 32px alignment slot with lighter fallback strokes');
            ctx.assert(await ctx.eval(`(()=>{const copy=document.querySelector('[data-testid=plugin-package-card-copy]');const card=copy.closest('[data-slot=card]');const nodes=['card-title','card-description'].map(slot=>card.querySelector('[data-slot='+slot+']'));return nodes.every((node,index)=>{const s=getComputedStyle(node);return s.fontSize===['14px','12px'][index]&&s.fontWeight===(index===0?'600':'400')&&s.lineHeight===['20px','18px'][index];});})()`),'plugin typography is 14/20 semibold and 12/18 regular without visible metadata rows');},
          screenshot:{name:`plugin-hierarchy-${theme}`,requireText:['插件']},
        });
        await ctx.prove(`${theme}：插件的右侧操作收进三个点菜单`,{
          voiceover:vo[4],action:async()=>{await ctx.trustedClick('[data-testid="plugin-package-list-item"] [data-slot="card-footer"] button');await ctx.waitFor("Boolean(document.querySelector('[role=menu]'))");},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const footer=document.querySelector('[data-testid=plugin-package-list-item] [data-slot=card-footer]');return footer.querySelectorAll('button').length===1&&footer.querySelector('svg.lucide-ellipsis')&&document.querySelectorAll('[role=menu] [role=menuitem]').length>0;})()`),'one ellipsis button exposes existing plugin actions');},
          screenshot:{name:`plugin-actions-menu-${theme}`,requireText:['插件']},
        });
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await ctx.navigateHash(`${ctx.settingsPrefix}/settings/extensions/skills`);
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=skills-catalog]'))");
        await ctx.trustedClick('[data-testid="skills-catalog"] [role="tab"]:first-child');
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=skill-card]'))");
        await ctx.prove(`${theme}：技能品牌与固定文案层级，搜索无填充`,{
          voiceover:vo[5],action:async()=>{await hover(ctx,'[data-testid="skill-card"]');await settle(ctx);},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const root=document.querySelector('[data-testid=skills-catalog]');const search=root.querySelector('[data-slot=search-field]');const cards=[...root.querySelectorAll('[data-testid=skill-card]')];return [search,search.querySelector('input')].every(node=>getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)')&&cards.every(card=>card.querySelector('h3[title]')&&card.scrollWidth<=card.clientWidth+1)&&cards.some(card=>card.querySelector('img')?.naturalWidth>0);})()`),'skill cards use loaded plugin branding and transparent search');
            ctx.assert(await ctx.eval(`(()=>{const card=document.querySelector('[data-testid=skill-card]');const nodes=['card-title','card-description'].map(slot=>card.querySelector('[data-slot='+slot+']'));return getComputedStyle(card).borderTopWidth==='0px'&&card.dataset.surface==='plain'&&getComputedStyle(card).backgroundColor!=='rgba(0, 0, 0, 0)'&&[...card.querySelectorAll('[data-slot=card-footer] button')].every(button=>getComputedStyle(button).borderTopWidth==='1px')&&nodes.every((node,index)=>{const s=getComputedStyle(node);return s.fontSize===['14px','12px'][index]&&s.fontWeight===(index===0?'600':'400');});})()`),'skills use shared borderless rows with neutral hover and outlined actions and distinct title/description typography');},
          screenshot:{name:`skill-hierarchy-${theme}`,requireText:['技能']},
        });
        await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:1,mobile:false});
        try {
          await ctx.prove(`${theme}：窄宽技能动作保持在右侧或右下且不溢出`,{
            voiceover:vo[4],action:async()=>{await hover(ctx,'[data-testid="skill-card"]');await settle(ctx);},
            assert:async()=>{ctx.assert(await ctx.eval(`[...document.querySelectorAll('[data-testid=skill-card]')].every(card=>{const footer=card.querySelector('[data-slot=card-footer]');const c=card.getBoundingClientRect(),f=footer.getBoundingClientRect();return card.dataset.layout==='row'&&!card.querySelector('[data-slot=card-meta]')&&card.scrollWidth<=card.clientWidth+1&&f.right<=c.right&&f.left>=c.left;})`),'shared card wraps actions within its right edge');},
            screenshot:{name:`skill-row-narrow-${theme}`,requireText:['技能']},
          });
        } finally {await ctx.client.send('Emulation.clearDeviceMetricsOverride');}

      }
    }},
    {name:"授权行与配置弹窗",async run(ctx){
      await ctx.navigateHash(`${ctx.settingsPrefix}/settings/authorizations`);
      await ctx.waitFor("document.querySelectorAll('[data-testid=authorization-service-row]').length>=2 && document.querySelector('[data-testid=authorization-service-row] button:has(svg.lucide-key-round)')?.disabled === false");
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await moveOutside(ctx);
        await ctx.prove(`${theme}：授权服务默认同尺寸描边卡片，品牌图标和操作层级统一`,{
          voiceover:vo[2],action:async()=>{await hover(ctx,'[data-testid="authorization-service-row"]');await ctx.waitFor("[...document.querySelectorAll('[data-testid=authorization-service-row] img')].every(img=>img.complete&&img.naturalWidth>0)");await settle(ctx);},
          assert:async()=>{
            const cards=await ctx.eval(`([...document.querySelectorAll('[data-testid=authorization-service-row]')].map(node=>{const s=getComputedStyle(node);return {border:s.borderTopWidth,background:s.backgroundColor,shadow:s.boxShadow};}))`);
            ctx.assert(cards.length>0&&cards.every(card=>card.border==='1px'&&card.background==='rgba(0, 0, 0, 0)'&&shadowFree(card.shadow)),JSON.stringify(cards));
            ctx.assert(await ctx.eval(`(()=>{const cards=[...document.querySelectorAll('[data-testid=authorization-service-row]')];return cards.every(card=>Math.abs(card.getBoundingClientRect().height-cards[0].getBoundingClientRect().height)<2)&&cards.every(card=>{const img=card.querySelector('img');return card.dataset.serviceId==='storage-routing'||(img?.complete&&img.naturalWidth>0);});})()`),"collapsed authorization cards have equal heights and loaded brand logos");
            ctx.assert(await ctx.eval(`(()=>{const rows=[...document.querySelectorAll('[data-testid=authorization-service-row]')];return rows.every(row=>row.dataset.variant==='resource'&&row.querySelector('h3')&&row.querySelector('button:has(svg.lucide-key-round)')&&row.querySelector('button:has(svg.lucide-plug-zap)')) && rows.every(row=>row.querySelector('[data-slot=card-footer]'));})()`),"configuration and test controls remain without the split card footer");
            await settle(ctx);
          },screenshot:{name:`authorization-outline-cards-${theme}`,requireText:['授权中心','OpenAI']},
        });
        for (const service of ['openai-images','heygen-video']) {
          const card=`[data-service-id="${service}"]`;
          const height=await ctx.eval(`document.querySelector('${card}').getBoundingClientRect().height`);
          await ctx.prove(`${theme}：${service} 底部展开保留授权操作，收起恢复统一高度`,{
            voiceover:vo[2],action:async()=>{await ctx.trustedClick(`${card} [data-testid="authorization-service-more"]`);await settle(ctx);},
            assert:async()=>{
              ctx.assert(await ctx.eval(`(()=>{const card=document.querySelector('${card}');return card.querySelector('[data-testid="authorization-service-more"]').getAttribute('aria-expanded')==='true'&&card.getBoundingClientRect().height>${height}&&Boolean(card.querySelector('[data-testid="authorization-service-details"] button:has(svg.lucide-globe)'));})()`),"expanded panel exposes original login and billing controls");
              await hover(ctx,`${card} [data-testid="authorization-service-more"]`);await settle(ctx);
              ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('${card} [data-testid="authorization-service-more"]')).backgroundColor==='rgba(0, 0, 0, 0)'`),'expanded authorization disclosure stays transparent while hovered');
            },screenshot:{name:`authorization-expanded-${service}-${theme}`,requireText:['授权中心']},
          });
          await ctx.trustedClick(`${card} [data-testid="authorization-service-more"]`);
          await settle(ctx);
          ctx.assert(await ctx.eval(`Math.abs(document.querySelector('${card}').getBoundingClientRect().height-${height})<2`),"collapse restores original card height");
        }
      }
      await ctx.trustedClick('[data-testid="authorization-service-row"] button:has(svg.lucide-key-round)');
      await ctx.waitFor("Boolean(document.querySelector('[data-slot=dialog-content][data-open]'))");
      ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-slot=dialog-content][data-open] input'))"),"existing authorization form opens; no credentials are changed or submitted");
      await ctx.trustedClick('[data-slot="dialog-content"][data-open] [data-slot="dialog-close"]');
      await ctx.waitFor("!document.querySelector('[data-slot=dialog-content][data-open]')");
      await ctx.eval(`document.documentElement.dataset.theme=${JSON.stringify(ctx.originalSettingsTheme??'light')}`);
    }},
    {name:"模板单层导航和远程资源卡",async run(ctx){
      await ctx.navigateHash(`${ctx.settingsPrefix}/session`);
      await ctx.waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='模板')");
      await ctx.eval("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='模板').click()");
      const dialog='[data-slot="dialog-content"][data-open]';
      await ctx.waitFor(`Boolean(document.querySelector('${dialog} [role=tablist][aria-label="模板"]'))`);
      for(const theme of ['light','dark'])for(const source of ['cloud','enterprise']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        const index=source==='cloud'?3:4;
        if(!await ctx.eval(`Boolean(document.querySelector('${dialog} [role=tablist] [role=tab]:nth-child(${index})'))`))continue;
        await ctx.prove(`${theme}：${source}模板单层页签和共享描边卡`,{
          voiceover:vo[6],action:async()=>{await ctx.trustedClick(`${dialog} [role=tablist] [role=tab]:nth-child(${index})`);await ctx.waitFor("!document.querySelector('[data-testid=template-catalog-loading]')");await settle(ctx);},
          assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}');const tabs=d.querySelectorAll('[role=tablist]');const cards=[...d.querySelectorAll('[data-testid=remote-template-card]')];return tabs.length===1&&tabs[0].querySelectorAll('[role=tab]').length>=3&&cards.every(card=>card.dataset.source==='${source}'&&card.dataset.variant==='resource'&&card.dataset.surface==='outline'&&getComputedStyle(card).borderTopWidth==='1px'&&getComputedStyle(card).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(card.querySelector('h3')).fontSize==='14px'&&getComputedStyle(card.querySelector('[data-slot=card-footer] button')).borderTopWidth==='1px');})()`),'native template navigation has one source list and remote items use shared cards');},
          screenshot:{name:`template-unified-${source}-${theme}`,requireText:['我的','内置','Cloud']},
        });
      }
      await ctx.eval("document.documentElement.dataset.theme='light'");
    }},
  ],
};
