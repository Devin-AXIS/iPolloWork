// Production plugin and local video actions; start video-workbench-fixture.ts.
const doc="document.querySelector('#studio').contentDocument";
const el=id=>`${doc}.getElementById(${JSON.stringify(id)})`;
const click=(ctx,id)=>ctx.eval(`${el(id)}.click()`);
const tool=(ctx,id)=>ctx.eval(`${doc}.querySelector('[data-tool=${id}]').click()`);
const input=async(ctx,label,value)=>ctx.eval(`(()=>{const e=${doc}.querySelector('input[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
export default {id:"video-workbench-toolbar",title:"视频工作台工具栏剪辑与保存",kind:"user-facing",preserveTheme:true,cdpTarget:{urlIncludes:"127.0.0.1:5278"},steps:[{name:"本地编辑与结果保存",async run(ctx){
  await ctx.eval("fetch('/reset',{method:'POST'}).then(r=>r.json())",{awaitPromise:true});
  await ctx.client.send('Page.reload');
  await ctx.waitFor("Boolean(window.__ipolloworkControl)");
  await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:1180,height:900,deviceScaleFactor:1,mobile:false});
  await ctx.waitFor(`${el('player')}?.videoWidth>0 && !${el('saveCopy')}?.disabled`,{timeoutMs:30000});
  const original=await ctx.eval("fetch('/witness').then(r=>r.json()).then(s=>s.source)",{awaitPromise:true});
  await ctx.prove("无需 AI 授权也能用图标工具栏编辑，旧任务区已移除",{
    voiceover:"视频工作台把常规剪辑放进图标工具栏。不绑定 AI 模型也能剪辑，下方不再显示旧任务列表。",
    action:async()=>{await tool(ctx,'rotate');ctx.assert(await ctx.eval(`${el('player')}.style.transform.includes('90deg')`),'Rotate updates preview');await tool(ctx,'undo');ctx.assert(await ctx.eval(`${el('player')}.style.transform.includes('0deg')`),'Undo restores preview');await tool(ctx,'redo');ctx.assert(await ctx.eval(`${el('player')}.style.transform.includes('90deg')`),'Redo reapplies rotation');await tool(ctx,'undo');await ctx.eval(`${doc}.querySelector('[data-tool=trim]').focus()`);ctx.assert(await ctx.eval(`!${el('tooltip')}.hidden && ${el('tooltip')}.textContent==='裁剪时长'`),'Icon focus shows the text tooltip');},
    assert:async()=>{ctx.assert(await ctx.eval(`!${doc}.querySelector('#jobs') && !${doc}.querySelector('#previewPath')`),"Old task and path area removed");ctx.assert(await ctx.eval(`${doc}.querySelector('[data-tool=rotate]').disabled===false && ${doc}.body.innerText.includes('视频工作台')`),"Local editor is available without a model");},screenshot:{name:"toolbar",requireText:["视频工作台"]},
  });
  await ctx.prove("裁剪、旋转、变速和静音直接反映在预览中",{
    voiceover:"通过工具栏保留中间四秒，裁切画面并旋转，设置两倍速和静音。预览立即显示这些修改。",
    action:async()=>{await tool(ctx,'trim');await input(ctx,'起点（秒）','1');await input(ctx,'终点（秒）','5');await tool(ctx,'crop');await input(ctx,'宽度（%）','50');await tool(ctx,'rotate');await tool(ctx,'speed');await input(ctx,'播放速度','2');await tool(ctx,'volume');await input(ctx,'音量（%）','0');await tool(ctx,'volume');},
    assert:async()=>{ctx.assert(await ctx.eval(`${el('player')}.style.transform.includes('90deg') && ${el('player')}.playbackRate===2 && ${el('player')}.muted`),"Video preview transform, speed and sound match toolbar values");ctx.assert(await ctx.eval(`${el('editHint')}.textContent.includes('2.0 秒')`),"Trim and speed yield a two-second output");},screenshot:{name:"edited-preview",requireText:["视频工作台"]},
  });
  await ctx.prove("覆盖需要确认，保存后原路径不变且结果真实转码",{
    voiceover:"覆盖前需要确认。取消不会改动原视频；确认保存后仍使用原文件路径，实际视频已经变成裁剪后的版本。",
    action:async()=>{await click(ctx,'overwrite');await click(ctx,'cancelOverwrite');ctx.assert((await ctx.eval("fetch('/witness').then(r=>r.json()).then(s=>s.source.revision)",{awaitPromise:true}))===original.revision,"Cancel preserves original bytes");await click(ctx,'overwrite');await click(ctx,'confirmSave');await ctx.waitFor("proofSaved.some(s=>s.saveMode==='overwrite')",{timeoutMs:30000});},
    assert:async()=>{const s=await ctx.eval("fetch('/witness').then(r=>r.json())",{awaitPromise:true});ctx.assert(s.source.width===360&&s.source.height===320,"Actual output dimensions reflect crop and rotation");ctx.assert(Math.abs(s.source.duration-2)<.15&&!s.source.hasAudio,"Actual output is trimmed, accelerated and silent");ctx.assert(s.artifacts.items.length===1&&s.source.revision!==original.revision,"Overwrite keeps one main artifact at the original path");ctx.assert(!s.calls.includes('submit'),"No AI submission occurred");},screenshot:{name:"overwrite-saved",requireText:["视频工作台"]},
  });
  await ctx.prove("另存为保留两版并通知宿主，窄面板仍能操作",{
    voiceover:"另存为会保留原视频和带独立名称的新版本，并通知素材宿主。缩窄面板后，工具栏和保存按钮仍能操作。",
    action:async()=>{await tool(ctx,'flip');await click(ctx,'saveCopy');await ctx.waitFor("proofSaved.some(s=>s.saveMode==='copy')",{timeoutMs:30000});await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:480,height:800,deviceScaleFactor:1,mobile:false});},
    assert:async()=>{const s=await ctx.eval("fetch('/witness').then(r=>r.json())",{awaitPromise:true});ctx.assert(s.artifacts.items.length===2,"Copy preserves both distinct artifacts");ctx.assert(s.artifacts.items.some(a=>a.path.includes('-edited-')),"Copy has a distinct filename");await ctx.waitFor(`${doc}.documentElement.scrollWidth <= ${doc}.documentElement.clientWidth`);ctx.assert(await ctx.eval(`${el('saveCopy')}.getBoundingClientRect().right<=480`),"Save remains reachable at narrow width");},screenshot:{name:"copy-narrow",requireText:["视频工作台"]},
  });
}}]};
