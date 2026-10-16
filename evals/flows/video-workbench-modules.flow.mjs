import {evaluate} from '../runner/cdp.mjs';
const iframeSelector='iframe[title*="HyperFrames"]';
async function wait(frame,expression){for(let i=0;i<200;i++){if(await evaluate(frame,expression))return;await new Promise(r=>setTimeout(r,60));}throw Error('Studio did not settle: '+expression);}
async function getFrame(ctx){
 const origin=await ctx.eval("new URL(document.querySelector("+JSON.stringify(iframeSelector)+").src).origin");
 const tree=await ctx.client.send('Page.getFrameTree');
 const entry=tree.frameTree.childFrames.find(e=>e.frame.url.startsWith(origin));
 ctx.assert(entry,'Actual Studio required');
 const world=await ctx.client.send('Page.createIsolatedWorld',{frameId:entry.frame.id,worldName:'workbench-readonly-proof'});
 return {send:(method,params)=>ctx.client.send(method,method==='Runtime.evaluate'?{...params,contextId:world.executionContextId}:params)};
}
async function click(ctx,frame,selector,hoverOnly=false){
 const point=await evaluate(frame,"(()=>{const e=document.querySelector("+JSON.stringify(selector)+");const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
 const offset=await ctx.eval("(()=>{const r=document.querySelector("+JSON.stringify(iframeSelector)+").getBoundingClientRect();return{x:r.x,y:r.y};})()");
 for(const type of hoverOnly?['mouseMoved']:['mouseMoved','mousePressed','mouseReleased'])await ctx.client.send('Input.dispatchMouseEvent',{type,x:point.x+offset.x,y:point.y+offset.y,...(type==='mouseMoved'?{}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})});
}
export default {id:'video-workbench-modules',title:'统一视频工作台：紧凑脚本、面板菜单与完整边界',kind:'user-facing',preserveTheme:true,cdpTarget:{urlIncludes:'localhost:5173'},steps:[{name:'真实客户端只读走查；任何保存均不提交',async run(ctx){
 ctx.assert(await ctx.eval("navigator.userAgent.includes('Electron')"),'Real Electron required');
 const frame=await getFrame(ctx);
 if(await evaluate(frame,"new URLSearchParams(location.hash.split('?')[1]).get('tab')==='renders'"))await evaluate(frame,"location.hash=location.hash.replace(/([?&]tab=)renders/,'$1design')");
 await wait(frame,"!!document.querySelector('.hf-script-sidebar td:nth-child(3) textarea')");
 const originalTitle=await evaluate(frame,"document.querySelector('[data-testid=studio-video-title]').textContent");
 const fileUrl=await evaluate(frame,"'/api/projects/'+encodeURIComponent(location.hash.match(/project\\/([^?]+)/)[1])+'/files/index.html'");
 const originalSource=await evaluate(frame,"fetch("+JSON.stringify(fileUrl)+").then(r=>r.json()).then(d=>d.content)",{awaitPromise:true});
 ctx.assert(typeof originalSource==='string','Real file snapshot required; never compare Promise placeholders');
 const choose=async text=>evaluate(frame,"Array.from(document.querySelectorAll('.hf-studio-inspector button')).find(e=>e.textContent==="+JSON.stringify(text)+").click()");
 const menu=async()=>{await evaluate(frame,"document.querySelector('header button').click()");await wait(frame,"!!document.querySelector('[role=menuitemcheckbox]')");};
 try{
 if(await evaluate(frame,"!!document.querySelector('[role=menu]')")){
  await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait(frame,"!document.querySelector('[role=menu]')");
 }
 await menu();
 const scriptChecked=await evaluate(frame,"Array.from(document.querySelectorAll('[role=menuitemcheckbox]')).find(e=>e.textContent.replaceAll('✓','').trim()==='脚本表').getAttribute('aria-checked')");
 if(scriptChecked==='false')await evaluate(frame,"Array.from(document.querySelectorAll('[role=menuitemcheckbox]')).find(e=>e.textContent.replaceAll('✓','').trim()==='脚本表').click()");
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(frame,"!document.querySelector('[role=menu]')");
 await wait(frame,"(()=>{const r=document.querySelector('.hf-script-sidebar').getBoundingClientRect();return r.width>160&&r.left>=0&&r.right<=innerWidth+1})()");
 if(await evaluate(frame,"document.querySelector('.hf-script-sidebar').dataset.expanded==='true'"))await evaluate(frame,"document.querySelector('[data-testid=script-expand-table]').click()");
 await ctx.prove('浅米色底座、白色模块和简化顶部入口',{
 voiceover:'顶部取消三种模式与更多，只保留面板、视频名称、重命名、增强、刷新和导出。米色仅用原色板的20%混合，不改变作品。',
 action:async()=>{},
 assert:async()=>{ctx.assert(await evaluate(frame,"!document.querySelector('header [role=tab]')&&!document.querySelector('[data-testid=studio-more-actions]')&&!!document.querySelector('[data-testid=studio-rename-video]')&&!!document.querySelector('[data-testid=studio-reload]')"),'Simplified header');ctx.assert(await evaluate(frame,"getComputedStyle(document.querySelector('.hf-script-sidebar')).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.hf-preview-pane')).backgroundColor==='rgb(0, 0, 0)'&&getComputedStyle(document.querySelector('[data-testid=studio-video-title]')).fontSize==='13px'&&getComputedStyle(document.querySelector('.hf-script-sidebar h2')).fontSize==='13px'"),'White cards, black player, compact headings');ctx.assert(await evaluate(frame,"document.querySelectorAll('.hf-dock .dv-groupview').length===4"),'Four modules');},
 screenshot:{name:'unified-header'}
 });

 await ctx.prove('浅米色工具栏使用同色系悬停反馈',{
  voiceover:'面板、重命名、智能增强等次要按钮沿用共享 ghost 控件，只在浅米色工具栏内使用暖色悬停底；暗色主题保持原语义。',
  action:async()=>{const point=await evaluate(frame,"(()=>{const r=document.querySelector('[data-testid=studio-enhancement-open]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");const offset=await ctx.eval("(()=>{const r=document.querySelector("+JSON.stringify(iframeSelector)+").getBoundingClientRect();return{x:r.x,y:r.y}})()");await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+offset.x,y:point.y+offset.y});await new Promise(r=>setTimeout(r,250));},
  assert:async()=>ctx.assert(await evaluate(frame,"(()=>{const e=document.querySelector('[data-testid=studio-enhancement-open]'),c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(e).backgroundColor;c.fillRect(0,0,1,1);const [r,g,b,a]=c.getImageData(0,0,1,1).data;return e.matches(':hover')&&a>0&&r>b+4&&g>b+4;})()"),'Hovered background is warm rather than neutral grey'),
  screenshot:{name:'warm-toolbar-hover'}
 });
 await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
 await new Promise(r=>setTimeout(r,250));
 ctx.assert(await evaluate(frame,"Array.from(document.querySelectorAll('.dv-render-overlay')).every(e=>getComputedStyle(e,'::after').content==='none')"),'Borderless module cards');
 ctx.assert(await evaluate(frame,"getComputedStyle(document.querySelector('[data-testid=studio-enhancement-open]')).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(document.querySelector('.hf-script-save')).backgroundColor==='rgba(0, 0, 0, 0)'"),'Secondary actions use shared ghost buttons');
 await ctx.prove('脚本侧栏直接可编辑，文字与字段对齐',{
 voiceover:'紧凑脚本表复用原编辑器，字号12px，序号、标题与预计时长同排；画面描述和旁白常驻，设置通过文字入口展开。本次不填写、不保存、不生成。',
 action:async()=>{await evaluate(frame,"document.querySelector('.hf-script-sidebar td:nth-child(3) textarea').focus()");},
 assert:async()=>{ctx.assert(await evaluate(frame,"Array.from(document.querySelectorAll('.hf-script-sidebar td:nth-child(3) textarea')).some(e=>!e.disabled&&!e.readOnly)&&getComputedStyle(document.querySelector('.hf-script-sidebar td:nth-child(3) textarea')).fontSize==='12px'"),'Editable, compact narration');ctx.assert(await evaluate(frame,"(()=>{const row=document.querySelector('tr[data-shot]'),title=row.querySelector('td:nth-child(2) input').getBoundingClientRect(),duration=row.querySelector('td:nth-child(4) input').getBoundingClientRect(),voice=row.querySelector('td:nth-child(3) textarea').getBoundingClientRect();const scene=row.querySelector('td:nth-child(2) textarea').getBoundingClientRect(),number=row.querySelector('button[draggable]').getBoundingClientRect(),toggle=row.querySelector('[data-testid^=storyboard-settings-toggle-]').getBoundingClientRect(),mid=r=>r.top+r.height/2;return [duration,number].every(r=>Math.abs(mid(title)-mid(r))<2)&&scene.top>=title.bottom&&voice.top>scene.bottom&&toggle.top>=voice.bottom&&Math.abs(title.left-scene.left)<2&&Math.abs(scene.left-voice.left)<2&&!row.querySelector('.hf-script-recipe-action');})()"),'Aligned script fields');await evaluate(frame,"document.documentElement.proofScriptField=document.querySelector('.hf-script-sidebar td:nth-child(3) textarea')");},
 screenshot:{name:'editable-script'}
 });

 ctx.assert(await evaluate(frame,"(()=>{const side=document.querySelector('.hf-script-sidebar'),save=side.querySelector('.hf-script-save'),footer=side.querySelector('.hf-script-footer'),button=side.querySelector('[data-testid=script-expand-table]');return footer.contains(save)&&button.textContent.trim()===''&&save.getBoundingClientRect().top>side.getBoundingClientRect().top+side.getBoundingClientRect().height*0.7;})()"),'Compact actions are in the fixed bottom-right footer, expansion is icon-only');
 ctx.assert(await evaluate(frame,"document.querySelector('[data-testid=studio-reload]').textContent==='重新加载'"),'Reload uses icon and text');
 await ctx.prove('展开图标提供可见 Tooltip',{
  voiceover:'展开入口只保留图标，悬停显示展开表格提示，不触发保存。',
  action:async()=>{await click(ctx,frame,'[data-testid=script-expand-table]',true);await wait(frame,"Array.from(document.querySelectorAll('[data-slot=tooltip-content]')).some(e=>e.textContent==='展开表格')");},
  assert:async()=>ctx.assert(await evaluate(frame,"Array.from(document.querySelectorAll('[data-slot=tooltip-content]')).some(e=>e.textContent==='展开表格'&&e.getBoundingClientRect().width>0)"),'Visible expansion tooltip'),
  screenshot:{name:'script-expand-tooltip'}
 });
 await ctx.prove('展开脚本表保留同一编辑器实例',{
 voiceover:'展开显示完整表格，同一输入组件与草稿继续保留；本次只展开和收起。',
 action:async()=>{await evaluate(frame,"document.querySelector('[data-testid=script-expand-table]').click()");await wait(frame,"document.querySelector('.hf-script-sidebar').dataset.expanded==='true'");await evaluate(frame,"(()=>{const s=document.querySelector('.hf-script-sidebar .hf-script-table-scroll');s.scrollTop=0;s.scrollLeft=0;})()");},
 assert:async()=>ctx.assert(await evaluate(frame,"document.documentElement.proofScriptField===document.querySelector('.hf-script-sidebar td:nth-child(3) textarea')&&document.querySelector('.hf-script-sidebar').getBoundingClientRect().width>innerWidth*0.8"),'Editor instance preserved and expanded'),
 screenshot:{name:'expanded-script'}
 });

 ctx.assert(await evaluate(frame,"(()=>{const side=document.querySelector('.hf-script-sidebar'),overview=side.querySelector('.hf-script-overview'),global=side.querySelector('.hf-script-global'),scroll=side.querySelector('.hf-script-table-scroll'),header=side.querySelector('h2'),x=e=>e.getBoundingClientRect().left;return Math.abs(x(header)-x(overview.querySelector('h2')))<2&&Math.abs(x(header)-x(global))<2&&getComputedStyle(scroll).borderRadius==='12px'&&getComputedStyle(scroll).paddingLeft==='8px'&&getComputedStyle(side.querySelector('td:nth-child(3) label')).display==='none'&&getComputedStyle(side.querySelector('td:nth-child(4) label')).display==='none'&&!side.querySelector('[data-testid^=storyboard-timeline-links]')&&!side.querySelector('[aria-label^=定位镜头]')&&getComputedStyle(side.querySelector('.hf-script-narration-heading')).order==='1'&&getComputedStyle(side.querySelector('thead tr')).borderTopWidth==='0px';})()"),'Expanded header alignment, rounded table frame, no duplicated labels or track list, shared reorder, no locator, one header separator and narration voice below content');
 await evaluate(frame,"document.querySelector('[data-testid=script-expand-table]').click()");
 await ctx.prove('面板菜单只管理模块显示',{
 voiceover:'属性显示与隐藏收入面板菜单，模板保存入口不再占用视频工作台。',
 action:menu,
 assert:async()=>{const labels=await evaluate(frame,"Array.from(document.querySelectorAll('[role=menuitemcheckbox],[role=menuitem]')).map(e=>e.textContent.replaceAll('✓','').trim())");ctx.assert(['脚本表','属性'].every(s=>labels.includes(s)),JSON.stringify(labels));ctx.assert(!labels.some(s=>s.includes('模板')||s.includes('专注')),'No template save or focus mode');},
 screenshot:{name:'panels-menu'}
 });
 await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await ctx.prove('重命名入口打开并取消，不提交保存',{
 voiceover:'真实客户端仅打开重命名输入并取消，不更改视频名称。保存异常和元信息转换另由隔离单元测试覆盖。',
 action:async()=>{await evaluate(frame,"document.querySelector('[data-testid=studio-rename-video]').click()");await wait(frame,"!!document.querySelector('header input')");},
 assert:async()=>ctx.assert(await evaluate(frame,"document.activeElement===document.querySelector('header input')&&document.querySelector('header input').value==="+JSON.stringify(originalTitle)),'Focused input contains current name'),
 screenshot:{name:'rename-open-only'}
 });
 await evaluate(frame,"Array.from(document.querySelectorAll('header button')).find(e=>e.textContent==='取消').click()");
 await wait(frame,"!document.querySelector('header input')&&document.activeElement===document.querySelector('[data-testid=studio-rename-video]')");
 await choose('主题');await new Promise(r=>setTimeout(r,500));
 await ctx.prove('主题面板滚动到下方仍保留完整外框',{
 voiceover:'主题页只滚动查看现有设置，检查宿主面板尺寸与底部圆角，不修改颜色或字体。',
 action:async()=>{await ctx.eval("(()=>{const root=Array.from(document.querySelectorAll('[style]')).find(e=>e.matches('[data-testid=video-voice-panel],[data-testid=video-style-tab-content],[data-testid=video-avatar-tab-content]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);if(!root)return;const s=Array.from(root.querySelectorAll('*')).filter(e=>e.clientHeight>200&&e.scrollHeight>e.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).sort((a,b)=>b.clientHeight-a.clientHeight)[0];if(s){s.dataset.proofScroll=String(s.scrollTop);s.scrollTop=s.scrollHeight;}})()");},
 assert:async()=>ctx.assert(await ctx.eval("Array.from(document.querySelectorAll('[style]')).some(e=>e.matches('[data-testid=video-voice-panel],[data-testid=video-style-tab-content],[data-testid=video-avatar-tab-content]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&e.style.border==='0px'&&getComputedStyle(e).borderBottomLeftRadius==='15px'&&getComputedStyle(e).borderBottomRightRadius==='15px')"),'Inset bounds and rounded bottom'),
 screenshot:{name:'theme-panel-inset'}
 });
 await ctx.eval("document.querySelectorAll('[data-proof-scroll]').forEach(e=>{e.scrollTop=Number(e.dataset.proofScroll);delete e.dataset.proofScroll;})");
 const embeddedScrollbar=await evaluate(frame,"(()=>{const s=getComputedStyle(document.querySelector('.hf-script-table-scroll'),'::-webkit-scrollbar-thumb');return {color:s.backgroundColor,border:s.borderTopWidth};})()");
 const timelineScrollbar=await evaluate(frame,"(()=>{const s=getComputedStyle(document.querySelector('.hf-timeline-scroll'),'::-webkit-scrollbar-thumb');return {color:s.backgroundColor,border:s.borderTopWidth};})()");
 const hostScrollbar=await ctx.eval("(()=>{const e=Array.from(document.querySelectorAll('.hf-video-workbench-host *')).find(e=>e.clientHeight>200&&e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto');const s=getComputedStyle(e,'::-webkit-scrollbar-thumb');return {color:s.backgroundColor,border:s.borderTopWidth};})()");
 ctx.assert(JSON.stringify(embeddedScrollbar)===JSON.stringify(timelineScrollbar)&&JSON.stringify(embeddedScrollbar)===JSON.stringify(hostScrollbar),'Script, timeline and host scrollbar colors and density match: '+JSON.stringify({embeddedScrollbar,timelineScrollbar,hostScrollbar}));
 await choose('讲解');await new Promise(r=>setTimeout(r,500));
 await ctx.prove('讲解面板完整边界和紧凑时间轴',{
 voiceover:'讲解页只检查边界，不生成配音。时间轴工具栏36px，左上方标注图层，不再像露出的空白缺口。',
 action:async()=>{},
 assert:async()=>{ctx.assert(await evaluate(frame,"getComputedStyle(document.querySelector('.hf-timeline-toolbar')).height==='36px'&&getComputedStyle(document.querySelector('.hf-timeline-toolbar')).borderTopWidth==='0px'&&document.querySelector('.hf-timeline-ruler-gutter').textContent==='图层'"),'Compact timeline and labelled corner');ctx.assert(await ctx.eval("Array.from(document.querySelectorAll('[style]')).some(e=>e.matches('[data-testid=video-voice-panel],[data-testid=video-style-tab-content],[data-testid=video-avatar-tab-content]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)"),'Narration panel contained');},
 screenshot:{name:'voice-panel-inset'}
 });

 const themeMode=await ctx.eval("import('/src/app/theme.ts').then(m=>m.getInitialThemeMode())",{awaitPromise:true});
 try {
 for(const theme of ['light','dark']){
  await ctx.eval("import('/src/app/theme.ts').then(m=>m.setThemeMode("+JSON.stringify(theme)+"))",{awaitPromise:true});
  await wait(frame,"document.documentElement.dataset.ipolloworkTheme==="+JSON.stringify(theme));
  for(const page of ['图层','主题','组件','动画','素材','讲解']){
   await ctx.prove(theme+' · '+page+' 页面设计与可见状态',{
    voiceover:'逐页检查真实客户端的明暗主题、选中导航、控件可访问名称、滚动边界。只切换页面，不应用作品设置或提交生成。',
    action:async()=>{await choose(page);if(page==='图层')await evaluate(frame,"document.querySelector('.hf-timeline-layer-header__select').click()");if(['组件','动画','素材'].includes(page))await wait(frame,"!!document.querySelector('.hf-studio-inspector input[type=search]')");await new Promise(r=>setTimeout(r,350));},
    assert:async()=>{
     ctx.assert(await evaluate(frame,"document.documentElement.dataset.ipolloworkTheme==="+JSON.stringify(theme)),'Actual host theme bridge applied');
     const bounds=await evaluate(frame,"(()=>{const e=document.querySelector('.hf-studio-inspector'),r=e.getBoundingClientRect();return {width:r.width,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight};})()");
     ctx.assert(bounds.width>=120&&bounds.right<=bounds.viewportWidth+1&&bounds.bottom<=bounds.viewportHeight+1,'Inspector respects its 120px minimum and stays inside viewport: '+JSON.stringify(bounds));
     const unnamed=await evaluate(frame,"Array.from(document.querySelectorAll('.hf-studio-inspector button')).filter(e=>e.getBoundingClientRect().width>0&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length");
     ctx.assert(unnamed===0,'No unnamed inspector actions: '+unnamed);ctx.assert(await evaluate(frame,"Array.from(document.querySelectorAll('.hf-panel-accordion-header')).every(e=>!getComputedStyle(e).boxShadow.includes('inset'))"),'No expanded group accent bars');
    },
    screenshot:{name:theme+'-page-'+['图层','主题','组件','动画','素材','讲解'].indexOf(page)}
   });
   if(['组件','动画','素材'].includes(page)){
    const selector='.hf-studio-inspector input[type=search]';
    const previous=await evaluate(frame,"document.querySelector("+JSON.stringify(selector)+").value");
    try {
     await ctx.prove(theme+' · '+page+' 搜索聚焦与无匹配状态',{
      voiceover:'只输入临时搜索词，验证焦点、筛选空结果和恢复；不导入、不删除、不添加作品内容。',
      action:async()=>{await click(ctx,frame,selector);await evaluate(frame,"document.querySelector("+JSON.stringify(selector)+").select()");await ctx.client.send('Input.insertText',{text:'ui验收无匹配987'});await new Promise(r=>setTimeout(r,250));},
      assert:async()=>{
       ctx.assert(await evaluate(frame,"document.querySelector("+JSON.stringify(selector)+").value==='ui验收无匹配987'"),'Search query retained');
       const text=await evaluate(frame,"document.querySelector('.hf-studio-inspector').innerText");
       ctx.assert(page==='动画'?text.includes('没有匹配的动画'):page==='素材'?text.includes('没有匹配的素材'):text.includes('暂无组件')||text.includes('匹配'), 'Visible empty feedback: '+text.slice(-300));
      },
      screenshot:{name:theme+'-search-'+page}
     });
    } finally {
     await evaluate(frame,"document.querySelector("+JSON.stringify(selector)+").select()");
     await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
     await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
     if(previous)await ctx.client.send('Input.insertText',{text:previous});
    }
   }

   if(page==='讲解'){
    await ctx.prove(theme+' · 数字人面板只读检查',{
     voiceover:'讲解中的数字人子页检查空态、操作层级与主题适配，不创建人物、不上传、不生成。',
     action:async()=>{await evaluate(frame,"Array.from(document.querySelectorAll('.hf-studio-inspector button')).find(e=>e.textContent==='数字人').click()");await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.getBoundingClientRect().height>0");},
     assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-testid=video-avatar-panel]')?.getBoundingClientRect().height>0"),'Real avatar panel visible'),
     screenshot:{name:theme+'-avatar-page'}
    });
    if(await ctx.eval("!!document.querySelector('[data-testid=avatar-profile-card], [aria-label=删除此数字人]')")){
     if(await ctx.eval("!!document.querySelector('[data-testid=avatar-profile-card]')"))await ctx.eval("document.querySelector('[data-testid=avatar-profile-card]').click()");
     await ctx.waitFor("!!document.querySelector('[aria-label=删除此数字人]')");
     await ctx.prove(theme+' · 数字人删除确认只打开后取消',{
      voiceover:'查看已有数字人设置，只打开删除确认以检查文案、主题与按钮层级，随后明确点击取消，不删除、不保存。',
      action:async()=>{await ctx.eval("document.querySelector('[aria-label=删除此数字人]').click()");await ctx.waitFor("!!document.querySelector('[role=alertdialog]')");},
      assert:async()=>ctx.assert(await ctx.eval("(()=>{const e=document.querySelector('[role=alertdialog]');return e.innerText.includes('删除人物配置')&&Array.from(e.querySelectorAll('button')).some(b=>b.textContent==='取消')})()"),'Destructive confirmation visible with cancel action'),
      screenshot:{name:theme+'-avatar-confirm-open-only'}
     });
     await ctx.eval("Array.from(document.querySelectorAll('[role=alertdialog] button')).find(e=>e.textContent==='取消').click()");
     await ctx.waitFor("!document.querySelector('[role=alertdialog]')");
    }
    await evaluate(frame,"Array.from(document.querySelectorAll('.hf-studio-inspector button')).find(e=>e.textContent==='配音').click()");
   }

  }
  await ctx.prove(theme+' · 合并后的智能增强弹窗只打开不提交',{
   voiceover:'通过工作台顶部入口打开宿主智能增强弹窗，只检查布局和明暗主题，随后按 Escape 关闭，不分析、不应用、不生成。',
   action:async()=>{await click(ctx,frame,'[data-testid=studio-enhancement-open]');await ctx.waitFor("!!document.querySelector('[data-testid=video-enhancement-panel]')");await new Promise(r=>setTimeout(r,500));},
   assert:async()=>ctx.assert(await ctx.eval("(()=>{const e=document.querySelector('[data-testid=video-enhancement-panel]'),r=e.getBoundingClientRect();return r.width>400&&r.height>200&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&!!e.querySelector('[data-testid=enhancement-file]')})()"),'Merged host dialog is visible and contained'),
   screenshot:{name:theme+'-enhancement-open-only'}
  });
  await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await ctx.waitFor("!document.querySelector('[data-testid=video-enhancement-panel]')");
  await ctx.prove(theme+' · 导出设置只查看不执行',{
   voiceover:'顶部导出只打开设置面板，检查格式、分辨率与帧率选择器。不改变选项，不开始渲染，也不删除历史。',
   action:async()=>{await click(ctx,frame,'header button[aria-label=导出]');await wait(frame,"!!document.querySelector('.hf-studio-inspector button[aria-label=分辨率]')");},
   assert:async()=>ctx.assert(await evaluate(frame,"document.querySelectorAll('.hf-studio-inspector [role=combobox]').length>=3"),'Export settings visible without starting render'),
   screenshot:{name:theme+'-export-settings-readonly'}
  });
  await ctx.prove(theme+' · 分辨率下拉选中与边界',{
   voiceover:'只展开分辨率菜单查看选中标记与宽度，按 Escape 关闭，不选择任何新值。',
   action:async()=>{await click(ctx,frame,'.hf-studio-inspector button[aria-label=分辨率]');await wait(frame,"!!document.querySelector('[role=listbox]')");},
   assert:async()=>ctx.assert(await evaluate(frame,"(()=>{const e=document.querySelector('[role=listbox]'),r=e.getBoundingClientRect();return r.width>100&&r.left>=0&&r.right<=innerWidth+1&&!!e.querySelector('[role=option][aria-selected=true]')})()"),'Selected option and popup remain in viewport'),
   screenshot:{name:theme+'-export-resolution-open-only'}
  });
  await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await evaluate(frame,"location.hash=location.hash.replace(/([?&]tab=)renders/,'$1design')");
  await wait(frame,"Array.from(document.querySelectorAll('.hf-studio-inspector button')).some(e=>e.textContent==='图层')");
  await choose('图层');
 }
 } finally {
  await ctx.eval("import('/src/app/theme.ts').then(m=>m.setThemeMode("+JSON.stringify(themeMode)+"))",{awaitPromise:true});
  await choose('图层');
 }


 await ctx.prove('脚本高级设置打开与取消，不应用修改',{
  voiceover:'窄栏通过镜头设置文字入口按需展开画面结构、素材与音效。只打开设置弹窗检查排版，随后取消，不应用、不保存。',
  action:async()=>{await evaluate(frame,"(()=>{const e=document.querySelector('tr[data-shot] [data-testid^=storyboard-settings-toggle-]');if(e.getAttribute('aria-expanded')!=='true')e.click()})()");await evaluate(frame,"(()=>{const e=document.querySelector('tr[data-shot] [data-testid^=storyboard-picture-picker-]');if(e.getBoundingClientRect().height===0)throw Error('Settings action is hidden');e.click()})()");await ctx.waitFor("!!document.querySelector('[data-testid=storyboard-settings-dialog]')");},
  assert:async()=>ctx.assert(await ctx.eval("!!document.querySelector('[data-testid=storyboard-settings-dialog] fieldset')"),'Host shared settings form opens'),
  screenshot:{name:'script-settings-open-only'}
 });
 await ctx.eval("Array.from(document.querySelectorAll('[data-testid=storyboard-settings-dialog] footer button')).find(e=>e.textContent==='取消').click()");
 await ctx.waitFor("!document.querySelector('[data-testid=storyboard-settings-dialog]')");
 await evaluate(frame,"document.querySelector('tr[data-shot] [data-testid^=storyboard-settings-toggle-]').click()");
 await choose('图层');
 await ctx.prove('图层选中状态与真实属性表单',{
  voiceover:'选择现有时间轴图层，仅查看它的属性与焦点，不改数值，不隐藏，不删除。',
  action:async()=>{await evaluate(frame,"document.querySelector('.hf-timeline-layer-header__select').click()");await new Promise(r=>setTimeout(r,350));},
  assert:async()=>ctx.assert(await evaluate(frame,"!!document.querySelector('.hf-timeline-layer-header__select[aria-pressed=true]')"),'Selected layer state visible'),
  screenshot:{name:'layer-selected-properties'}
 });

 ctx.assert(await evaluate(frame,"fetch("+JSON.stringify(fileUrl)+").then(r=>r.json()).then(d=>d.content)",{awaitPromise:true})===originalSource,'Real video file unchanged');
 ctx.assert(await evaluate(frame,"document.querySelector('[data-testid=studio-video-title]').textContent")==originalTitle,'Real video name unchanged');
 }finally{
 if(await ctx.eval("!!document.querySelector('[data-testid=storyboard-settings-dialog]')"))await ctx.eval("Array.from(document.querySelectorAll('[data-testid=storyboard-settings-dialog] footer button')).find(e=>e.textContent==='取消').click()");
 if(await evaluate(frame,"!!document.querySelector('header input')"))await evaluate(frame,"Array.from(document.querySelectorAll('header button')).find(e=>e.textContent==='取消').click()");
 await ctx.eval("document.querySelectorAll('[data-proof-scroll]').forEach(e=>{e.scrollTop=Number(e.dataset.proofScroll);delete e.dataset.proofScroll;})");
 }
}}]};
