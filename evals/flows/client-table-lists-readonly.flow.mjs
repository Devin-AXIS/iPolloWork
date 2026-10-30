async function press(ctx, selector) {
  await ctx.eval("document.querySelector("+JSON.stringify(selector)+").click()");
  await new Promise(r=>setTimeout(r,250));
}
async function check(ctx, selector) {
  await ctx.eval("document.querySelector("+JSON.stringify(selector)+").click()");
  await new Promise(r=>setTimeout(r,150));
}
async function fill(ctx,value) {
  await ctx.eval("(()=>{const e=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await new Promise(r=>setTimeout(r,150));
}
export default {
 id:'client-table-lists-readonly',title:'开发版 Electron 两处列表：真实数据只读走查',kind:'user-facing',preserveTheme:true,cdpTarget:{urlIncludes:'localhost:5173'},
 steps:[{name:'真实窗口，不提交变更',async run(ctx){
  ctx.assert(await ctx.eval("navigator.userAgent.includes('Electron')"),'Must use real Electron, not browser fixture');
  const workspace = await ctx.eval("location.hash.split('/')[2]");
  ctx.assert(workspace,'Existing workspace required; do not create one');
  const root='/workspace/'+workspace;
  if(!await ctx.eval("location.hash.includes('/session')"))await ctx.navigateHash(root+'/session');
  // Wait for the desktop's saved-session restoration before operating its controls.
  await new Promise(r=>setTimeout(r,3000));
  await ctx.waitFor("!!document.querySelector('[data-testid=session-header-work-tasks]')");
  await ctx.eval("document.querySelector('[data-testid=session-header-work-tasks]').click()");
  await ctx.waitFor("!!document.querySelector('[data-testid=work-center]')");
  await ctx.eval("Array.from(document.querySelectorAll('[data-testid=work-center] button')).find(e=>e.textContent==='列表').click()");
  await ctx.waitFor("!!document.querySelector('[data-testid=work-item-list]')");
  await ctx.waitFor("document.querySelector('[data-slot=table]').getAttribute('aria-busy')==='false'");
  const taskCount = await ctx.eval("document.querySelectorAll('[data-row-id]').length");
  await ctx.prove('真实任务列表显示与只读执行记录',{
   voiceover:'在开发版 Electron 原窗口查看真实列表。执行绑定记录不可批量修改，不创建测试任务。',
   action:async()=>{},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-slot=table-pagination]')!==null&&getComputedStyle(document.querySelector('table')).fontSize==='13px'"),'Compact table and real pagination'),
   screenshot:{name:'electron-work-list'}
  });
  await ctx.prove('任务排序与筛选无匹配恢复',{
   voiceover:'只改变界面上的排序与搜索；不存在的名称显示无匹配，清空后恢复记录。',
   action:async()=>{
    await press(ctx,'button[aria-label="按名称排序"]');
    ctx.assert(await ctx.eval("document.querySelector('[aria-sort=ascending]')!==null"),'Ascending');
    await press(ctx,'button[aria-label="按名称排序"]');
    ctx.assert(await ctx.eval("document.querySelector('[aria-sort=descending]')!==null"),'Descending');
    await press(ctx,'button[aria-label="按名称排序"]');
    await fill(ctx,'__readonly_no_matching_task_20261012__');
    ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length===0&&document.body.innerText.includes('没有匹配结果')"),'Real no match');
   },
   assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length")===0,'Task search shows real no match'),
   screenshot:{name:'electron-work-sort-filter'}
  });
  await fill(ctx,'');
  ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length")==taskCount,'Tasks restored without writes');
  const selectable = await ctx.eval("Array.from(document.querySelectorAll('[data-row-id] [role=checkbox]')).filter(e=>e.getAttribute('aria-disabled')!=='true').length");
  await ctx.prove('可选范围和分页边界',{
   voiceover:selectable?'表头选择只影响界面选择，清除后不执行状态更新。':'当前任务都是执行绑定记录，选择被禁用，不能打开批量修改确认；这项边界如实记录。',
   action:async()=>{
    if(selectable){await check(ctx,'thead [role=checkbox]');await ctx.waitFor("!!document.querySelector('[data-slot=table-bulk-actions]')");await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='批量修改状态').click()");await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-content]')");await press(ctx,'[data-slot=alert-dialog-cancel]');await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='清除选择').click()");}
   },
   assert:async()=>{
    if(!selectable)ctx.assert(await ctx.eval("Array.from(document.querySelectorAll('[data-row-id] [role=checkbox]')).every(e=>e.getAttribute('aria-disabled')==='true')"),'Read-only records cannot be selected');
    ctx.assert(await ctx.eval("document.querySelector('button[aria-label=上一页]').disabled"),'First page boundary');
   },
   screenshot:{name:'electron-work-selection-boundary'}
  });
  await ctx.navigateHash(root+'/settings/environment');
  await ctx.waitFor("location.hash.endsWith('/settings/environment')&&document.querySelector('button[aria-label=\"按名称排序\"]')?.closest('th')?.textContent.includes('名称')");
  const count=await ctx.eval("document.querySelectorAll('[data-row-id]').length");
  ctx.assert(count>0,'Existing metadata required; never create credentials');
  await ctx.prove('环境变量只读取名称元数据，值仍隐藏',{
   voiceover:'打开真实设置页面，只看变量名与遮罩，不点击查看或编辑。',
   action:async()=>{await press(ctx,'button[aria-label="按名称排序"]');},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[aria-sort=ascending]')!==null&&document.querySelectorAll('button[aria-label=查看]').length>0&&document.querySelectorAll('button[aria-label=隐藏]').length===0"),'Sorted metadata; no value revealed'),
   screenshot:{name:'electron-env-masked'}
  });
  await ctx.prove('环境变量搜索无匹配可恢复',{
   voiceover:'搜索不存在名称后清空，真实列表恢复；不读取任何值。',
   action:async()=>{await fill(ctx,'__readonly_no_matching_key_20261012__');},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length")===0,'Name-only no match'),
   screenshot:{name:'electron-env-search'}
  });
  await fill(ctx,'');
  ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length")==count,'Metadata rows restored');
  await check(ctx,'[data-row-id] [role=checkbox]');
  await ctx.waitFor("!!document.querySelector('[data-slot=table-bulk-actions]')");
  await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='批量删除').click()");
  await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-content]')");
  await ctx.prove('删除确认只打开，不提交',{
   voiceover:'选中一项打开确认，核对数量、不可撤销提示和生效边界。绝不点击确认删除。',
   action:async()=>{},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('1 个')&&document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('不可撤销')"),'One item explicitly confirmed'),
   screenshot:{name:'electron-env-confirm-only'}
  });
  await press(ctx,'[data-slot=alert-dialog-cancel]');await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
  await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='清除选择').click()");
  await ctx.prove('取消后记录不变，分页边界正确',{
   voiceover:'取消并清除界面选择，刷新重新读取名称元数据，确认记录数量不变。',
   action:async()=>{await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='刷新列表').click()");await new Promise(r=>setTimeout(r,500));},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-row-id]').length")==count&&await ctx.eval("document.querySelector('button[aria-label=上一页]').disabled&&!document.querySelector('[data-slot=table-bulk-actions]')"),'No deletion and first-page boundary'),
   screenshot:{name:'electron-env-cancelled'}
  });
 }}]
};
