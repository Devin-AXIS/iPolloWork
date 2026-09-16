import { connect, debuggerUrlFor, evaluate, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SIDEBAR = '[data-testid="sidebar-data-annotation"]';
const FRAME = 'iframe[title="数据标注"]';
const TAB = 'button[aria-label="Select tab: 数据标注"]';

async function showSidebar(ctx) {
  await ctx.client.send('Page.bringToFront');
  if (await ctx.eval(`document.querySelector(${JSON.stringify(SIDEBAR)})?.getBoundingClientRect().x < 0`)) {
    await ctx.trustedClick('[data-sidebar="trigger"]');
  }
  await ctx.waitFor(`document.querySelector(${JSON.stringify(SIDEBAR)})?.getBoundingClientRect().x >= 0`);
}

async function assertWorkbench(ctx) {
  await ctx.waitFor(`(() => {
    const host = document.querySelector(${JSON.stringify(FRAME)});
    const frame = host?.contentDocument?.querySelector('#workbench');
    return frame && !frame.hidden && frame.getAttribute('src')?.startsWith('http://127.0.0.1:');
  })()`, { timeoutMs: 30000, label: 'embedded annotation workbench' });
  const frameUrl = await ctx.eval(`document.querySelector(${JSON.stringify(FRAME)}).contentDocument.querySelector('#workbench').src`);
  const target = (await listTargets(ctx.cdpBaseUrl)).find((entry) => entry.type === 'iframe' && entry.url === frameUrl);
  ctx.assert(Boolean(target), 'The platform must load in a child iframe target, never a browser page');
  const child = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  let view;
  try {
    view = await evaluate(child, '({text:document.body.innerText, width:innerWidth, scrollWidth:document.documentElement.scrollWidth})');
  } finally { child.close(); }
  ctx.assert(view?.text.includes('实训') && view.text.includes('标注'), 'The real annotation application must render');
  ctx.assert(view.scrollWidth <= view.width + 1, 'The embedded app must fit the panel width');
  await ctx.waitFor("!document.body.innerText.includes('Workspace or session not found')", { label: 'available selected task' });
  ctx.assert(await ctx.eval(`document.querySelectorAll(${JSON.stringify(TAB)}).length === 1`), 'Opening must reuse one annotation tab');
  const bounds = await ctx.eval(`(() => {const r=document.querySelector(${JSON.stringify(FRAME)}).getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight};})()`);
  ctx.assert(bounds.x > 200 && bounds.right <= bounds.vw + 1 && bounds.bottom <= bounds.vh + 1 && bounds.w > 200 && bounds.h > 200, 'Annotation must be visible inside the right console');
  await ctx.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', { awaitPromise: true });
}

export default {
  id: 'data-annotation-bundled',
  title: 'Bundled data annotation opens in the right console and cannot be removed',
  kind: 'user-facing',
  preserveTheme: true,
  steps: [{
    name: 'Open the bundled platform from the sidebar',
    async run(ctx) {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)');
      await ctx.prove('The sidebar opens the ready-to-use annotation platform in the right iframe', {
        voiceover: '点击左侧的数据标注，右侧直接打开标注平台，无需下载插件。',
        action: async () => { await showSidebar(ctx); await ctx.trustedClick(SIDEBAR); },
        assert: () => assertWorkbench(ctx),
        screenshot: { name: 'sidebar-annotation-iframe', requireText: ['数据标注'], rejectText: ['暂时无法打开', 'could not be displayed'] },
      });
      // Reopening is intentionally visually unchanged, so keep this assertion
      // with the original frame instead of recording a duplicate screenshot.
      await showSidebar(ctx);
      await ctx.trustedClick(SIDEBAR);
      await assertWorkbench(ctx);
      await ctx.prove('The console launcher opens the same iframe platform', {
        voiceover: '关闭工作台后，也可以从右侧控制台的加号菜单重新打开数据标注。',
        action: async () => {
          await ctx.trustedClick('button[aria-label="Close tab: 数据标注"]');
          await ctx.waitFor(`!document.querySelector(${JSON.stringify(TAB)})`, { label: 'annotation tab closed' });
          if (!await ctx.eval('Boolean(document.querySelector(\'button[aria-label="添加侧面板入口"]\'))')) {
            await ctx.trustedClick('[data-testid="right-panel-toggle"]');
          }
          await ctx.trustedClick('button[aria-label="添加侧面板入口"]');
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid^="side-panel-launcher-workspace-app:labelu-data-annotation:"]\'))');
          await ctx.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', { awaitPromise: true });
          await ctx.screenshot('console-launcher-menu', {
            claim: 'The console menu includes Data Annotation',
            voiceover: '右侧加号菜单中可以直接选择数据标注。',
            requireText: ['数据标注'],
          });
          await ctx.trustedClick('[data-testid^="side-panel-launcher-workspace-app:labelu-data-annotation:"]');
        },
        assert: () => assertWorkbench(ctx),
        screenshot: { name: 'console-annotation-iframe', requireText: ['数据标注'], rejectText: ['暂时无法打开'] },
      });
      await ctx.prove('The installed plugin has no uninstall control and remains enabled', {
        voiceover: '扩展详情显示数据标注已随应用内置，始终启用，不能卸载。',
        action: async () => {
          await showSidebar(ctx);
          await ctx.clickText('扩展', { selector: '[data-sidebar="menu-button"]' });
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="plugin-installed-row"]\'))');
          const tile = '[data-testid="plugin-installed-tile"][aria-label*="数据标注"]';
          if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(tile)}))`)) {
            await ctx.trustedClick('[data-testid="plugin-installed-expand"]');
          }
          await ctx.trustedClick(tile);
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="required-plugin-notice"]\'))');
          await ctx.eval('document.querySelector(\'[data-testid="required-plugin-notice"]\').scrollIntoView({block:"center"})');
        },
        assert: async () => {
          await ctx.expectText('v0.3.2');
          ctx.assert(await ctx.eval('document.querySelector(\'[data-testid="required-plugin-notice"]\').innerText.includes("不可卸载")'), 'A built-in notice explains the policy');
          ctx.assert(!await ctx.eval('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="卸载")'), 'There must be no uninstall control');
          ctx.assert(await ctx.eval('[...document.querySelectorAll(\'[role="switch"]\')].every(b=>b.disabled || b.getAttribute("aria-disabled")==="true")'), 'Required plugin controls cannot be disabled');
        },
        screenshot: { name: 'required-plugin-detail', requireText: ['不可卸载'], rejectText: ['Unexpected server error'] },
      });
    },
  }, {
    name: 'Import text, save annotations, and resume after reload',
    async run(ctx) {
      await showSidebar(ctx);
      await ctx.trustedClick(SIDEBAR);
      await assertWorkbench(ctx);
      const frameUrl = await ctx.eval(`document.querySelector(${JSON.stringify(FRAME)}).contentDocument.querySelector('#workbench').src`);
      const target = (await listTargets(ctx.cdpBaseUrl)).find(entry => entry.type === 'iframe' && entry.url === frameUrl);
      const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
      const child = new EvalContext({ client, outDir: ctx.outDir, flowId: ctx.flowId });
      const title = `0.3.2 文字导入验证 ${Date.now()}`;
      const content = '数字标注升级验证。\n第二段中文正文。';
      try {
        await ctx.prove('The bundled 0.3.2 workbench imports Chinese TXT into a text project', {
          voiceover: '导入中文 TXT 文件，确认正文后创建文字标注项目。',
          action: async () => {
            await child.clickText('文字标注', { selector: '.modality-option' });
            const fixture = join(ctx.outDir, 'annotation-import.txt');
            await writeFile(fixture, content);
            const { root } = await client.send('DOM.getDocument');
            const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"][accept*=".txt"]' });
            await client.send('DOM.setFileInputFiles', { nodeId, files: [fixture] });
            await child.waitForText('已导入');
            ctx.assert(await child.eval(`document.querySelector('.text-project-form textarea').value === ${JSON.stringify(content)}`), 'Imported paragraphs must match the file');
            await child.fill('.text-project-form input', title);
            await child.trustedClick('.form-actions .primary-button');
          },
          assert: async () => {
            await child.waitFor('Boolean(document.querySelector(\'textarea[aria-label="待标注正文"]\'))');
            ctx.assert(await child.eval(`document.querySelector('textarea[aria-label="待标注正文"]').value === ${JSON.stringify(content)}`), 'The created project must preserve the imported text');
          },
          screenshot: { name: 'imported-text-project', requireText: ['数据标注'] },
        });
        await ctx.prove('Text ranges and classification remain saved after reloading the workbench', {
          voiceover: '添加区间标签和文档分类，保存后重新加载，再打开项目确认结果仍在。',
          action: async () => {
            await child.eval(`document.querySelector('textarea[aria-label="待标注正文"]').setSelectionRange(0, 4)`);
            await child.trustedClick('.text-actions button');
            await child.fill('.classification-field input', '升级验证');
            await child.trustedClick('.primary-button.compact');
            await child.waitFor('document.querySelector(".primary-button.compact").disabled && !document.body.innerText.includes("未保存") && !document.body.innerText.includes("保存中")');
            await child.eval('location.reload()');
            await child.waitForText(title);
            await child.clickText(title, { selector: '.project-row' });
          },
          assert: async () => {
            await child.waitFor('Boolean(document.querySelector(".span-item"))');
            ctx.assert(await child.eval(`document.querySelector('.classification-field input').value === '升级验证'`), 'Classification must survive reload');
            ctx.assert(await child.eval(`document.querySelectorAll('.span-item').length === 1 && document.querySelector('.span-item').innerText.includes('数字标注')`), 'The saved text range must survive reload');
            ctx.assert(await child.eval(`document.querySelector('textarea[aria-label="待标注正文"]').value === ${JSON.stringify(content)}`), 'Reload must preserve both text paragraphs');
          },
          screenshot: { name: 'resumed-text-annotations', requireText: ['数据标注'] },
        });
      } finally { client.close(); }
    },
  }],
};
