// Real Electron shell regression plus the existing no-charge image fixture.
// The fixture keeps production UI/service/filesystem code; only AI output is fake.
const studio = `document.querySelector('iframe[title="图片工作台"]')?.contentDocument`;
const imageName = 'kuafu-purple-energy-source-model-edit.png';

async function clickInStudio(ctx, selector) {
  await ctx.waitFor(`${studio}?.querySelector(${JSON.stringify(selector)})?.disabled === false`);
  await ctx.eval(`${studio}.querySelector(${JSON.stringify(selector)}).click()`);
}

async function selectRegion(ctx) {
  await clickInStudio(ctx, 'button[data-tool="rectangle"]');
  const area = await ctx.waitFor(`(() => {
    const frame = document.querySelector('iframe[title="图片工作台"]');
    const rect = frame?.contentDocument?.querySelector('#selectionCanvas')?.getBoundingClientRect();
    if (!rect || rect.width < 100) return null;
    const outer = frame.getBoundingClientRect();
    return {x:outer.left+rect.left,y:outer.top+rect.top,width:rect.width,height:rect.height};
  })()`);
  const start = {x:area.x+area.width*.35,y:area.y+area.height*.35};
  const end = {x:area.x+area.width*.62,y:area.y+area.height*.62};
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseMoved',...start});
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseMoved',...end,button:'left',buttons:1});
  await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseReleased',...end,button:'left',clickCount:1});
  await ctx.waitFor(`Boolean(document.querySelector('[data-image-selection-chip]'))`);
}

async function witness(ctx) {
  return ctx.eval(`fetch('http://127.0.0.1:5190/witness').then(r=>r.json())`, {awaitPromise:true});
}

async function editFixture(ctx, prompt) {
  await ctx.waitFor(`${studio}?.querySelector('#imageCanvas')?.width === 800`);
  if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) await clickInStudio(ctx, '#parameters');
  if (!await ctx.eval(`document.querySelector('[aria-label="图片模型"]')?.textContent.includes('GPT Image 2 · API')`)) {
    await ctx.trustedClick('[aria-label="图片模型"]');
    await ctx.clickText('GPT Image 2 · API', {selector:'[role="option"]'});
  }
  await ctx.fill('textarea[name="prompt"]', prompt);
  await selectRegion(ctx);
  await ctx.clickText('生成编辑结果', {selector:'button'});
  await ctx.waitFor(`${studio}?.querySelector('#saveReview')?.hidden === false`);
}

async function showOutputs(ctx, count) {
  if (await ctx.hasText('显示主要产出')) await ctx.clickText('显示主要产出');
  await ctx.waitForText(`${count} 个主要产出`);
}

