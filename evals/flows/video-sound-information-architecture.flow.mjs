import { fileURLToPath } from "node:url";

async function openVideoStudio(ctx) {
  const hasStudio = await ctx.eval(
    'Boolean(document.querySelector(\'iframe[title*="HyperFrames"], iframe[title*="视频工作室"]\'))',
  );
  if (!hasStudio) {
    await ctx.eval(`(() => {
      const title = [...document.querySelectorAll('[data-testid="artifact-file-title"]')]
        .find((element) => element.textContent?.includes('-视频'));
      title?.closest('button')?.click();
    })()`);
  }
  await ctx.waitFor(
    'Boolean(document.querySelector(\'iframe[title*="HyperFrames"], iframe[title*="视频工作室"]\'))',
    { timeoutMs: 60_000, label: "Video Studio iframe" },
  );
}

async function studioFrameContext(ctx) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frames = [];
  const collect = (node) => {
    frames.push(node.frame);
    for (const child of node.childFrames ?? []) collect(child);
  };
  collect(frameTree);
  const studioFrame = frames.find((frame) => frame.urlFragment?.includes("#project/"));
  if (!studioFrame) throw new Error("Video Studio frame not found");
  const world = await ctx.client.send("Page.createIsolatedWorld", {
    frameId: studioFrame.id,
    worldName: "fraimz-video-sound-information-architecture",
    grantUniveralAccess: true,
  });
  return world.executionContextId;
}

