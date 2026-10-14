import {buildPluginRuntime} from '../../packages/ui/build-plugin-runtime.mjs';
import {coreDemoHtml} from '../support/shared-ui-core-fixture.mjs';
import {evaluate} from '../runner/cdp.mjs';
import {click,findFrame} from './shared-ui-core.flow.mjs';
const origin=process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN||'http://127.0.0.1:5195';
const preview=origin+'/@fs'+new URL('../support/shared-ui-core.html',import.meta.url).pathname;
async function wait(frame,expression){for(let i=0;i<100;i++){if(await evaluate(frame,expression))return;await new Promise(r=>setTimeout(r,30));}throw Error(expression);}
export default {
 id:'shared-ui-async-feedback',title:'异步反馈：保留内容、空态、错误恢复与成功',kind:'user-facing',preserveTheme:true,cdpTarget:{urlIncludes:origin},
 steps:['bundled','host'].map(mode=>({name:mode+' 异步组合',async run(ctx){
  const parent=ctx.client;
  await parent.send('Page.navigate',{url:preview+'?mode='+mode});
  await ctx.waitFor("!!document.querySelector('iframe')");
  if(mode==='bundled'){const{script}=await buildPluginRuntime('bundled');await ctx.eval("document.querySelector('iframe').srcdoc="+JSON.stringify(coreDemoHtml(script)));}
  const frame=await findFrame(ctx,mode);
  try{
   await click(parent,frame,'#group-异步反馈');
   await click(parent,frame,'#feedback-fail');
   await ctx.prove(mode+' 刷新加载保留输入与上一份内容',{
    voiceover:'异步组合使用模拟请求；刷新中保留输入和上次内容，不把加载当作空列表。',
    action:()=>click(parent,frame,'#feedback-reload'),
    assert:async()=>ctx.assert(await evaluate(frame,"document.querySelector('#feedback-region').getAttribute('aria-busy')==='true'&&document.querySelector('#feedback-draft').value==='搜索草稿'&&document.querySelector('#feedback-items').textContent==='已有素材'"),'Loading retains state'),screenshot:{name:mode+'-loading'}
   });
   await wait(frame,"!!document.querySelector('#feedback-retry')");
   await ctx.prove(mode+' 失败就地重试，成功更新实际结果',{
    voiceover:'失败显示原因并保留旧内容；解除模拟失败后重试，成功才替换列表。',
    action:async()=>{ctx.assert(await evaluate(frame,"document.querySelector('#feedback-items').textContent==='已有素材'"),'Error retains old result');},
    assert:async()=>ctx.assert(await evaluate(frame,"document.body.innerText.includes('模拟请求失败，已有内容保留')"),'Visible error'),
    screenshot:{name:mode+'-error'}
   });
   await click(parent,frame,'#feedback-fail');await click(parent,frame,'#feedback-retry');
   await wait(frame,"document.querySelector('#feedback-items').textContent==='更新后的素材'");
   await ctx.prove(mode+' 空列表提供恢复动作',{
    voiceover:'成功列表可见；确认空列表时使用Empty和明确恢复动作。',
    action:async()=>{await click(parent,frame,'#feedback-empty');},
    assert:async()=>ctx.assert(await evaluate(frame,"!document.querySelector('#feedback-items')&&!!document.querySelector('#feedback-empty-reset')"),'Empty action available'),screenshot:{name:mode+'-empty'}
   });
  }finally{frame.close();}
 }})).concat([{name:'真实声音和素材入口',async run(ctx){
  await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?mine=1&voiceListDelay=1'});
  await ctx.waitFor("!!document.querySelector('[data-testid=voice-selection-trigger]')");
  await ctx.trustedClick('[data-testid=voice-selection-trigger]');await ctx.clickText('我的声音');
  await ctx.waitFor("document.querySelector('[data-testid=my-voice-picker] [data-testid=custom-voice-option]')!==null");
  await ctx.eval("window.avatarProof.setVoiceListMode('failure')");
  await ctx.prove('真实声音刷新保留可用列表',{
   voiceover:'真实声音面板遇到延迟刷新时仍显示已有声音，防止内容闪空。服务响应被隔离。',
   action:()=>ctx.trustedClick('button[aria-label=刷新我的声音]'),
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-testid=my-voice-picker]').getAttribute('aria-busy')==='true'&&document.querySelectorAll('[data-testid=custom-voice-option]').length===2"),'Existing voices stay'),screenshot:{name:'voice-loading'}
  });
  await ctx.waitFor("!!document.querySelector('[data-testid=voice-library-error]')");
  await ctx.prove('声音刷新失败保留内容且不误报空态',{
   voiceover:'读取失败在声音列表内显示重试；不把失败显示为没有声音。',
   action:async()=>{},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=custom-voice-option]').length===2&&!document.querySelector('[data-testid=voice-library-empty]')"),'Failure is not empty'),screenshot:{name:'voice-error'}
  });
  await ctx.eval("window.avatarProof.setVoiceListMode('ready')");
  await ctx.trustedClick('[data-testid=voice-library-error] button');
  await ctx.waitFor("!document.querySelector('[data-testid=voice-library-error]')&&document.querySelector('[data-testid=my-voice-picker]').getAttribute('aria-busy')==='false'");
  await ctx.prove('声音重试完成显示成功',{
   voiceover:'重试完成后解除忙碌状态，保留可选声音并显示列表已更新。',
   action:async()=>{},assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-testid=my-voice-picker]').innerText.includes('声音列表已更新')"),'Success result visible'),screenshot:{name:'voice-success'}
  });
  await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?panel=storyboard&asyncAssets=1&importFail=1'});
  await ctx.waitFor("!!document.querySelector('input[type=file]')");
  await ctx.prove('素材导入失败保留搜索和重试文件',{
   voiceover:'素材导入失败保留原有描述、搜索和文件，重试不要求重新选择。',
   action:async()=>{
    await ctx.fill('input[aria-label=搜索项目素材]','人物');
    await ctx.eval("(()=>{const d=new DataTransfer();d.items.add(new File(['proof'],'人物.png',{type:'image/png'}));const e=document.querySelector('input[type=file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await ctx.waitFor("document.querySelector('[data-slot=file-upload-item]')?.dataset.status==='error'");
    await ctx.eval("document.querySelector('[data-slot=file-upload-item]').scrollIntoView({block:'center'})");
   },
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('input[aria-label=搜索项目素材]').value==='人物'&&document.querySelector('[data-slot=file-upload-item]').innerText.includes('人物.png')"),'File and query held'),screenshot:{name:'asset-error'}
  });
  await ctx.eval("window.avatarProof.setImportFailure(false)");
  await ctx.trustedClick('[data-slot=file-upload-item] button');
  await ctx.waitFor("document.querySelector('[data-slot=file-upload-item]')?.dataset.status==='success'");
  await ctx.prove('素材导入重试成功更新列表',{
   voiceover:'成功结果进入列表并选中，搜索和已有描述不清空；不会调用真实文件服务。',
   action:async()=>{await ctx.eval("document.querySelector('[data-slot=file-upload-item]').scrollIntoView({block:'center'})");},
   assert:async()=>ctx.assert(await ctx.eval("document.querySelector('[data-slot=file-upload-item]').innerText.includes('素材已导入')&&document.querySelector('button[aria-pressed=true]').innerText==='人物.png'"),'Imported result selected'),screenshot:{name:'asset-success'}
  });
 } }])
};
