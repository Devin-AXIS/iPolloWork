import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseStoryboard } from '../../vendor/hyperframes/packages/core/dist/storyboard/index.js';
import { click } from './shared-ui-core.flow.mjs';

const projectId = 'storyboard-structure-eval';
const fixture = new URL('../../vendor/hyperframes/packages/studio/data/projects/' + projectId + '/', import.meta.url);
const script = new URL('STORYBOARD.md', fixture);
const origin = 'http://127.0.0.1:5198';
const source = '# Structure save proof\n\n## Frame 1 — Opening\n- duration: 3s\n- voiceover: "Preserve this narration"\n- asset_source: "existing"\n- asset_reference: "media/original.png"\n';
const trigger = '[data-testid=storyboard-structure-1]';
let selectedRecipe;
let selectedLabel;
const press = (ctx, selector) => click(ctx.client, ctx.client, selector);
export default {
  id: 'video-picture-structure', title: '画面结构沿用配方字段：保存、重新打开和自动选择', kind: 'user-facing', preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: [{ name: '专用本地夹具的真实文件保存，不修改用户视频', async run(ctx) {
    await mkdir(fixture, { recursive: true });
    await writeFile(new URL('index.html', fixture), '<!doctype html><html><head><title>Structure proof</title></head><body><div data-composition-id="main" data-width="1280" data-height="720" data-duration="3"></div></body></html>');
    await writeFile(script, source);
    await ctx.client.send('Page.navigate', { url: origin + '/?view=storyboard&locale=zh#project/' + projectId + '?ipolloworkTheme=light' });
    await ctx.waitFor(`!!document.querySelector('${trigger}')`);
    await press(ctx, '[data-testid=script-expand-table]');
    await ctx.prove('画面结构选择的是实际组件，改变选择只进入脚本草稿', {
      voiceover: '选择一个实际画面结构，界面提示未保存，磁盘上的脚本保持不变。',
      action: async () => {
        await press(ctx, trigger);
        await ctx.waitFor("!!document.querySelector('[role=option][data-recipe-id]')");
        selectedRecipe = await ctx.eval("document.querySelector('[role=option][data-recipe-id]').dataset.recipeId");
        selectedLabel = await ctx.eval("document.querySelector('[role=option][data-recipe-id]').textContent");
        await press(ctx, '[role=option][data-recipe-id]');
      },
      assert: async () => { ctx.assert((await readFile(script, 'utf8')) === source, 'No implicit disk write'); ctx.assert(await ctx.eval("document.body.innerText.includes('未保存')"), 'Draft is dirty'); },
      screenshot: { name: 'structure-draft', requireText: ['画面结构', '未保存'] },
    });
    await ctx.prove('保存沿用 recipe 字段，配音和原素材保持不变', {
      voiceover: '保存脚本后，结构写入原有配方字段，素材和配音保持不变。',
      action: async () => { await press(ctx, '.hf-script-save'); await ctx.waitFor("!document.body.innerText.includes('未保存修改')"); },
      assert: async () => { const frame = parseStoryboard(await readFile(script, 'utf8')).frames[0]; ctx.assert(frame.extra.recipe === selectedRecipe && frame.voiceover === 'Preserve this narration' && frame.assetReference === 'media/original.png', 'Exact recipe and preserved source fields'); },
      screenshot: { name: 'structure-saved', requireText: ['画面结构', '已保存'] },
    });
    await ctx.prove('重新打开从已保存脚本恢复同一个结构', {
      voiceover: '重新打开脚本，刚才选择的画面结构仍然在。',
      action: async () => { const before = await ctx.eval('performance.timeOrigin'); await ctx.client.send('Page.reload'); await ctx.waitFor('performance.timeOrigin !== ' + before + ` && !!document.querySelector('${trigger}')`); await press(ctx, '[data-testid=script-expand-table]'); await ctx.waitFor(`document.querySelector('${trigger}').textContent.includes(${JSON.stringify(selectedLabel)})`); },
      assert: async () => ctx.assert(await ctx.eval(`document.querySelector('${trigger}').textContent.includes(${JSON.stringify(selectedLabel)})`), 'Saved recipe restored'),
      screenshot: { name: 'structure-reloaded', requireText: ['画面结构'] },
    });
    await ctx.prove('改回自动布局会清除明确配方，不更改原素材', {
      voiceover: '改回自动布局并保存，脚本取消指定配方，原素材和旁白继续保留。',
      action: async () => { await press(ctx, trigger); await ctx.waitFor("Array.from(document.querySelectorAll('[role=option]')).some(e=>e.textContent==='自动安排')"); await ctx.eval("Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent==='自动安排').dataset.proofAuto='true'"); await press(ctx, '[data-proof-auto]'); await press(ctx, '.hf-script-save'); await ctx.waitFor("!document.body.innerText.includes('未保存修改')"); },
      assert: async () => { const frame = parseStoryboard(await readFile(script, 'utf8')).frames[0]; ctx.assert(!frame.extra.recipe && frame.assetReference === 'media/original.png', 'Automatic choice persisted without altering materials'); },
      screenshot: { name: 'structure-auto', requireText: ['自动安排'] },
    });
  } }],
};