export default {
  id:'image-studio-recovery',
  title:'合并后图片工作台恢复、选区与保存回归',
  kind:'user-facing',
  preserveTheme:true,
  requiredEnv:['IPOLLOWORK_EVAL_IMAGE_SESSION_URL'],
  steps:[{
    name:'恢复真实应用并验证图片打开和选区',
    async run(ctx) {
      const url=ctx.env.IPOLLOWORK_EVAL_IMAGE_SESSION_URL;
      await ctx.prove('刷新后的完整应用能从对话卡片打开原图', {
        voiceover:'重新加载完整应用后，对话正常显示，点击图片卡片就能在右侧打开原图。',
        action:async()=>{
          await ctx.client.send('Page.navigate',{url});
          await ctx.waitFor('Boolean(window.__ipolloworkControl)',{timeoutMs:60000});
          const card=`Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).find(card=>Array.from(card.querySelectorAll('[title]')).some(node=>node.title===${JSON.stringify(imageName)}))`;
          await ctx.waitFor(`Boolean(${card})`);
          await ctx.eval(`${card}.click()`);
          await ctx.waitFor(`${studio}?.querySelector('#sourceMeta')?.textContent.includes(${JSON.stringify(imageName)})`);
        },
        assert:async()=>{
          ctx.assert(await ctx.eval(`${studio}.querySelector('#imageCanvas').width === 1536`),'Actual image decoded at original width');
          ctx.assert(await ctx.eval(`document.querySelector('iframe[title="图片工作台"]').srcdoc.includes('version: "0.1.13"')`),'Installed workbench is version 0.1.13');
          await ctx.expectNoText('暂时无法响应');
        },
        screenshot:{name:'real-app-open-image',requireText:['图片工作台','这里改成紫色的能量源'],rejectText:['暂时无法响应']},
      });
      await ctx.prove('右侧真实选区出现在左侧对话附件中',{
        voiceover:'在原图上框选一个区域，左侧对话框立即显示图片选区附件，测试不会发送消息或修改原图。',
        action:()=>selectRegion(ctx),
        assert:async()=>ctx.assert(await ctx.eval(`Boolean(document.querySelector('[data-image-selection-chip]'))`),'Chat displays the active selection'),
        screenshot:{name:'real-app-selection',requireText:['图片工作台','图片选区'],rejectText:['暂时无法响应']},
      });
      await clickInStudio(ctx,'#clearSelection');
      await ctx.waitFor(`!document.querySelector('[data-image-selection-chip]')`);
    },
  },{
    name:'独立测试图验证覆盖与另存为（模型响应模拟）',
    async run(ctx){
      const url=ctx.env.IPOLLOWORK_EVAL_IMAGE_SESSION_URL;
      try {
        await ctx.client.send('Page.navigate',{url:'http://127.0.0.1:5190/'});
        await ctx.waitForText('图片选区修改 · 界面验证',{timeoutMs:60000});
        ctx.assert((await witness(ctx)).files.length===1,'Start with a fresh isolated fixture');
        await ctx.prove('确认覆盖后原文件更新且主要产出仅剩一项',{
          voiceover:'在独立测试图片上编辑选区，预览保留原图。确认覆盖后，主要产出只显示更新后的原文件。',
          action:async()=>{
            await editFixture(ctx,'将选中区域改成蓝色，自然衔接背景');
            const preview=await witness(ctx);
            ctx.assert(preview.saved.originalPreserved && preview.files.length===2,'Preview retains the original and edited copy');
            await clickInStudio(ctx,'#overwriteEdit');
            ctx.assert(await ctx.eval(`${studio}.querySelector('#overwriteEdit').textContent === '确认覆盖'`),'Overwrite requires a second explicit confirmation');
            ctx.assert(!(await witness(ctx)).actions.some(a=>a.action==='save-edit'),'First click has no save side effect');
            await clickInStudio(ctx,'#overwriteEdit');
            await ctx.waitFor(`${studio}?.querySelector('#saveReview')?.hidden === true`);
            await showOutputs(ctx,1);
          },
          assert:async()=>{
            const value=await witness(ctx);
            ctx.assert(value.files.length===1 && value.files[0]==='source.png' && value.artifacts.length===1,'Disk and main artifacts retain exactly the original path');
            ctx.assert(!value.saved.originalPreserved && value.saved.changedPixels>0 && value.saved.changedPixels<value.saved.totalPixels,'Selected pixels changed without replacing the whole image');
            ctx.assert(value.requests.length===1 && value.actions.some(a=>a.action==='save-edit' && a.mode==='overwrite'),'Overwrite does not buy another image');
            ctx.output('Overwrite filesystem witness',JSON.stringify({...value,requests:value.requests.map(r=>({nativeMask:r.nativeMask}))}));
          },
          screenshot:{name:'fixture-overwrite',requireText:['1 个主要产出','source.png'],rejectText:['暂时无法响应']},
        });
        await ctx.clickText('显示对话');
        await ctx.prove('另存为保留原图和名称不同的编辑版',{
          voiceover:'再次编辑并选择另存为，主要产出显示两张图片，编辑版带有独立名称。',
          action:async()=>{
            await editFixture(ctx,'将另一片选中区域改成蓝色，自然衔接背景');
            await clickInStudio(ctx,'#saveCopy');
            await ctx.waitFor(`${studio}?.querySelector('#saveReview')?.hidden === true`);
            await showOutputs(ctx,2);
          },
          assert:async()=>{
            const value=await witness(ctx);
            ctx.assert(value.files.length===2 && value.artifacts.length===2 && new Set(value.files).size===2,'Two distinct files and registered outputs');
            ctx.assert(value.files.some(path=>path.includes('-edited-')),'Edited name is distinguishable');
            ctx.assert(value.requests.length===2 && value.actions.some(a=>a.action==='save-edit' && a.mode==='copy'),'Save as does not buy another image');
            ctx.output('Save-as filesystem witness',JSON.stringify({...value,requests:value.requests.map(r=>({nativeMask:r.nativeMask}))}));
          },
          screenshot:{name:'fixture-save-as',requireText:['2 个主要产出','source.png'],rejectText:['暂时无法响应']},
        });
      } finally {
        await ctx.client.send('Page.navigate',{url});
        await ctx.waitFor('Boolean(window.__ipolloworkControl)',{timeoutMs:60000});
      }
    },
  }],
};
