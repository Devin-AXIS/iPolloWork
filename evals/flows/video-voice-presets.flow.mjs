import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const origin = process.env.IPOLLOWORK_VOICE_LIBRARY_ORIGIN || "http://localhost:5173";
const studioPort = process.env.IPOLLOWORK_ROLE_STUDIO_PORT || "5201";
import { fileURLToPath } from "node:url";

async function openAvatar(ctx, query = '') {
  await ctx.client.send('Page.navigate', {url: `${origin}/tests/video-avatar-proof.html?panel=avatar&${query}`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-avatar-panel"] [data-testid="avatar-profile-card"]') || document.querySelector('[data-testid="video-avatar-panel"] button')?.textContent.includes('创建数字人'))`);
}

async function openMyVoices(ctx) {
  await ctx.trustedClick('[data-testid="voice-selection-trigger"]');
  await ctx.waitFor(`document.querySelector('[data-testid="voice-subtabs"]')?.checkVisibility()`);
  await ctx.clickText('我的声音');
  await ctx.waitFor(`document.querySelector('[data-testid="my-voice-picker"]')?.checkVisibility()`);
}

// Real voice panel and client; the fixture simulates provider calls and project files.
async function openFixture(ctx, query) {
  await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:960,height:1000,deviceScaleFactor:1,mobile:false});
  await ctx.client.send("Page.navigate", {url: `${origin}/tests/video-avatar-proof.html?${query}`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-voice-panel"] [role="switch"]'))`);
}

async function roleFrame(ctx, expression) {
  const tree = await ctx.client.send("Page.getFrameTree");
  const frame = tree.frameTree.childFrames?.find(item => item.frame.url.includes(`:${studioPort}`));
  ctx.assert(Boolean(frame), "Role studio iframe missing");
  const world = await ctx.client.send("Page.createIsolatedWorld", {frameId: frame.frame.id, worldName: "role-proof"});
  const value = await ctx.client.send("Runtime.evaluate", {expression, contextId:world.executionContextId, returnByValue:true});
  if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
  return value.result.value;
}
async function waitRoleFrame(ctx, expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await roleFrame(ctx,expression)) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Studio frame did not reach '+expression);
}
async function clickRoleFrame(ctx, label) {
  const rect = await roleFrame(ctx, `(() => {const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button'); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await ctx.client.send("Input.dispatchMouseEvent",{type:"mousePressed",...rect,button:"left",clickCount:1});
  await ctx.client.send("Input.dispatchMouseEvent",{type:"mouseReleased",...rect,button:"left",clickCount:1});
}
async function openRecording(ctx) {
  await openFixture(ctx, 'mine=1&applied=single&cloneDelay=1');
  await openMyVoices(ctx);
  await ctx.trustedClick('[data-testid="voice-clone-entry"]');
  await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"]') && getComputedStyle(document.querySelector('[data-testid="voice-clone-dialog"]')).opacity === '1'`);
  await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]','录音旁白');
  await ctx.clickText('直接录音');
}

