import { fileURLToPath } from "node:url";

async function openAvatar(ctx, query = '') {
  await ctx.client.send('Page.navigate', {url: `http://localhost:5173/tests/video-avatar-proof.html?panel=avatar&${query}`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-avatar-panel"]')) && !document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('正在检查视频服务')`);
}

// Real voice panel and client; the fixture simulates provider calls and project files.
async function openFixture(ctx, query) {
  await ctx.client.send("Page.navigate", {url: `http://localhost:5173/tests/video-avatar-proof.html?${query}`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-voice-panel"] [role="switch"]'))`);
}

export default {
  id: "video-voice-presets",
  title: "Authorization-aware voice defaults and compact voice selection",
  kind: "user-facing",
  cdpTarget: {urlIncludes: "video-avatar-proof.html"},
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
            const tabs = document.querySelector('[data-testid="voice-subtabs"]');
            const selector = document.querySelector('[aria-label="选择一个官方音色"]');
            const current = document.querySelector('[data-testid="voice-mode-result"]');
            return {on: document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true', label: document.querySelector('[role="switch"]').getAttribute('aria-label'),
              noRadios: !document.querySelector('[role="radio"]'), noList: !document.querySelector('[data-testid="voice-picker"]'),
              visibleParameters: [...document.querySelectorAll('[data-testid="voice-delivery-controls"] [role="combobox"]')].every(input => input.checkVisibility()), plainParameters: !document.querySelector('[data-testid="voice-delivery-controls"] summary') && getComputedStyle(document.querySelector('[data-testid="voice-delivery-controls"]')).backgroundColor === 'rgba(0, 0, 0, 0)', current: current.textContent, noPreview: !current.querySelector('[aria-label="试听当前音色"]'), selectorHeight: selector.parentElement.getBoundingClientRect().height,
              heights: [tabs, document.querySelector('[data-testid="voice-delivery-controls"] [role="combobox"]')].map(el => el.getBoundingClientRect().height),
              tabPadding: getComputedStyle(tabs).padding, selectedTabHeight: tabs.querySelector('[aria-selected="true"]').getBoundingClientRect().height,
            };
          })()`);
          ctx.assert(result.plainParameters && result.visibleParameters && result.on && result.label === '自动生成配音' && result.noRadios && result.noList && result.noPreview && result.selectorHeight === 34 && result.current.includes('AI 自动匹配') && !result.current.includes('龙安洋'), JSON.stringify(result));
          ctx.assert(result.heights.every(h => h === 34) && result.selectedTabHeight === 26 && result.tabPadding === '4px', `Control sizing: ${JSON.stringify(result)}`);
        },
        screenshot: {name: 'voice-auto-adjacent-result', requireText: ['自动生成配音', '每次生成或更新当前视频时，自动生成配音。', 'AI 自动匹配', '声音参数']},
      });
    }},
    {name: "The current voice opens a searchable voice library", run: async ctx => {
      await ctx.prove("Opening the selector preserves automatic mode; search and rounded-square filters have the same height", {
        voiceover: "直接点开音色，浮层中再搜索和筛选音色。筛选按钮是与搜索框等高的圆角方形。",
        action: async () => {
          await ctx.trustedClick('[aria-label="选择一个官方音色"]');
          await ctx.waitFor(`document.querySelectorAll('[data-testid="preset-voice-card"]').length === 16`);
          await ctx.trustedClick('[aria-label="筛选音色"]');
          await ctx.waitFor(`(() => { const filter = document.querySelector('[aria-label="语言"]')?.closest('[data-slot="popover-content"]'); return filter && getComputedStyle(filter).opacity === '1'; })()`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const toolbar = document.querySelector('[data-testid="voice-search-toolbar"]');
            const input = toolbar.querySelector('input').getBoundingClientRect();
            const button = toolbar.querySelector('button'); const rect = button.getBoundingClientRect();
            return {noSelectionWrite: !window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.selectionMode === 'manual'), autoSelected: document.querySelector('[data-testid="voice-auto-match"]').getAttribute('aria-pressed') === 'true', width: rect.width, height: rect.height, inputHeight: input.height,
              radius: parseFloat(getComputedStyle(button).borderRadius), filters: ['语言','性别','年龄感'].every(l => document.querySelector('[aria-label="'+l+'"]'))};
          })()`);
          ctx.assert(result.noSelectionWrite && result.autoSelected && result.width === 34 && result.height === 34 && result.inputHeight === 34 && result.radius < 17 && result.filters, JSON.stringify(result));
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
            const anchor = document.querySelector('[aria-label="选择一个官方音色"]').parentElement.getBoundingClientRect();
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
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-mode-result"]').textContent.includes('龙机器')`), 'Chosen voice must appear near the mode');
          ctx.assert(await ctx.eval(`document.querySelector('[aria-label="选择一个官方音色"]').getBoundingClientRect().height === 34 && !document.querySelector('[data-testid="voice-mode-result"] [aria-label="试听当前音色"]')`), 'Selected voice stays 34px high with preview available only in the list');
          ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').length === 1`), 'Selecting a voice must not synthesize again after the explicit preview');
        },
        screenshot: {name: 'saved-manual-voice', requireText: ['龙机器', '声音参数']},
      });
      await ctx.trustedClick('[aria-label="选择一个官方音色"]');
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-auto-match"]'))`);
      ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-auto-match"]').getAttribute('aria-pressed') === 'false'`), 'Manual selection stays fixed until explicitly changed');
      await ctx.trustedClick('[data-testid="voice-auto-match"]');
      await ctx.waitFor(`!document.querySelector('[data-testid="voice-picker"]') && document.querySelector('[data-testid="voice-mode-result"]').textContent.includes('AI 自动匹配')`);
      ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r => r.action === 'save-voice').at(-1).settings.selectionMode === 'auto' && !document.querySelector('[data-testid="voice-mode-result"]').textContent.includes('龙机器')`), 'Restoring automatic matching must not claim the previous manual voice was matched');
    }},
    {name: "My voices uses a 34px selector and per-item previews", run: async ctx => {
      await ctx.prove("My voices keeps previews in the list and shows voice parameters inline without a card", {
        voiceover: "我的声音也通过浮层试听和选择，下拉框高 34 像素，没有外置试听按钮。声音参数直接展示，不套卡片。",
        action: async () => {
          await ctx.eval(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === '我的声音').click()`);
          await ctx.waitFor(`Boolean(document.querySelector('[aria-label="我的百炼声音"]')) && !document.querySelector('[aria-label="我的百炼声音"]').disabled`);
          await ctx.eval(`document.querySelector('[aria-label="我的百炼声音"]').focus()`);
          await ctx.client.send('Input.dispatchKeyEvent', {type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32});
          await ctx.client.send('Input.dispatchKeyEvent', {type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32});
          await ctx.waitFor(`document.querySelectorAll('[data-testid="custom-voice-option"]').length === 2`);
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="custom-voice-option"]:disabled').length === 1`), 'Unavailable custom voices must remain disabled');
          await ctx.trustedClick('[aria-label="试听我的旁白"]');
          await ctx.waitFor(`window.avatarProof.requests.filter(r => r.action === 'preview-played').length === 2`);
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="custom-voice-option"]').length === 2 && !window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.source === 'cloned') && window.avatarProof.requests.filter(r => r.action === 'speech_synthesize').at(-1).args.voice === 'proof-ready'`), 'Custom voice preview must play the requested voice without selecting it or closing the list');
          await ctx.trustedClick('[data-testid="custom-voice-option"]:not(:disabled)');
          await ctx.waitFor(`window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.voiceId === 'proof-ready') && document.querySelector('[aria-label="我的百炼声音"]').textContent.includes('我的旁白') && Boolean(document.querySelector('[data-testid="voice-delivery-controls"]'))`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const select = document.querySelector('[aria-label="我的百炼声音"]');
            return {height: select.getBoundingClientRect().height, name: select.textContent,
              noPreview: !document.querySelector('[role="tabpanel"] [aria-label="试听当前音色"]'),
              visibleParameters: [...document.querySelectorAll('[data-testid="voice-delivery-controls"] [role="combobox"]')].every(input => input.checkVisibility()),
              parameters: document.querySelector('[data-testid="voice-delivery-controls"] [role="combobox"]').getBoundingClientRect().height};
          })()`);
          ctx.assert(result.height === 34 && result.parameters === 34 && result.noPreview && result.visibleParameters && result.name.includes('我的旁白'), JSON.stringify(result));
        },
        screenshot: {name: 'my-voice-selected', requireText: ['我的旁白', '复刻声音', '声音参数']},
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
            const voice = document.querySelector('[aria-label="选择一个官方音色"]');
            return {
              count: controls.length,
              aligned: rects.every(rect => rect.height === 34 && Math.abs(rect.left - rects[0].left) < 1 && Math.abs(rect.width - rects[0].width) < 1),
              consistent: controls.every(control => getComputedStyle(control).backgroundColor === getComputedStyle(voice.parentElement).backgroundColor && getComputedStyle(control).fontSize === '12px' && getComputedStyle(control).borderWidth === '0px'),
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
        screenshot: {name: 'saved-off-preference', requireText: ['自动生成配音', '后续生成不再自动配音，已有配音保留。']},
      });
      await openFixture(ctx, 'auth=off');
      ctx.assert(await ctx.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && Boolean(document.querySelector('[data-testid="voice-authorization-empty"]')) && !window.avatarProof.requests.some(r => r.action === 'save-voice')`), 'Missing authorization overrides an enabled UI state without deleting saved preferences');
    }},
    {name: 'Avatar fields use the same typography hierarchy as sound', run: async ctx => {
      await ctx.prove('Titles use 13px medium text; fields use 12px regular text; descriptions use 11px', {
        voiceover: '数字人面板的分组标题、字段和说明文字与声音面板保持一致。',
        action: () => openAvatar(ctx),
        assert: async () => {
          const result = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="video-avatar-panel"]');
            const headings = [panel.querySelector('h3'), panel.querySelector('label[for]')];
            const fields = [panel.querySelector('textarea'), panel.querySelector('[aria-label="数字人视频时长"]'), panel.querySelector('[aria-label="上传人物图片"] .truncate')];
            const labels = [...panel.querySelectorAll('label')].filter(el => !el.textContent.includes('使用视频配音'));
            const help = [...panel.querySelectorAll('p')];
            return {
              headings: headings.every(el => getComputedStyle(el).fontSize === '13px' && getComputedStyle(el).fontWeight === '500'),
              fields: fields.every(el => getComputedStyle(el).fontSize === '12px' && getComputedStyle(el).fontWeight === '400'),
              labels: labels.every(el => getComputedStyle(el).fontSize === '12px' && getComputedStyle(el).fontWeight === '400'),
              help: help.every(el => getComputedStyle(el).fontSize === '11px'),
              action: getComputedStyle([...panel.querySelectorAll('button')].find(el => el.textContent.trim() === '生成数字人')).fontSize,
              noGeneration: !window.avatarProof.requests.some(r => r.action === 'submit'),
            };
          })()`);
          ctx.assert(result.headings && result.fields && result.labels && result.help && result.action === '12px' && result.noGeneration, JSON.stringify(result));
        },
        screenshot: {name: 'avatar-type-hierarchy', requireText: ['画面设置', '动作描述', '生成数字人']},
      });
    }},
    {name: 'Uploaded portrait and entered content keep readable field text', run: async ctx => {
      await ctx.prove('The uploaded filename and action text remain 12px regular text, and editing still works', {
        voiceover: '上传图片后，文件名和动作描述保持相同正文规格。',
        action: async () => {
          const {root} = await ctx.client.send('DOM.getDocument');
          const {nodeId} = await ctx.client.send('DOM.querySelector', {nodeId: root.nodeId, selector: '[data-testid="video-avatar-panel"] input[type="file"]'});
          await ctx.client.send('DOM.setFileInputFiles', {nodeId, files: [fileURLToPath(new URL('../../apps/app/public/default-brand-avatar.jpg', import.meta.url))]});
          await ctx.waitFor(`Boolean(document.querySelector('[aria-label="替换人物图片"]:not(:disabled)')) && document.querySelector('[data-testid="video-avatar-panel"] img')?.naturalWidth > 0`);
          await ctx.fill('[data-testid="video-avatar-panel"] textarea', '人物面向镜头微笑，自然抬手打招呼。');
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="video-avatar-panel"]');
            const name = panel.querySelector('[aria-label="替换人物图片"] [title]');
            return name.textContent === 'default-brand-avatar.jpg' && getComputedStyle(name).fontSize === '12px' && getComputedStyle(name).fontWeight === '400' && panel.querySelector('textarea').value === '人物面向镜头微笑，自然抬手打招呼。' && !window.avatarProof.requests.some(r => r.action === 'submit');
          })()`), 'Image and text editing must preserve their content without starting generation');
        },
        screenshot: {name: 'avatar-portrait-field-text', requireText: ['default-brand-avatar.jpg', '点击替换图片']},
      });
    }},
    {name: 'Narration duration and task records follow the hierarchy', run: async ctx => {
      await ctx.prove('Narration duration is a field value; record titles and secondary status descriptions keep their hierarchy', {
        voiceover: '跟随配音的时长作为正文显示，生成记录标题和状态说明有明确层级。',
        action: () => openAvatar(ctx, 'long=1'),
        assert: async () => {
          ctx.assert(await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="video-avatar-panel"]');
            const duration = [...panel.querySelectorAll('span')].find(el => el.textContent.includes('跟随配音'));
            const records = [...panel.children].find(el => el.textContent.startsWith('生成记录'));
            const message = [...panel.querySelectorAll('p')].find(el => el.textContent.includes('第 2/5 段失败'));
            return getComputedStyle(duration).fontSize === '12px' && getComputedStyle(duration).fontWeight === '400' && getComputedStyle(records).fontSize === '13px' && getComputedStyle(message).fontSize === '11px' && !window.avatarProof.requests.some(r => r.action === 'submit' || r.action === 'retry-segment');
          })()`), 'Timing and records must follow the hierarchy without invoking paid actions');
        },
        screenshot: {name: 'avatar-record-type-hierarchy', requireText: ['跟随配音', '生成记录', '已完成 1/5 段']},
      });
    }},
  ],
};
