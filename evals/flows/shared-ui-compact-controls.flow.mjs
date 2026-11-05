import { buildPluginRuntime } from '../../packages/ui/build-plugin-runtime.mjs';
import { coreDemoHtml } from '../support/shared-ui-core-fixture.mjs';
import { evaluate } from '../runner/cdp.mjs';
import { key, click, findFrame } from './shared-ui-core.flow.mjs';
const origin=process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN || 'http://127.0.0.1:5196';
const url=origin+'/@fs'+new URL('../support/shared-ui-core.html',import.meta.url).pathname;
async function fill(frame, selector, value) {
  await evaluate(frame,"(()=>{const e=document.querySelector("+JSON.stringify(selector)+");e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
}
export default {
 id:'shared-ui-compact-controls',title:'紧凑高频控件：两种共享运行时',kind:'user-facing',preserveTheme:true,
 cdpTarget:{urlIncludes:origin},
 steps:['bundled','host'].map(mode=>({name:mode+' 高频交互',async run(ctx){
  const parent=ctx.client;
  await parent.send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});
  await parent.send('Page.navigate',{url:url+'?mode='+mode});
  await ctx.waitFor("document.querySelector('iframe')!==null");
  if(mode==='bundled') {
   const {script}=await buildPluginRuntime('bundled');
   await ctx.eval("document.querySelector('iframe').srcdoc="+JSON.stringify(coreDemoHtml(script)));
  }
  const frame=await findFrame(ctx,mode);
  try {
   await click(parent,frame,'#group-高频控件');
   await ctx.prove(mode+' 搜索中文、无结果与清空恢复',{
    voiceover:'搜索控件保留图标间距，中文过滤、空结果和清空恢复使用同一入口。',
    action:async()=>{await fill(frame,'#compact-search','不存在');ctx.assert(await evaluate(frame,"document.querySelector('#search-results').textContent==='暂无匹配素材'"),'Empty results');await click(parent,frame,'button[aria-label="清除搜索"]');await fill(frame,'#compact-search','中文');},
    assert:async()=>{
     const g=await evaluate(frame,"(()=>{const e=document.querySelector('#compact-search'),r=e.getBoundingClientRect(),i=e.parentElement.querySelector('svg').getBoundingClientRect();return{value:e.value,height:r.height,gap:r.left-i.right,font:getComputedStyle(e).fontSize,results:document.querySelector('#search-results').textContent}})()");
     ctx.assert(g.value==='中文'&&g.results==='中文素材'&&g.height===32&&g.gap>=0&&g.font==='13px',JSON.stringify(g));
    },screenshot:{name:mode+'-search'}
   });
   await ctx.prove(mode+' 数值边界提示、加减和滑块键盘同步',{
    voiceover:'越界值保留并显示错误，修正后加减、方向键和滑块更新同一个数值。',
    action:async()=>{
     await fill(frame,'#compact-number','150');
     ctx.assert(await evaluate(frame,"document.querySelector('#compact-number').getAttribute('aria-invalid')==='true'&&document.body.innerText.includes('请输入 0–100')"),'Linked numeric error');
     await fill(frame,'#compact-number','50');
     await click(parent,frame,'button[aria-label="音量 +"]');
     await evaluate(frame,"document.querySelector('[data-slot=slider] input[type=range]').focus()");
     await key(parent,'ArrowRight');
    },
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('#numeric-value').textContent==='60'&&document.querySelector('#compact-number').value==='60'"),'Number and slider both equal 60'),
    screenshot:{name:mode+'-numeric-slider'}
   });
   await ctx.prove(mode+' 日历禁用日期、时间值和选择',{
    voiceover:'日期保持本地日期语义，日历禁用越界日期，选择后返回输入区。',
    action:async()=>{await click(parent,frame,'button[aria-label="打开日历"]');},
    assert:async()=>{
     const g=await evaluate(frame,"(()=>{const c=document.querySelector('[data-slot=calendar]');return {exists:!!c,days:c?.querySelectorAll('button').length,disabled:c?.querySelectorAll('button:disabled').length,border:getComputedStyle(c.querySelector('tbody button')).borderTopWidth,date:document.querySelector('#compact-date').value,time:document.querySelector('#compact-time').value}})()");
     ctx.assert(g.border==='0px'&&g.exists&&g.days>20&&g.disabled>0&&g.date==='2026-10-12'&&g.time==='09:30',JSON.stringify(g));
    },screenshot:{name:mode+'-calendar'}
   });
   const selectable=await evaluate(frame,"Array.from(document.querySelectorAll('[data-slot=calendar] button')).find(e=>e.textContent==='20'&&!e.disabled)?.getAttribute('aria-label')");
   if(!selectable)throw Error('Day 20 missing');
   await click(parent,frame,'[data-slot=calendar] button[aria-label='+JSON.stringify(selectable)+']');
   ctx.assert(await evaluate(frame,"document.querySelector('#compact-date').value==='2026-10-20'"),'Selected local date');
   await click(parent,frame,'button[aria-label="清除日期"]');
   ctx.assert(await evaluate(frame,"document.querySelector('#compact-date').value===''"),'Date cleared');
   await ctx.prove(mode+' 上传校验、文件保留与恢复入口',{
    voiceover:'不支持的文件显示原因，合法文件保留名称，失败后提供重试。传输失败是显式演示状态。',
    action:async()=>{
     await evaluate(frame,"(()=>{const d=new DataTransfer();d.items.add(new File(['bad'],'音频.mp3',{type:'audio/mpeg'}));document.querySelector('[data-slot=file-upload]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()");
     ctx.assert(await evaluate(frame,"document.body.innerText.includes('仅支持 PNG / JPG')"),'Type rejected');
     await evaluate(frame,"(()=>{const d=new DataTransfer();d.items.add(new File(['image'],'中文图片.png',{type:'image/png'}));document.querySelector('[data-slot=file-upload]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()");
     await click(parent,frame,'#upload-fail');
    },
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('#file-name').textContent==='中文图片.png'&&document.querySelector('[data-slot=file-upload-item]').dataset.status==='error'&&!document.querySelector('[data-slot=file-upload-item] [role=progressbar]')"),'Retained file without fake percentage'),
    screenshot:{name:mode+'-upload-recovery'}
   });
   await click(parent,frame,'[data-slot=file-upload-item] button');
   ctx.assert(await evaluate(frame,"document.querySelector('[data-slot=file-upload-item]').dataset.status==='ready'"),'Retry retains file');
   await ctx.prove(mode+' 暗色窄容器不溢出，控件高度不变',{
    voiceover:'深色三百九十像素容器下，搜索与日期保持三十二像素，按钮仍可操作。',
    action:async()=>{
     await evaluate(frame,"document.documentElement.dataset.theme='dark'");
     await parent.send('Emulation.setDeviceMetricsOverride',{width:390,height:960,deviceScaleFactor:1,mobile:false});
     await new Promise(resolve => setTimeout(resolve, 350));
    },
    assert:async()=>ctx.assert(await evaluate(frame,"document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#compact-search').getBoundingClientRect().height===32&&document.querySelector('#compact-date').getBoundingClientRect().height===32"),'Compact height stable, no horizontal overflow'),
    screenshot:{name:mode+'-dark-narrow'}
   });
  } finally {frame.close();await parent.send('Emulation.clearDeviceMetricsOverride');}
 }})).concat([{name:'宿主真实表单与上传',async run(ctx){
  await ctx.client.send('Page.navigate',{url:origin+'/tests/shared-ui-controls-proof.html'});
  await ctx.waitForText('创建计划任务');
  await ctx.fill('input[aria-label="搜索插件"]','不存在');
  await ctx.prove('真实设置搜索保留无结果和清空恢复',{
   voiceover:'宿主设置搜索复用新控件，无结果后清空能恢复列表。',
   action:async()=>{ctx.assert(await ctx.eval("document.querySelector('#host-search-results').textContent==='暂无结果'"),'Host filtering');await ctx.trustedClick('button[aria-label="清除搜索"]');},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('#host-search-results').textContent.includes('图片插件')"),'Host results restored'),
   screenshot:{name:'host-business-search'}
  });
  await ctx.trustedClick('#open-work-sheet');
  await ctx.waitFor("document.querySelector('[data-slot=date-picker]')!==null");
  await ctx.prove('工作项真实日期表单使用日历，原有时间菜单不变',{
   voiceover:'工作项日期换为共享日历，仍保留原来的二十四小时菜单和时间戳保存逻辑。',
   action:async()=>{await ctx.fill('#work-item-title','共享控件验证');await ctx.trustedClick('[data-slot=date-picker] button[aria-label$="日期"]');},
   assert:async()=>{
    const g=await ctx.eval("({cal:!!document.querySelector('[data-slot=calendar]'),dates:document.querySelectorAll('[data-slot=date-picker]').length,time:document.querySelector('[data-testid$=time-picker-24h]').textContent})");
    ctx.assert(g.cal&&g.dates===2&&g.time.includes('09:30'),JSON.stringify(g));
   },screenshot:{name:'host-business-calendar'}
  });
  await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await ctx.clickText('保存');
  await ctx.waitFor("document.querySelector('#work-save-receipt').textContent.includes('共享控件验证')");
  await ctx.prove('工作项日期和时间原值到达保存回调',{
   voiceover:'保存仍收到相同本地日期和时间的时间戳，不产生时区偏移。此处保存回调隔离，不创建真实任务。',
   assert:async()=>{
    const r=await ctx.eval("JSON.parse(document.querySelector('#work-save-receipt').textContent)");
    ctx.assert(r.startAt===new Date(2026,9,12,9,30).getTime()&&r.dueAt===new Date(2026,9,12,10,30).getTime(),JSON.stringify(r));
   },screenshot:{name:'host-business-date-save'}
  });
  await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?panel=avatar&profiles=1&audio=1'});
  await ctx.waitForText('创建数字人');
  await ctx.clickText('创建数字人');
  await ctx.waitFor("document.querySelector('[data-slot=file-upload]')!==null");
  await ctx.clickText('切换上传失败');
  await ctx.eval("(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').fillRect(0,0,2,2);c.toBlob(blob=>{const d=new DataTransfer();d.items.add(new File([blob],'人物.png',{type:'image/png'}));document.querySelector('[data-slot=file-upload]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));},'image/png');})()");
  await ctx.waitFor("document.querySelector('[data-slot=file-upload-item]')?.dataset.status==='error'");
  await ctx.prove('数字人真实上传调用失败后保留文件并重试',{
   voiceover:'数字人图片使用真实面板和上传客户端，显式注入一次传输失败，保留文件并重试；不调用收费生成。',
   action:async()=>{await ctx.clickText('切换上传失败');await ctx.trustedClick('[data-slot=file-upload-item] button');await ctx.waitFor("document.querySelector('[data-slot=file-upload-item]')?.dataset.status==='success'");},
   assert:async()=>ctx.assert(await ctx.eval("window.avatarProof.requests.filter(r=>r.action==='upload').length===2&&document.querySelector('[data-slot=file-upload-item]').textContent.includes('人物.png')"),'Two multipart requests with retained image'),
   screenshot:{name:'host-business-upload-retry'}
  });
 }}])
};