export default {
  id: "video-voice-presets",
  title: "Authorization-aware voice defaults and compact voice selection",
  kind: "user-facing",
  cdpTarget: {urlIncludes: process.env.IPOLLOWORK_VOICE_LIBRARY_ORIGIN || "video-avatar-proof.html"},
  preserveTheme: true,
  steps: [
    {name: "Unconfigured voiceover is off with an authorization entry", run: async ctx => {
      await ctx.prove("Without a key, voiceover stays off and links to this workspace's Authorization Center", {
        voiceover: "没有连接声音服务时，配音关闭，面板只显示前往授权中心的入口。",
        action: () => openFixture(ctx, 'auth=off&saved=none'),
        assert: async () => {
          const result = await ctx.eval(`(() => ({
            off: document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false',
            disabled: document.querySelector('[role="switch"]').getAttribute('aria-disabled') === 'true',
            label: document.querySelector('[role="switch"]').getAttribute('aria-label'),
            noTabs: !document.querySelector('[data-testid="voice-subtabs"]'),
            link: document.querySelector('[data-testid="voice-authorization-empty"] a')?.getAttribute('href'),
            noWrites: !window.avatarProof.requests.some(r => r.action === 'save-voice'),
          }))()`);
          ctx.assert(result.off && result.disabled && result.label === '自动生成配音' && result.noTabs && result.noWrites, JSON.stringify(result));
          ctx.assert(result.link === '#/workspace/proof/settings/authorizations', 'Authorization entry must preserve the workspace');
        },
        screenshot: {name: 'voice-authorization-empty', requireText: ['前往授权中心', '连接声音服务']},
      });
      await ctx.trustedClick('[data-testid="voice-authorization-empty"] a');
      await ctx.expectHashIncludes('/workspace/proof/settings/authorizations');
    }},
    {name: "Authorization enables the default and consistent controls", run: async ctx => {
      await ctx.prove("Authorized new projects show one automatic voice selector without inventing a matched voice", {
        voiceover: "连接服务后，新项目默认开启配音。音色入口显示自动匹配，生成前不显示虚假的匹配结果。",
        action: () => openFixture(ctx, 'saved=none&mine=1'),
        assert: async () => {
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.enabled && r.settings.selectionMode === 'auto')`);
          const result = await ctx.eval(`(() => {
            const selector = document.querySelector('[data-testid="voice-selection-trigger"]');
            const voiceHeading = document.querySelector('[data-testid="voice-label"]');
            const parameterHeading = document.querySelector('[data-testid="voice-delivery-controls"] h3');
            const root = document.documentElement;
            const originalLang = root.lang;
            const macClasses = ['ipollowork-electron', 'ipollowork-platform-mac'];
            const addedClasses = macClasses.filter(name => !root.classList.contains(name));
            root.lang = 'zh'; root.classList.add(...addedClasses);
            const macHeadings = ['fontSize', 'fontWeight'].every(property => getComputedStyle(voiceHeading)[property] === getComputedStyle(parameterHeading)[property]) && getComputedStyle(voiceHeading).fontWeight === '600';
            root.lang = originalLang; root.classList.remove(...addedClasses);
            return {on: document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true', label: document.querySelector('[role="switch"]').getAttribute('aria-label'),
              noRadios: !document.querySelector('[role="radio"]'), noList: !document.querySelector('[data-testid="voice-picker"]'),
              visibleParameters: [...document.querySelectorAll('[data-testid="voice-delivery-controls"] [role="combobox"]')].every(input => input.checkVisibility()), plainParameters: !document.querySelector('[data-testid="voice-delivery-controls"] summary') && getComputedStyle(document.querySelector('[data-testid="voice-delivery-controls"]')).backgroundColor === 'rgba(0, 0, 0, 0)', current: selector.textContent, noPreview: !document.querySelector('[data-testid="voice-selected-preview"]'), selectorHeight: selector.getBoundingClientRect().height,
              tabsHidden: !document.querySelector('[data-testid="voice-subtabs"]'), parameterHeight: document.querySelector('[data-testid="voice-delivery-controls"] [role="combobox"]').getBoundingClientRect().height,
              sectionGap: document.querySelector('[data-testid="voice-delivery-controls"]').getBoundingClientRect().top - selector.getBoundingClientRect().bottom,
              matchingHeadings: ['fontSize', 'fontWeight'].every(property => getComputedStyle(voiceHeading)[property] === getComputedStyle(parameterHeading)[property]), macHeadings,
              noRedundantHint: !document.querySelector('[data-testid="video-voice-panel"]').textContent.includes('每次生成或更新当前视频时'),
            };
          })()`);
          ctx.assert(result.plainParameters && result.visibleParameters && result.on && result.label === '自动生成配音' && result.noRadios && result.noList && result.noPreview && result.tabsHidden && result.noRedundantHint && result.selectorHeight === 34 && result.parameterHeight === 34 && result.sectionGap === 24 && result.matchingHeadings && result.macHeadings && result.current.includes('AI 自动匹配') && !result.current.includes('龙安洋'), JSON.stringify(result));
        },
        screenshot: {name: 'voice-auto-adjacent-result', requireText: ['自动生成配音', 'AI 自动匹配', '声音参数']},
      });
    }},
    {name: "The current voice opens a searchable voice library", run: async ctx => {
      await ctx.prove("Opening the selector preserves automatic mode; search and rounded-square filters have the same height", {
        voiceover: "直接点开音色，浮层中再搜索和筛选音色。筛选按钮是与搜索框等高的圆角方形。",
        action: async () => {
          await ctx.trustedClick('[data-testid="voice-selection-trigger"]');
          await ctx.waitFor(`document.querySelectorAll('[data-testid="preset-voice-card"]').length === 16`);
          await ctx.trustedClick('[aria-label="筛选音色"]');
          await ctx.waitFor(`(() => { const filter = document.querySelector('[aria-label="语言"]')?.closest('[data-slot="popover-content"]'); return filter && getComputedStyle(filter).opacity === '1'; })()`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const toolbar = document.querySelector('[data-testid="voice-search-toolbar"]');
            const input = toolbar.querySelector('input').getBoundingClientRect();
            const button = toolbar.querySelector('button'); const rect = button.getBoundingClientRect();
            const tabs = document.querySelector('[data-testid="voice-subtabs"]');
            return {noSelectionWrite: !window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.selectionMode === 'manual'), autoSelected: document.querySelector('[data-testid="voice-auto-match"]').getAttribute('aria-pressed') === 'true', width: rect.width, height: rect.height, inputHeight: input.height,
              radius: parseFloat(getComputedStyle(button).borderRadius), filters: ['语言','性别','年龄感'].every(l => document.querySelector('[aria-label="'+l+'"]')),
              tabsInside: document.querySelector('[data-testid="voice-picker"]').contains(tabs), tabHeight: tabs.getBoundingClientRect().height,
              tabOrder: [...tabs.querySelectorAll('[role="tab"]')].map(tab => tab.textContent.trim()).join('/'),
              tabShadows: [...tabs.querySelectorAll('[role="tab"]')].map(tab => getComputedStyle(tab).boxShadow).join('/'),
              tabFontSize: getComputedStyle(tabs.querySelector('[role="tab"]')).fontSize,
            };
          })()`);
          ctx.assert(result.noSelectionWrite && result.autoSelected && result.width === 34 && result.height === 34 && result.inputHeight === 34 && result.radius < 17 && result.filters && result.tabsInside && result.tabHeight === 34 && result.tabOrder === '官方音色/我的声音' && !/[1-9]\d*px/.test(result.tabShadows) && result.tabFontSize === '13px', JSON.stringify(result));
        },
        screenshot: {name: 'voice-library-filter', requireText: ['AI 自动匹配', '语言', '性别', '年龄感']},
      });
      await ctx.trustedClick('[aria-label="语言"]');
      await ctx.trustedClick('[data-slot="select-content"][data-open] [role="option"]:nth-child(3)');
      await ctx.waitFor(`document.querySelector('[aria-label="语言"]').textContent.includes('英语')`);
      ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="preset-voice-card"]').length < 16`), 'Filter must narrow the library');
      await ctx.eval(`[...document.querySelectorAll('[data-slot="popover-content"] button')].find(b => b.textContent.trim() === '重置').click()`);
      await ctx.trustedClick('[aria-label="筛选音色"]');
    }},
    {name: "Compact anchored library supports preview without selecting", run: async ctx => {
      await ctx.prove("The library aligns to the whole selector; preview plays audio without changing the chosen voice", {
        voiceover: "浮层与整条音色框对齐，列表更紧凑。点击音色右侧播放，只试听，不改变选择，也不收起浮层。",
        action: async () => {
          await ctx.waitFor(`getComputedStyle(document.querySelector('[data-testid="voice-picker"]')).opacity === '1'`);
          await ctx.eval(`(() => {
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = async function() {
              await play.call(this);
              window.avatarProof.requests.push({action: 'preview-played', paused: this.paused});
            };
          })()`);
          await ctx.trustedClick('[aria-label="试听龙安欢"]');
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'preview-played')`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const popup = document.querySelector('[data-testid="voice-picker"]');
            const rect = popup.getBoundingClientRect();
            const anchor = document.querySelector('[data-testid="voice-selection-trigger"]').parentElement.getBoundingClientRect();
            const auto = popup.querySelector('[data-testid="voice-auto-match"]');
            const cards = [...popup.querySelectorAll('[data-testid="preset-voice-card"]')];
            return {
              aligned: Math.abs(rect.left - anchor.left) < 1 && Math.abs(rect.width - anchor.width) < 1,
              compact: auto.getBoundingClientRect().height === 48 && cards.every(card => card.parentElement.getBoundingClientRect().height === 48),
              titleHidden: popup.querySelector('[data-slot="popover-title"]').getBoundingClientRect().height === 1,
              autoStillSelected: auto.getAttribute('aria-pressed') === 'true' && cards.every(card => card.getAttribute('aria-pressed') === 'false'),
              unchanged: window.avatarProof.requests.filter(r => r.action === 'save-voice').length === 1,
              target: window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').at(-1)?.args.voice,
              played: window.avatarProof.requests.some(r => r.action === 'preview-played' && !r.paused),
              separateButtons: !popup.querySelector('button button'),
            };
          })()`);
          ctx.assert(result.target === 'longanhuan_v3' && result.aligned && result.compact && result.titleHidden && result.autoStillSelected && result.unchanged && result.played && result.separateButtons, JSON.stringify(result));
        },
        screenshot: {name: 'compact-voice-library', requireText: ['AI 自动匹配', '龙安洋', '龙安欢']},
      });
    }},
    {name: "Choosing a voice closes the library and saves the selection", run: async ctx => {
      await ctx.prove("Choosing a voice updates the nearby result and saves manual selection without synthesizing audio", {
        voiceover: "选中音色后浮层收起，面板直接显示所选声音。浏览和选择不会触发配音生成。",
        action: async () => {
          await ctx.fill('[data-testid="voice-search-toolbar"] input', '龙机器');
          await ctx.waitFor(`document.querySelectorAll('[data-testid="preset-voice-card"]').length === 1`);
          await ctx.trustedClick('[data-voice-id="longjiqi_v3"]');
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-picker"]')`);
        },
        assert: async () => {
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.voiceId === 'longjiqi_v3' && r.settings.model === 'cosyvoice-v3-flash' && r.settings.selectionMode === 'manual')`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('龙机器')`), 'Chosen voice must appear near the mode');
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-selection-trigger"]').getBoundingClientRect().height === 34 && Boolean(document.querySelector('[data-testid="voice-selected-preview"] [aria-label="试听龙机器"]')) && !document.querySelector('[data-testid="voice-selection-trigger"] button')`), 'Selected voice needs a separate preview button on the left');
          ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').length === 1`), 'Selecting a voice must not synthesize again after the explicit preview');
        },
        screenshot: {name: 'saved-manual-voice', requireText: ['音色', '龙机器', '声音参数']},
      });
      await ctx.trustedClick('[aria-label="试听龙机器"]');
      await ctx.waitFor(`window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').length === 2`);
      ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="voice-picker"]') && document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('龙机器')`), 'Preview must not open the picker or change the selection');
      await ctx.trustedClick('[data-testid="voice-selection-trigger"]');
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-auto-match"]'))`);
      ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-auto-match"]').getAttribute('aria-pressed') === 'false'`), 'Manual selection stays fixed until explicitly changed');
      await ctx.trustedClick('[data-testid="voice-auto-match"]');
      await ctx.waitFor(`!document.querySelector('[data-testid="voice-picker"]') && document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('AI 自动匹配')`);
      ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'save-voice').at(-1).settings.selectionMode === 'auto' && !document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('龙机器')`), 'Restoring automatic matching must not claim the previous manual voice was matched');
    }},
    {name: "My voices uses a 34px selector and per-item previews", run: async ctx => {
      await ctx.prove("My voices offers selected and per-item previews while keeping parameters inline", {
        voiceover: "我的声音可以在列表里逐个试听，选中后也能在音色框左侧试听。声音参数直接展示，不套卡片。",
        action: async () => {
          await openMyVoices(ctx);
          await ctx.waitFor(`document.querySelectorAll('[data-testid="custom-voice-option"]').length === 2`);
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="custom-voice-option"]:disabled').length === 1`), 'Unavailable custom voices must remain disabled');
          await ctx.trustedClick('[aria-label="试听我的旁白"]');
          await ctx.waitFor(`window.avatarProof.requests.filter(r => r.action === 'preview-played').length === 3`);
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="custom-voice-option"]').length === 2 && !window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.source === 'cloned') && window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').at(-1).args.voice === 'proof-ready'`), 'Custom voice preview must play the requested voice without selecting it or closing the list');
          await ctx.trustedClick('[data-testid="custom-voice-option"]:not(:disabled)');
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.voiceId === 'proof-ready') && document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('我的旁白') && Boolean(document.querySelector('[data-testid="voice-delivery-controls"]'))`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const select = document.querySelector('[data-testid="voice-selection-trigger"]');
            return {height: select.getBoundingClientRect().height, name: select.textContent,
              preview: Boolean(document.querySelector('[aria-label="试听我的旁白"]')),
              visibleParameters: [...document.querySelectorAll('[data-testid="voice-delivery-controls"] [role="combobox"]')].every(input => input.checkVisibility()),
              parameters: document.querySelector('[data-testid="voice-delivery-controls"] [role="combobox"]').getBoundingClientRect().height};
          })()`);
          ctx.assert(result.height === 34 && result.parameters === 34 && result.preview && result.visibleParameters && result.name.includes('我的旁白'), JSON.stringify(result));
        },
        screenshot: {name: 'my-voice-selected', requireText: ['我的旁白', '声音参数']},
      });
    }},
    {name: "Legacy narration labels unavailable voice details below the selector", run: async ctx => {
      await ctx.prove("An existing voiceover without metadata keeps the selected voice and shows a semantic warning below it", {
        voiceover: "旧配音没有音色记录时，仍显示当前选中的音色，并在下方提示音色信息不可用。",
        action: () => openFixture(ctx, 'applied=legacy&mode=manual'),
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const label = document.querySelector('[data-testid="voice-label"]');
            const selector = document.querySelector('[data-testid="voice-selection-trigger"]');
            const status = document.querySelector('[data-testid="voice-applied"]');
            const parameters = document.querySelector('[data-testid="voice-delivery-controls"]');
            return {label: label?.getBoundingClientRect().bottom < selector.getBoundingClientRect().top,
              status: selector.getBoundingClientRect().bottom < status?.getBoundingClientRect().top,
              warning: status?.classList.contains('text-warning'),
              text: status?.textContent,
              selected: selector.textContent.includes('龙安洋'),
              noDivider: getComputedStyle(parameters).borderTopWidth === '0px',
              preview: Boolean(document.querySelector('[aria-label="试听龙安洋"]'))};
          })()`);
          ctx.assert(result.label && result.status && result.warning && result.text === '已有配音，音色信息不可用' && result.selected && result.noDivider && result.preview, JSON.stringify(result));
        },
        screenshot: {name: 'legacy-voice-warning', requireText: ['音色', '龙安洋', '已有配音，音色信息不可用']},
      });
    }},
    {name: "Voice parameters use consistent fields and preserve custom numbers", run: async ctx => {
      await ctx.prove("Four aligned 34px fields replace sliders and preserve an existing 36% volume", {
        voiceover: "声音参数统一为左侧标签、右侧下拉框，已有的 36% 音量保持不变。",
        action: () => openFixture(ctx, 'volume=36'),
        assert: async () => {
          await ctx.waitFor(`document.querySelector('[aria-label="音量"]').textContent.includes('36%')`);
          const result = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="voice-delivery-controls"]');
            const controls = [...panel.querySelectorAll('[role="combobox"]')];
            const rects = controls.map(control => control.getBoundingClientRect());
            const voice = document.querySelector('[data-testid="voice-selection-trigger"]');
            return {
              count: controls.length,
              aligned: rects.every(rect => rect.height === 34 && Math.abs(rect.left - rects[0].left) < 1 && Math.abs(rect.width - rects[0].width) < 1),
              consistent: controls.every(control => getComputedStyle(control).backgroundColor === getComputedStyle(voice).backgroundColor && getComputedStyle(control).fontSize === '12px' && getComputedStyle(control).borderWidth === '0px'),
              labels: [...panel.querySelectorAll('label')].every(label => getComputedStyle(label).fontSize === '12px'),
              title: getComputedStyle(panel.querySelector('h3')).fontSize,
              noSliders: !panel.querySelector('input[type="range"]'),
              noWrites: !window.avatarProof.requests.some(r => r.action === 'save-voice'),
            };
          })()`);
          ctx.assert(result.count === 4 && result.aligned && result.consistent && result.labels && result.title === '13px' && result.noSliders && result.noWrites, JSON.stringify(result));
        },
        screenshot: {name: 'voice-parameter-fields', requireText: ['声音参数', '表达风格', '语速', '音调', '音量', '36%']},
      });
      await ctx.prove("Preset and inline custom changes save only valid values", {
        voiceover: "可以选常用档位，也可以在原位置输入精确数值；超出范围不会保存。",
        action: async () => {
          await ctx.trustedClick('[aria-label="语速"]');
          await ctx.trustedClick('[data-slot="select-content"][data-open] [role="option"]:nth-child(3)');
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.rate === 1.25 && r.settings.volume === 36)`);
          await ctx.trustedClick('[aria-label="音量"]');
          await ctx.trustedClick('[data-slot="select-content"][data-open] [role="option"]:last-child');
          await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="音量（自定义）"]'))`);
          await ctx.fill('input[aria-label="音量（自定义）"]', '37');
          await ctx.eval(`document.querySelector('input[aria-label="音量（自定义）"]').focus(); document.querySelector('input[aria-label="音量（自定义）"]').blur()`);
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.volume === 37) && document.querySelector('[aria-label="音量"]').textContent.includes('37%')`);
          await ctx.trustedClick('[aria-label="音量"]');
          await ctx.trustedClick('[data-slot="select-content"][data-open] [role="option"]:last-child');
          await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="音量（自定义）"]'))`);
          await ctx.fill('input[aria-label="音量（自定义）"]', '101');
          await ctx.eval(`document.querySelector('input[aria-label="音量（自定义）"]').focus(); document.querySelector('input[aria-label="音量（自定义）"]').blur()`);
        },
        assert: async () => {
          await ctx.waitFor(`Boolean(document.querySelector('input[aria-invalid="true"]'))`);
          ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'save-voice').length === 2 && window.avatarProof.requests.filter(r => r.action === 'save-voice').at(-1).settings.volume === 37`), 'Invalid volume must not change the last saved value');
          ctx.assert(await ctx.eval(`document.querySelector('input[aria-invalid="true"]').getBoundingClientRect().height === 34`), 'Custom entry stays in the same height field');
        },
        screenshot: {name: 'custom-voice-parameter-validation', requireText: ['请输入 0–100 之间的数值', '较快 1.25×']},
      });
      await ctx.fill('input[aria-label="音量（自定义）"]', '');
      await ctx.eval(`document.querySelector('input[aria-label="音量（自定义）"]').focus(); document.querySelector('input[aria-label="音量（自定义）"]').blur()`);
      ctx.assert(await ctx.eval(`Boolean(document.querySelector('input[aria-invalid="true"]')) && window.avatarProof.requests.filter(r => r.action === 'save-voice').length === 2`), 'Empty input must not be converted to zero');
      await ctx.fill('input[aria-label="音量（自定义）"]', '0');
      await ctx.eval(`document.querySelector('input[aria-label="音量（自定义）"]').focus(); document.querySelector('input[aria-label="音量（自定义）"]').blur()`);
      await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.volume === 0) && document.querySelector('[aria-label="音量"]').textContent.includes('0%')`);
    }},
    {name: "Explicit off remains off after authorization", run: async ctx => {
      await ctx.prove("A saved off preference is restored instead of automatically enabling voiceover", {
        voiceover: "如果用户曾主动关闭配音，即使已经授权，也会保留关闭状态。",
        action: () => openFixture(ctx, 'saved=off'),
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && !document.querySelector('[data-testid="voice-subtabs"]') && !document.querySelector('[data-testid="voice-authorization-empty"]')`), 'Authorized saved-off state must stay off');
          ctx.assert(await ctx.eval(`!window.avatarProof.requests.some(r => r.action === 'save-voice')`), 'Reading saved off preferences must not rewrite them');
        },
        screenshot: {name: 'saved-off-preference', requireText: ['自动生成配音']},
      });
      await openFixture(ctx, 'auth=off');
      ctx.assert(await ctx.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && Boolean(document.querySelector('[data-testid="voice-authorization-empty"]')) && !window.avatarProof.requests.some(r => r.action === 'save-voice')`), 'Missing authorization overrides an enabled UI state without deleting saved preferences');
    }},
    {name: 'Avatar list creates a draft without generating', run: async ctx => {
      await ctx.prove('The avatar section starts with a list and opens an independent configuration', {
        voiceover: '数字人先显示列表，点击创建后再配置形象和对应配音。创建配置本身不会生成视频。',
        action: async () => {
          await openAvatar(ctx, 'profiles=1&audio=1');
          await ctx.trustedClick('[data-testid="video-avatar-panel"] button');
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-avatar-panel"] input[aria-label="选择人物图片"]'))`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {const panel=document.querySelector('[data-testid="video-avatar-panel"]');return {
            created: window.avatarProof.profiles.length === 1 && window.avatarProof.profiles[0].name === '数字人 1',
            fields: !!panel.querySelector('input[aria-label="选择人物图片"]') && !!panel.querySelector('[aria-label="配音片段"]') && !!panel.querySelector('textarea'),
            noGeneration: !window.avatarProof.requests.some(r=>r.action==='submit'),
          };})()`);
          ctx.assert(result.created && result.fields && result.noGeneration, JSON.stringify(result));
        },
        screenshot: {name:'avatar-profile-detail',requireText:['数字人列表','上传人物图片','配音片段','画面设置']},
      });
    }},
    {name: 'Avatar images and names stay with their own profile', run: async ctx => {
      await ctx.prove('Two avatar entries keep separate names and image drafts', {
        voiceover: '上传第一位人物图片并返回列表，再创建第二位数字人；两份配置独立保存。',
        action: async () => {
          const {root} = await ctx.client.send('DOM.getDocument');
          const {nodeId} = await ctx.client.send('DOM.querySelector', {nodeId: root.nodeId, selector: '[data-testid="video-avatar-panel"] input[type=file]'});
          await ctx.client.send('DOM.setFileInputFiles', {nodeId, files:[fileURLToPath(new URL('../../apps/app/public/default-brand-avatar.jpg',import.meta.url))]});
          await ctx.waitFor(`document.querySelector('[aria-label="替换人物图片"]') && !document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('正在上传')`);
          await ctx.fill('[data-testid="video-avatar-panel"] input[maxlength="80"]','讲解员 A');
          await ctx.clickText('数字人列表');
          await ctx.waitFor(`document.querySelector('[data-testid="avatar-profile-card"]')?.textContent.includes('讲解员 A')`);
          await ctx.clickText('创建数字人');
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-panel"] input[maxlength="80"]')?.value === '数字人 1'`);
          await ctx.trustedClick('[data-testid="video-avatar-panel"] button[aria-label^="横屏"]');
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-panel"] button[aria-label^="横屏"]')?.getAttribute('aria-pressed') === 'true'`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => ({names:window.avatarProof.profiles.map(p=>p.name),image:window.avatarProof.profiles.find(p=>p.name==='讲解员 A')?.imagePath,secondImage:window.avatarProof.profiles.find(p=>p.name==='数字人 1')?.imagePath,generated:window.avatarProof.requests.some(r=>r.action==='submit')}))()`);
          ctx.assert(result.names.length===2 && result.image && !result.secondImage && !result.generated,JSON.stringify(result));
        },
        screenshot:{name:'two-avatar-profiles',requireText:['数字人列表','上传人物图片','配音片段']},
      });
    }},
    {name: 'Each avatar chooses its own narration segment', run: async ctx => {
      await ctx.prove('Binding the second avatar to a segment leaves the first avatar unchanged', {
        voiceover: '第二位数字人可单独关联一段配音，第一位的形象和配音设置不会被覆盖。',
        action: async () => {
          await ctx.trustedClick('[aria-label="配音片段"]');
          await ctx.trustedClick('[data-slot="select-content"] [role="option"]:last-child');
          await ctx.clickText('数字人列表');
          await ctx.waitFor(`document.querySelectorAll('[data-testid="avatar-profile-card"]').length === 2`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => ({first:window.avatarProof.profiles.find(p=>p.name==='讲解员 A'),second:window.avatarProof.profiles.find(p=>p.name==='数字人 1'),generated:window.avatarProof.requests.some(r=>r.action==='submit')}))()`);
          ctx.assert(result.first?.imagePath && !result.first.audioClipId && result.second?.audioClipId==='scene-two' && !result.generated,JSON.stringify(result));
        },
        screenshot:{name:'avatar-profiles-with-independent-audio',requireText:['讲解员 A','数字人 1']},
      });
    }},

    {name: "My voices uses a picker with one secondary clone entry", run: async ctx => {
      await ctx.prove("Existing voices can be previewed and selected; cloning lives inside the picker", {
        voiceover: "我的声音以选择已有音色为主，复刻新声音收在列表底部，面板只保留应用配音的主按钮。",
        action: async () => {
          await openFixture(ctx, 'mine=1&applied=single');
          await openMyVoices(ctx);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="voice-clone-entry"]').length === 1 && !!document.querySelector('[data-testid="my-voice-picker"] [data-testid="voice-clone-entry"]') && document.querySelectorAll('[data-testid="custom-voice-option"]').length === 2 && !!document.querySelector('[data-testid="voice-delivery-controls"]')`), 'Browsing My voices changed the selected official voice');
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-generate"]') && !window.avatarProof.requests.some(r=>r.action==='save-voice' && r.settings.source==='cloned') && getComputedStyle(document.querySelector('[data-testid="voice-applied"]')).color === 'rgb(8, 124, 130)'`), 'Browsing must preserve the existing voice preference and show applied narration in teal');
          const layout = await ctx.eval(`(() => {
            const toggleRow = document.querySelector('[role="switch"]').parentElement.getBoundingClientRect();
            const applied = document.querySelector('[data-testid="voice-applied"]').getBoundingClientRect();
            const selector = document.querySelector('[data-testid="voice-selection-trigger"]').getBoundingClientRect();
            const parameters = document.querySelector('[data-testid="voice-delivery-controls"]');
            const section = parameters.getBoundingClientRect();
            const heading = parameters.querySelector('h3').getBoundingClientRect();
            const action = document.querySelector('[data-testid="voice-generate"]').getBoundingClientRect();
            return {
              toggleToLabel: document.querySelector('[data-testid="voice-label"]').getBoundingClientRect().top - toggleRow.bottom,
              labelToSelector: selector.top - document.querySelector('[data-testid="voice-label"]').getBoundingClientRect().bottom,
              selectorToApplied: applied.top - selector.bottom,
              appliedToSection: section.top - applied.bottom,
              sectionToAction: action.top - section.bottom,
              divider: getComputedStyle(parameters).borderTopWidth,
              headingWeight: getComputedStyle(parameters.querySelector('h3')).fontWeight,
            };
          })()`);
          ctx.assert(layout.toggleToLabel === 24 && layout.labelToSelector === 8 && layout.selectorToApplied === 8 && layout.appliedToSection === 24 && layout.sectionToAction === 24 && layout.divider === '0px' && layout.headingWeight === '600', JSON.stringify(layout));
        },
        screenshot: {name: 'my-voices-picker-clone-entry', requireText: ['我的旁白', '复刻新声音']},
      });
    }},
    {name: "Empty library opens a cancelable clone form", run: async ctx => {
      await ctx.prove("An incomplete clone form explains what to add without calling the provider", {
        voiceover: "复刻按钮可以点击。未填写名称时会说明缺少什么，取消不会复刻或修改配音。",
        action: async () => {
          await openFixture(ctx, 'applied=single');
          await openMyVoices(ctx);
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-library-empty"]'))`);
          await ctx.trustedClick('[data-testid="voice-clone-entry"]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"]') && getComputedStyle(document.querySelector('[data-testid="voice-clone-dialog"]')).opacity === "1"`);
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"] [role=alert]')?.textContent.includes('请先填写声音名称')`);
          await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]', '测试旁白');
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"] [role=alert]')?.textContent.includes('请先上传音频或录制')`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const dialog = document.querySelector('[data-testid="voice-clone-dialog"]');
            const sampleTabs = dialog.querySelector('[data-testid="voice-sample"] [data-slot="tabs-list"]');
            return {
              parametersIntact: Boolean(document.querySelector('[data-testid="voice-delivery-controls"]')),
              submitActionable: !dialog.querySelector('button[type=submit]').disabled && dialog.querySelector('button[type=submit]').textContent.includes('复刻声音'),
              noClone: !window.avatarProof.requests.some(r => r.action === 'voice_clone_workspace_file'),
              titleSize: getComputedStyle(dialog.querySelector('[data-slot="dialog-title"]')).fontSize,
              descriptionSize: getComputedStyle(dialog.querySelector('[data-slot="dialog-description"]')).fontSize,
              description: dialog.querySelector('[data-slot="dialog-description"]').textContent,
              labelSize: getComputedStyle(dialog.querySelector('label')).fontSize,
              nameGap: dialog.querySelector('input[maxlength="80"]').getBoundingClientRect().top - dialog.querySelector('label').getBoundingClientRect().bottom,
              tabHeight: sampleTabs.getBoundingClientRect().height,
              tabShadows: [...sampleTabs.querySelectorAll('[role="tab"]')].map(tab => getComputedStyle(tab).boxShadow).join('/'),
            };
          })()`);
          ctx.assert(result.parametersIntact && result.submitActionable && result.noClone && result.titleSize === '16px' && result.descriptionSize === '13px' && result.description === '上传音频或直接录音，复刻后用于视频配音。' && result.labelSize === '13px' && result.nameGap === 6 && result.tabHeight === 34 && !/[1-9]\d*px/.test(result.tabShadows), JSON.stringify(result));
        },
        screenshot: {name: 'clone-voice-form', requireText: ['声音名称', '请先上传音频或录制', '复刻声音']},
      });
      await ctx.clickText('取消');
      await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"]')`);
      ctx.assert(await ctx.eval(`!window.avatarProof.requests.some(r => r.action === 'voice_clone_workspace_file' || r.action === 'save-voice')`), 'Cancel changed voice settings');
    }},
    {name: "Cloning selects the new name without replacing narration", run: async ctx => {
      await ctx.prove("A named sample clones successfully, selects the new voice and leaves applied narration unchanged", {
        voiceover: "样本复刻成功后自动选中新声音，参数随之出现；视频仍保留原配音，点击更新后才替换。",
        action: async () => {
          await openFixture(ctx, 'mine=1&applied=single');
          await openMyVoices(ctx);
          await ctx.trustedClick('[data-testid="voice-clone-entry"]');
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-clone-dialog"] input[maxlength="80"]'))`);
          await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]', '产品讲解');
          const sample = Buffer.alloc(44 + 8000 * 12 * 2);
          sample.write('RIFF', 0); sample.writeUInt32LE(sample.length - 8, 4); sample.write('WAVEfmt ', 8); sample.writeUInt32LE(16, 16); sample.writeUInt16LE(1, 20); sample.writeUInt16LE(1, 22); sample.writeUInt32LE(8000, 24); sample.writeUInt32LE(16000, 28); sample.writeUInt16LE(2, 32); sample.writeUInt16LE(16, 34); sample.write('data', 36); sample.writeUInt32LE(sample.length - 44, 40);
          const path = join(tmpdir(), 'ipollowork-voice-library-proof.wav'); await writeFile(path, sample);
          await ctx.client.send('DOM.enable'); const {root} = await ctx.client.send('DOM.getDocument'); const {nodeId} = await ctx.client.send('DOM.querySelector', {nodeId: root.nodeId, selector: '[data-testid="voice-clone-dialog"] input[type="file"]'});
          await ctx.client.send('DOM.setFileInputFiles', {nodeId, files: [path]});
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"] button[type=submit]').disabled`);
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"]') && document.querySelector('[data-testid="voice-selection-trigger"]')?.textContent.includes('产品讲解')`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'voice_clone_workspace_file').length === 1 && window.avatarProof.requests.find(r => r.action === 'voice_clone_workspace_file').args.name === '产品讲解' && window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.voiceId === 'proof-cloned') && !window.avatarProof.requests.some(r => r.action === 'generate-voiceover') && document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙应沐') && !document.querySelector('[data-testid="voice-generate"]').disabled`), 'Cloning should select once without applying or duplicating');
        },
        screenshot: {name: 'cloned-voice-awaits-application', requireText: ['产品讲解', '声音参数', '修改尚未应用', '更新整段配音']},
      });
    }},
    {name: "Picker and parameter popovers share a surface", run: async ctx => {
      await ctx.prove("Voice and parameter menus use the same padding, corner radius, colors and text size", {
        voiceover: "声音列表与参数下拉统一浮层外观、边距和字号，单行选项保持相同高度。",
        action: async () => { await openMyVoices(ctx); },
        assert: async () => {
          const measure = selector => `(() => {const s=getComputedStyle(document.querySelector('${selector}'));return {padding:s.padding,radius:s.borderRadius,bg:s.backgroundColor,color:s.color,font:s.fontSize};})()`;
          const picker = await ctx.eval(measure('[data-testid="voice-picker"]'));
          await ctx.client.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await ctx.client.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-picker"]')`);
          await ctx.trustedClick('[aria-label="语速"]'); await ctx.waitFor(`Boolean(document.querySelector('[data-slot="select-content"]'))`);
          const parameter = await ctx.eval(measure('[data-slot="select-content"]'));
          ctx.assert(JSON.stringify(picker) === JSON.stringify(parameter), JSON.stringify({picker, parameter}));
          ctx.assert(await ctx.eval(`[...document.querySelectorAll('[role="option"]')].every(e => e.getBoundingClientRect().height === 34 && getComputedStyle(e).fontSize === '12px')`), 'Parameter rows are not compact');
        },
        screenshot: {name: 'consistent-parameter-menu', requireText: ['标准 1.00×', '自定义']},
      });
    }},
    {name: "Failed cloning keeps the sample and applied voice", run: async ctx => {
      await ctx.prove("A failed clone remains editable without changing the selected or applied narration", {
        voiceover: "复刻失败时保留填写的名称和样本，错误显示在弹窗内，原有配音不会被替换。",
        action: async () => {
          await openFixture(ctx, 'mine=1&cloneFail=1&applied=single');
          await openMyVoices(ctx);
          await ctx.trustedClick('[data-testid="voice-clone-entry"]'); await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-clone-dialog"]'))`);
          await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]', '保留名称');
          await ctx.client.send('DOM.enable'); const {root} = await ctx.client.send('DOM.getDocument'); const {nodeId} = await ctx.client.send('DOM.querySelector', {nodeId: root.nodeId, selector: '[data-testid="voice-clone-dialog"] input[type=file]'});
          await ctx.client.send('DOM.setFileInputFiles', {nodeId, files:[join(tmpdir(), 'ipollowork-voice-library-proof.wav')]});
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"] button[type=submit]').disabled`);
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitForText('模拟复刻失败，请重试。');
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-clone-dialog"] input[maxlength="80"]').value === '保留名称' && document.querySelector('[data-testid="voice-clone-dialog"]').textContent.includes('ipollowork-voice-library-proof.wav') && !window.avatarProof.requests.some(r => r.action === 'save-voice' || r.action === 'generate-voiceover') && document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙应沐')`), 'Failure discarded the form or changed narration');
        },
        screenshot: {name:'clone-error-preserves-form',requireText:['模拟复刻失败，请重试。','声音名称','ipollowork-voice-library-proof.wav']},
      });
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
    }},
    {name: "Narration switches between voiceover and avatar profiles", run: async ctx => {
      const project = fileURLToPath(new URL('../../vendor/hyperframes/packages/studio/data/projects/video-layer-accordion-icons-proof/', import.meta.url));
      await mkdir(join(project,'assets'),{recursive:true});
      await copyFile(fileURLToPath(new URL('../../apps/app/public/default-brand-avatar.jpg',import.meta.url)),join(project,'assets/portrait.jpg'));
      await writeFile(join(project,'hyperframes.json'),JSON.stringify({paths:{assets:'assets',blocks:'compositions',components:'compositions/components'}}));
      await writeFile(join(project,'index.html'),'<html><body style="margin:0;background:#15151d"><div id="proof" data-composition-id="video-layer-accordion-icons-proof" data-width="1280" data-height="720" data-duration="8"><img src="assets/portrait.jpg" style="height:500px" /></div></body></html>');
      await ctx.prove("One Narration entry opens voiceover first and retains an avatar draft across tabs", {
        voiceover:"讲解默认进入配音，数字人通过列表创建。切换回配音再返回，上传的形象仍保留。",
        action:async()=>{
          await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
          await ctx.client.send('Page.navigate',{url:`${origin}/tests/video-avatar-proof.html?panel=role&mine=1&applied=single&profiles=1&audio=1&studioPort=${studioPort}`});
          await ctx.waitFor(`document.querySelector('[data-testid="video-voice-panel"]')?.checkVisibility()`);
          ctx.assert(await roleFrame(ctx,`(() => {const tabs=[...document.querySelectorAll('[data-testid="role-subtabs"] button')]; return tabs.map(b=>b.textContent.trim()).join('/')==='配音/数字人' && tabs[0].getAttribute('aria-pressed')==='true';})()`),'Narration did not default to voiceover');
          await clickRoleFrame(ctx,'数字人');
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-panel"]')?.checkVisibility()`);
          await ctx.clickText('创建数字人');
          await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="选择人物图片"]'))`);
          const doc=await ctx.client.send('DOM.getDocument');
          const node=await ctx.client.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="选择人物图片"]'});
          await ctx.client.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[fileURLToPath(new URL('../../apps/app/public/default-brand-avatar.jpg',import.meta.url))]});
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('default-brand-avatar.jpg') && !document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('正在上传')`);
          await ctx.clickText('调整配音');
          await ctx.waitFor(`document.querySelector('[data-testid="video-voice-panel"]')?.checkVisibility()`);
          ctx.assert(await roleFrame(ctx,`document.querySelector('[data-testid="role-subtabs"] [aria-pressed="true"]').textContent.trim() === '配音'`),'Voice link failed to select voiceover');
          await clickRoleFrame(ctx,'组件');
          await ctx.waitFor(`!document.querySelector('[data-testid="video-voice-panel"]')`);
          await waitRoleFrame(ctx,`location.hash.includes('tab=components') && !document.querySelector('[data-testid="role-subtabs"]')`);
          ctx.assert(await roleFrame(ctx,`!document.querySelector('[data-testid="component-subtabs"]')`),'Duplicate avatar entry remained in components');
          await clickRoleFrame(ctx,'讲解');
          await ctx.waitFor(`document.querySelector('[data-testid="video-voice-panel"]')?.checkVisibility()`);
          await clickRoleFrame(ctx,'数字人');
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-panel"]')?.checkVisibility()`);
        },
        assert:async()=>{
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="video-avatar-panel"] img')?.src.startsWith('blob:') && document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('default-brand-avatar.jpg')`),'Image lost across role switch');
          ctx.assert(await roleFrame(ctx,`document.querySelector('[data-testid="role-subtabs"]').getBoundingClientRect().height === 34`),'Narration tabs are not 34px');
        },
        screenshot:{name:'role-appearance-preserves-image',requireText:['default-brand-avatar.jpg','画面设置']},
      });
    }},
    {name: "Microphone permission errors keep the form usable", run:async ctx=>{
      await ctx.prove("Denied microphone permission shows an actionable error without submitting a clone",{
        voiceover:"如果没有麦克风权限，页面会提示原因，也可以切回上传音频。",
        action:async()=>{
          await openRecording(ctx);
          await ctx.eval(`navigator.mediaDevices.getUserMedia = async () => {throw new DOMException('Denied','NotAllowedError')}`);
          await ctx.clickText('开始录音');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"]').textContent.includes('允许麦克风访问')`);
        },
        assert:async()=>ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="voice-sample"] [role="tab"]').disabled && !window.avatarProof.requests.some(r => r.action === 'voice_clone_workspace_file')`),'Permission failure blocks retry or submits clone'),
        screenshot:{name:'recording-permission-error',requireText:['允许麦克风访问','直接录音']},
      });
    }},
    {name: "Recording displays real waveform and elapsed time", run:async ctx=>{
      await ctx.prove("Recording exposes a sample passage, live signal, time, and an actionable clone requirement",{
        voiceover:"录音时可照着例句读，波形、音量和时长持续更新。提前点复刻会提示先结束录音。",
        action:async()=>{
          await openRecording(ctx);
          await ctx.eval(`navigator.mediaDevices.getUserMedia = async () => {if(window.avatarProof.recordContext?.state !== 'closed') await window.avatarProof.recordContext?.close();const context=new AudioContext();await context.resume();const oscillator=context.createOscillator();const gain=context.createGain();gain.gain.value=0.3;const destination=context.createMediaStreamDestination();oscillator.connect(gain).connect(destination);oscillator.start();window.avatarProof.recordStream=destination.stream;window.avatarProof.recordContext=context;return destination.stream;}`);
          await ctx.clickText('开始录音');
          await ctx.waitFor(`Number(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')) > 0 && document.querySelector('[data-testid="voice-sample"]').textContent.includes('00:13')`,{timeoutMs:20000});
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"] [role=alert]')?.textContent.includes('请先结束录音')`);
        },
        assert:async()=>ctx.assert(await ctx.eval(`(() => {
          const sample = document.querySelector('[data-testid="voice-sample"]');
          const stop = [...sample.querySelectorAll('button')].find(button => button.textContent.includes('结束录音'));
          const canvas = sample.querySelector('canvas[aria-label="实时录音波形"]');
          const meter = sample.querySelector('[role="meter"]');
          const submit = document.querySelector('[data-testid="voice-clone-dialog"] button[type=submit]');
          return getComputedStyle(canvas).color === 'rgb(31, 186, 192)' && Number(meter.getAttribute('aria-valuenow')) > 0 &&
            getComputedStyle(meter.firstElementChild).backgroundColor === 'rgb(28, 32, 36)' &&
            getComputedStyle(submit).color !== getComputedStyle(submit).backgroundColor &&
            sample.querySelector('[data-testid="voice-record-prompt"]')?.textContent.includes('大家好，今天的天气很舒服') &&
            !submit.disabled &&
            !window.avatarProof.requests.some(r=>r.action==='voice_clone_workspace_file') &&
            window.avatarProof.recordStream.getAudioTracks()[0].readyState === 'live' &&
            getComputedStyle(sample.querySelector('[role="status"]')).fontSize === '13px' &&
            !/[1-9]\d*px/.test(getComputedStyle(stop).boxShadow);
        })()`),'Signal feedback or recording presentation missing'),
        screenshot:{name:'recording-live-feedback',requireText:['朗读示例','大家好，今天的天气很舒服','请先结束录音']},
      });
    }},
    {name: "Recorded sample previews and submits through existing clone flow",run:async ctx=>{
      await ctx.prove("Stopping produces a playable WAV and releases the microphone; clone processing has honest stage feedback",{
        voiceover:"结束录音后可以试听或重新录音。确认后提交，页面显示处理阶段；完成后选中新声音，再由用户应用到视频。",
        action:async()=>{
          await ctx.clickText('结束录音');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-sample-preview"]')?.duration >= 10`);
          ctx.assert(await ctx.eval(`window.avatarProof.recordStream.getAudioTracks().every(t=>t.readyState==='ended')`),'Microphone remained active after stop');
          await ctx.eval(`document.querySelector('[data-testid="voice-sample-preview"]').play()`);
          await ctx.waitFor(`document.querySelector('[data-testid="voice-sample-preview"]').currentTime > 0`);
          await ctx.eval(`document.querySelector('[data-testid="voice-sample-preview"]').pause()`);
          await ctx.clickText('重新录音');
          await ctx.waitFor(`Number(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')) > 0`);
          ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="voice-sample-preview"]') && !document.querySelector('[data-testid="voice-clone-dialog"] button[type=submit]').disabled`),'Re-recording kept the old sample selectable');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-sample"]').textContent.includes('00:13')`,{timeoutMs:20000});
          await ctx.clickText('结束录音');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-sample-preview"]')?.duration >= 10`);

          await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]','');
          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-clone-dialog"] [role=alert]')?.textContent.includes('请先填写声音名称')`);
          ctx.assert(await ctx.eval(`!window.avatarProof.requests.some(r=>r.action==='voice_clone_workspace_file')`),'Missing name reached the provider');
          await ctx.fill('[data-testid="voice-clone-dialog"] input[maxlength="80"]','录音旁白');

          await ctx.trustedClick('[data-testid="voice-clone-dialog"] button[type=submit]');
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-clone-progress"]'))`);
        },
        assert:async()=>ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-clone-progress"]').textContent.length > 0 && !window.avatarProof.requests.some(r=>r.action==='generate-voiceover')`),'Clone progress missing or narration replaced early'),
        screenshot:{name:'recording-clone-progress',requireText:['复刻','声音名称']},
      });
      await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"]') && document.querySelector('[data-testid="voice-selection-trigger"]').textContent.includes('录音旁白')`);
      ctx.assert(await ctx.eval(`!window.avatarProof.requests.some(r=>r.action==='generate-voiceover')`),'Cloning replaced narration');
      await ctx.eval('window.avatarProof.recordContext.close()');
    }},
    {name: "Canceling recording releases tracks and allows another recording",run:async ctx=>{
      await ctx.prove("Closing the clone dialog during recording releases capture and resets the next visit",{
        voiceover:"录音中取消会立即释放麦克风。再次打开时可以重新录音，原视频的配音保持不变。",
        action:async()=>{
          await ctx.trustedClick('[data-testid="voice-selection-trigger"]');await ctx.trustedClick('[data-testid="voice-clone-entry"]');
          await ctx.clickText('直接录音');await ctx.clickText('开始录音');
          await ctx.waitFor(`Number(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')) > 0`);
          await ctx.clickText('取消');
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"]')`);
          ctx.assert(await ctx.eval(`window.avatarProof.recordStream.getTracks().every(t=>t.readyState==='ended')`),'Cancel leaked media tracks');
          await ctx.trustedClick('[data-testid="voice-selection-trigger"]');await ctx.trustedClick('[data-testid="voice-clone-entry"]');
          await ctx.clickText('直接录音');
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-clone-dialog"] button:disabled') || [...document.querySelectorAll('[data-testid="voice-clone-dialog"] button')].some(b=>b.textContent.includes('开始录音')&&!b.disabled)`);
        },
        assert:async()=>ctx.assert(await ctx.eval(`!document.querySelector('[role="meter"]') && [...document.querySelectorAll('[data-testid="voice-clone-dialog"] button')].some(b=>b.textContent.includes('开始录音')&&!b.disabled) && !window.avatarProof.requests.some(r=>r.action==='generate-voiceover')`),'Recording state persisted after close'),
        screenshot:{name:'recording-cancel-reset',requireText:['直接录音','开始录音']},
      });
      await ctx.clickText('取消');await ctx.eval('window.avatarProof.recordContext.close()');
    }},
  ],
};
