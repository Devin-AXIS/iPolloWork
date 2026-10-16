const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"]';
const DRAFT = "Create the first task with OpenCode";

async function setTheme(ctx, theme) {
  await ctx.eval(`(() => {
    localStorage.setItem('ipollowork.react.settings.theme-mode', ${JSON.stringify(theme)});
    location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "control API after theme change",
  });
  await ctx.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, {
    timeoutMs: 10_000,
    label: `${theme} theme`,
  });
  await ctx.waitFor(`(() => {
    if (document.querySelector('[data-testid=startup-logo-animation]')) return false;
    return ![...document.querySelectorAll('[role=status]')]
      .some((element) => /Installing required resources|正在安装所需资源/.test(element.innerText || ''));
  })()`, {
    timeoutMs: 120_000,
    label: "starter visible without a loading overlay",
  });
}

async function typeDraft(ctx) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
    timeoutMs: 30_000,
    label: "initial project composer",
  });
  await ctx.eval(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    editor.focus();
    return document.activeElement === editor;
  })()`);
  await ctx.client.send("Input.insertText", { text: DRAFT });
  await ctx.waitFor(
    `document.querySelector(${JSON.stringify(EDITOR_SELECTOR)})?.innerText.trim() === ${JSON.stringify(DRAFT)}`,
    { timeoutMs: 10_000, label: "starter draft" },
  );
}

async function submitDraft(ctx) {
  await ctx.waitFor(
    `(() => {
      const button = document.querySelector('button[title="Run task"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`,
    { timeoutMs: 10_000, label: "enabled starter submit" },
  );
}

