import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("enterprise-shared-controls");
const manage = '[data-testid="enterprise-resource-management"][data-open]';
const access = '[data-testid="enterprise-resource-access"][data-open]';
const review = '[data-testid="enterprise-resource-review"][data-open]';
const exporting = '[data-testid="skill-export-dialog"][data-open]';
const key = async (ctx, name) => {
  for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: ({ Escape: 27, Tab: 9, ArrowRight: 39, ArrowLeft: 37, Enter: 13 })[name], ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) });
};
const close = async (ctx, selector) => {
  await ctx.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAnimations({ subtree: true }).every(animation => animation.playState !== "running")`, { label: "dialog entrance settled before closing" });
  await ctx.trustedClick(`${selector} [data-slot="dialog-close"]`);
  await ctx.waitFor(`!document.querySelector(${JSON.stringify(selector.replaceAll("[data-open]", ""))})`);
};
const clickMenuItem = async (ctx, text) => {
  await ctx.waitFor(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].some(item=>item.textContent.trim()===${JSON.stringify(text)})`, {label:`menu renders ${text}`});
  const id = await ctx.eval(`([...document.querySelectorAll('[role=menu] [role=menuitem]')].find(item=>item.textContent.trim()===${JSON.stringify(text)})?.id)`);
  ctx.assert(Boolean(id),`menu contains ${text}`);
  await ctx.eval(`document.getElementById(${JSON.stringify(id)}).focus()`);
  await key(ctx, "Enter");
};
const reset = async (ctx) => {
  await ctx.client.send("Page.bringToFront");
  if(await ctx.eval("new URLSearchParams(location.search).has('account-cache')")) {
    const origin=await ctx.eval("location.origin");
    await ctx.client.send("Page.navigate",{url:`${origin}/tests/enterprise-collaboration-proof.html?shared-ui#/session`});
  } else await ctx.client.send("Page.reload");
  await ctx.waitForText("企业协作功能验证");
  await ctx.trustedClick('[data-testid="proof-owner"]');
  await ctx.waitFor("document.querySelector('[data-testid=enterprise-template-manage]')?.textContent.includes('模板管理')");
  await ctx.waitFor('Boolean(document.querySelector("[data-testid=enterprise-skill-manage]"))');
};
const stableClick = async (ctx, selector) => {
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await ctx.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",{awaitPromise:true});
  await ctx.trustedClick(selector);
};
const open = async (ctx, type) => {
  await ctx.eval(`document.querySelector('[data-testid="enterprise-${type}-manage"]').scrollIntoView({block:"center"})`);
  await ctx.eval("document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))", {awaitPromise:true});
  await ctx.trustedClick(`[data-testid="enterprise-${type}-manage"]`);
  await ctx.waitFor(`Boolean(document.querySelector('${manage} input[type="search"]')) && !document.querySelector('${manage} [aria-label="刷新企业资源"]').disabled`);
  await ctx.waitFor(`document.querySelector('${manage}').getAnimations({ subtree: true }).every(animation => animation.playState !== "running")`, { label: "management dialog entrance settled" });
};
const chooseFile = async (ctx, path) => {
  const { root } = await ctx.client.send("DOM.getDocument");
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: `${manage} input[type="file"]` });
  ctx.assert(Boolean(nodeId), "shared upload owns a native file input");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [path] });
};

