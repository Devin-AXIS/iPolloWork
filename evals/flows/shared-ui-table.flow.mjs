import {buildPluginRuntime} from '../../packages/ui/build-plugin-runtime.mjs';
import {coreDemoHtml} from '../support/shared-ui-core-fixture.mjs';
import {evaluate} from '../runner/cdp.mjs';
import {click,key,findFrame} from './shared-ui-core.flow.mjs';
const origin=process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN||'http://127.0.0.1:5194';
const preview=origin+'/@fs'+new URL('../support/shared-ui-core.html',import.meta.url).pathname;
async function wait(frame,expression){await new Promise(r=>setTimeout(r,50));for(let i=0;i<150;i++){if(await evaluate(frame,expression))return;await new Promise(r=>setTimeout(r,25));}throw Error('Table did not settle: '+expression);}
const settled="document.querySelector('#table-result')?.getAttribute('aria-busy')==='false'";
async function check(parent,frame,selector){await evaluate(frame,"document.querySelector("+JSON.stringify(selector)+").focus()");await key(parent,' ');}
async function fill(frame,value){await evaluate(frame,"(()=>{const e=document.querySelector('#table-search');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");await wait(frame,settled);}
export default {
 id:'shared-ui-table',title:'紧凑共享表格：排序、组合筛选、分页与批量恢复',kind:'user-facing',preserveTheme:true,cdpTarget:{urlIncludes:origin},
 steps:['bundled','host'].map(mode=>({name:mode+' 数据表格',async run(ctx){
  const parent=ctx.client;
  await parent.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await parent.send('Page.navigate',{url:preview+'?mode='+mode});await ctx.waitFor("!!document.querySelector('iframe')");
  if(mode==='bundled'){const{script}=await buildPluginRuntime('bundled');await ctx.eval("document.querySelector('iframe').srcdoc="+JSON.stringify(coreDemoHtml(script)));}
  const frame=await findFrame(ctx,mode);
  try{
   await click(parent,frame,'#group-数据表格');await wait(frame,settled);
   await ctx.prove(mode+' 名称排序在完整数据上执行',{
    voiceover:'表头键盘操作依次切换升序、降序和默认；排序先于分页，不是只排当前页。',
    action:async()=>{await click(parent,frame,'#table-sort-head button');await wait(frame,settled);},
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('#table-sort-head').getAttribute('aria-sort')==='ascending'&&document.querySelector('[data-column=name]').textContent==='素材 01'&&document.querySelectorAll('[data-row-id]').length===5"),'Full collection sorted before page'),
    screenshot:{name:mode+'-sort'}
   });
   await click(parent,frame,'#table-sort-head button');await wait(frame,settled);
   ctx.assert(await evaluate(frame,"document.querySelector('[data-column=name]').textContent==='素材 23'&&document.querySelector('#table-sort-head').getAttribute('aria-sort')==='descending'"),'Descending sort');
   await click(parent,frame,'#table-sort-head button');await wait(frame,settled);
   ctx.assert(await evaluate(frame,"document.querySelector('#table-sort-head').getAttribute('aria-sort')==='none'"),'Sort reset');
   await ctx.prove(mode+' 翻页保留选择，当前页全选不扩大范围',{
    voiceover:'先选一行出现半选，表头只选当前页；翻页保留五项，再增加第二页的一项。',
    action:async()=>{
     await check(parent,frame,'[data-row-id] [role=checkbox]');
     ctx.assert(await evaluate(frame,"document.querySelector('thead [role=checkbox]').getAttribute('aria-checked')==='mixed'"),'Mixed state');
     await check(parent,frame,'thead [role=checkbox]');
     await click(parent,frame,'button[aria-label=下一页]');await wait(frame,settled);
     await check(parent,frame,'[data-row-id] [role=checkbox]');
    },
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=table-bulk-actions]').textContent.includes('已选择 6 项')&&document.querySelector('[data-slot=table-pagination]').textContent.includes('第 2 / 5 页')"),'Cross-page six selected'),
    screenshot:{name:mode+'-selection'}
   });
   await ctx.prove(mode+' 搜索和状态筛选叠加，回到第一页并清空选择',{
    voiceover:'改变筛选会重置页码和选择；搜索与状态同时生效，无匹配可以恢复。',
    action:async()=>{
     await fill(frame,'素材 0');
     await click(parent,frame,'#table-status');
     await wait(frame,"!!document.querySelector('[role=option]')");
     await evaluate(frame,"Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent==='已完成').dataset.tableChoice='done'");
     await click(parent,frame,'[data-table-choice=done]');await wait(frame,settled);
    },
    assert:async()=>ctx.assert(await evaluate(frame,"!document.querySelector('[data-slot=table-bulk-actions]')&&Array.from(document.querySelectorAll('[data-row-id]')).every(e=>e.textContent.includes('素材 0')&&e.textContent.includes('已完成'))&&document.querySelector('[data-slot=table-pagination]').textContent.includes('第 1')"),'Combined filters and reset'),
    screenshot:{name:mode+'-filters'}
   });
   await fill(frame,'不存在');
   ctx.assert(await evaluate(frame,"document.body.innerText.includes('没有匹配结果')&&!!document.querySelector('#table-reset')"),'No match has reset');
   await click(parent,frame,'#table-reset');await wait(frame,settled);
   await ctx.prove(mode+' 每页条数变化重置分页',{
    voiceover:'每页条数由调用方控制；改成十条会回到第一页并重新计算真实页数。',
    action:async()=>{
     await click(parent,frame,'button[aria-label=每页条数]');await wait(frame,"!!document.querySelector('[role=option]')");
     await evaluate(frame,"Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent==='10').dataset.tablePageSize='ten'");
     await click(parent,frame,'[data-table-page-size=ten]');await wait(frame,settled);
    },
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelectorAll('[data-row-id]').length===10&&document.querySelector('[data-slot=table-pagination]').textContent.includes('第 1 / 3 页')"),'Page size accepted'),
    screenshot:{name:mode+'-page-size'}
   });
   await click(parent,frame,'button[aria-label=每页条数]');await wait(frame,"!!document.querySelector('[role=option]')");
   await evaluate(frame,"Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent==='5').dataset.tablePageSize='five'");
   await click(parent,frame,'[data-table-page-size=five]');await wait(frame,settled);
   await ctx.prove(mode+' 读取失败保留上页内容与真实页码',{
    voiceover:'下一页读取失败时保留上一页，页码不假装成功跳转；重试完成才显示第二页。',
    action:async()=>{await click(parent,frame,'#table-fail-read');await click(parent,frame,'button[aria-label=下一页]');await wait(frame,"!!document.querySelector('#table-error')");},
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelectorAll('[data-row-id]').length===5&&document.querySelector('[data-slot=table-pagination]').textContent.includes('第 1 / 5 页')"),'Failed page preserves confirmed data'),
    screenshot:{name:mode+'-page-error'}
   });
   await click(parent,frame,'#table-fail-read');await click(parent,frame,'#table-retry');await wait(frame,settled);
   ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=table-pagination]').textContent.includes('第 2 / 5 页')"),'Retry accepted second page');
   await check(parent,frame,'thead [role=checkbox]');
   await click(parent,frame,'#table-bulk');
   await wait(frame,"!!document.querySelector('#table-confirm')");
   await ctx.prove(mode+' 批量操作明确确认与取消不执行',{
    voiceover:'跨页批量操作先显示数量和确认，取消不改变演示数据。',
    action:async()=>{},
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('5 项')"),'Scope explicit'),
    screenshot:{name:mode+'-confirm'}
   });
   await click(parent,frame,'[data-slot=alert-dialog-cancel]');
   await wait(frame,"!document.querySelector('#table-confirm')");
   ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=table-pagination]').textContent.includes('共 23 项')"),'Cancel did not execute');
   await click(parent,frame,'#table-bulk');await wait(frame,"!!document.querySelector('#table-confirm')");
   await click(parent,frame,'#table-confirm');
   await wait(frame,"!!document.querySelector('#table-bulk-error')&&!document.querySelector('#table-confirm')");await wait(frame,settled);
   await ctx.prove(mode+' 部分失败只保留失败项重试',{
    voiceover:'模拟批量部分失败后移除成功项，只保留一个失败项供重试，不重复执行成功项。',
    action:async()=>{},
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=table-bulk-actions]').textContent.includes('已选择 1 项')&&document.querySelector('[data-slot=table-pagination]').textContent.includes('共 19 项')&&document.querySelector('#receipt').textContent.includes('成功 4，失败 1')"),'Partial result handled'),
    screenshot:{name:mode+'-partial-failure'}
   });
   await click(parent,frame,'#table-fail-bulk');await click(parent,frame,'#table-bulk');await wait(frame,"!!document.querySelector('#table-confirm')");await click(parent,frame,'#table-confirm');
   await wait(frame,"!document.querySelector('[data-slot=table-bulk-actions]')&&!document.querySelector('#table-confirm')");await wait(frame,settled);
   ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=table-pagination]').textContent.includes('共 18 项')&&document.querySelector('#receipt').textContent.includes('成功 1，失败 0')"),'Retry only failed ID');
   await ctx.prove(mode+' 暗色窄窗口保持紧凑和局部滚动',{
    voiceover:'暗色三百九十像素容器中保持十三像素文字、三十二像素操作和局部表格滚动。',
    action:async()=>{await evaluate(frame,"document.documentElement.dataset.theme='dark'");await parent.send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,350));},
    assert:async()=>ctx.assert(await evaluate(frame,"document.documentElement.scrollWidth<=innerWidth&&getComputedStyle(document.querySelector('[data-slot=table]')).fontSize==='13px'&&document.querySelector('#table-search').getBoundingClientRect().height===32"),'Compact geometry'),
    screenshot:{name:mode+'-narrow'}
   });
  }finally{frame.close();await parent.send('Emulation.clearDeviceMetricsOverride');}
 }}))
};
