import { click, key } from './shared-ui-core.flow.mjs';
const origin = process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN || 'http://127.0.0.1:5197';
const preview = origin + '/tests/shared-ui-controls-proof.html?lists';
async function press(ctx, selector) { await click(ctx.client, ctx.client, selector); await new Promise(resolve => setTimeout(resolve, 250)); }
async function check(ctx, selector) { await ctx.eval('document.querySelector(' + JSON.stringify(selector) + ').focus()'); await key(ctx.client, ' '); }
async function fill(ctx, selector, value) { await ctx.eval("(()=>{const e=document.querySelector(" + JSON.stringify(selector) + ");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e," + JSON.stringify(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));})()"); }
async function choice(ctx, selector, label) {
  await press(ctx, selector); await ctx.waitFor("Array.from(document.querySelectorAll('[role=option]')).some(e=>e.getBoundingClientRect().width>0)");
  await ctx.eval("document.querySelectorAll('[data-proof-choice]').forEach(e=>e.removeAttribute('data-proof-choice'));Array.from(document.querySelectorAll('[role=option]')).find(e=>e.getBoundingClientRect().width>0&&e.textContent===" + JSON.stringify(label) + ").dataset.proofChoice='target'");
  const point = await ctx.eval("(()=>{const e=document.querySelector('[data-proof-choice=target]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await ctx.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await ctx.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 250));
  await ctx.waitFor("document.querySelector(" + JSON.stringify(selector) + ").textContent.includes(" + JSON.stringify(label) + ")");
}
const rows = "document.querySelectorAll('[data-row-id]').length";
const settle = "!document.querySelector('[data-slot=table][aria-busy=true]')";
export default {
  id: 'client-table-lists', title: '真实客户端列表：工作中心和环境变量', kind: 'user-facing', preserveTheme: true, cdpTarget: { urlIncludes: origin },
  steps: [{ name: '真实业务组件与隔离 HTTP 响应', async run(ctx) {
    await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send('Page.navigate', { url: preview });
    await ctx.waitFor("!!document.querySelector('[data-testid=work-center]')");
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='列表').id='open-list'");
    await press(ctx, '#open-list'); await ctx.waitFor(rows + "===10");
    await ctx.prove('工作中心新增列表，保留其他视图与只读自动任务', {
      voiceover: '真实 WorkCenter 接到共享表格，批量修改使用真实客户端的版本化接口。测试服务响应隔离，不修改日常任务。',
      action: async () => {},
      assert: async () => ctx.assert(await ctx.eval("document.body.innerText.includes('看板')&&document.body.innerText.includes('日程')&&document.body.innerText.includes('仅对已加载')&&" + rows + "===10"), 'Real list mounted'),
      screenshot: { name: 'work-list' },
    });
    await ctx.prove('任务名称完整排序，组合筛选清空跨页选择', {
      voiceover: '排序覆盖已加载记录，不限当前页；跨页选择保留，改变筛选会回到第一页并清除选择。',
      action: async () => {
        await press(ctx, 'button[aria-label="按名称排序"]');
        ctx.assert(await ctx.eval("document.querySelector('[data-row-id]')?.textContent.includes('任务 01')"), 'Ascending whole list');
        await press(ctx, 'button[aria-label="按名称排序"]'); await press(ctx, 'button[aria-label="按名称排序"]');
        await check(ctx, 'thead [role=checkbox]'); await press(ctx, 'button[aria-label="下一页"]'); await check(ctx, '[data-row-id] [role=checkbox]');
        ctx.assert(await ctx.eval("document.querySelector('[data-slot=table-bulk-actions]').textContent.includes('11 项')"), 'Cross-page selection');
        await fill(ctx, 'input[type=search]', '任务 0');
        await choice(ctx, 'button[aria-label="状态"]', '已完成');
      },
      assert: async () => ctx.assert(await ctx.eval("!document.querySelector('[data-slot=table-bulk-actions]')&&Array.from(document.querySelectorAll('[data-row-id]')).every(e=>e.textContent.includes('任务 0')&&e.textContent.includes('已完成'))"), 'Combined filters clear selection'),
      screenshot: { name: 'work-filter' },
    });
    await fill(ctx, 'input[type=search]', '没有这个任务');
    ctx.assert(await ctx.eval("document.body.innerText.includes('没有匹配结果')"), 'No match');
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='清除筛选').id='reset-list'");
    await press(ctx, '#reset-list'); await ctx.waitFor(rows + "===10");
    await check(ctx, 'thead [role=checkbox]'); await press(ctx, 'button[aria-label="下一页"]'); await check(ctx, '[data-row-id] [role=checkbox]');
    await choice(ctx, 'button[aria-label="目标状态"]', '待验收');
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='批量修改状态').id='bulk-status'");
    await press(ctx, '#bulk-status');
    await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-content]')");
    await ctx.prove('任务批量确认明确范围，取消无写入', {
      voiceover: '确认展示十一项及目标状态，取消不触发更新接口。',
      action: async () => {},
      assert: async () => ctx.assert(await ctx.eval("document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('11 项')&&window.listProof.writes.length===0"), 'No writes before confirm'),
      screenshot: { name: 'work-confirm' },
    });
    await press(ctx, '[data-slot=alert-dialog-cancel]'); await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
    ctx.assert(await ctx.eval("window.listProof.writes.length===0"), 'Cancel no writes');
    await press(ctx, '#bulk-status'); await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-action]')");
    await press(ctx, '[data-slot=alert-dialog-action]');
    await ctx.waitFor("document.body.innerText.includes('成功 10 项，失败 1 项')"); await ctx.waitFor(settle);
    await ctx.prove('任务部分失败保留一项，重试不重复成功项', {
      voiceover: '模拟一项版本冲突。十项成功，只保留失败项；重试只发送一个版本化更新。',
      action: async () => {
        await ctx.eval('window.listProof.setFailures(false,false,false)');
        await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='重试失败项').id='retry-work'");
        await press(ctx, '#retry-work'); await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-action]')"); await press(ctx, '[data-slot=alert-dialog-action]');
        await ctx.waitFor("document.body.innerText.includes('成功 1 项，失败 0 项')");
      },
      assert: async () => ctx.assert(await ctx.eval("window.listProof.writes.filter(w=>w.path.includes('/work-items/')).length===12&&window.listProof.writes.filter(w=>w.path.endsWith('/task-0')).length===2&&window.listProof.writes.every(w=>typeof w.body.expectedVersion==='number'&&w.body.status==='review')"), 'Only failed task retried with version'),
      screenshot: { name: 'work-retry' },
    });
    await press(ctx, 'button[aria-label="下一页"]');
    ctx.assert(await ctx.eval("Array.from(document.querySelectorAll('[data-row-id]')).some(e=>e.textContent.includes('自动任务')&&e.querySelector('[role=checkbox]').getAttribute('aria-disabled')==='true')"), 'Automated task excluded');
    await choice(ctx, 'button[aria-label="每页条数"]', '20');
    await ctx.waitFor(rows + "===20");
    ctx.assert(await ctx.eval(rows + "===20&&document.querySelector('[data-slot=table-pagination]').textContent.includes('第 1 / 2 页')"), 'Real work page size resets');
    await ctx.prove('任务刷新失败保留内容，暗色窄屏可继续浏览', {
      voiceover: '刷新失败保留二十条已确认内容。窄屏表格独立滚动，不撑宽页面。',
      action: async () => {
        await ctx.eval('window.listProof.setFailures(false,false,true)');
        await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='刷新列表').id='refresh-work'");
        await press(ctx, '#refresh-work'); await ctx.waitFor("document.body.innerText.includes('工作内容加载失败')");
        await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false });
        await ctx.eval("document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark')");
        await new Promise(resolve => setTimeout(resolve, 300));
      },
      assert: async () => ctx.assert(await ctx.eval(rows + "===20&&document.documentElement.scrollWidth<=390"), 'Task content preserved and page contained'),
      screenshot: { name: 'work-dark-refresh-error' },
    });
    await ctx.eval('window.listProof.setFailures(false,false,false)');
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='重试').id='retry-work-read'");
    await press(ctx, '#retry-work-read'); await ctx.waitFor("!document.body.innerText.includes('工作内容加载失败')");
    await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ctx.eval("document.documentElement.dataset.theme='light';document.documentElement.classList.remove('dark')");
    await new Promise(resolve => setTimeout(resolve, 300));
    await press(ctx, '#proof-env'); await ctx.waitFor(rows + "===10");
    await ctx.prove('环境变量按名称搜索排序，值始终隐藏', {
      voiceover: '真实 EnvironmentView 保留遮罩值与应用变更流程。搜索只匹配名称，不请求密钥内容。',
      action: async () => { await press(ctx, 'button[aria-label="按名称排序"]'); await fill(ctx, 'input[type=search]', 'PROOF_0'); },
      assert: async () => ctx.assert(await ctx.eval(rows + "===9&&document.body.innerText.includes('••••••••')&&!document.body.innerText.includes('isolated-test-value')"), 'Secrets stay hidden'),
      screenshot: { name: 'env-filter' },
    });
    await fill(ctx, 'input[type=search]', ''); await press(ctx, 'button[aria-label="按名称排序"]'); await press(ctx, 'button[aria-label="按名称排序"]');
    await check(ctx, 'thead [role=checkbox]'); await press(ctx, 'button[aria-label="下一页"]'); await check(ctx, '[data-row-id] [role=checkbox]');
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='批量删除').id='bulk-env'");
    await press(ctx, '#bulk-env'); await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-content]')");
    await ctx.prove('环境变量跨页删除明确名称及生效边界', {
      voiceover: '确认列出十一项名称，强调不可撤销及应用更改。取消不会删除。',
      action: async () => {},
      assert: async () => ctx.assert(await ctx.eval("document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('11 个')&&document.querySelector('[data-slot=alert-dialog-description]').textContent.includes('PROOF_23')"), 'Names and count shown'),
      screenshot: { name: 'env-confirm' },
    });
    await press(ctx, '[data-slot=alert-dialog-cancel]'); await ctx.waitFor("!document.querySelector('[data-slot=alert-dialog-content]')");
    ctx.assert(await ctx.eval("window.listProof.writes.filter(w=>w.path.startsWith('/env/')).length===0"), 'Cancel no deletes');
    await ctx.eval('window.listProof.setFailures(false,true,false)');
    await press(ctx, '#bulk-env'); await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-action]')"); await press(ctx, '[data-slot=alert-dialog-action]');
    await ctx.waitFor("document.body.innerText.includes('成功 10 项，失败 1 项')");
    await ctx.prove('删除部分失败后只重试失败项，保留应用更改提醒', {
      voiceover: '成功项移除，失败项继续选中；只重试失败的一项，原有应用更改提醒仍在。',
      action: async () => {
        await ctx.eval('window.listProof.setFailures(false,false,false)');
        await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='重试失败项').id='retry-env'");
        await press(ctx, '#retry-env'); await ctx.waitFor("!!document.querySelector('[data-slot=alert-dialog-action]')"); await press(ctx, '[data-slot=alert-dialog-action]');
        await ctx.waitFor("document.body.innerText.includes('成功 1 项，失败 0 项')");
      },
      assert: async () => ctx.assert(await ctx.eval("window.listProof.writes.filter(w=>w.path.startsWith('/env/')).length===12&&document.body.innerText.includes('尚未生效')&&document.querySelector('[data-slot=table-pagination]').textContent.includes('共 12 项')"), 'Failed delete only; apply pending preserved'),
      screenshot: { name: 'env-retry' },
    });
    await ctx.prove('读取失败保留已确认内容，刷新后恢复', {
      voiceover: '模拟刷新失败不会清空数据，原位置重试恢复。',
      action: async () => { await ctx.eval('window.listProof.setFailures(false,false,true)'); await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='刷新列表').id='refresh-env'"); await press(ctx, '#refresh-env'); await ctx.waitFor("document.body.innerText.includes('模拟读取失败')"); },
      assert: async () => ctx.assert(await ctx.eval(rows + ">0&&document.querySelector('[data-slot=table-pagination]').textContent.includes('共 12 项')"), 'Last content preserved'),
      screenshot: { name: 'env-refresh-error' },
    });
    await ctx.eval('window.listProof.setFailures(false,false,false)');
    await ctx.eval("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='重试').id='retry-read'");
    await press(ctx, '#retry-read'); await ctx.waitFor("!document.body.innerText.includes('模拟读取失败')");
    await ctx.prove('暗色窄屏保持紧凑，页面不横向溢出', {
      voiceover: '十三像素表格及紧凑控件，窄屏工具栏换行，表格在自己的区域滚动。',
      action: async () => { await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false }); await ctx.eval("document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark')"); await new Promise(resolve => setTimeout(resolve, 300)); },
      assert: async () => ctx.assert(await ctx.eval("getComputedStyle(document.querySelector('table')).fontSize==='13px'&&document.documentElement.scrollWidth<=390"), 'Compact dark narrow layout'),
      screenshot: { name: 'env-dark-narrow' },
    });
  } }],
};