const assertFlat = async (ctx, selector) => {
  const styles = await ctx.eval(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})].map(button => ({ name: button.textContent.trim() || button.getAttribute('aria-label'), shadow: getComputedStyle(button).boxShadow, before: getComputedStyle(button, '::before').boxShadow, height: button.offsetHeight, font: getComputedStyle(button).fontSize })))()`);
  const transparent = (shadow) => shadow === "none" || (shadow.includes("rgba(") && [...shadow.matchAll(/rgba?\(([^)]+)\)/g)].every((match) => Number(match[1].split(",")[3]) === 0));
  ctx.assert(styles.length > 0 && styles.every(style => transparent(style.shadow) && transparent(style.before)), JSON.stringify(styles));
};

export default {
  id: "enterprise-shared-controls",
  title: "企业插件、技能、模板管理共享 UI（Electron，隔离接口）",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html?shared-ui" },
  steps: [
    { name: "三个入口与亮暗主题", async run(ctx) {
      await reset(ctx);
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        for (const [type, label] of [["extension", "插件"], ["skill", "技能"], ["template", "模板"]]) {
          await ctx.prove(`${theme}：${label}管理复用共享按钮、弹窗、上传与搜索`, {
            voiceover: vo[0],
            action: async () => { await open(ctx, type); },
            assert: async () => {
              await ctx.expectText(`企业${label}管理`);
              const data = await ctx.eval(`(() => { const d = document.querySelector('${manage}'); const input = d.querySelector('[data-slot="search-field"] input'); return { upload: !!d.querySelector('[data-slot="file-upload"]'), label: input.labels.length, field: !!input.closest('[data-slot="field"]'), close: d.querySelectorAll('[data-slot="dialog-close"]').length, theme: document.documentElement.dataset.theme, width: d.offsetWidth, overflow: d.scrollWidth > d.clientWidth + 1 }; })()`);
              ctx.assert(data.upload && data.label === 1 && data.field && data.close === 1 && data.width <= 640 && !data.overflow && data.theme === theme, JSON.stringify(data));
              await assertFlat(ctx, `${manage} button`);
              ctx.assert(await ctx.eval(`(() => { const tabs = [...document.querySelectorAll('${manage} [role="tab"]')]; return tabs.length === 2 && tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').length === 1 && tabs.every(tab => getComputedStyle(tab).fontSize === '13px' && tab.offsetHeight === 24 && (tab.getAttribute('aria-selected') !== 'true' || document.getElementById(tab.getAttribute('aria-controls')))); })()`), "shared tabs expose selection and associated panels with stable 24px/13px type");
            }, screenshot: { name: `${type}-${theme}`, requireText: [`企业${label}管理`, "搜索企业资源"] },
          });
          await close(ctx, manage);
          await ctx.waitFor(`document.activeElement?.dataset.testid === 'enterprise-${type}-manage'`, { label: "close returns focus to management entry" });
        }
      }
    } },
    { name: "按钮悬停按下与页签键盘", async run(ctx) {
      await reset(ctx); await open(ctx, "template");
      await ctx.prove("分配权限悬停和按下无投影，页签键盘切换保留尺寸与选中态", {
        voiceover: vo[3], action: async () => {
          const selector = `${manage} article:first-child button:first-of-type`;
          const point = await ctx.eval(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
          await assertFlat(ctx, selector);
          await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
          await assertFlat(ctx, selector);
          await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
          await ctx.waitFor(`Boolean(document.querySelector('${access}'))`);
          await ctx.waitFor(`Boolean(document.querySelector('${access} input[type="search"]')) && !document.querySelector('${access} [role="status"]')`);
          await ctx.eval("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))", {awaitPromise:true});
          await ctx.waitFor(`document.querySelector('${access}').getAnimations({ subtree: true }).every(animation => animation.playState !== "running")`);
          await ctx.trustedClick(`${access} > button:first-of-type`); await ctx.waitFor(`Boolean(document.querySelector('${manage}'))`);
          const metrics = () => ctx.eval(`[...document.querySelectorAll('${manage} [role="tab"]')].map(tab => [tab.offsetWidth,tab.offsetHeight,getComputedStyle(tab).fontSize,getComputedStyle(tab).lineHeight])`);
          const before = await metrics();
          await ctx.trustedClick(`${manage} [role="tab"]:first-child`);
          await key(ctx, "ArrowRight");
          await key(ctx, "Enter");
          await ctx.waitFor(`document.querySelector('${manage} [role="tab"]:last-child').getAttribute('aria-selected') === 'true'`);
          ctx.assert(JSON.stringify(before) === JSON.stringify(await metrics()), "tabs keep dimensions and typography on selection");
          await ctx.waitForText("还没有投稿，选择自己的模板包提交审核。");
        }, assert: async () => {
          ctx.assert(await ctx.eval(`document.activeElement.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true' && getComputedStyle(document.activeElement).getPropertyValue('--tw-ring-shadow') !== ''`), "keyboard focus and selected state are retained");
        }, screenshot: { name: "tabs-keyboard-selection", requireText: ["企业模板管理", "我的投稿", "还没有投稿"] },
      });
      await close(ctx, manage);
    } },
    { name: "投稿空态保持紧凑宽度", async run(ctx) {
      await reset(ctx); await open(ctx, "template");
      const width = await ctx.eval(`document.querySelector('${manage}').offsetWidth`);
      await ctx.prove("全部资源和我的投稿保持同一紧凑宽度，空态不拉宽弹窗", {
        voiceover: vo[2], action: async () => {
          await ctx.trustedClick(`${manage} [aria-label="资源视图"] button:last-child`);
          await ctx.waitForText("还没有投稿，选择自己的模板包提交审核。");
        }, assert: async () => {
          const size = await ctx.eval(`(() => { const d = document.querySelector('${manage}'); return { width: d.offsetWidth, overflow: d.scrollWidth > d.clientWidth + 1 }; })()`);
          ctx.assert(size.width === width && size.width <= 640 && !size.overflow, JSON.stringify(size));
        }, screenshot: { name: "submissions-compact", requireText: ["企业模板管理", "我的投稿", "还没有投稿"] },
      });
      await close(ctx, manage);
    } },
    { name: "搜索空态与清除", async run(ctx) {
      await reset(ctx); await open(ctx, "template");
      await ctx.prove("资源搜索无匹配时显示共享空态，并支持清除搜索恢复列表", {
        voiceover: vo[2], action: async () => { await ctx.fill(`${manage} input[type="search"]`, "无匹配资源"); await ctx.waitForText("没有匹配的模板"); },
        assert: async () => { ctx.assert(await ctx.eval(`Boolean(document.querySelector('${manage} [data-slot="empty"]'))`), "shared Empty is visible"); },
        screenshot: { name: "resource-empty", requireText: ["没有匹配的模板", "清除搜索"] },
      });
      await ctx.trustedClick(`${manage} [aria-label="清除资源搜索"]`);
      await ctx.waitForText("产品提案模板");
      ctx.assert(await ctx.eval(`document.activeElement === document.querySelector('${manage} input[type="search"]')`), "search clear returns focus to input");
      await close(ctx, manage);
    } },
    { name: "审核说明与失败保留", async run(ctx) {
      await reset(ctx); await ctx.trustedClick('[data-testid="proof-fail-resource-write"]'); await open(ctx, "template");
      await ctx.trustedClick(`${manage} article:nth-child(2) button:last-child`);
      await ctx.waitFor(`Boolean(document.querySelector('${review} textarea'))`);
      await ctx.prove("审核失败在当前弹窗提示，说明保留后可以重试", {
        voiceover: vo[1], action: async () => {
          await ctx.fill(`${review} textarea`, "请补充模板的使用说明");
          await ctx.trustedClick(`${review} [data-slot="dialog-footer"] button:nth-child(2)`);
          await ctx.waitFor(`Boolean(document.querySelector('${review} [data-slot="alert"]'))`);
        }, assert: async () => {
          ctx.assert(await ctx.eval(`(() => { const n = document.querySelector('${review} textarea'); return n.value === '请补充模板的使用说明' && n.labels.length === 1 && !!n.closest('[data-slot="field"]'); })()`), "review shared Field labels and draft survive failure");
        }, screenshot: { name: "review-failure", requireText: ["审核模板投稿", "审核说明", "企业服务请求失败"] },
      });
      await ctx.trustedClick(`${review} [data-slot="dialog-footer"] button:nth-child(2)`);
      await ctx.waitFor(`!document.querySelector('${review}')`);
      await ctx.waitForText("投稿已退回。");
      await close(ctx, manage);
    } },
    { name: "上传校验与失败重试", async run(ctx) {
      await reset(ctx); await ctx.trustedClick('[data-testid="proof-fail-resource-write"]'); await open(ctx, "skill");
      const directory = await mkdtemp(join(tmpdir(), "ipollowork-enterprise-ui-"));
      try {
        const oversized = join(directory, "oversized.md"), file = join(directory, "shared-controls.md");
        await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1, 65)); await writeFile(file, "# 隔离技能文件\n");
        await chooseFile(ctx, oversized); await ctx.waitForText("技能 MD 文件大小不能超过 1 MB。");
        ctx.assert(!await ctx.eval(`Boolean(document.querySelector('${manage} [data-slot="file-upload-item"]'))`), "oversized MD never becomes selected");
        await chooseFile(ctx, file); await ctx.waitForText("shared-controls.md");
        await ctx.prove("共享上传校验 MD 大小，提交失败保留同一个文件", {
          voiceover: vo[2], action: async () => {
            await ctx.trustedClick(`${manage} div.flex.justify-end > button`);
            await ctx.waitFor(`Boolean(document.querySelector('${manage} [data-slot="alert"][role="alert"]'))`);
          }, assert: async () => {
            ctx.assert(await ctx.eval(`document.querySelector('${manage} [data-slot="file-upload-item"]').textContent.includes('shared-controls.md') && !document.querySelector('${manage} [role="progressbar"]')`), "failed upload retains file without fake progress");
            ctx.assert(await ctx.eval(`Boolean(document.querySelector('${manage} [data-slot="alert"] > svg.lucide-circle-alert[aria-hidden="true"]'))`),"failed operation has the shared leading error icon");
          }, screenshot: { name: "upload-failure", requireText: ["shared-controls.md", "企业服务请求失败"] },
        });
        await ctx.trustedClick(`${manage} div.flex.justify-end > button`);
        await ctx.waitForText("投稿已提交，可在我的投稿中查看审核状态。");
        ctx.assert(await ctx.eval(`Boolean(document.querySelector('${manage} [data-slot="alert"][role="status"]')) && !document.querySelector('${manage} [data-slot="file-upload-item"]')`), "successful retry shows shared status and clears file");
        await ctx.prove("企业成功反馈显示前置状态图标，错误反馈也使用对应图标",{
          voiceover:vo[10],action:async()=>{},assert:async()=>{ctx.assert(await ctx.eval(`Boolean(document.querySelector('${manage} [data-slot="alert"][role="status"] > svg.lucide-circle-check[aria-hidden="true"]'))`),"success uses a decorative leading Lucide check icon");},screenshot:{name:"enterprise-success-icon",requireText:["投稿已提交，可在我的投稿中查看审核状态。"]},
        });
        await close(ctx, manage);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } },
    { name: "单弹窗权限、范围切换与返回", async run(ctx) {
      await reset(ctx); await ctx.trustedClick('[data-testid="proof-fail-resource-write"]'); await open(ctx, "template");
      await ctx.trustedClick(`${manage} article:first-child button:first-of-type`);
      await ctx.waitFor(`Boolean(document.querySelector('${access} input[type="search"]'))`);
      await ctx.prove("分配权限和切换三个访问范围始终只有同一个弹窗", {
        voiceover: vo[3], action: async () => {
          await ctx.eval(`(() => { window.__permissionPopup = document.querySelector('${access}'); return true; })()`);
          for (const scope of ["all", "admins", "restricted"]) {
            await ctx.trustedClick(`${access} [role="radio"][aria-labelledby$="-${scope}-label"]`);
            ctx.assert(await ctx.eval(`document.querySelectorAll('[data-slot="dialog-content"][data-open]').length === 1 && document.querySelector('${access}') === window.__permissionPopup`), "scope selection never opens another dialog");
          }
        }, assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${access}').offsetWidth <= 640 && document.querySelectorAll('[data-slot="dialog-overlay"]').length === 1 && !document.querySelector('${manage}')`), "permission replaces list in the same compact shell");
          ctx.assert(await ctx.eval(`Boolean(document.querySelector('${access} > button:first-of-type svg.lucide-arrow-left[aria-hidden="true"]'))`), "back action includes a decorative Lucide left arrow before its text");
        }, screenshot: { name: "single-permission-shell", requireText: ["分配资源权限", "返回资源列表"], rejectText: ["企业模板管理"] },
      });

      await ctx.prove("共享权限单选支持方向键切换并保持唯一选中", {
        voiceover: vo[9], action: async () => {
          await ctx.trustedClick(`${access} [role="radio"][aria-labelledby$="-restricted-label"]`);
          await key(ctx, "ArrowRight");
          await ctx.waitFor(`document.querySelector('${access} [role="radio"][aria-labelledby$="-all-label"]').getAttribute('aria-checked') === 'true'`);
          ctx.assert(await ctx.eval(`!document.querySelector('${access} input[type="search"]')`), "all-members scope hides the restricted people picker");
          await key(ctx, "ArrowRight");
          await ctx.waitFor(`document.querySelector('${access} [role="radio"][aria-labelledby$="-admins-label"]').getAttribute('aria-checked') === 'true'`);
          await key(ctx, "ArrowLeft"); await key(ctx, "ArrowLeft");
          await ctx.waitFor(`Boolean(document.querySelector('${access} input[type="search"]'))`);
        }, assert: async () => {
          ctx.assert(await ctx.eval(`(() => { const group=document.querySelector('${access} [role="radiogroup"]'); const radios=[...group.querySelectorAll('[role="radio"]')]; return group.getAttribute('aria-label')==='访问范围' && radios.length===3 && radios.filter(radio=>radio.getAttribute('aria-checked')==='true').length===1 && radios.every(radio=>Boolean(document.getElementById(radio.getAttribute('aria-labelledby')))); })()`), "shared radios have visible labels and one selected value");
        }, screenshot: { name: "permission-radio-keyboard", requireText: ["指定人员和部门", "全体成员", "仅管理员", "搜索企业人员"] },
      });
      await ctx.fill(`${access} input[type="search"]`, "王磊"); await ctx.waitForText("wanglei@example.com");
      await ctx.trustedClick(`${access} [role="checkbox"][aria-label="选择 王磊"]`);
      await ctx.trustedClick(`${access} [data-slot="dialog-footer"] button:last-child`);
      await ctx.waitFor(`Boolean(document.querySelector('${access} [data-slot="alert"]'))`);
      await ctx.prove("窄屏深色权限弹窗保留失败前人员选择", {
        voiceover: vo[3], action: async () => {
          await ctx.eval("document.documentElement.dataset.theme = 'dark'");
          await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 560, height: 900, deviceScaleFactor: 1, mobile: false });
          await ctx.waitFor(`document.querySelector('${access}').getBoundingClientRect().width <= 560`);
        }, assert: async () => {
          ctx.assert(await ctx.eval(`(() => { const d = document.querySelector('${access}'); const input = d.querySelector('input[type="search"]'); return d.querySelector('[role="checkbox"][aria-label="选择 王磊"]').getAttribute('aria-checked') === 'true' && input.value === '王磊' && input.labels.length === 1 && d.scrollWidth <= d.clientWidth + 1; })()`), "selected person, shared labeled search and narrow layout survive failure");
        }, screenshot: { name: "permission-dark-narrow", requireText: ["分配资源权限", "王磊", "企业服务请求失败"] },
      });
      await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      await ctx.prove("Escape 在同一个弹窗内返回资源列表并恢复操作焦点", {
        voiceover: vo[3], action: async () => { await key(ctx, "Escape"); },
        assert: async () => {
          await ctx.waitFor(`!document.querySelector('${access}') && Boolean(document.querySelector('${manage}')) && document.activeElement?.textContent.includes('分配权限')`, { label: "same dialog returns to list and restores focus" });
        }, screenshot: { name: "single-dialog-back", requireText: ["企业模板管理", "产品提案模板"], rejectText: ["分配资源权限"] },
      });
      await close(ctx, manage);
    } },
    { name: "个人企业页签与卡片一致", async run(ctx) {
      await reset(ctx);
      const catalog = '[data-testid="proof-enterprise-plugins"]';
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-testid="plugin-package-list-item"]'))`);
        const measure = () => ctx.eval(`(() => { const card = document.querySelector('${catalog} [data-testid="plugin-package-list-item"]'); const style=getComputedStyle(card); return [card.className,style.padding,style.borderRadius,style.minHeight,style.boxShadow,getComputedStyle(card.querySelector('[data-testid="plugin-package-card-copy"]')).fontSize]; })()`);
        await stableClick(ctx,`${catalog} [role="tab"]:last-child`);
        await ctx.waitForText("产品调研助手");
        const enterprise = await measure();
        await stableClick(ctx,`${catalog} [role="tab"]:first-child`);
        await ctx.waitForText("Context7");
        ctx.assert(JSON.stringify(await measure()) === JSON.stringify(enterprise), "personal and enterprise use identical shared card presentation");
        await ctx.prove(`${theme}：左侧个人企业页签与共享插件卡片布局`, {
          voiceover: vo[4], action: async () => {
            await stableClick(ctx,`${catalog} [role="tab"]:last-child`);
            await ctx.waitForText("产品调研助手");
          }, assert: async () => {
            ctx.assert(await ctx.eval(`(() => { const root = document.querySelector('${catalog}'); const tabs=root.querySelector('[role="tablist"]'); const section=root.querySelector('section'); const buttons=[...root.querySelectorAll('[role="tab"]')]; return !root.innerText.includes('资源来源') && Math.abs(tabs.getBoundingClientRect().left-section.getBoundingClientRect().left)<2 && buttons.filter(b=>b.getAttribute('aria-selected')==='true').length===1 && buttons.every(b=>b.getAttribute('aria-selected')!=='true'||document.getElementById(b.getAttribute('aria-controls'))) && !root.querySelector('article.shadow-sm'); })()`), "left aligned real tabs have panels and no visible source label or parallel card");
          }, screenshot: { name: `catalog-reuse-${theme}`, requireText: ["产品调研助手", "个人", "星河科技"] },
        });
      }
    } },
    { name: "插件技能来源页签位置和配色", async run(ctx) {
      await reset(ctx);
      for (const theme of ["light", "dark"]) {
        await ctx.prove(`${theme}：插件技能共享来源页签配色与标题下方布局`, {
          voiceover: vo[5], action: async () => {
            await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
            await ctx.trustedClick('[data-testid="skills-catalog"] [role="tab"]:first-child');
            await ctx.trustedClick('[data-testid="proof-enterprise-plugins"] [role="tab"]:first-child');
            await ctx.waitFor(`[...document.querySelectorAll('[data-testid="skills-catalog"] [role="tablist"], [data-testid="proof-enterprise-plugins"] [role="tablist"]')].every(list => list.getAnimations({ subtree: true }).every(animation => animation.playState !== "running"))`, { label: "source selection colors settled" });
          }, assert: async () => {
            ctx.assert(await ctx.eval(`(() => {
              const skills = document.querySelector('[data-testid="skills-catalog"]');
              const plugins = document.querySelector('[data-testid="proof-enterprise-plugins"]');
              const measure = root => {
                const title = root.querySelector('h1,h2'), list = root.querySelector('[role="tablist"]');
                const selected = list.querySelector('[aria-selected="true"]');
                const unselected = list.querySelector('[aria-selected="false"]');
                const style = getComputedStyle(list), active = getComputedStyle(selected), inactive = getComputedStyle(unselected);
                return { title: title.getBoundingClientRect(), list: list.getBoundingClientRect(), colors: [style.backgroundColor, active.backgroundColor, active.color, inactive.backgroundColor, inactive.color], panel: Boolean(document.getElementById(selected.getAttribute('aria-controls'))) };
              };
              const s = measure(skills), p = measure(plugins);
              const search = skills.querySelector('[data-slot="search-field"]').getBoundingClientRect();
              const names = [...skills.querySelectorAll('[role="tab"] span'), ...plugins.querySelectorAll('[role="tab"] span')];
              return names.every(name => name.scrollWidth <= name.clientWidth) && s.panel && p.panel && JSON.stringify(s.colors) === JSON.stringify(p.colors) && s.list.top >= s.title.bottom && p.list.top >= p.title.bottom && search.top >= s.list.bottom && Math.abs(search.left-s.title.left)<2 && [s,p].every(m=>Math.abs(m.title.left-m.list.left)<2);
            })()`), "source Tabs use the same active/inactive theme colors, sit under aligned titles, and skill search follows tabs");
            await ctx.trustedClick('[data-testid="skills-catalog"] [role="tab"]:last-child');
            await ctx.waitFor(`document.querySelector('[data-testid="skills-catalog"] [role="tab"]:last-child').getAttribute('aria-selected') === 'true'`);
            await ctx.trustedClick('[data-testid="skills-catalog"] [role="tab"]:first-child');
          }, screenshot: { name: `source-tabs-${theme}`, requireText: ["技能", "个人", "星河科技"] },
        });
      }
    } },
    { name: "技能来源卡片统一", async run(ctx) {
      await reset(ctx);
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        let reference;
        for (const [index, source] of ["personal", "public", "enterprise"].entries()) {
          await ctx.prove(`${theme}：${source} 技能透明描边卡片和明确字号层级`, {
            voiceover: source==='personal'?vo[13]:vo[11], action: async () => {
              await ctx.trustedClick(`[data-testid="skills-catalog"] [role="tab"]:nth-child(${index + 1})`);
              await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skill-card"][data-source="${source}"]'))`);
              await ctx.waitFor("document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')");
            }, assert: async () => {
              const style = await ctx.eval(`(()=>{const node=document.querySelector('[data-testid="skill-card"][data-source="${source}"]');const s=getComputedStyle(node);return {border:s.borderTopWidth,fill:s.backgroundColor,padding:s.padding,radius:s.borderRadius,title:!!node.querySelector('h3'),actions:node.querySelectorAll('button').length};})()`);
              ctx.assert(style.border==='0px'&&style.fill==='rgba(0, 0, 0, 0)'&&style.title&&style.actions>0,JSON.stringify(style));
              ctx.assert(await ctx.eval(`(()=>{const search=document.querySelector('[data-testid="skills-catalog"] [data-slot="search-field"]');return [search,search.querySelector('input')].every(node=>getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)');})()`),'skill search has a transparent background');
              if(source==='personal')ctx.assert(await ctx.eval(`(()=>{const card=[...document.querySelectorAll('[data-testid="skill-card"]')].find(card=>card.textContent.includes('context7-docs-research'));const img=card?.querySelector('img');return img?.complete&&img.naturalWidth>0;})()`),'plugin skill uses the installed plugin brand logo');
              const layout=JSON.stringify([style.fill,style.padding,style.radius]);
              if(reference) ctx.assert(layout===reference,'all skill sources share fill, padding and radius');
              reference=layout;
            }, screenshot: {name:`skill-card-${source}-${theme}`,requireText:["技能"]},
          });
        }
      }
    } },
    { name: "企业消息分享和连接入口按钮", async run(ctx) {
      await reset(ctx);
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        await ctx.prove(`${theme}：企业消息、分享和连接弹窗沿用无投影按钮`, {
          voiceover: vo[0], action: async () => {
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="proof-enterprise-plugins"] [data-testid="plugin-package-list-item"] button'))`);
            await assertFlat(ctx, '[data-testid="proof-plugin-source"] button, [data-testid="enterprise-inbox"] button, [data-testid="skills-catalog"] button, [data-testid="proof-enterprise-plugins"] button');
            await ctx.trustedClick('[data-testid="enterprise-inbox"] > button');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="enterprise-message-preview"][data-open]'))`);
            await assertFlat(ctx, '[data-testid="enterprise-message-preview"][data-open] button');
            await close(ctx, '[data-testid="enterprise-message-preview"][data-open]');
            await ctx.trustedClick('[data-testid="proof-share"]');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="enterprise-session-share"][data-open]'))`);
            await assertFlat(ctx, '[data-testid="enterprise-session-share"][data-open] button');
            await close(ctx, '[data-testid="enterprise-session-share"][data-open]');
            await ctx.trustedClick('[data-testid="proof-enterprise-connect"]');
            await ctx.waitFor(`Boolean(document.querySelector('[data-slot="dialog-content"][data-open]'))`);
          }, assert: async () => { await ctx.waitFor("document.querySelector('[data-slot=dialog-content][data-open]').getAnimations({subtree:true}).every(animation=>animation.playState!=='running')"); await assertFlat(ctx, '[data-slot="dialog-content"][data-open] button'); },
          screenshot: { name: `enterprise-connect-${theme}`, requireText: ["企业"] },
        });
        await close(ctx, '[data-slot="dialog-content"][data-open]');
      }
    } },
    { name: "加入企业精简表单", async run(ctx) {
      await reset(ctx);
      for(const theme of ['light','dark']) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await ctx.prove(`${theme}：加入企业两项必填，帮助按需展开`,{
          voiceover:vo[12],action:async()=>{await ctx.trustedClick('[data-testid="proof-enterprise-connect"]');await ctx.waitFor("Boolean(document.querySelector('[data-testid=enterprise-connect-dialog][data-open]'))");},
          assert:async()=>{
            await ctx.waitFor("document.querySelector('[data-testid=enterprise-connect-dialog]').getAnimations({subtree:true}).every(animation=>animation.playState!=='running')");
            ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('[data-testid=enterprise-connect-dialog]');const inputs=[...d.querySelectorAll('input')];return inputs.length===2&&inputs.every(input=>input.labels.length===1)&&d.getBoundingClientRect().width<=448;})()`),'compact labeled form has exactly two fields');
          },screenshot:{name:`enterprise-join-compact-${theme}`,requireText:['企业']},
        });
        await ctx.trustedClick('[data-testid="enterprise-connect-help"]');
        ctx.assert(await ctx.eval("document.querySelector('[data-testid=enterprise-connect-help]').getAttribute('aria-expanded')==='true'"),'supplementary account and isolation help expands');
        await close(ctx,'[data-testid="enterprise-connect-dialog"][data-open]');
        await ctx.waitFor("document.activeElement?.dataset.testid==='proof-enterprise-connect'");
      }
    } },
    { name: "模板我的投稿入口位置和尺寸", async run(ctx) {
      await reset(ctx);
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        await ctx.prove(`${theme}：我的投稿仅在我的模板中显示，三个动作尺寸一致`, {
          voiceover: vo[6], action: async () => {
            await ctx.trustedClick('[data-testid="proof-template-source"]');
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="模板操作"]'))`);
            ctx.assert(await ctx.eval("!document.querySelector('[aria-label=模板操作] [data-testid=enterprise-template-manage]')&&!document.querySelector('[data-testid=enterprise-template-submissions]')"),'enterprise catalog has no global management or submissions entry');
            await ctx.trustedClick('[role="tablist"][aria-label="模板"] [role="tab"]:first-child');
            await ctx.waitFor(`[...document.querySelectorAll('[data-slot="dialog-content"][data-open]')].every(dialog => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== "running"))`);
          }, assert: async () => {
            const buttons = await ctx.eval(`(() => [...document.querySelectorAll('[aria-label="模板操作"] button')].map(button => { const r=button.getBoundingClientRect(), style=getComputedStyle(button); return { name:button.textContent.trim(),x:r.x,y:r.y,height:r.height,font:style.fontSize,line:style.lineHeight,icon:!!button.querySelector('svg') }; }))()`);
            ctx.assert(buttons.length === 3 && buttons[0].name === '我的投稿' && buttons[1].name === '自定义模板' && buttons[2].name === '导入' && buttons.every(button => button.y === buttons[0].y && button.height === buttons[0].height && button.font === buttons[0].font && button.line === buttons[0].line && button.icon) && buttons[0].x < buttons[1].x && buttons[1].x < buttons[2].x, JSON.stringify(buttons));
          }, screenshot: { name: `template-top-actions-${theme}`, requireText: ["我的投稿", "自定义模板", "导入", "内置"] },
        });
        await ctx.trustedClick('[aria-label="模板操作"] [data-testid="enterprise-template-submissions"]');
        await ctx.waitFor(`Boolean(document.querySelector('${manage}'))`);
        await close(ctx, manage);
        await ctx.waitFor(`document.activeElement?.dataset.testid === 'enterprise-template-submissions'`);
        await close(ctx, '[data-slot="dialog-content"][data-open]');
        await ctx.waitFor(`document.activeElement?.dataset.testid === 'proof-template-source'`);
      }
    } },
    { name: "模板共享页签键盘与内容关联", async run(ctx) {
      await reset(ctx);
      const dialog = '[data-slot="dialog-content"][data-open]';
      const views = `${dialog} [role="tablist"][aria-label="模板"]`;
      for (const theme of ["light", "dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme = '${theme}'`);
        await ctx.prove(`${theme}：模板视图、来源及我的模板页签支持键盘并关联真实内容`, {
          voiceover: vo[7], action: async () => {
            await ctx.trustedClick('[data-testid="proof-template-source"]');
            await ctx.waitFor(`Boolean(document.querySelector('${views}'))`);
            await ctx.waitFor(`document.querySelector('${dialog}').getAnimations({subtree:true}).every(animation=>animation.playState!=='running')`);
            await ctx.trustedClick(`${views} [role="tab"]:first-child`);
            await key(ctx, "ArrowRight"); await key(ctx, "Enter");
            await ctx.waitFor(`document.querySelector('${views} [role="tab"]:nth-child(2)').getAttribute('aria-selected')==='true'`);
            for (const index of [3,4]) {
              await ctx.trustedClick(`${views} [role="tab"]:nth-child(${index})`);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=remote-template-card]'))");
              ctx.assert(await ctx.eval(`(()=>{const card=document.querySelector('[data-testid=remote-template-card]');const style=getComputedStyle(card);return card.dataset.variant==='resource'&&card.dataset.surface==='outline'&&style.borderTopWidth==='1px'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&card.querySelector('[data-slot=card-icon]')&&getComputedStyle(card.querySelector('h3')).fontSize==='14px'&&getComputedStyle(card.querySelector('[data-slot=card-footer] button')).borderTopWidth==='1px';})()`),'remote templates use shared outlined resource cards');
            }
          }, assert: async () => {
            ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}');const lists=d.querySelectorAll('[role=tablist]');const selected=lists[0].querySelector('[aria-selected=true]');const panel=document.getElementById(selected.getAttribute('aria-controls'));return lists.length===1&&lists[0].querySelectorAll('[role=tab]').length===4&&panel?.querySelector('[data-testid=remote-template-card]')&&[...lists[0].querySelectorAll('[role=tab]')].filter(tab=>tab.tabIndex===0).length===1;})()`),'one catalog tablist owns the active remote template panel');
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:560,height:900,deviceScaleFactor:1,mobile:false});
            await ctx.waitFor(`document.querySelector('${dialog}').getBoundingClientRect().width <= 560`);
            ctx.assert(await ctx.eval(`document.querySelector('${dialog}').scrollWidth <= document.querySelector('${dialog}').clientWidth+1`), "template toolbar fits the narrow dialog");
          }, screenshot: {name:`template-tabs-keyboard-${theme}`,requireText:["我的","内置","Cloud"]},
        });
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
        await close(ctx,dialog);
      }
    } },
    { name: "企业反馈与分享表单", async run(ctx) {
      await reset(ctx);
      const catalog='[data-testid="proof-enterprise-plugins"]', inbox='[data-testid="enterprise-inbox"]', share='[data-testid="enterprise-session-share"][data-open]';
      for (const theme of ["light","dark"]) {
        await ctx.eval(`document.documentElement.dataset.theme='${theme}'`);
        await ctx.prove(`${theme}：企业目录和消息沿用共享错误、空态及恢复动作`, {
          voiceover:vo[8],action:async()=>{
            await stableClick(ctx,`${catalog} [role="tab"]:last-child`);
            await ctx.trustedClick('[data-testid="proof-catalog-error"]');
            await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-slot="alert"]')) && Boolean(document.querySelector('${inbox} [data-slot="alert"]'))`);
            await ctx.trustedClick(`${catalog} [data-slot="alert"] button`);
            await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-slot="alert"]'))`);
          },assert:async()=>{
            const styles=await ctx.eval(`['${catalog}','${inbox}'].map(selector=>{const a=document.querySelector(selector+' [data-slot="alert"]');const s=getComputedStyle(a);return {role:a.getAttribute('role'),border:s.borderTopWidth,shadow:s.boxShadow,icon:Boolean(a.querySelector(':scope > svg.lucide-circle-alert[aria-hidden="true"]'))};})`);
            ctx.assert(styles.every(style=>style.icon&&style.role==='alert'&&style.border==='0px'&&(style.shadow==='none'||[...style.shadow.matchAll(/rgba?\(([^)]+)\)/g)].every(match=>Number(match[1].split(',')[3])===0))),JSON.stringify(styles));
          },screenshot:{name:`enterprise-feedback-error-${theme}`,requireText:["企业服务请求失败"]},
        });
        await ctx.trustedClick('[data-testid="proof-catalog-empty"]');
        await ctx.trustedClick('[data-testid="proof-personal-mode"]');
        await ctx.waitFor(`Boolean(document.querySelector('[data-testid="proof-personal"]'))`);
        await ctx.trustedClick('[data-testid="proof-owner"]');
        await stableClick(ctx,`${catalog} [role="tab"]:last-child`);
        await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-slot="empty"]')) && Boolean(document.querySelector('${inbox} [data-slot="empty"]'))`);
        await ctx.prove(`${theme}：企业空态不会伪装错误，恢复后目录重新显示`,{
          voiceover:vo[8],action:async()=>{},assert:async()=>{ctx.assert(await ctx.eval(`!document.querySelector('${catalog} [data-slot="alert"]') && !document.querySelector('${inbox} [data-slot="alert"]')`),"successful empty responses render shared Empty rather than alerts");},screenshot:{name:`enterprise-feedback-empty-${theme}`,requireText:["暂无企业消息"]},
        });
        await ctx.trustedClick('[data-testid="proof-catalog-ready"]');
        await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-testid="plugin-package-list-item"]'))`);
        await ctx.trustedClick('[data-testid="proof-catalog-read-error"]');
        await ctx.prove(`${theme}：企业插件刷新失败保留已有卡片，原位重试恢复`, {
          voiceover:vo[8],action:async()=>{
            await ctx.trustedClick(`${catalog} button[aria-label="刷新"]`);
            await ctx.waitFor(`Boolean(document.querySelector('${catalog} [role="tabpanel"][aria-busy="true"]'))`);
            ctx.assert(await ctx.eval(`Boolean(document.querySelector('${catalog} [data-testid="plugin-package-list-item"]')) && !document.querySelector('${catalog} [data-slot="skeleton"]')`),"refresh keeps confirmed cards instead of replacing them with initial skeletons");
            await ctx.waitFor(`Boolean(document.querySelector('${catalog} [data-slot="alert"]'))`);
          },assert:async()=>{ctx.assert(await ctx.eval(`Boolean(document.querySelector('${catalog} [data-testid="plugin-package-list-item"]')) && document.querySelector('${catalog} [data-slot="alert"] button').textContent==='重试'`),"error feedback and existing cards remain together");},screenshot:{name:`enterprise-refresh-preserved-${theme}`,requireText:["产品调研助手","重试","无法从当前企业服务器加载资源"]},
        });
        await ctx.trustedClick('[data-testid="proof-catalog-read-ready"]');
        await ctx.trustedClick(`${catalog} [data-slot="alert"] button`);
        await ctx.waitFor(`!document.querySelector('${catalog} [data-slot="alert"]') && Boolean(document.querySelector('${catalog} [data-testid="plugin-package-list-item"]')) && !document.querySelector('${catalog} [aria-busy="true"]')`);
      }
      await ctx.trustedClick('[data-testid="proof-fail-summary"]');
      await ctx.trustedClick('[data-testid="proof-fail-send"]');
      await ctx.trustedClick('[data-testid="proof-share"]');
      await ctx.waitFor(`Boolean(document.querySelector('${share} [role="checkbox"][aria-label="选择部门 星河科技"]'))`);
      await ctx.trustedClick(`${share} [role="checkbox"][aria-label="选择部门 星河科技"]`);
      await ctx.waitForText("已选 3 人");
      await ctx.trustedClick(`${share} [data-slot="dialog-footer"] button:last-child`);
      await ctx.waitFor(`Boolean(document.querySelector('${share} [data-slot="alert"]'))`);
      await ctx.trustedClick(`${share} [data-slot="alert"] + *`);
      await ctx.waitFor(`Boolean(document.querySelector('${share} input[id$="-title"]'))`);
      await ctx.fill(`${share} input[id$="-title"]`,"保留的分享标题");
      await ctx.fill(`${share} textarea`,"保留的 Markdown 总结");
      await ctx.prove("分享发送失败使用共享提示并保留共享表单输入和已选人员",{
        voiceover:vo[8],action:async()=>{await ctx.trustedClick(`${share} [data-slot="dialog-footer"] button:last-child`);await ctx.waitFor(`Boolean(document.querySelector('${share} [data-slot="alert"]'))`);},
        assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${share}'),title=d.querySelector('input[id$="-title"]'),body=d.querySelector('textarea');return title.value==='保留的分享标题'&&body.value==='保留的 Markdown 总结'&&[title,body].every(input=>input.labels.length===1&&input.closest('[data-slot="field"]'))&&d.innerText.includes('已选 3 人');})()`),"labeled shared fields and recipients survive failed send");},screenshot:{name:"share-fields-failure",requireText:["分享标题","Markdown 总结","企业服务请求失败","已选 3 人"]},
      });
      await close(ctx,share);
    } },
    { name: "技能导出表单错误保留与键盘", async run(ctx) {
      await reset(ctx); await ctx.trustedClick('[data-testid="proof-fail-resource-write"]');
      await ctx.trustedClick('[data-testid="skills-catalog"] [data-testid="skill-card"] [data-slot="card-footer"] button');
      await clickMenuItem(ctx,'导出 / 投稿');
      await ctx.waitFor(`Boolean(document.querySelector('${exporting}'))`);
      const inputIds = await ctx.eval(`[...document.querySelectorAll('${exporting} input')].map(input => input.id)`);
      await ctx.fill(`input[id="${inputIds[0]}"]`, "产品调研技能共享版");
      await ctx.fill(`input[id="${inputIds[1]}"]`, "2.0.0");
      await ctx.prove("技能导出失败在当前弹窗可见，名称和版本保留以便重试", {
        voiceover: vo[3], action: async () => {
          await ctx.trustedClick(`${exporting} [data-slot="dialog-footer"] button:first-child`);
          await ctx.waitFor(`Boolean(document.querySelector('${exporting} [data-slot="alert"]'))`);
        }, assert: async () => {
          ctx.assert(await ctx.eval(`(() => { const inputs = [...document.querySelectorAll('${exporting} input')]; return inputs[0].value === '产品调研技能共享版' && inputs[1].value === '2.0.0' && inputs.every(input => input.labels.length === 1 && input.closest('[data-slot="field"]')); })()`), "export shared fields retain valid values after failure");
          await key(ctx, "Tab");
          ctx.assert(await ctx.eval(`document.querySelector('${exporting}').contains(document.activeElement)`), "keyboard focus stays inside the dialog");
        }, screenshot: { name: "export-error-draft", requireText: ["导出独立技能 / 企业投稿", "技能名称", "版本号"] },
      });
      await key(ctx, "Escape"); await ctx.waitFor(`!document.querySelector('${exporting}')`);
      await ctx.waitFor(`document.activeElement?.getAttribute('aria-label')==='产品调研技能的操作'`, { label: "Escape restores export action focus" });
    } },
    {name:"卡片操作菜单和资源管理权限",async run(ctx){
      await reset(ctx);
      for(const role of ['owner','template_admin','extension_admin','skill_admin','member']) {
        await ctx.trustedClick('[data-testid="proof-owner"]');
        if(role!=='owner')await ctx.trustedClick(`[data-testid="proof-${role}"]`);
        for(const type of ['extension','skill']) {
          const root=type==='extension'?'[data-testid="proof-enterprise-plugins"]':'[data-testid="skills-catalog"]';
          const card=type==='extension'?'[data-testid="plugin-package-list-item"]':'[data-testid="skill-card"][data-source="enterprise"]';
          await stableClick(ctx,`${root} [role="tab"]:last-child`);
          await ctx.waitFor(`Boolean(document.querySelector('${root} ${card}'))`);
          const allowed=role==='owner'||role===`${type}_admin`;
          ctx.assert(await ctx.eval(`!document.querySelector('${root} [data-testid=enterprise-${type}-manage]')&&!document.querySelector('${root} [data-testid=enterprise-${type}-submissions]')`),'enterprise catalog contains no global management or submissions button');
          await ctx.prove(`${role}：${type}菜单只提供允许的操作`,{
            voiceover:vo[14],action:async()=>{await stableClick(ctx,`${root} ${card} [data-slot="card-footer"] button`);await ctx.waitFor("Boolean(document.querySelector('[role=menu]'))");},
            assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const footer=document.querySelector('${root} ${card} [data-slot=card-footer]');const menu=document.querySelector('[role=menu]');const labels=[...menu.querySelectorAll('[role=menuitem]')].map(item=>item.textContent.trim());return footer.querySelectorAll('button').length===1&&footer.querySelector('svg.lucide-ellipsis')&&!menu.querySelector('button button')&&labels.includes('分配权限')===${allowed}&&labels.includes('下架')===${allowed};})()`),'one ellipsis trigger owns actions; management items are limited to the assigned resource type');},
            screenshot:{name:`card-menu-${role}-${type}`,requireText:allowed?['分配权限','下架']:['下载'].filter(()=>type==='skill')},
          });
          if(role==='owner') {
            await clickMenuItem(ctx,'分配权限');
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=enterprise-card-access] [role=radiogroup]'))");
            ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=enterprise-card-access] [role=radio]').length===3"),'card access uses the existing permission scope form');
            await ctx.trustedClick('[data-testid="enterprise-card-access"] [data-slot="dialog-close"]');
            await ctx.waitFor("!document.querySelector('[data-testid=enterprise-card-access]')");
            await stableClick(ctx,`${root} ${card} [data-slot="card-footer"] button`);
            await clickMenuItem(ctx,'下架');
            await ctx.waitFor("Boolean(document.querySelector('[role=alertdialog]'))");
            ctx.assert(await ctx.eval("document.querySelector('[role=alertdialog]').textContent.includes('下架企业资源')"),'archive requires confirmation');
            await ctx.trustedClick('[role="alertdialog"] [data-slot="alert-dialog-cancel"]');
            await ctx.waitFor("!document.querySelector('[role=alertdialog]')");
          } else await key(ctx,'Escape');
          await stableClick(ctx,`${root} [role="tab"]:first-child`);
          await ctx.waitFor(`Boolean(document.querySelector('${root} [data-testid=enterprise-${type}-submissions]'))`);
          await ctx.trustedClick(`${root} [data-testid=enterprise-${type}-submissions]`);
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=enterprise-resource-management] input[type=file]'))");
          ctx.assert(await ctx.eval("!document.querySelector('[data-testid=enterprise-resource-management]').textContent.includes('全部企业')"),'personal submission entry never exposes management catalog');
          await close(ctx,manage);
        }
      }
      await ctx.prove('卡片管理操作在后台降权后停止',{voiceover:vo[14],action:async()=>{
        for(const type of ['extension','skill']) {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          const root=type==='extension'?'[data-testid="proof-enterprise-plugins"]':'[data-testid="skills-catalog"]';
          const card=type==='extension'?'[data-testid="plugin-package-list-item"]':'[data-testid="skill-card"][data-source="enterprise"]';
          await stableClick(ctx,`${root} [role="tab"]:last-child`);
          await ctx.waitFor(`Boolean(document.querySelector('${root} ${card}'))`);
          await stableClick(ctx,`${root} ${card} [data-slot="card-footer"] button`);
          await clickMenuItem(ctx,type==='extension'?'下架':'分配权限');
          await ctx.waitFor(type==='extension'?"Boolean(document.querySelector('[role=alertdialog]'))":"Boolean(document.querySelector('[data-testid=enterprise-card-access] [role=radiogroup]'))");
          await ctx.eval("document.querySelector('[data-testid=proof-stats]').click()");
          const before=await ctx.eval("document.querySelector('[data-testid=proof-result]').dataset.managementRequests");
          await ctx.eval("document.querySelector('[data-testid=proof-demote-member]').click()");
          await ctx.trustedClick(type==='extension'?'[role="alertdialog"] [data-slot="alert-dialog-action"]':'[data-testid="enterprise-card-access"] [data-slot="dialog-footer"] button:last-child');
          await ctx.waitFor("!document.querySelector('[role=alertdialog]')&&!document.querySelector('[data-testid=enterprise-card-access]')");
          await ctx.eval("document.querySelector('[data-testid=proof-stats]').click()");
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid=proof-result]').dataset.managementRequests===${JSON.stringify(before)}`),'stale card action refreshes membership without sending a privileged request');
        }
      },assert:async()=>{ctx.assert(await ctx.eval("!document.querySelector('[data-testid=enterprise-card-access]')&&!document.querySelector('[role=alertdialog]')"),'privileged card dialogs close after demotion');},screenshot:{name:'card-menu-demotion',requireText:['我的插件投稿','我的技能投稿']}});
      await ctx.trustedClick('[data-testid="proof-owner"]');
    }},
    {name:"企业模板卡片菜单和我的投稿",async run(ctx){
      await reset(ctx);
      const main='[data-slot="dialog-content"][data-open]:not([data-testid])';
      for(const role of ['owner','template_admin','extension_admin','skill_admin','member']) {
        await ctx.trustedClick('[data-testid="proof-owner"]');
        if(role!=='owner')await ctx.trustedClick(`[data-testid="proof-${role}"]`);
        await ctx.trustedClick('[data-testid="proof-template-source"]');
        await ctx.waitFor(`Boolean(document.querySelector('${main} [role=tablist][aria-label="模板"]'))`);
        await ctx.trustedClick(`${main} [role=tablist][aria-label="模板"] [role=tab]:last-child`);
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=remote-template-card]'))");
        const allowed=role==='owner'||role==='template_admin';
        const menuProof={voiceover:vo[15],action:async()=>{
          ctx.assert(await ctx.eval(`!document.querySelector('${main} [data-testid=enterprise-template-manage]')&&!document.querySelector('${main} [data-testid=enterprise-template-submissions]')`),'enterprise templates contain no global management or personal submission button');
          await ctx.trustedClick('[data-testid="remote-template-card"] [data-slot="card-footer"] button');
          await ctx.waitFor("Boolean(document.querySelector('[role=menu]'))");
        },assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const menu=document.querySelector('[role=menu]');const labels=[...menu.querySelectorAll('[role=menuitem]')].map(item=>item.textContent.trim());return labels.includes('分配权限')===${allowed}&&labels.includes('下架')===${allowed}&&document.querySelectorAll('[data-testid=remote-template-card] [data-slot=card-footer] button').length===1;})()`),'template role gates only its own management items and uses one ellipsis trigger');},screenshot:{name:`template-card-menu-${role}`,requireText:allowed?['分配权限','下架']:['安装']}};
        if(role==='owner'||role==='member') await ctx.prove(`${role}：企业模板菜单权限和我的投稿入口`,menuProof);
        else {await menuProof.action();await menuProof.assert();}
        if(role==='owner') {
          await clickMenuItem(ctx,'分配权限');
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=enterprise-card-access] [role=radiogroup]'))");
          await close(ctx,'[data-testid="enterprise-card-access"][data-open]');
        } else await key(ctx,'Escape');
        await ctx.trustedClick(`${main} [role=tablist][aria-label="模板"] [role=tab]:first-child`);
        await ctx.waitFor(`Boolean(document.querySelector('${main} [data-testid=enterprise-template-submissions]'))`);
        await ctx.trustedClick(`${main} [data-testid=enterprise-template-submissions]`);
        await ctx.waitFor(`Boolean(document.querySelector('${manage} input[type=file]'))`);
        ctx.assert(await ctx.eval(`!document.querySelector('${manage}').textContent.includes('全部企业')`),'template personal submissions are available to all active roles without management controls');
        await close(ctx,manage);
        await close(ctx,main);
      }
      await ctx.trustedClick('[data-testid="proof-owner"]');
    }},
    { name: "合并后的远端模板安装前预览", async run(ctx) {
      const origin = await ctx.eval("location.origin");
      await ctx.client.send("Page.navigate", { url: `${origin}/tests/enterprise-collaboration-proof.html?shared-ui&template-cards` });
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=template-market-proof]'))");
      const dialog = '[role="dialog"][data-open]';
      for (const source of ["cloud", "enterprise"]) {
        await ctx.trustedClick(`${dialog} [role=tablist] [role=tab]:nth-child(${source === "cloud" ? 3 : 4})`);
        await ctx.waitFor("document.querySelectorAll('[data-testid=remote-template-card]').length===2");
        await ctx.prove(`${source}：紧凑模板卡片保留安装前预览`, {
          voiceover: vo[16], action: async () => {
            await ctx.trustedClick('[data-testid="remote-template-card"] button');
            await ctx.waitFor("[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent==='查看'&&!item.hasAttribute('aria-disabled'))");
            await clickMenuItem(ctx, '查看');
            await ctx.waitFor("document.querySelectorAll('[role=dialog][data-open]').length===2");
          }, assert: async () => {
            await ctx.waitFor("[...document.querySelectorAll('[role=dialog][data-open]')].at(-1).querySelector('img')?.naturalWidth===1600");
            ctx.assert(await ctx.eval("document.querySelector('[data-testid=template-market-proof]').dataset.downloads==='0'"), "Preview renders the validated remote cover before any package download");
          }, screenshot: { name: `merged-${source}-preview`, requireText: ['品牌网站模板', '安装模板'] },
        });
        await key(ctx, 'Escape');
        await ctx.waitFor("document.querySelectorAll('[role=dialog][data-open]').length===1");
      }
    } },
    { name: "账号来源卡片共享控件与选中状态", async run(ctx) {
      const origin=await ctx.eval("location.origin");
      await ctx.client.send("Page.navigate",{url:`${origin}/tests/enterprise-collaboration-proof.html?shared-ui&account-cache#/session`});
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="proof-login-account-a"]'))`);
      await ctx.trustedClick('[data-testid="proof-login-account-a"]');
      await ctx.waitForText("验证账号 A");
      await ctx.trustedClick('[data-testid="proof-bind-account"]');
      await ctx.waitFor(`document.querySelectorAll('[data-testid="cloud-workspaces"] button[aria-pressed]').length===2`);
      await ctx.prove("账号来源卡片使用共享按钮，切换后明确唯一选中项",{
        voiceover:vo[9],action:async()=>{
          await ctx.trustedClick('[data-testid="cloud-workspaces"] button[aria-pressed]:first-child');
          await ctx.waitFor(`document.querySelector('[data-testid="cloud-workspaces"] button[aria-pressed]').getAttribute('aria-pressed')==='true'`);
          await ctx.trustedClick('[data-testid="cloud-workspaces"] button[aria-pressed="false"]');
          await ctx.waitFor(`document.querySelectorAll('[data-testid="cloud-workspaces"] button[aria-pressed="true"]').length===1 && document.querySelector('[data-testid="cloud-workspaces"] button[aria-pressed="true"]').innerText.includes('星河科技')`);
        },assert:async()=>{ctx.assert(await ctx.eval(`(()=>{const r=document.querySelector('[data-testid="cloud-workspaces"]');return [...r.querySelectorAll('button')].every(button=>button.dataset.slot==='button'||button.dataset.slot==='dropdown-menu-trigger')&&r.querySelectorAll('button[aria-pressed="true"]').length===1&&!r.querySelector('button button');})()`),"source cards reuse Button, expose one active source, and keep exit separate");},screenshot:{name:"account-shared-selection",requireText:["个人","星河科技","加入企业"]},
      });
      await ctx.client.send("Page.navigate",{url:`${origin}/tests/enterprise-collaboration-proof.html?shared-ui#/session`});
      await ctx.waitForText("企业协作功能验证");
    } },
  ],
};