async function studioEval(ctx, contextId, expression) {
  const response = await ctx.client.send("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitForStudio(ctx, contextId, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (await studioEval(ctx, contextId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export default {
  id: "video-sound-information-architecture",
  title: "Video Studio separates sound settings from the avatar component",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" },
  preserveTheme: true,
  steps: [
    {
      name: "Avatar lives in Components",
      run: async (ctx) => {
        await ctx.prove("Components provides fixed Presets and Avatar sections within the six-tab inspector", {
          voiceover: "组件下方现在有预设组件和数字人两个固定入口。点击数字人，直接设置人物图片和配音。",
          action: async () => {
            await openVideoStudio(ctx);
            await ctx.client.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 1, y: 1});
            const contextId = await studioFrameContext(ctx);
            const tabsVisible = await studioEval(
              ctx,
              contextId,
              "Boolean(document.querySelector('.hf-inspector-tabs-scroll'))",
            );
            if (!tabsVisible) {
              await studioEval(
                ctx,
                contextId,
                `document.querySelector('button[aria-label="属性"]')?.click()`,
              );
            }
            await waitForStudio(
              ctx,
              contextId,
              "Boolean(document.querySelector('.hf-inspector-tabs-scroll'))",
              "inspector tabs",
            );
            await studioEval(
              ctx,
              contextId,
              `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')]
                .find((button) => button.textContent?.trim() === '组件')?.click()`,
            );
            await waitForStudio(
              ctx,
              contextId,
              `Boolean(document.querySelector('[data-testid="component-subtabs"]'))`,
              "Component secondary tabs",
            );
            await studioEval(
              ctx,
              contextId,
              `[...document.querySelectorAll('[data-testid="component-subtabs"] button')]
                .find((button) => button.textContent.trim() === "数字人")?.click()`,
            );
            await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="video-avatar-tab-content"]\')?.checkVisibility())');
            await ctx.eval(`document.querySelector('[aria-label="竖屏 576×1024"]').click()`);
            ctx.videoSoundContextId = contextId;
          },
          assert: async () => {
            const labels = await studioEval(
              ctx,
              ctx.videoSoundContextId,
              `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')]
                .map((button) => button.textContent?.trim())`,
            );
            const subtabs = await studioEval(
              ctx,
              ctx.videoSoundContextId,
              `[...document.querySelectorAll('[data-testid="component-subtabs"] button')]
                .map(button => ({label: button.textContent.trim(), active: button.getAttribute("aria-pressed")}))`,
            );
            ctx.assert(
              JSON.stringify(labels) === JSON.stringify(["图层", "主题", "组件", "动画", "声音", "素材"]),
              `Unexpected inspector tabs: ${JSON.stringify(labels)}`,
            );
            ctx.assert(JSON.stringify(subtabs) === JSON.stringify([
              {label: "预设组件", active: "false"}, {label: "数字人", active: "true"},
            ]), "Both component sections should remain visible with Avatar selected");
            const tabsBottom = await studioEval(ctx, ctx.videoSoundContextId,
              `document.querySelector('[data-testid="component-subtabs"]').getBoundingClientRect().bottom`);
            const overlayTop = await ctx.eval(`document.querySelector('[data-testid="video-avatar-tab-content"]').getBoundingClientRect().top - document.querySelector('iframe[title*="视频工作室"],iframe[title*="HyperFrames"]').getBoundingClientRect().top`);
            ctx.assert(overlayTop >= tabsBottom, "Avatar panel must not cover the secondary tabs");
            await ctx.expectText("使用视频配音");
          },
          screenshot: {
            name: "avatar-under-components",
            requireText: ["画面设置", "使用视频配音"],
          },
        });
      },
    },
    {
      name: "Avatar settings have a clear hierarchy",
      run: async (ctx) => {
        await ctx.prove("Avatar settings show each decision once, with contextual hints and no empty history", {
          voiceover: "人物图片只保留上传入口。配音时长不重复显示，背景提示跟随动作描述，空的生成记录不再占位。",
          action: async () => {
            await ctx.eval(`(() => {
              const panel = document.querySelector('[data-testid="video-avatar-panel"]');
              const toggle = panel.querySelector('[role="switch"]');
              if (toggle.getAttribute('aria-checked') === 'true') toggle.click();
              panel.querySelector('button[aria-label="横屏 1024×576"]').click();
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="数字人视频时长"]'))`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-testid="video-avatar-panel"]');
              return {headings: [...panel.querySelectorAll('h3')].map(h => h.textContent),
                upload: Boolean(panel.querySelector('button[aria-label="上传人物图片"],button[aria-label="替换人物图片"]')),
                nativeUploadHidden: getComputedStyle(panel.querySelector('input[type="file"]')).display === 'none',
                compactRatio: panel.querySelector('[aria-label="横屏 1024×576"]').getBoundingClientRect().height < 50,
                selectedRatio: panel.querySelector('[aria-label="横屏 1024×576"]').getAttribute('aria-pressed'),
                concise: !panel.querySelector('[data-testid="avatar-generation-help"]') && !panel.textContent.includes('暂无生成记录') && !panel.textContent.includes('沿用图片中的人物形象与视觉风格'),
                backgroundHelp: Boolean(panel.querySelector('[aria-label="动作与背景说明"]')),
                switchOff: panel.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false',
                switchHint: !panel.querySelector('[role="switch"]').disabled || Boolean(document.getElementById(panel.querySelector('[role="switch"]').getAttribute('aria-describedby'))),
                noChoiceButtons: ![...panel.querySelectorAll('button')].some(b => b.textContent === '不使用配音'),
                generateDisabled: Boolean(panel.querySelector('img')) || [...panel.querySelectorAll('button')].find(b => b.textContent === '生成数字人').disabled,

                lucide: [...panel.querySelectorAll('svg')].every(icon => icon.classList.contains('lucide'))};
            })()`);
            ctx.assert(JSON.stringify(state.headings) === JSON.stringify(['画面设置']), 'Audio switch must use its own label without a repeated heading');
            ctx.assert(state.upload && state.nativeUploadHidden && state.compactRatio && state.lucide, 'Upload and sizing controls must stay compact and use Lucide');
            ctx.assert(state.selectedRatio === 'true' && state.concise && state.backgroundHelp, 'Ratio choice should work and explanations should be contextual');
            ctx.assert(state.switchOff && state.switchHint && state.noChoiceButtons, 'Audio must use one switch, with a reason when unavailable');
            ctx.assert(state.generateDisabled, 'Generation must remain disabled without a portrait');
          },
          screenshot: {name: "avatar-settings-hierarchy", requireText: ['配音', '画面设置', '动作描述', '生成数字人']},
        });
        await ctx.eval(`document.querySelector('[aria-label="竖屏 576×1024"]').click()`);
      },
    },
    {
      name: "Switch back to presets",
      run: async (ctx) => {
        await ctx.prove("Switching to Presets restores the component catalog and dismisses Avatar", {
          voiceover: "切回预设组件，就能继续搜索和选择组件。两个入口始终保留在上方。",
          action: async () => {
            await studioEval(ctx, ctx.videoSoundContextId,
              `[...document.querySelectorAll('[data-testid="component-subtabs"] button')].find(button => button.textContent.trim() === "预设组件")?.click()`);
            await ctx.waitFor(`!document.querySelector('[data-testid="video-avatar-tab-content"]')?.checkVisibility()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `Boolean(document.querySelector('[data-testid="component-section-header"]'))`, "Preset catalog");
            await studioEval(ctx, ctx.videoSoundContextId, `document.activeElement?.blur()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `![...document.querySelectorAll('[role="tooltip"]')].some(t => t.textContent.includes('组件会跟随当前主题'))`, "Guidance hidden until hover");
          },
          assert: async () => {
            const state = await studioEval(ctx, ctx.videoSoundContextId, `({
              selected: document.querySelector('[data-testid="component-subtabs"] [aria-pressed="true"]')?.textContent.trim(),
              catalog: Boolean(document.querySelector('[data-testid="block-catalog-search"]')),
              removedEntry: !document.querySelector('[data-testid="open-avatar-panel"]'),
              expansionHeaders: [...document.querySelectorAll('[data-testid="component-section-header"]')].every(header => Boolean(header.querySelector('.absolute')) === (header.getAttribute('aria-expanded') === 'true') && header.querySelectorAll('svg').length === 1),
              lucideIcons: [...document.querySelectorAll('[data-testid="component-catalog-toolbar"] svg, [data-testid="component-section-header"] svg, [data-testid="block-catalog-components"] button svg')].every(icon => icon.classList.contains('lucide')),
              searchIcon: Boolean(document.querySelector('[data-testid="component-catalog-toolbar"] .lucide-search')),
              titleSize: getComputedStyle(document.querySelector('[data-testid="component-section-header"] .truncate')).fontSize,
            })`);
            ctx.assert(state.selected === "预设组件" && state.catalog && state.removedEntry, "Preset catalog should appear directly");
            ctx.assert(state.expansionHeaders && state.titleSize === '12px', "Small group headers should show accent bars only when expanded, with no filter icons");
            ctx.assert(state.lucideIcons && state.searchIcon, "Component controls must use Lucide icons");
          },
          screenshot: {name: "preset-components"},
        });
      },
    },
    {
      name: "Preset guidance is available on demand",
      run: async (ctx) => {
        await ctx.prove("Preset guidance appears beside its tab without a permanent card above the catalog", {
          voiceover: "预设组件标签只保留文字。直接悬停或聚焦标签即可查看说明。",
          action: async () => {
            const tab = await studioEval(ctx, ctx.videoSoundContextId, `(() => {
              const rect = document.querySelector('[data-testid="component-subtabs"] button').getBoundingClientRect();
              return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
            })()`);
            const frame = await ctx.eval(`(() => {
              const rect = document.querySelector('iframe[title*="HyperFrames"],iframe[title*="视频工作室"]').getBoundingClientRect();
              return {x: rect.x, y: rect.y};
            })()`);
            await ctx.client.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: frame.x + tab.x, y: frame.y + tab.y});
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `[...document.querySelectorAll('[role="tooltip"]')].some(t => t.textContent.includes('组件会跟随当前主题'))`, "Preset guidance tooltip");
          },
          assert: async () => {
            const state = await studioEval(ctx, ctx.videoSoundContextId, `(() => {
              const tooltip = [...document.querySelectorAll('[role="tooltip"]')].find(t => t.textContent.includes('组件会跟随当前主题'));
              const bounds = tooltip.getBoundingClientRect();
              return {removedCard: !document.querySelector('[data-testid="components-catalog-help"]'),
                icon: Boolean(document.querySelector('[data-testid="component-subtabs"] .lucide-info')),
                inside: bounds.left >= 0 && bounds.right <= innerWidth,
                text: tooltip.textContent};
            })()`);
            ctx.assert(state.removedCard && !state.icon && state.inside, "Guidance should appear on tab hover without an info icon");
            ctx.assert(state.text.includes('调整参数') && state.text.includes('AI'), "Guidance must retain editing instructions");
          },
          screenshot: {name: "preset-guidance-tooltip"},
        });
        await ctx.client.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 1, y: 1});
        await studioEval(ctx, ctx.videoSoundContextId, `document.activeElement?.blur()`);
      },
    },
    {
      name: "Group accent follows expansion",
      run: async (ctx) => {
        await ctx.prove("Collapsing a component group hides its accent bar; expanding restores it", {
          voiceover: "青色竖线跟随分组的展开状态。收起时隐藏，再展开时恢复，与分类筛选无关。",
          action: async () => {
            await studioEval(ctx, ctx.videoSoundContextId, `document.querySelector('[data-testid="component-section-header"]').click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `document.querySelector('[data-testid="component-section-header"]').getAttribute('aria-expanded') === 'false'`, "Collapsed group");
          },
          assert: async () => {
            const collapsed = await studioEval(ctx, ctx.videoSoundContextId, `({
              accent: Boolean(document.querySelector('[data-testid="component-section-header"]').querySelector('.absolute')),
              cards: Boolean(document.querySelector('[data-testid="catalog-grid-scene"]')),
            })`);
            ctx.assert(!collapsed.accent && !collapsed.cards, "Collapsed group must hide both accent and cards");
            await studioEval(ctx, ctx.videoSoundContextId, `document.querySelector('[data-testid="component-section-header"]').click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `Boolean(document.querySelector('[data-testid="component-section-header"][aria-expanded="true"] .absolute')) && Boolean(document.querySelector('[data-testid="catalog-grid-scene"]'))`, "Expanded group accent and cards");
          },
          screenshot: {name: "expanded-group-accent"},
        });
      },
    },
    {
      name: "Search and category filter share one row",
      run: async (ctx) => {
        await ctx.prove("The search input and icon filter share one row, with categories in an anchored menu", {
          voiceover: "搜索框右侧是分类筛选按钮。点击图标，就能展开全部分类，不再占用单独一行。",
          action: async () => {
            await studioEval(ctx, ctx.videoSoundContextId,
              `document.querySelector('button[aria-label="组件分类"]').click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `Boolean(document.querySelector('[role="listbox"][aria-label="组件分类"]'))`, "Category menu");
          },
          assert: async () => {
            const state = await studioEval(ctx, ctx.videoSoundContextId, `(() => {
              const search = document.querySelector('[data-testid="block-catalog-search"]').getBoundingClientRect();
              const button = document.querySelector('button[aria-label="组件分类"]');
              const filter = button.getBoundingClientRect();
              const tabs = document.querySelector('[data-testid="component-subtabs"]').getBoundingClientRect();
              const menu = document.querySelector('[role="listbox"]').getBoundingClientRect();
              return {sameRow: Math.abs(search.top - filter.top) < 1 && filter.left > search.right,
                matchedHeight: search.height === 34 && tabs.height === search.height && filter.height === search.height,
                compactGap: Math.abs(search.top - tabs.bottom - 12) < 1,
                iconOnly: button.textContent.trim() === '', withinViewport: menu.right <= innerWidth,
                lucideCheck: Boolean(document.querySelector('[role="option"][aria-selected="true"] .lucide-check')),
                options: [...document.querySelectorAll('[role="option"]')].map(option => option.textContent)};
            })()`);
            ctx.assert(state.sameRow && state.iconOnly, "Filter must be an icon beside search");
            ctx.assert(state.matchedHeight && state.compactGap, "Tabs and search must share a 34px height with a 12px gap");
            ctx.assert(state.withinViewport, "Category menu must fit within the panel viewport");
            ctx.assert(state.lucideCheck, "Category checkmark must use Lucide");
            ctx.assert(state.options.length > 2 && state.options[0].includes("全部组件"), "Category choices should remain available");
          },
          screenshot: {name: "compact-category-menu"},
        });
      },
    },
    {
      name: "Search within the selected category",
      run: async (ctx) => {
        await ctx.prove("Category selection and search work together, and All components clears the category", {
          voiceover: "选择开场与收尾后，可以继续搜索 Brand。筛选图标保持高亮，随时能切回全部组件。",
          action: async () => {
            await studioEval(ctx, ctx.videoSoundContextId,
              `[...document.querySelectorAll('[role="option"]')].find(option => option.textContent.includes("开场与收尾")).click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `!document.querySelector('[role="listbox"]')`, "Closed category menu");
            await studioEval(ctx, ctx.videoSoundContextId, `(() => {
              const input = document.querySelector('[data-testid="block-catalog-search"]');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Brand');
              input.dispatchEvent(new Event('input', {bubbles: true}));
            })()`);
            await waitForStudio(ctx, ctx.videoSoundContextId,
              `document.querySelector('[data-testid="block-catalog-components"]')?.textContent.includes("Brand CTA")`, "Filtered results");
          },
          assert: async () => {
            const state = await studioEval(ctx, ctx.videoSoundContextId, `({
              title: document.querySelector('button[aria-label="组件分类"]').title,
              highlighted: document.querySelector('button[aria-label="组件分类"]').className.includes('text-panel-accent'),
              content: document.querySelector('[data-testid="block-catalog-components"]').textContent,
              search: document.querySelector('[data-testid="block-catalog-search"]').value,
              expandedHeader: Boolean(document.querySelector('[data-testid="component-section-header"][aria-expanded="true"] .absolute')),
            })`);
            ctx.assert(state.title.includes("开场与收尾") && state.highlighted && state.expandedHeader, "The expanded category should have an accent bar");
            ctx.assert(state.search === "Brand" && !state.content.includes("Agenda Opener") && state.content.includes("Brand CTA"), "Search must narrow the selected category");
            await studioEval(ctx, ctx.videoSoundContextId, `document.querySelector('button[aria-label="组件分类"]').click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId, `Boolean(document.querySelector('[role="option"]'))`, "Reset category option");
            await studioEval(ctx, ctx.videoSoundContextId, `document.querySelector('[role="option"]').click()`);
            await waitForStudio(ctx, ctx.videoSoundContextId, `document.querySelector('button[aria-label="组件分类"]').title.includes('全部组件')`, "All categories restored");
            const hasAccent = await studioEval(ctx, ctx.videoSoundContextId, `Boolean(document.querySelector('[data-testid="component-section-header"] .absolute'))`);
            ctx.assert(hasAccent, "Clearing the category must preserve the expanded group accent bar");
            await studioEval(ctx, ctx.videoSoundContextId, `(() => {
              const input = document.querySelector('[data-testid="block-catalog-search"]');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
              input.dispatchEvent(new Event('input', {bubbles: true}));
            })()`);
          },
          screenshot: {name: "compact-catalog-reset"},
        });
      },
    },
    {
      name: "Sound stays focused",
      run: async (ctx) => {
        await ctx.prove("Sound contains voice selection while voice parameters stay visible inline", {
          voiceover: "声音仍然单独设置，保留官方音色和我的声音。声音参数直接展示，不套卡片。",
          action: async () => {
            await studioEval(
              ctx,
              ctx.videoSoundContextId,
              `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')]
                .find((button) => button.textContent?.trim() === '声音')?.click()`,
            );
            await ctx.waitFor(
              'document.querySelectorAll(\'[data-testid="video-voice-panel"] [role="tab"]\').length === 2',
              { timeoutMs: 30_000, label: "voice tabs" },
            );
          },
          assert: async () => {
            const panel = await ctx.eval(`(() => {
              const element = document.querySelector('[data-testid="video-voice-panel"]');
              return {
                tabs: [...element.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()),
                parametersVisible: [...element.querySelectorAll('[data-testid="voice-delivery-controls"] [role="combobox"]')].every(input => input.checkVisibility()),
              };
            })()`);
            ctx.assert(
              JSON.stringify(panel.tabs) === JSON.stringify(["官方音色", "我的声音"]),
              `Unexpected voice tabs: ${JSON.stringify(panel.tabs)}`,
            );
            ctx.assert(panel.parametersVisible, "Voice parameters should be directly visible");
            await ctx.expectText("生成旁白与配音");
            await ctx.expectText("AI 自动匹配");
            await ctx.expectText("声音参数");
          },
          screenshot: {
            name: "focused-sound-panel",
            requireText: ["生成旁白与配音", "官方音色", "我的声音", "声音参数"],
          },
        });
      },
    },
    {
      name: "Voice selection and filtering are separated from advanced controls",
      run: async (ctx) => {
        await ctx.prove("Official voices keep search and filters together, with preview only for a concrete selection", {
          voiceover: "搜索和筛选合在一行。选定具体音色后可以试听，自动匹配前不把默认声音作为结果。",
          action: async () => {
            await ctx.trustedClick('[aria-label="选择一个官方音色"]');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-picker"]'))`);
            await ctx.trustedClick('[aria-label="筛选音色"]');
            await ctx.trustedClick('[aria-label="语言"]');
            await ctx.trustedClick('[role="option"]:nth-child(3)');
            await ctx.waitFor(`document.querySelector('[aria-label="语言"]').textContent.includes('英语')`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-testid="video-voice-panel"]');
              const toolbar = document.querySelector('[data-testid="voice-search-toolbar"]');
              const search = toolbar.querySelector('input').getBoundingClientRect();
              const filter = toolbar.querySelector('button').getBoundingClientRect();
              const parameters = panel.querySelector('[data-testid="voice-delivery-controls"]');
              const preview = [...panel.querySelectorAll('[data-testid="voice-mode-result"] button')].find(b => b.textContent.trim() === '试听');
              return {sameRow: Math.abs(search.top - filter.top) < 1 && Math.abs(search.height - filter.height) < 1,
                filtered: toolbar.querySelector('button').textContent.includes('1'),
                visibleParameters: [...parameters.querySelectorAll('[role="combobox"]')].every(input => input.checkVisibility()),
                previewInListOnly: !preview && Boolean(document.querySelector('[data-testid="voice-picker"] [aria-label^="试听"]')),
                noRepeatedHeading: !panel.innerText.includes('官方预置音色'),
                labeledFilters: ['语言','性别','年龄感'].every(label => document.querySelector('[aria-label="'+label+'"]'))};
            })()`);
            ctx.assert(Object.values(state).every(Boolean), `Voice hierarchy failed: ${JSON.stringify(state)}`);
          },
          screenshot: {name: "voice-filter-popover", requireText: ['筛选音色', '语言', '英语']},
        });
        await ctx.eval(`[...document.querySelectorAll('[data-slot="popover-content"] button')].find(b => b.textContent.trim() === '重置').click()`);
        await ctx.trustedClick('[aria-label="筛选音色"]');
        await ctx.trustedClick('[aria-label="选择一个官方音色"]');
      },
    },
    {
      name: "My voices prioritizes selection and keeps cloning concise",
      run: async (ctx) => {
        await ctx.prove("My voices has one saved-voice selector and one concise clone entry without technical status clutter", {
          voiceover: "我的声音先展示已保存的声音，下面是复刻入口和文件要求。存储说明通过悬停查看，不再占据面板。",
          action: async () => {
            await ctx.eval(`[...document.querySelectorAll('[data-testid="video-voice-panel"] [role="tab"]')].find(b => b.textContent.trim() === '我的声音').click()`);
            await ctx.waitFor(`document.querySelector('[data-testid="video-voice-panel"]').innerText.includes('已保存的声音') && !document.querySelector('[data-testid="video-voice-panel"]').innerText.includes('正在读取我的声音')`, {timeoutMs: 60_000});
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-testid="video-voice-panel"]');
              return {selected: panel.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === '我的声音',
                chooserOrEmpty: Boolean(panel.querySelector('[aria-label="我的百炼声音"]')) || panel.innerText.includes('还没有复刻的声音'),
                oneUpload: [...panel.querySelectorAll('button')].filter(b => b.textContent.trim() === '复刻声音').length === 1,
                fileHelp: panel.innerText.includes('10–60 秒') && panel.innerText.includes('10 MB'),
                noTechnicalCopy: !panel.innerText.includes('OSS/Wasabi') && !panel.innerText.includes('私有临时链接'),
                noRepeatedTitle: !panel.innerText.includes('复刻自己的声音')};
            })()`);
            ctx.assert(Object.values(state).every(Boolean), `My voices hierarchy failed: ${JSON.stringify(state)}`);
          },
          screenshot: {name: "my-voices-hierarchy", requireText: ['已保存的声音', '复刻声音', 'WAV']},
        });
      },
    },
    {
      name: "Avatar draft survives a trip to sound settings",
      run: async (ctx) => {
        const openAvatar = async () => {
          await studioEval(ctx, ctx.videoSoundContextId,
            `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b => b.textContent.trim() === '组件').click()`);
          await waitForStudio(ctx, ctx.videoSoundContextId,
            `Boolean(document.querySelector('[data-testid="component-subtabs"]'))`, "Component tabs");
          await studioEval(ctx, ctx.videoSoundContextId,
            `[...document.querySelectorAll('[data-testid="component-subtabs"] button')].find(b => b.textContent.trim() === '数字人').click()`);
          await ctx.waitFor(`document.querySelector('[data-testid="video-avatar-tab-content"]')?.checkVisibility()`);
          await ctx.waitFor(`!document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('正在读取配音')`);
        };
        const snapshot = () => ctx.eval(`(() => {
          const panel = document.querySelector('[data-testid="video-avatar-panel"]');
          const image = panel.querySelector('img');
          return {src: image?.src, loaded: Boolean(image?.complete && image.naturalWidth),
            name: panel.querySelector('[aria-label="替换人物图片"] [title]')?.title,
            prompt: panel.querySelector('textarea').value,
            ratio: panel.querySelector('[aria-pressed="true"]').getAttribute('aria-label'),
            audio: panel.querySelector('[role="switch"]').getAttribute('aria-checked'),
            duration: panel.querySelector('[aria-label="数字人视频时长"]')?.textContent};
        })()`);
        let before;
        await ctx.prove("Uploaded portrait and avatar settings survive navigating to Sound and back", {
          voiceover: "上传人物图片并填写动作后，可以先去调整配音。回到数字人，图片、画面比例和填写的内容都还在。",
          action: async () => {
            await openAvatar();
            const {root} = await ctx.client.send("DOM.getDocument");
            const {nodeId} = await ctx.client.send("DOM.querySelector", {nodeId: root.nodeId, selector: 'input[aria-label="选择人物图片"]'});
            await ctx.client.send("DOM.setFileInputFiles", {nodeId, files: [fileURLToPath(new URL('../../apps/app/public/default-brand-avatar.jpg', import.meta.url))]});
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="替换人物图片"]:not(:disabled)')) && !document.querySelector('[data-testid="video-avatar-panel"]').textContent.includes('图片上传失败')`);
            const previous = await snapshot();
            await ctx.fill('[data-testid="video-avatar-panel"] textarea', previous.prompt === '人物面向镜头微笑，抬手打招呼。' ? '人物面向镜头点头，保持微笑。' : '人物面向镜头微笑，抬手打招呼。');
            await ctx.eval(`document.querySelector('[aria-label="横屏 1024×576"]').click()`);
            before = await snapshot();
            ctx.assert(before.loaded && before.name === 'default-brand-avatar.jpg', "Reference image must be uploaded and decoded before navigation");
            const hasLink = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll('[data-testid="video-avatar-panel"] button')].find(b => ['调整配音', '设置配音'].includes(b.textContent.trim()));
              button?.click(); return Boolean(button);
            })()`);
            if (!hasLink) await studioEval(ctx, ctx.videoSoundContextId,
              `[...document.querySelectorAll('.hf-inspector-tabs-scroll button')].find(b => b.textContent.trim() === '声音').click()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-voice-panel"]')) && !document.querySelector('[data-testid="video-avatar-tab-content"]').checkVisibility()`);
            await openAvatar();
          },
          assert: async () => {
            const after = await snapshot();
            ctx.assert(JSON.stringify(after) === JSON.stringify(before), `Avatar draft changed across tabs: ${JSON.stringify({before, after})}`);
            ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="video-voice-panel"]')`), "Sound overlay should be closed after returning");
          },
          screenshot: {name: "avatar-draft-preserved", requireText: ['default-brand-avatar.jpg', '画面设置', '动作描述']},
        });
      },
    },
  ],
};
