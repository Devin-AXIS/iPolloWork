import { buildPluginRuntime } from '../../packages/ui/build-plugin-runtime.mjs';
import { coreDemoHtml } from '../support/shared-ui-core-fixture.mjs';
import { evaluate } from '../runner/cdp.mjs';
import { key, click, findFrame } from './shared-ui-core.flow.mjs';
const origin = process.env.IPOLLOWORK_UI_PREVIEW_ORIGIN || 'http://127.0.0.1:5197';
const preview = origin + '/@fs' + new URL('../support/shared-ui-core.html', import.meta.url).pathname;
async function fill(frame, selector, value) {
  await evaluate(frame, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function wait(frame, expression) {
  for (let attempt=0;attempt<100;attempt++) {
    if (await evaluate(frame, expression)) return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('UI did not settle: '+expression);
}
export default {
  id: 'shared-ui-compositions', title: '紧凑组合：表单、输入附件与工具栏', kind: 'user-facing', preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: ['bundled', 'host'].map(mode => ({ name: mode + ' 标准组合', async run(ctx) {
    const parent = ctx.client;
    await parent.send('Emulation.setDeviceMetricsOverride', {width:1280,height:960,deviceScaleFactor:1,mobile:false});
    await parent.send('Page.navigate', {url:preview+'?mode='+mode});
    await ctx.waitFor("!!document.querySelector('iframe')");
    if (mode === 'bundled') {
      const {script} = await buildPluginRuntime('bundled');
      await ctx.eval("document.querySelector('iframe').srcdoc="+JSON.stringify(coreDemoHtml(script)));
    }
    const frame = await findFrame(ctx, mode);
    try {
      await click(parent,frame,'#group-组合模式');
      await ctx.prove(mode+' 标签聚焦、错误关联和草稿恢复', {
        voiceover:'标准表单把标签、说明和错误关联到输入；失败保留草稿，修改后清除错误。',
        action:async()=>{
          await fill(frame,'#composition-name','组合草稿');
          await click(parent,frame,'#composition-fail');
        },
        assert:async()=>{
          ctx.assert(await evaluate(frame,"document.querySelector('#composition-name').value==='组合草稿'&&document.querySelector('#composition-name').getAttribute('aria-describedby').includes('composition-name-error')&&document.querySelector('#composition-name-error').getAttribute('role')==='alert'"),'Draft and error linked');
          await evaluate(frame,"document.querySelector('label[for=composition-name]').click()");
          ctx.assert(await evaluate(frame,"document.activeElement.id==='composition-name'"),'Label focuses field');
        }, screenshot:{name:mode+'-field-error'}
      });
      await fill(frame,'#composition-name','修正后的草稿');
      ctx.assert(await evaluate(frame,"!document.querySelector('#composition-name-error')"),'Editing clears fixture error');
      await ctx.prove(mode+' 多行输入和附件点击聚焦', {
        voiceover:'多行描述保留换行，字数在输入外显示；点击附件区域也能聚焦文本框。',
        action:async()=>{
          await fill(frame,'#composition-text','第一行\n第二行说明');
          await evaluate(frame,"document.querySelector('#composition-count').click()");
        },
        assert:async()=>{
          ctx.assert(await evaluate(frame,"document.activeElement.id==='composition-text'&&document.querySelector('#composition-text').value.includes('\\n')&&document.querySelector('#composition-count').textContent.startsWith(String(document.querySelector('#composition-text').value.length))"),'Multiline draft, count and addon focus');
        }, screenshot:{name:mode+'-multiline'}
      });
      await ctx.prove(mode+' 主操作和菜单键盘退出恢复焦点', {
        voiceover:'主操作和更多菜单组合，禁用项保持不可执行，Escape返回菜单入口。',
        action:async()=>{await click(parent,frame,'#composition-save');await click(parent,frame,'#composition-more');},
        assert:async()=>{
          ctx.assert(await evaluate(frame,"document.querySelector('#receipt').textContent==='组合保存已执行'&&!!document.querySelector('[data-slot=dropdown-menu-content]')&&document.body.innerText.includes('暂不可用')"),'Action and menu mounted');
          await key(parent,'Escape');
          await wait(frame,"!document.querySelector('[data-slot=dropdown-menu-content]')&&document.activeElement.id==='composition-more'");
          ctx.assert(await evaluate(frame,"!document.querySelector('[data-slot=dropdown-menu-content]')&&document.activeElement.id==='composition-more'"),'Focus restored');
        }, screenshot:{name:mode+'-actions'}
      });
      await ctx.prove(mode+' 亮暗窄容器组合不溢出', {
        voiceover:'窄容器下保持可读和可操作，字段与工具栏不会撑宽页面。',
        action:async()=>{
          await evaluate(frame,"document.documentElement.dataset.theme='dark'");
          await parent.send('Emulation.setDeviceMetricsOverride',{width:390,height:960,deviceScaleFactor:1,mobile:false});
          await new Promise(resolve=>setTimeout(resolve,350));
        },
        assert:async()=>ctx.assert(await evaluate(frame,"document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#composition-unit').getBoundingClientRect().height===32&&document.querySelector('#composition-text-group').getBoundingClientRect().width<=innerWidth"),'Narrow controls fit'),
        screenshot:{name:mode+'-dark-narrow'}
      });
    } finally { frame.close(); await parent.send('Emulation.clearDeviceMetricsOverride'); }
  }})).concat([{name:'真实视频入口',async run(ctx){
    await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:960,height:1000,deviceScaleFactor:1,mobile:false});
    await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?panel=avatar&profiles=1&audio=1'});
    await ctx.waitForText('创建数字人');
    await ctx.clickText('创建数字人');
    await ctx.waitFor("!!document.querySelector('textarea')");
    await ctx.prove('数字人实际多行描述、字数和保存动作', {
      voiceover:'真实数字人面板使用Field和多行InputGroup；字数与说明关联，保存与生成仍为不同动作。',
      action:async()=>{await ctx.fill('textarea','面向镜头\n自然交流');},
      assert:async()=>{
        const result=await ctx.eval("(()=>{const e=document.querySelector('textarea'),g=e.closest('[data-slot=field]');return{value:e.value,label:Array.from(g.querySelectorAll('label')).some(label=>label.htmlFor===e.id),ids:e.getAttribute('aria-describedby').split(' ').every(id=>!!document.getElementById(id)),count:g.innerText.includes(e.value.length+' / 3000'),actions:!!document.querySelector('[role=group][aria-label=数字人操作]')}})()");
        ctx.assert(result.value.includes('\n')&&result.label&&result.ids&&result.count&&result.actions,JSON.stringify(result));
      },screenshot:{name:'host-avatar-composition'}
    });
    await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?mine=1&applied=single'});
    await ctx.waitFor("!!document.querySelector('[data-testid=voice-selection-trigger]')");
    await ctx.trustedClick('[data-testid=voice-selection-trigger]');
    await ctx.waitFor("!!document.querySelector('[data-testid=voice-search-toolbar] input')");
    await ctx.prove('声音库搜索与筛选组合', {
      voiceover:'声音搜索复用共享清空入口，筛选浮层保持独立，Escape恢复入口焦点。',
      action:async()=>{
        await ctx.fill('[data-testid=voice-search-toolbar] input','不存在的声音');
        ctx.assert(await ctx.eval("document.body.innerText.includes('没有符合当前筛选条件的声音')"),'Search draft held');
        await ctx.trustedClick('[data-testid=voice-search-toolbar] button[aria-label=清除搜索]');
        await ctx.trustedClick('button[aria-label=筛选音色]');
      },
      assert:async()=>{
        ctx.assert(await ctx.eval("document.querySelector('[data-testid=voice-search-toolbar] input').value===''&&document.body.innerText.includes('重置')"),'Clear and filters');
        await key(ctx.client,'Escape');
        await new Promise(resolve => setTimeout(resolve, 250));
        await ctx.waitFor("document.activeElement.getAttribute('aria-label')==='筛选音色'");
        ctx.assert(await ctx.eval("document.activeElement.getAttribute('aria-label')==='筛选音色'"),'Filter focus restored');
      },screenshot:{name:'host-voice-toolbar'}
    });
    await ctx.client.send('Page.navigate',{url:origin+'/tests/video-avatar-proof.html?panel=storyboard'});
    await ctx.waitFor("!!document.querySelector('#shot-source')");
    await ctx.prove('分镜保存失败保留原有草稿与错误', {
      voiceover:'分镜弹窗保留既有业务校验，保存失败保持草稿与持续错误；模拟回调不写入真实脚本。',
      action:async()=>{await ctx.clickText('应用到脚本');},
      assert:async()=>{
        ctx.assert(await ctx.eval("!!document.querySelector('[data-slot=field-error]')&&document.querySelector('textarea').value==='保留这个描述'"),'Draft held after failure');
      },screenshot:{name:'host-storyboard-error'}
    });
    await ctx.client.send('Page.navigate',{url:origin+'/tests/shared-ui-controls-proof.html'});
    await ctx.waitFor("!!document.querySelector('#plugin-library-proof input')");
    await ctx.prove('设置插件库真实搜索与筛选窄窗口', {
      voiceover:'设置插件库移除独立34px覆盖，搜索与筛选保持共享尺寸，在窄窗口下换行。',
      action:async()=>{
        await ctx.fill('#plugin-library-proof input','中文插件');
        await ctx.clickText('公开');
        await ctx.waitFor("!!document.querySelector('[data-testid=plugin-category-filter]')");
        await ctx.trustedClick('[data-testid=plugin-status-filter]');
        await ctx.waitFor("!!document.querySelector('[role=option]')");
        await ctx.eval("Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent.trim()==='已安装').dataset.compositionChoice='installed'");
        await ctx.trustedClick('[data-composition-choice=installed]');
        await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
      },
      assert:async()=>{
        const result=await ctx.eval("(()=>{const e=document.querySelector('#plugin-library-proof input'),f=document.querySelector('[data-testid=plugin-category-filter]');return{height:e.getBoundingClientRect().height,filter:f.getBoundingClientRect().height,width:document.documentElement.scrollWidth,viewport:innerWidth,receipt:document.querySelector('#plugin-library-filter-receipt').textContent}})()");
        ctx.assert(result.height===32&&result.filter===32&&result.width<=result.viewport&&result.receipt.includes('中文插件')&&JSON.parse(result.receipt).status==='installed',JSON.stringify(result));
      },screenshot:{name:'host-settings-toolbar'}
    });
    await ctx.client.send('Emulation.clearDeviceMetricsOverride');
  }}])
};