export default {
  id: "project-engine-starter",
  title: "First project defaults to OpenCode",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]'))", {
      timeoutMs: 30_000,
      label: "zero-project starter",
    });
    const projectCount = await ctx.eval("document.querySelectorAll('[data-testid=project-row]').length");
    return projectCount === 0 ? null : "This proof requires an isolated profile with no named projects.";
  },
  steps: [
    {
      name: "Open the new-project engine cards",
      run: async (ctx) => {
        await ctx.prove("The new-project dialog uses the Figma engine-card variants", {
          voiceover: "新建项目弹窗复用新版引擎卡片：品牌图标位于左上，单选状态位于右上，选中态使用青色描边。",
          action: async () => {
            await setTheme(ctx, "light");
            await ctx.waitFor(`(() => {
              const button = document.querySelector('[data-testid=new-project-button]');
              if (!button) return false;
              button.click();
              return true;
            })()`, {
              timeoutMs: 10_000,
              label: "open new project dialog",
            });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", {
              timeoutMs: 10_000,
              label: "new project dialog",
            });
          },
          assert: async () => {
            const cards = await ctx.eval(`[...document.querySelectorAll('[data-testid=project-engine-option]')].map((card) => {
              const images = [...card.querySelectorAll('img')];
              const rect = card.getBoundingClientRect();
              return {
                engineId: card.getAttribute('data-engine-id'),
                state: card.getAttribute('data-state'),
                width: rect.width,
                height: rect.height,
                border: getComputedStyle(card).borderColor,
                background: getComputedStyle(card).backgroundColor,
                brandIcon: { width: images[0]?.getBoundingClientRect().width || 0, height: images[0]?.getBoundingClientRect().height || 0 },
                radio: { width: images[1]?.getBoundingClientRect().width || 0, height: images[1]?.getBoundingClientRect().height || 0 },
              };
            })`);
            ctx.assert(cards.length === 3, `Expected three engine cards, found ${cards.length}.`);
            ctx.assert(cards.every((card) => card.width >= 204 && card.height >= 119), "Engine cards should fill the available dialog width and remain at least 120px high.");
            ctx.assert(Math.max(...cards.map((card) => card.width)) - Math.min(...cards.map((card) => card.width)) <= 1, "Engine cards should share the dialog width evenly.");
            ctx.assert(Math.abs(cards[0].brandIcon.width - 19) <= 1 && Math.abs(cards[0].brandIcon.height - 24) <= 1, "OpenCode should use the 19×24 Figma icon.");
            ctx.assert(Math.abs(cards[1].brandIcon.width - 33) <= 1 && Math.abs(cards[1].brandIcon.height - 24) <= 1, "DeepSeek Harness should use the 33×24 Figma icon.");
            ctx.assert(cards.every((card) => Math.abs(card.radio.width - 16) <= 1 && Math.abs(card.radio.height - 16) <= 1), "Each card should expose a 16px radio state.");
            ctx.assert(cards[0].state === "selected", "OpenCode should remain the default selected engine.");
            ctx.assert(cards[0].border !== cards[1].border, "The selected card should use a distinct accent border.");
            ctx.assert(cards[0].background === "rgba(0, 0, 0, 0)", "The selected card should keep a transparent surface.");
          },
          screenshot: {
            name: "new-project-engine-cards-light",
            requireText: ["OpenCode", "DeepSeek Harness", "Codex Harness"],
            rejectText: ["Something went wrong", "Ungrouped", "未分组"],
          },
        });
      },
    },
    {
      name: "Open the project-first starter",
      run: async (ctx) => {
        await ctx.prove("The shortcut editor stays inside the visible content area", {
          voiceover: "标题和标签栏保持固定，标签到快捷任务、模板到输入框都保持二十四像素间距；快捷入口面板在窄矮窗口中也不会被截断。",
          action: async () => {
            await setTheme(ctx, "light");
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 1024,
              height: 925,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]'))", {
              timeoutMs: 30_000,
              label: "light starter for shortcut editor",
            });
            await ctx.eval(`(async () => {
              const tabs = [...document.querySelectorAll('[role=tab]')];
              tabs[1]?.click();
              await new Promise((resolve) => setTimeout(resolve, 400));
              const compactTasks = document.querySelector('[data-testid=new-conversation-starter-tasks]')?.getBoundingClientRect();
              const compactComposer = document.querySelector('[data-testid=new-conversation-starter-composer-shell]')?.getBoundingClientRect();
              tabs[2]?.click();
              await new Promise((resolve) => setTimeout(resolve, 400));
              document.querySelector('[data-testid=new-conversation-quick-actions] > button')?.click();
              await new Promise((resolve) => setTimeout(resolve, 600));
              const tablist = document.querySelector('[role=tablist]')?.getBoundingClientRect();
              const firstTask = document.querySelector('[data-testid=new-conversation-quick-actions] > button')?.getBoundingClientRect();
              const strip = document.querySelector('[data-testid=new-conversation-template-strip]')?.getBoundingClientRect();
              const expandedComposer = document.querySelector('[data-testid=new-conversation-starter-composer-shell]')?.getBoundingClientRect();
              window.__projectEngineStarterTallLayout = {
                compactTaskToComposerGap: compactTasks && compactComposer ? compactComposer.top - compactTasks.bottom : null,
                tabToTaskGap: tablist && firstTask ? firstTask.top - tablist.bottom : null,
                moduleToComposerGap: strip && expandedComposer ? expandedComposer.top - strip.bottom : null,
                composerShift: compactComposer && expandedComposer ? expandedComposer.top - compactComposer.top : null,
              };
              return window.__projectEngineStarterTallLayout;
            })()`, { awaitPromise: true });
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 834,
              height: 650,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await new Promise((resolve) => setTimeout(resolve, 300));
            await ctx.eval(`(() => {
              const composer = document.querySelector('[data-testid=new-conversation-starter-composer-shell]');
              const strip = document.querySelector('[data-testid=new-conversation-template-strip]')?.getBoundingClientRect();
              const composerRect = composer?.getBoundingClientRect();
              let scrollParent = composer?.parentElement || null;
              while (scrollParent && !['auto', 'scroll'].includes(getComputedStyle(scrollParent).overflowY)) {
                scrollParent = scrollParent.parentElement;
              }
              window.__projectEngineStarterNarrowLayout = {
                moduleToComposerGap: strip && composerRect ? composerRect.top - strip.bottom : null,
                canScroll: Boolean(scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight),
              };
              [...document.querySelectorAll('[role=tab]')][0]?.click();
              return window.__projectEngineStarterNarrowLayout;
            })()`);
            await new Promise((resolve) => setTimeout(resolve, 400));
            await ctx.waitFor(`(() => {
              const button = document.querySelector('button[aria-label="Add shortcut"], button[aria-label="添加快捷标签"]');
              if (!button) return false;
              button.click();
              return true;
            })()`, {
              timeoutMs: 10_000,
              label: "open shortcut editor",
            });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-shortcut-editor]'))", {
              timeoutMs: 10_000,
              label: "shortcut editor",
            });
          },
          assert: async () => {
            const geometry = await ctx.eval(`(() => {
              const editor = document.querySelector('[data-testid=new-conversation-shortcut-editor]');
              const inset = document.querySelector('[data-slot="sidebar-inset"]');
              const sidebar = document.querySelector('[data-slot="sidebar"]');
              const editorRect = editor?.getBoundingClientRect();
              const insetRect = inset?.getBoundingClientRect();
              const sidebarRect = sidebar?.getBoundingClientRect();
              return {
                editor: editorRect ? { top: editorRect.top, bottom: editorRect.bottom, left: editorRect.left, right: editorRect.right, width: editorRect.width } : null,
                inset: insetRect ? { left: insetRect.left, right: insetRect.right } : null,
                sidebar: sidebarRect ? { right: sidebarRect.right } : null,
                viewportHeight: innerHeight,
                tallLayout: window.__projectEngineStarterTallLayout || null,
                narrowLayout: window.__projectEngineStarterNarrowLayout || null,
              };
            })()`);
            ctx.assert(Boolean(geometry.editor && geometry.inset), "Shortcut editor and main content bounds should be measurable.");
            ctx.assert(Boolean(geometry.tallLayout), "Tall-window template spacing should be measurable.");
            ctx.assert(Boolean(geometry.narrowLayout), "Narrow-window template layout should be measurable.");
            ctx.assert(Math.abs(geometry.tallLayout.compactTaskToComposerGap - 24) <= 1, `Compact task-to-composer gap should be 24px, found ${geometry.tallLayout.compactTaskToComposerGap}px.`);
            ctx.assert(Math.abs(geometry.tallLayout.tabToTaskGap - 24) <= 1, `Tab-to-task gap should be 24px, found ${geometry.tallLayout.tabToTaskGap}px.`);
            ctx.assert(Math.abs(geometry.tallLayout.moduleToComposerGap - 24) <= 1, `Template-to-composer gap should be 24px, found ${geometry.tallLayout.moduleToComposerGap}px.`);
            ctx.assert(geometry.tallLayout.composerShift >= 185, `The template module should expand the content flow, found a ${geometry.tallLayout.composerShift}px shift.`);
            ctx.assert(Math.abs(geometry.narrowLayout.moduleToComposerGap - 24) <= 1, `Narrow template-to-composer gap should remain 24px, found ${geometry.narrowLayout.moduleToComposerGap}px.`);
            ctx.assert(geometry.narrowLayout.canScroll, "A short viewport should scroll the complete starter instead of clipping its template or composer.");
            ctx.assert(geometry.editor.left >= geometry.inset.left + 15, "Shortcut editor should keep a 16px margin from the content edge.");
            ctx.assert(geometry.editor.right <= geometry.inset.right - 15, "Shortcut editor should remain inside the content area's right edge.");
            ctx.assert(geometry.editor.top >= 15, "Shortcut editor should keep a 16px margin from the viewport top.");
            ctx.assert(geometry.editor.bottom <= geometry.viewportHeight - 15, "Shortcut editor should keep a 16px margin from the viewport bottom.");
            ctx.assert(geometry.editor.width <= 340, `Shortcut editor should remain at most 340px wide, found ${geometry.editor.width}px.`);
            if (geometry.sidebar) {
              ctx.assert(geometry.editor.left >= geometry.sidebar.right, "Shortcut editor should not overlap the expanded sidebar.");
            }
          },
          screenshot: {
            name: "shortcut-editor-contained-light",
            requireText: ["Manage shortcuts"],
            rejectText: ["Something went wrong", "Ungrouped", "未分组"],
          },
        });

        await ctx.eval(`(() => {
          const editor = document.querySelector('[data-testid=new-conversation-shortcut-editor]');
          const close = editor?.querySelector('button[aria-label="Close"], button[aria-label="关闭"]');
          close?.click();
          return !document.querySelector('[data-testid=new-conversation-shortcut-editor]');
        })()`);
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");

        await ctx.prove("With no projects, the starter defaults to OpenCode", {
          voiceover: "还没有项目时，首页默认使用 OpenCode，不再弹出首次引擎选择；空内容发送按钮仍会说明为什么暂时无法发送。",
          action: async () => {
            await ctx.client.send("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
            });
            await setTheme(ctx, "light");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]'))", {
              timeoutMs: 30_000,
              label: "light starter",
            });
            await ctx.eval(`new Promise((resolve) => {
              const target = [...document.querySelectorAll('[role=tab]')]
                .find((tab) => tab.getAttribute('aria-selected') !== 'true');
              if (!target) {
                resolve(false);
                return;
              }
              const samples = [];
              const started = performance.now();
              target.click();
              const sample = (now) => {
                const indicator = document.querySelector('[data-testid=new-conversation-mode-indicator]');
                samples.push(indicator?.getBoundingClientRect().x || 0);
                if (now - started < 500) {
                  requestAnimationFrame(sample);
                  return;
                }
                window.__projectEngineStarterModeMotion = samples;
                resolve(true);
              };
              requestAnimationFrame(sample);
            })`, { awaitPromise: true });
            await ctx.eval(`(() => {
              const button = document.querySelector('button[title="Run task"], button[title="运行任务"]');
              button?.scrollIntoView({ block: 'center' });
              button?.click();
              return Boolean(button);
            })()`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=composer-empty-submit-hint]'))", {
              timeoutMs: 10_000,
              label: "empty submit explanation",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const starter = document.querySelector('[data-testid=initial-project-task-starter]');
              const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
              const placeholder = editor?.parentElement?.querySelector('[data-testid=composer-placeholder]');
              const placeholderTarget = document.createElement('span');
              placeholderTarget.className = 'text-slate-10';
              document.body.append(placeholderTarget);
              const placeholderTargetColor = getComputedStyle(placeholderTarget).color;
              placeholderTarget.remove();
              const submit = starter.querySelector('button[title="Run task"], button[title="运行任务"]');
              const addEntry = starter.querySelector('button[title="Add to this task"], button[title="添加到任务"]');
              const addEntryIcon = addEntry?.querySelector('svg');
              const model = starter.querySelector('button[aria-label*="Change model"], button[aria-label*="更换模型"]');
              const mode = starter.querySelector('button[aria-label*="Work mode"], button[aria-label*="工作模式"]');
              const addEntryRect = addEntry?.getBoundingClientRect();
              const modelRect = model?.getBoundingClientRect();
              const modeRect = mode?.getBoundingClientRect();
              const hint = document.querySelector('[data-testid=composer-empty-submit-hint]');
              const submitRect = submit?.getBoundingClientRect();
              const hintRect = hint?.getBoundingClientRect();
              const modeIndicator = document.querySelector('[data-testid=new-conversation-mode-indicator]');
              const motionSamples = window.__projectEngineStarterModeMotion || [];
              const tabs = [...starter.querySelectorAll('button')]
                .map((button) => button.textContent?.trim())
                .filter((label) => ['Work', 'Code', 'Create', 'Video', '工作', '代码', '创作', '视频'].includes(label));
              const contextHealth = document.querySelector('[data-testid=composer-context-health]');
              return {
                theme: document.documentElement.dataset.theme,
                projects: document.querySelectorAll('[data-testid=project-row]').length,
                contextHealth: Boolean(contextHealth),
                contextHealthLabel: contextHealth?.getAttribute('aria-label') || '',
                engineDialog: Boolean(document.querySelector('[data-testid=initial-project-engine-dialog]')),
                subtitle: /Start with an idea|从一个想法开始/.test(starter.innerText || ''),
                tabs,
                selectedTabCount: starter.querySelectorAll('[role=tab][aria-selected=true]').length,
                modeIndicatorBackground: modeIndicator ? getComputedStyle(modeIndicator).backgroundColor : '',
                motionSampleCount: motionSamples.length,
                motionSampleRange: motionSamples.length ? Math.max(...motionSamples) - Math.min(...motionSamples) : 0,
                motionDistinctPositions: new Set(motionSamples.map((position) => Math.round(position))).size,
                placeholder: editor?.getAttribute('aria-placeholder') || '',
                placeholderColor: placeholder ? getComputedStyle(placeholder).color : '',
                placeholderTargetColor,
                modelBackground: getComputedStyle(model).backgroundColor,
                modeBackground: getComputedStyle(mode).backgroundColor,
                addEntryIconClass: addEntryIcon?.getAttribute('class') || '',
                addEntryIconWidth: addEntryIcon?.getAttribute('width') || '',
                addEntryToModelGap: addEntryRect && modelRect ? modelRect.left - addEntryRect.right : Number.NaN,
                modelToModeGap: modelRect && modeRect ? modeRect.left - modelRect.right : Number.NaN,
                controlPaddings: [addEntry, model, mode].map((control) => control ? [getComputedStyle(control).paddingLeft, getComputedStyle(control).paddingRight] : []),
                submitDisabled: submit?.disabled ?? true,
                submitBackground: submit ? getComputedStyle(submit).backgroundColor : '',
                hintText: hint?.textContent?.trim() || '',
                hintAboveSubmit: Boolean(submitRect && hintRect && hintRect.bottom <= submitRect.top),
              };
            })()`);
            ctx.assert(state.theme === "light", "Starter should render in light mode.");
            ctx.assert(state.projects === 0, "Opening the starter must not create a project.");
            ctx.assert(state.contextHealth, "The zero-project starter should show context health.");
            ctx.assert(/Context health|上下文体检/.test(state.contextHealthLabel), "The starter should expose context usage instead of an engine badge.");
            ctx.assert(!state.engineDialog, "The zero-project starter should not contain a first-use engine dialog.");
            ctx.assert(!state.subtitle, "The old explanatory copy should be removed.");
            ctx.assert(state.addEntryIconClass.includes("lucide-plus"), "The composer should keep the plus entry icon.");
            ctx.assert(state.addEntryIconWidth === "18", `Expected an 18px plus icon, found ${state.addEntryIconWidth}px.`);
            ctx.assert(state.addEntryToModelGap === 6, `Expected a 6px add-to-model gap, found ${state.addEntryToModelGap}px.`);
            ctx.assert(state.modelToModeGap === 6, `Expected a 6px model-to-mode gap, found ${state.modelToModeGap}px.`);
            ctx.assert(state.controlPaddings.every((padding) => padding[0] === "8px" && padding[1] === "8px"), "Composer controls should keep 8px horizontal hover padding.");
            ctx.assert(state.tabs.length === 4, `Expected four mode tabs, found ${state.tabs.length}.`);
            ctx.assert(state.selectedTabCount === 1, `Expected one selected mode tab, found ${state.selectedTabCount}.`);
            ctx.assert(Boolean(state.modeIndicatorBackground), "The selected mode should keep a visible shared indicator.");
            ctx.assert(state.motionSampleCount > 3, "The mode switch should be sampled across multiple animation frames.");
            ctx.assert(state.motionSampleRange >= 80, `The shared indicator should travel between tabs; found ${state.motionSampleRange}px.`);
            ctx.assert(state.motionDistinctPositions > 3, "The mode indicator should use spring motion instead of jumping instantly.");
            ctx.assert(state.placeholder.length > 0, "The unified composer placeholder should be visible.");
            ctx.assert(state.placeholderColor === state.placeholderTargetColor, "The composer placeholder should use the lighter slate-10 semantic color.");
            ctx.assert(state.modelBackground === "rgba(0, 0, 0, 0)", "The model control should have no default background.");
            ctx.assert(state.modeBackground === "rgba(0, 0, 0, 0)", "The work-mode control should have no default background.");
            ctx.assert(!state.submitDisabled, "An empty submit should remain actionable instead of looking disabled.");
            ctx.assert(Boolean(state.submitBackground), "The empty submit should keep a visible background.");
            ctx.assert(/Can't find a message to send|找不到要发送的消息/.test(state.hintText), "The empty submit should explain why it cannot send.");
            ctx.assert(state.hintAboveSubmit, "The empty-submit explanation should appear above the send button.");
          },
          screenshot: {
            name: "zero-project-starter-light",
            requireText: ["OpenCode"],
            rejectText: ["Something went wrong", "Ungrouped", "未分组"],
          },
        });
      },
    },
    {
      name: "Create the first project and task",
      run: async (ctx) => {
        await ctx.prove("Sending creates one OpenCode project and selects only its task", {
          voiceover: "输入内容并发送后，不再询问引擎，直接用 OpenCode 生成一个未命名项目和首个任务；新项目立即成为当前项目。",
          action: async () => {
            await setTheme(ctx, "dark");
            await ctx.eval(`(() => {
              window.__projectEngineStarterDefaultWorkspaceId = location.hash.match(/workspace\\/(ws_[^/]+)/)?.[1] || '';
              return true;
            })()`);
            await typeDraft(ctx);
            await submitDraft(ctx);
            await ctx.waitFor("!document.querySelector('[data-testid=initial-project-engine-dialog]')", {
              timeoutMs: 10_000,
              label: "no first-use engine dialog",
            });
            await ctx.waitFor(`(() => {
              const project = document.querySelector('[data-testid=project-row]');
              const projectId = project?.getAttribute('data-project-id') || '';
              return projectId
                && location.hash.includes(projectId)
                && /session\\/ses_/.test(location.hash)
                && project?.getAttribute('data-selected') === 'false'
                && Boolean(document.querySelector('[data-sidebar=menu-sub-button][data-active]'))
                && Boolean(document.querySelector('[data-testid=composer-context-health]'));
            })()`, {
              timeoutMs: 120_000,
              label: "first project task with preserved draft",
            });
            await ctx.eval(`document.querySelector('[data-testid=composer-context-health]')?.click()`);
            await ctx.waitFor(`document.body.innerText.includes('Context health') || document.body.innerText.includes('上下文体检')`, {
              timeoutMs: 10_000,
              label: "context health details",
            });
            await ctx.eval(`document.querySelector('[data-testid=session-header-project]')?.click()`);
            await ctx.waitFor(`(() => {
              const projectName = document.querySelector('[data-testid=session-header-project]')?.getAttribute('aria-label') || '';
              return [...document.querySelectorAll('[data-slot=tooltip-content]')]
                .some((tooltip) => tooltip.textContent?.trim() === projectName);
            })()`, {
              timeoutMs: 10_000,
              label: "project name tooltip",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(async () => {
              const project = document.querySelector('[data-testid=project-row]');
              const selectedConversation = document.querySelector('[data-sidebar=menu-sub-button][data-active]');
              const projectId = project?.getAttribute('data-project-id') || '';
              const headerProject = document.querySelector('[data-testid=session-header-project]');
              const headerActions = document.querySelector('[data-testid=session-header-actions]');
              const header = headerActions?.closest('header');
              const actionsRect = headerActions?.getBoundingClientRect();
              const headerRect = header?.getBoundingClientRect();
              const headerProjectIcon = headerProject?.querySelector('img');
              const sidebarProjectIcon = project?.querySelector('img');
              const projectTarget = document.createElement('span');
              projectTarget.className = 'bg-sidebar-accent mac:bg-black/5 dark:mac:bg-white/10';
              document.body.append(projectTarget);
              const projectTargetBackground = getComputedStyle(projectTarget).backgroundColor;
              projectTarget.remove();
              const baseUrl = localStorage.getItem('ipollowork.server.urlOverride');
              const token = localStorage.getItem('ipollowork.server.token');
              const response = await fetch(baseUrl + '/workspace/' + projectId + '/sessions', {
                headers: { authorization: 'Bearer ' + token },
              });
              const sessions = await response.json();
              return {
                projectCount: document.querySelectorAll('[data-testid=project-row]').length,
                selectedProjectId: projectId,
                defaultWorkspaceId: window.__projectEngineStarterDefaultWorkspaceId,
                route: location.hash,
                taskCount: sessions.items?.length || 0,
                contextHealthHeight: document.querySelector('[data-testid=composer-context-health]')?.getBoundingClientRect().height || 0,
                contextInsideHeader: Boolean(document.querySelector('[data-testid=composer-context-health]')?.closest('header')),
                contextInsideComposer: Boolean(document.querySelector('[data-testid=composer-context-health]')?.closest('[data-session-surface-id]')),
                contextHealthLabel: document.querySelector('[data-testid=composer-context-health]')?.getAttribute('aria-label') || '',
                contextEngineId: document.querySelector('[data-testid=composer-context-health]')?.getAttribute('data-engine-id') || '',
                projectName: project?.innerText.trim() || '',
                headerProjectName: headerProject?.getAttribute('aria-label') || '',
                headerProjectIcon: headerProjectIcon?.getAttribute('src') || '',
                sidebarProjectIcon: sidebarProjectIcon?.getAttribute('src') || '',
                projectSelected: project?.getAttribute('data-selected') || '',
                selectedConversationCount: document.querySelectorAll('[data-sidebar=menu-sub-button][data-active]').length,
                projectBackground: project ? getComputedStyle(project).backgroundColor : '',
                selectedConversationBackground: selectedConversation ? getComputedStyle(selectedConversation).backgroundColor : '',
                projectTargetBackground,
                headerActionsRightInset: actionsRect && headerRect ? headerRect.right - actionsRect.right : Number.POSITIVE_INFINITY,
                tooltipTexts: [...document.querySelectorAll('[data-slot=tooltip-content]')].map((tooltip) => tooltip.textContent?.trim() || ''),
              };
            })()`, { awaitPromise: true });
            ctx.assert(state.projectCount === 1, `Expected one named project, found ${state.projectCount}.`);
            ctx.assert(state.selectedProjectId !== state.defaultWorkspaceId, "The new named project should replace the default workspace as current.");
            ctx.assert(state.route.includes(state.selectedProjectId), "The route should point to the selected project.");
            ctx.assert(state.taskCount === 1, `Expected one first task, found ${state.taskCount}.`);
            ctx.assert(state.contextHealthHeight === 32, `Expected a 32px context-health control, found ${state.contextHealthHeight}px.`);
            ctx.assert(!state.contextInsideHeader, "Context health should not render in the navigation header.");
            ctx.assert(state.contextInsideComposer, "Context health should render inside the session composer.");
            ctx.assert(state.contextEngineId === "", "Context health should not expose the former engine identity attribute.");
            ctx.assert(/Context health|上下文体检/.test(state.contextHealthLabel), "The composer should expose context usage and model capacity.");
            ctx.assert(state.headerProjectName === state.projectName, "The header project button should expose the selected project name.");
            ctx.assert(state.headerProjectIcon === state.sidebarProjectIcon, "The header and sidebar should use the same project folder icon.");
            ctx.assert(state.projectSelected === "false", "The project should not remain selected while one of its conversations is selected.");
            ctx.assert(state.selectedConversationCount === 1, `Exactly one conversation should be selected, found ${state.selectedConversationCount}.`);
            ctx.assert(state.selectedConversationBackground === state.projectTargetBackground, "Project and conversation selections should share the same semantic color.");
            ctx.assert(state.projectBackground !== state.selectedConversationBackground, "Only the conversation should show a selected background.");
            ctx.assert(state.headerActionsRightInset <= 32, `Header actions should stay on the right; found ${state.headerActionsRightInset}px inset.`);
            ctx.assert(state.tooltipTexts.includes(state.projectName), "Clicking the project icon should show the project name.");
          },
          screenshot: {
            name: "first-project-task-created-dark",
            rejectText: ["Something went wrong", "Ungrouped", "未分组"],
          },
        });

        await ctx.eval(`(() => {
          window.__projectEngineStarterOriginalFetch = window.fetch.bind(window);
          window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            const method = (init?.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
            if (url.endsWith('/opencode/session') && method === 'POST') return new Promise(() => {});
            return window.__projectEngineStarterOriginalFetch(input, init);
          };
          return true;
        })()`);
        try {
          await ctx.prove("Selecting the project clears the task selection", {
            voiceover: "点击项目后只高亮项目，会话取消选中；两种选中状态使用同一种灰色，项目行和会话行之间保持两像素间距。",
            action: async () => {
              await ctx.eval(`document.querySelector('[data-testid=project-row]')?.click()`);
              await ctx.waitFor(`(() => {
                const project = document.querySelector('[data-testid=project-row]');
                return project?.getAttribute('data-selected') === 'true'
                  && document.querySelectorAll('[data-sidebar=menu-sub-button][data-active]').length === 0;
              })()`, {
                timeoutMs: 10_000,
                label: "project-only selection",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const project = document.querySelector('[data-testid=project-row]');
                const target = document.createElement('span');
                target.className = 'bg-sidebar-accent mac:bg-black/5 dark:mac:bg-white/10';
                document.body.append(target);
                const targetBackground = getComputedStyle(target).backgroundColor;
                target.remove();
                const firstConversation = document.querySelector('[data-sidebar=menu-sub-button]');
                const projectRect = project?.getBoundingClientRect();
                const conversationRect = firstConversation?.getBoundingClientRect();
                return {
                  projectSelected: project?.getAttribute('data-selected') || '',
                  selectedConversations: document.querySelectorAll('[data-sidebar=menu-sub-button][data-active]').length,
                  projectBackground: project ? getComputedStyle(project).backgroundColor : '',
                  targetBackground,
                  rowGap: projectRect && conversationRect ? conversationRect.top - projectRect.bottom : Number.NaN,
                };
              })()`);
              ctx.assert(state.projectSelected === "true", "The project should become the only selected item.");
              ctx.assert(state.selectedConversations === 0, "Selecting the project should clear the task selection.");
              ctx.assert(state.projectBackground === state.targetBackground, "The project should use the same semantic selection gray as a task.");
              ctx.assert(state.rowGap === 2, `Expected a 2px gap between the project and first task, found ${state.rowGap}px.`);
            },
            screenshot: {
              name: "project-only-selection-dark",
              rejectText: ["Something went wrong", "Ungrouped", "未分组"],
            },
          });
        } finally {
          await ctx.eval(`(() => {
            if (window.__projectEngineStarterOriginalFetch) window.fetch = window.__projectEngineStarterOriginalFetch;
            return true;
          })()`);
        }
      },
    },
  ],
};
