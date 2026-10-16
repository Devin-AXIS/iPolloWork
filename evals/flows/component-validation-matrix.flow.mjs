// Component-level proof only: real React controls, isolated data/callbacks.
async function key(ctx, key, code, windowsVirtualKeyCode) {
  for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", {type, key, code, windowsVirtualKeyCode, ...(type === "keyDown" && key === "Enter" ? {text:"\r"} : {})});
}
const escape = ctx => key(ctx, "Escape", "Escape", 27);
async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const point = await ctx.eval(`(async()=>{
    const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',inline:'center'});
    let previous=e.getBoundingClientRect(),stable=0;
    for(let i=0;i<120&&stable<3;i++){
      await new Promise(requestAnimationFrame);const r=e.getBoundingClientRect();
      stable=Math.abs(r.x-previous.x)<.1&&Math.abs(r.y-previous.y)<.1&&Math.abs(r.height-previous.height)<.1?stable+1:0;previous=r;
    }
    const x=previous.x+previous.width/2,y=previous.y+previous.height/2,hit=document.elementFromPoint(x,y);
    return stable===3&&hit&&(hit===e||e.contains(hit))?{x,y}:null;
  })()`,{awaitPromise:true});
  ctx.assert(Boolean(point),`Stable, unobstructed clickable ${selector}`);
  await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  for(const type of ['mousePressed','mouseReleased'])await ctx.client.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
}
async function focus(ctx, selector) {
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
}
async function keyboardFocus(ctx, selector) {
  await focus(ctx, selector);
  await key(ctx, 'Tab', 'Tab', 9);
  for (const type of ['keyDown','keyUp']) await ctx.client.send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
}
async function scroll(ctx, id) {
  await ctx.eval(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'start'})`);
}
async function assertEval(ctx, expression, message) {
  ctx.assert(await ctx.eval(expression), message);
}
async function receipt(ctx, text) {
  await ctx.waitFor(`document.querySelector('#matrix-receipt').textContent===${JSON.stringify(text)}`);
}
const screenshot = name => ({name, requireText:["组件补齐验证"]});
async function assertPopup(ctx, selector) {
  await ctx.waitFor(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth})()`);
  const v=await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,overflow:e.scrollWidth>e.clientWidth}})()`);
  ctx.assert(v.left>=0&&v.right<=v.width&&!v.overflow,JSON.stringify(v));
}
export default {
  id:"component-validation-matrix", title:"待验证组件：真实控件状态、键盘、亮暗和窄窗口（隔离回调）", kind:"user-facing", preserveTheme:true,
  cdpTarget:{urlIncludes:"matrix=1"},
  steps:[
    {name:"字段、错误恢复和受控输入", async run(ctx) {
      await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
      await ctx.client.send("Emulation.setFocusEmulationEnabled",{enabled:true});
      await ctx.client.send("Page.reload"); await ctx.waitFor("Boolean(document.querySelector('#validation-matrix'))",{timeoutMs:90000});
      await ctx.prove("Label 关联字段；Input Error 保留草稿、关联错误并可恢复；Textarea/SearchField 保留输入",{
        action:async()=>{await click(ctx,'#matrix-form label[for=matrix-name]');await assertEval(ctx,"document.activeElement.id==='matrix-name'","Label focuses corresponding input");await click(ctx,'#matrix-validate');await ctx.waitFor("document.querySelector('#matrix-name').getAttribute('aria-invalid')==='true'");},
        assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-name').value==='保留草稿' && document.querySelector('#matrix-name').getAttribute('aria-describedby')==='matrix-error' && document.querySelector('#matrix-error').getAttribute('role')==='alert'","Invalid field preserves draft and describes error");},screenshot:screenshot("field-error")});
      await ctx.fill('#matrix-name','修改后的草稿');await click(ctx,'#matrix-save');await receipt(ctx,'保存：修改后的草稿');
      await assertEval(ctx,"document.querySelector('#matrix-name').getAttribute('aria-invalid')==='false' && !document.querySelector('#matrix-error')","Editing/retry clears error without erasing draft");
      await ctx.fill('#matrix-text','第一行\n第二行');await ctx.fill('#matrix-search','Beta');await ctx.waitFor("document.querySelector('#matrix-search-results').textContent==='Beta'");
      await assertEval(ctx,"document.querySelector('#matrix-text').value==='第一行\\n第二行' && document.querySelector('[aria-label=禁用说明]').disabled","Textarea stores multiline and has disabled state");
      await ctx.fill('#matrix-search','missing');await ctx.waitFor("document.querySelector('#matrix-search-results').textContent==='没有匹配结果'");await ctx.fill('#matrix-search','');
    }},
    {name:"多选、单选与开关键盘",async run(ctx){
      await ctx.prove("Checkbox/Switch 用空格切换，RadioGroup 箭头切换，禁用项不参与操作",{action:async()=>{await focus(ctx,'[role=checkbox][aria-label=多选项目]');await key(ctx,' ','Space',32);await receipt(ctx,'多选：true');await focus(ctx,'[role=switch][aria-label=自动保存]');await key(ctx,' ','Space',32);await receipt(ctx,'自动保存：true');await focus(ctx,'[aria-label=方案一]');await key(ctx,'ArrowDown','ArrowDown',40);await receipt(ctx,'单选：two');},assert:async()=>{await assertEval(ctx,"document.querySelector('[role=checkbox][aria-label=多选项目]').getAttribute('aria-checked')==='true' && document.querySelector('[role=switch][aria-label=自动保存]').getAttribute('aria-checked')==='true' && document.querySelector('[aria-label=方案二]').getAttribute('aria-checked')==='true'","Keyboard updates accessible checked states");await assertEval(ctx,"[...document.querySelectorAll('[aria-label^=禁用]')].every(e=>e.disabled || e.getAttribute('aria-disabled')==='true')","Disabled controls remain disabled");},screenshot:screenshot('selection-states')});
    }},
    {name:"Autocomplete 与命令搜索",async run(ctx){
      await click(ctx,'#matrix-autocomplete');await ctx.fill('#matrix-autocomplete','Beta');await key(ctx,'ArrowDown','ArrowDown',40);await ctx.waitFor("Boolean(document.querySelector('[data-slot=autocomplete-popup] [role=option]'))");
      await key(ctx,'Enter','Enter',13);await receipt(ctx,'搜索选择：Beta');await ctx.waitFor("document.querySelector('#matrix-autocomplete').getAttribute('aria-expanded')==='false'");
      await ctx.fill('#matrix-command input','missing');await ctx.waitFor("document.querySelector('#matrix-command').textContent.includes('无匹配命令')");
      await ctx.prove("Autocomplete 搜索键盘选择，Command/Input 过滤为空和结果选择",{action:async()=>{await ctx.fill('#matrix-command input','Gamma');await focus(ctx,'#matrix-command input');await key(ctx,'ArrowDown','ArrowDown',40);await key(ctx,'Enter','Enter',13);await receipt(ctx,'命令：Gamma');},assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-autocomplete').value==='Beta'","Autocomplete retains selected value");},screenshot:screenshot('search-command')});
    }},
    {name:"描述按钮、下拉与右键菜单",async run(ctx){
      await scroll(ctx,'matrix-menus');await focus(ctx,'#matrix-descriptive');await key(ctx,'Enter','Enter',13);await receipt(ctx,'描述按钮已执行');
      await click(ctx,'#matrix-dropdown');await ctx.waitFor("Boolean(document.querySelector('#matrix-dropdown-action'))");
      await escape(ctx);await ctx.waitFor("!document.querySelector('#matrix-dropdown-action')");await assertEval(ctx,"document.activeElement.id==='matrix-dropdown'","Dropdown Escape restores trigger focus");
      await click(ctx,'#matrix-dropdown');await click(ctx,'#matrix-dropdown-action');await receipt(ctx,'菜单已执行');
      const point=await ctx.eval("(()=>{const r=document.querySelector('#matrix-context').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      for(const type of ['mousePressed','mouseReleased'])await ctx.client.send('Input.dispatchMouseEvent',{type,button:'right',clickCount:1,...point});
      await ctx.waitFor("Boolean(document.querySelector('#matrix-context-action'))");
      await ctx.prove("DescriptiveButton 键盘可执行；Dropdown/ContextMenu 保留禁用状态和回调",{assert:async()=>{await assertEval(ctx,"document.querySelector('[data-slot=context-menu-content] [aria-disabled=true]')!==null","Context menu exposes disabled item");},screenshot:screenshot('context-menu')});
      await click(ctx,'#matrix-context-action');await receipt(ctx,'上下文已执行');
    }},
    {name:"命令弹窗、模型行为、风险确认和链接菜单",async run(ctx){
      await click(ctx,'#matrix-command-dialog');await ctx.waitFor("Boolean(document.querySelector('[data-slot=command-dialog-popup]'))");
      await assertEval(ctx,"document.querySelector('[data-slot=command-dialog-popup]').contains(document.activeElement)","CommandDialog contains keyboard focus");
      await escape(ctx);await ctx.waitFor("!document.querySelector('[data-slot=command-dialog-popup]')");await assertEval(ctx,"document.activeElement.id==='matrix-command-dialog'","CommandDialog restores focus");
      await click(ctx,'#matrix-menus button[aria-label="切换模型 · 行为"]');await ctx.waitForText('推理力度');await ctx.clickText('推理力度');await ctx.clickText('低');await receipt(ctx,'推理：low');
      await click(ctx,'#matrix-confirm');await ctx.waitForText('确认隔离操作？');await ctx.clickText('取消执行');await receipt(ctx,'确认已取消');await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
      await click(ctx,'#matrix-confirm');await ctx.waitForText('确认隔离操作？');
      await ctx.prove("CommandDialog 焦点闭环，ModelBehaviorMenu 更新选择，ConfirmModal 取消不执行；LinkActionMenu 分发预览回调",{assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-receipt').textContent==='确认已取消'","Confirmation does not execute before explicit approval");},screenshot:screenshot('danger-confirm')});
      await ctx.clickText('确认执行');await receipt(ctx,'确认已执行');await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
      await click(ctx,'#matrix-link');await ctx.waitForText('网页预览');await ctx.clickText('网页预览',{selector:'[role=menuitem]'});await receipt(ctx,'链接：preview');
    }},
    {name:"头像、图片、消息、来源与悬停",async run(ctx){
      await scroll(ctx,'matrix-content');await ctx.waitFor("document.querySelector('#matrix-content [data-slot=avatar-fallback]')?.textContent==='IP' && document.querySelector('#matrix-image img')?.naturalHeight===480");
      await click(ctx,'#matrix-image button');await ctx.waitFor("document.querySelector('#matrix-image img').getBoundingClientRect().height>100");
      await click(ctx,'#matrix-image button');await ctx.waitFor("document.querySelector('#matrix-image img').parentElement.getBoundingClientRect().height<=100");
      await keyboardFocus(ctx,'#matrix-hover');await ctx.waitFor("Boolean(document.querySelector('[data-slot=hover-card-content]'))");
      await ctx.prove("Avatar 失败回退；Image 展开收起；HoverCard 键盘聚焦与安全来源链接",{assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-source a').rel.includes('noopener') && document.querySelector('#matrix-source a').target==='_blank'","Source uses safe external link");},screenshot:screenshot('content-hover')});
      await escape(ctx);await keyboardFocus(ctx,'#matrix-source a');await ctx.waitFor("document.querySelector('[data-slot=hover-card-content]')?.textContent.includes('验证来源标题')");await escape(ctx);
    }},
    {name:"工具状态、思考展开和加载结果",async run(ctx){
      await click(ctx,'#matrix-tool-error');await click(ctx,'#matrix-tool button');await ctx.waitFor("document.querySelector('#matrix-tool').textContent.includes('连接失败；原始输入保留')");
      await ctx.prove("Tool/Error 明示失败并保留输入；ChainOfThought 可展开；ModelLoadingStatus/Skeleton 不伪造完成",{assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-tool').textContent.includes('failed') && document.querySelector('#matrix-tool').textContent.includes('proof.txt')","Tool failure keeps input and error detail");await assertEval(ctx,"document.querySelector('#matrix-loading [role=status]').getAttribute('aria-live')==='polite' && document.querySelector('#matrix-skeleton').getBoundingClientRect().height===32","Loading announces politely and shows real skeleton");},screenshot:screenshot('tool-error')});
      await click(ctx,'#matrix-tool-success');await ctx.waitFor("document.querySelector('#matrix-tool').textContent.includes('读取结果') && !document.querySelector('#matrix-tool').textContent.includes('failed')");
      await click(ctx,'#matrix-tool-running');await assertEval(ctx,"Boolean(document.querySelector('#matrix-tool .animate-spin'))","In-flight tool uses spinner");
      await focus(ctx,'#matrix-thought button');await key(ctx,'Enter','Enter',13);await ctx.waitFor("document.querySelector('#matrix-thought button').getAttribute('aria-expanded')==='true'");
      await click(ctx,'#matrix-loading-toggle');await ctx.waitFor("Boolean(document.querySelector('#matrix-loaded')) && !document.querySelector('#matrix-loading')");
    }},
    {name:"展开、面板、分栏、滚动、分隔与侧栏",async run(ctx){
      await scroll(ctx,'matrix-layout');await focus(ctx,'#matrix-accordion');await key(ctx,'Enter','Enter',13);await ctx.waitFor("document.querySelector('#matrix-accordion').getAttribute('aria-expanded')==='true'");
      await focus(ctx,'#matrix-layout [data-slot=collapsible-trigger]');await key(ctx,' ','Space',32);await ctx.waitFor("document.querySelector('#matrix-layout [data-slot=collapsible-trigger]').getAttribute('aria-expanded')==='true'");
      await ctx.clickText('预览');await receipt(ctx,'面板：预览');await focus(ctx,'[aria-label="Close tab: 预览"]');await key(ctx,'Enter','Enter',13);await receipt(ctx,'关闭：预览');await assertEval(ctx,"!document.querySelector('[aria-label=\"Close tab: 预览\"]')","PanelTabs close does not reactivate removed tab");
      const before=await ctx.eval("document.querySelector('#matrix-panel-left').getBoundingClientRect().width");await focus(ctx,'[data-slot=resizable-handle]');await key(ctx,'ArrowRight','ArrowRight',39);await ctx.waitFor(`document.querySelector('#matrix-panel-left').getBoundingClientRect().width>${before}`);
      await focus(ctx,'#matrix-scroll [data-slot=scroll-area-viewport]');await key(ctx,'End','End',35);await ctx.waitFor("document.querySelector('#matrix-scroll [data-slot=scroll-area-viewport]').scrollTop>0");
      await click(ctx,'#matrix-sidebar-toggle');await ctx.waitFor("document.querySelector('#matrix-sidebar [data-slot=sidebar]').dataset.state==='collapsed'");
      await ctx.prove("Accordion/Collapsible 键盘展开，PanelTabs 切换关闭，Resizable 键盘调整，ScrollArea 滚动，Sidebar 折叠",{assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-separator').getAttribute('role')==='separator'","Separator exposes semantic role");},screenshot:screenshot('layout-controls')});
    }},
    {name:"通知中心与产物入口（隔离存储和回调）",async run(ctx){
      await scroll(ctx,'matrix-business');await focus(ctx,'#matrix-notify-reset');await key(ctx,'Enter','Enter',13);await ctx.waitFor("JSON.parse(localStorage.getItem('ipollowork:notifications:v1')).state.notifications.length===0");await click(ctx,'#matrix-business button[aria-label="通知"]');await ctx.waitForText('还没有通知');await escape(ctx);
      await focus(ctx,'#matrix-notify-add');await key(ctx,'Enter','Enter',13);await ctx.waitFor("Boolean(document.querySelector('#matrix-business button[aria-label=\"通知 (1)\"]'))");
      await click(ctx,'#matrix-business button[aria-label="通知 (1)"]');await ctx.waitForText('隔离验证通知');
      await ctx.prove("NotificationCenter 空态、未读标记和读取；Artifact 保留真实文件卡片与打开回调",{assert:async()=>{await assertEval(ctx,"document.querySelector('#matrix-artifacts [data-artifact-path=\"design/proof/index.html\"]')!==null && document.querySelector('#matrix-artifacts-empty').children.length===0","Artifact renders registered file and empty list stays empty");},screenshot:screenshot('business-notification')});
      await escape(ctx);await ctx.waitFor("Boolean(document.querySelector('#matrix-business button[aria-label=\"通知\"]'))");
      await click(ctx,'#matrix-artifacts button[data-testid=artifact-file-card]');await receipt(ctx,'产物：design/proof/index.html:design');
    }},
    {name:"亮暗主题与窄窗口布局",async run(ctx){
      const light=await ctx.eval("getComputedStyle(document.querySelector('#validation-matrix')).backgroundColor");
      await click(ctx,'#matrix-theme');await ctx.waitFor("document.documentElement.dataset.theme==='dark'");
      await assertEval(ctx,`getComputedStyle(document.querySelector('#validation-matrix')).backgroundColor!==${JSON.stringify(light)}`,"Dark mode changes shared surface");
      for(const width of [1280,390]){
        await ctx.client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        for(const id of ['matrix-form','matrix-menus','matrix-content','matrix-layout','matrix-business']){
          await scroll(ctx,id);await ctx.prove(`${id} 深色 ${width}px 布局与文字边界`,{assert:async()=>{const v=await ctx.eval(`(()=>{const e=document.getElementById('${id}');return {width:e.clientWidth,scrollWidth:e.scrollWidth,viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth}})()`);ctx.assert(v.viewport===width&&v.scrollWidth<=v.width&&!v.documentOverflow,JSON.stringify(v));},screenshot:screenshot(`${id}-dark-${width}`)});
        }
      }
      await click(ctx,'#matrix-theme');
      for(const id of ['matrix-form','matrix-menus','matrix-content','matrix-layout','matrix-business']){
        await scroll(ctx,id);await ctx.prove(`${id} 浅色 390px 布局与文字边界`,{assert:async()=>{await assertEval(ctx,`document.getElementById('${id}').scrollWidth<=document.getElementById('${id}').clientWidth && document.documentElement.scrollWidth<=innerWidth`,"Narrow light layout stays inside viewport");},screenshot:screenshot(`${id}-light-390`)});
      }
      for(const theme of ['light','dark']) {
        if(theme==='dark')await click(ctx,'#matrix-theme');
        await scroll(ctx,'matrix-menus');await click(ctx,'#matrix-dropdown');await ctx.waitFor("Boolean(document.querySelector('#matrix-dropdown-action'))");
        await ctx.prove(`DropdownMenu ${theme} 390px 浮层与焦点恢复`,{assert:()=>assertPopup(ctx,'[data-slot=dropdown-menu-content]'),screenshot:screenshot(`dropdown-${theme}-390`)});await escape(ctx);
        await ctx.waitFor("!document.querySelector('#matrix-dropdown-action') && document.activeElement.id==='matrix-dropdown'");
        await click(ctx,'#matrix-command-dialog');await ctx.waitFor("Boolean(document.querySelector('[data-slot=command-dialog-popup]'))");
        await ctx.prove(`CommandDialog ${theme} 390px 浮层与焦点限制`,{assert:async()=>{await assertPopup(ctx,'[data-slot=command-dialog-popup]');await assertEval(ctx,"document.querySelector('[data-slot=command-dialog-popup]').contains(document.activeElement)","Narrow dialog retains focus");},screenshot:screenshot(`command-dialog-${theme}-390`)});await escape(ctx);await ctx.waitFor("!document.querySelector('[data-slot=command-dialog-popup]') && !document.querySelector('[data-slot=command-dialog-backdrop]')");
        await scroll(ctx,'matrix-business');await click(ctx,'#matrix-business button[aria-label="通知"]');await ctx.waitForText('隔离验证通知');
        await ctx.prove(`NotificationCenter ${theme} 390px 浮层边界`,{assert:()=>assertPopup(ctx,'[data-slot=popover-content]'),screenshot:screenshot(`notification-${theme}-390`)});await escape(ctx);await ctx.waitFor("!document.querySelector('[data-slot=popover-content]')");
        await scroll(ctx,'matrix-layout');await click(ctx,'#matrix-sidebar-toggle');await ctx.waitFor("Boolean(document.querySelector('[data-slot=sidebar][data-mobile=true]'))");
        await assertPopup(ctx,'[data-slot=sidebar][data-mobile=true]');await escape(ctx);await ctx.waitFor("!document.querySelector('[data-slot=sidebar][data-mobile=true]')");
      }
    }},
    ...(process.env.IPOLLOWORK_MATRIX_DEFAULT_MESSAGE === '1' ? [{name:"Message 默认组合长串验收（已知缺陷回归）",async run(ctx){
      await scroll(ctx,'matrix-content');
      await ctx.screenshot('message-default-overflow',{claim:'Message 默认组合应在390px连续长字符串下保持边界',requireText:['组件补齐验证']});
      await assertEval(ctx,"document.querySelector('#matrix-message').scrollWidth<=document.querySelector('#matrix-message').clientWidth","Message default content must wrap without caller min-w-0");
    }}] : []),
    ...(process.env.IPOLLOWORK_MATRIX_THOUGHT_PROPS === '1' ? [{name:"ChainOfThoughtTrigger 自定义属性验收（已知缺陷回归）",async run(ctx){
      await scroll(ctx,'matrix-content');await ctx.screenshot('thought-props',{claim:'ChainOfThoughtTrigger 应透传调用方指定的 id',requireText:['组件补齐验证']});
      await assertEval(ctx,"document.querySelector('#matrix-thought-trigger')!==null","ChainOfThoughtTrigger must forward id to its actual trigger");
      await assertEval(ctx,"document.querySelector('#matrix-thought-trigger').dataset.proof==='forwarded' && document.querySelector('#matrix-thought-disabled').getAttribute('aria-disabled')==='true'","Custom attribute and accessible disabled state reach trigger");
      await focus(ctx,'#matrix-thought-disabled');await key(ctx,'Enter','Enter',13);await key(ctx,' ','Space',32);
      await assertEval(ctx,"document.querySelector('#matrix-thought-disabled').getAttribute('aria-expanded')==='false'","Disabled trigger ignores Enter and Space");
    }}] : []),
  ],
};
