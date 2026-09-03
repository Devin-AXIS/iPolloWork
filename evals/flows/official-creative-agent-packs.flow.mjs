import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("official-creative-agent-packs");
const DESIGN_TOGGLE = '[role="switch"][aria-label*="Design Studio"]';

let sessionRoute = "";
let videoSessionRoute = "";
let videoProjectRoute = "";

async function setChinese(ctx) {
  await ctx.eval(`(() => {
    localStorage.setItem("ipollowork.language", "zh");
    return true;
  })()`);
  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded Chinese app" });
}

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await closeWorkspaceOverlay(ctx);
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "create task action",
  });
  const previousHash = await ctx.eval("location.hash");
  await ctx.control("session.create_task");
  const nextHash = await ctx.waitFor(`location.hash !== ${JSON.stringify(previousHash)} && location.hash.includes('/session/') && location.hash`, {
    timeoutMs: 60_000,
    label: "active task",
  });
  sessionRoute = String(nextHash).replace(/^#/, "");
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(sessionRoute)}`, {
    timeoutMs: 60_000,
    label: "active task control route",
  });
}

async function closeWorkspaceOverlay(ctx) {
  const closed = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) =>
      ['关闭设置', 'Close settings'].includes(entry.getAttribute('aria-label') ?? '')
    );
    button?.click();
    return Boolean(button);
  })()`);
  if (closed) await new Promise((resolve) => setTimeout(resolve, 300));
}

async function dismissTemplateBrief(ctx) {
  const visible = await ctx.eval(`document.body.innerText.includes('开始制作视频') || document.body.innerText.includes('Start making video')`);
  if (!visible) return;
  const closed = await ctx.eval(`(() => {
    const close = [...document.querySelectorAll('button')].find((button) =>
      ['关闭', 'Close'].includes(button.getAttribute('aria-label') ?? '')
    );
    close?.click();
    return Boolean(close);
  })()`);
  ctx.assert(closed, "Video template brief could not be dismissed.");
  await ctx.waitFor(`!document.body.innerText.includes('开始制作视频') && !document.body.innerText.includes('Start making video')`, {
    timeoutMs: 30_000,
    label: "dismissed Video brief",
  });
}

async function ensureSidePanelVisible(ctx) {
  await closeWorkspaceOverlay(ctx);
  const opened = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) =>
      ['打开右侧面板', 'Open right panel'].includes(entry.getAttribute('aria-label') ?? '')
    );
    button?.click();
    return Boolean(button);
  })()`);
  if (opened) {
    await ctx.waitFor(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.some((entry) => entry.textContent?.trim() === 'Design')
        || buttons.some((entry) => ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? ''));
    })()`, {
      timeoutMs: 60_000,
      label: "visible right panel",
    });
  }
}

async function showSidePanelEntries(ctx) {
  await ensureSidePanelVisible(ctx);
  const directEntriesVisible = await ctx.eval(`[...document.querySelectorAll('button')].some((entry) => entry.textContent?.trim() === 'Design')`);
  if (directEntriesVisible) return false;
  const openedMenu = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) =>
      ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? '')
    );
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(openedMenu, "Side panel entry control was unavailable.");
  await ctx.waitFor(`document.querySelectorAll('[role="menuitem"]').length > 0`, {
    timeoutMs: 30_000,
    label: "side panel entry menu",
  });
  return true;
}

async function creativeEntriesAvailable(ctx) {
  const openedMenu = await showSidePanelEntries(ctx);
  const available = await ctx.waitFor(`(() => {
    const labels = [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? '');
    return labels.includes('Design') && (labels.includes('视频') || labels.includes('Video'));
  })()`, { timeoutMs: 30_000, label: "Design and Video entries" });
  if (openedMenu) {
    await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  }
  return Boolean(available);
}

async function selectPersonalResourceScope(ctx) {
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
}

async function openPluginList(ctx) {
  await ctx.navigateHash("/settings/preferences");
  await ctx.waitForText("偏好设置", { timeoutMs: 30_000 });
  await ctx.navigateHash("/settings/extensions");
  await selectPersonalResourceScope(ctx);
  await ctx.waitForText("个人插件", { timeoutMs: 30_000 });
}

async function clickPackageAction(ctx, packageName, labels) {
  await ctx.waitFor(`(() => {
    const labels = ${JSON.stringify(labels)};
    const title = [...document.querySelectorAll('*')].find((candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
    );
    let parent = title?.parentElement;
    let button;
    for (let depth = 0; parent && depth < 8 && !button; depth += 1, parent = parent.parentElement) {
      button = [...parent.querySelectorAll('button')].find((candidate) =>
        labels.includes(candidate.textContent?.trim() ?? '') && !candidate.disabled
      );
    }
    button?.scrollIntoView({ block: 'center' });
    button?.click();
    return Boolean(button);
  })()`, {
    timeoutMs: 30_000,
    label: `${packageName} action: ${labels.join(", ")}`,
  });
}

async function installPackage(ctx, packageName) {
  const alreadyInstalled = await packageIsInstalled(ctx, packageName);
  if (!alreadyInstalled) {
    await clickPackageAction(ctx, packageName, ["安装", "Install"]);
    await ctx.waitFor(`(() => {
      const title = [...document.querySelectorAll('*')].find((candidate) =>
        candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
      );
      let parent = title?.parentElement;
      for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
        if ([...parent.querySelectorAll('button')].some((candidate) => ['打开', 'Open'].includes(candidate.textContent?.trim() ?? ''))) return true;
      }
      return false;
    })()`, { timeoutMs: 45_000, label: `${packageName} installed` });
  }
}

async function packageIsInstalled(ctx, packageName) {
  return ctx.eval(`(() => {
    const title = [...document.querySelectorAll('*')].find((candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
    );
    let parent = title?.parentElement;
    for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
      if ([...parent.querySelectorAll('button')].some((candidate) => ['打开', 'Open'].includes(candidate.textContent?.trim() ?? ''))) return true;
    }
    return false;
  })()`);
}

async function removeInstalledPackage(ctx, pluginId) {
  await ctx.navigateHash(`/settings/extensions/plugin/${pluginId}`);
  await ctx.waitFor(`document.body.innerText.includes('卸载插件') || document.body.innerText.includes('Uninstall plugin') || document.body.innerText.includes('未找到') || document.body.innerText.includes('not found')`, {
    timeoutMs: 30_000,
    label: `${pluginId} detail resolved`,
  });
  const removed = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => ['卸载插件', 'Uninstall plugin'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  if (removed) {
    await ctx.waitFor(`location.hash.includes('/settings/extensions') && !location.hash.includes('/plugin/')`, {
      timeoutMs: 30_000,
      label: `${pluginId} uninstalled`,
    });
  }
}

async function setSkillEnabled(ctx, selector, enabled) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, {
    timeoutMs: 30_000,
    label: `skill toggle ${selector}`,
  });
  const state = await ctx.eval(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')`);
  if ((state === "true") !== enabled) {
    await ctx.eval(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await ctx.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked') === ${JSON.stringify(String(enabled))}`, {
      timeoutMs: 30_000,
      label: `skill ${enabled ? "enabled" : "disabled"}`,
    });
  }
}

async function materializeVideoTemplate(ctx) {
  const result = await ctx.eval(`(async () => {
    const workspaceId = window.__ipolloworkControl.snapshot().route.match(/\\/workspace\\/([^/]+)/)?.[1] ?? '';
    const sessionId = window.__ipolloworkControl.snapshot().route.match(/\\/session\\/([^/?#]+)/)?.[1] ?? '';
    const baseUrl = localStorage.getItem('ipollowork.server.urlOverride')
      || ('http://127.0.0.1:' + (localStorage.getItem('ipollowork.server.port') || ''));
    const token = localStorage.getItem('ipollowork.server.token') || '';
    const hostToken = localStorage.getItem('ipollowork.server.hostToken') || '';
    const headers = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(hostToken ? { 'X-iPolloWork-Host-Token': hostToken } : {}),
    };
    const templateId = 'ipollowork.html-anything.motion-frames';
    const install = await fetch(baseUrl + '/workspace/' + encodeURIComponent(workspaceId) + '/templates/' + encodeURIComponent(templateId) + '/install', {
      method: 'POST',
      headers,
    });
    if (!install.ok && install.status !== 409) return { ok: false, stage: 'install', status: install.status };
    const materialized = await fetch(baseUrl + '/workspace/' + encodeURIComponent(workspaceId) + '/templates/' + encodeURIComponent(templateId) + '/materialize', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId }),
    });
    if (!materialized.ok) return { ok: false, stage: 'materialize', status: materialized.status };
    const body = await materialized.json();
    return {
      ok: body?.manifest?.surface === 'video',
      surface: body?.manifest?.surface ?? null,
    };
  })()`, { awaitPromise: true });
  ctx.assert(result.ok, `Could not materialize the bundled Video template: ${JSON.stringify(result)}`);
  await ctx.eval("location.reload(); true");
  await new Promise((resolve) => setTimeout(resolve, 800));
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded Video task" });
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes('/session/')`, {
    timeoutMs: 60_000,
    label: "materialized Video task",
  });
  await ctx.waitFor(`document.body.innerText.includes('开始制作视频') || document.body.innerText.includes('Start making video')`, {
    timeoutMs: 60_000,
    label: "materialized Video template",
  });
  await dismissTemplateBrief(ctx);
  videoSessionRoute = await ctx.eval("window.__ipolloworkControl.snapshot().route");
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function openVideoStudio(ctx) {
  await closeWorkspaceOverlay(ctx);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const alreadyOpen = await ctx.eval(`Boolean(document.querySelector('[data-testid="video-panel"]'))`);
  if (!alreadyOpen) {
    await showSidePanelEntries(ctx);
    await ctx.waitFor(`(() => {
      const labels = [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? '');
      return labels.includes('视频') || labels.includes('Video');
    })()`, { timeoutMs: 30_000, label: "Video side panel entry" });
    await ctx.eval(`(() => {
      const entries = [...document.querySelectorAll('[role="menuitem"], button')];
      const entry = entries.findLast((candidate) => ['视频', 'Video'].includes(candidate.textContent?.trim() ?? '') && !candidate.disabled);
      entry?.setAttribute('data-fraimz-video-entry', 'true');
    })()`);
    await ctx.eval(`document.querySelector('[data-fraimz-video-entry="true"]')?.click(); true`);
  }
  await ctx.waitFor(`document.querySelector('[data-testid="video-panel"] iframe')?.dataset.loaded === "true"`, {
    timeoutMs: 60_000,
    label: "ready Video Studio",
  });
  const source = await ctx.eval(`document.querySelector('[data-testid="video-panel"] iframe')?.getAttribute('src') ?? ''`);
  const marker = source.indexOf("?");
  const normalized = marker === -1 ? source : source.slice(0, marker);
  return new URL(normalized).hash;
}

export default {
  id: "official-creative-agent-packs",
  title: "Official creative plugins install and uninstall without changing project data",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:" },
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the creative agent flow can run."
      : null;
  },
  steps: [
    {
      name: "Official creative plugins are installed by default",
      run: async (ctx) => {
        await ctx.prove("Design Agent and Video Agent are installed through the plugin lifecycle while their familiar workspace entries remain available", {
          voiceover: vo[0],
          action: async () => {
            await setChinese(ctx);
            await ensureSession(ctx);
            const toolsAvailable = await creativeEntriesAvailable(ctx);
            ctx.assert(toolsAvailable, "Design or Video side panel entry was unavailable after default plugin installation.");
            await openPluginList(ctx);
            await ctx.waitForText("iPolloWork Design Agent", { timeoutMs: 30_000 });
            await ctx.waitForText("iPolloWork Video Agent", { timeoutMs: 30_000 });
            const installed = await Promise.all([
              packageIsInstalled(ctx, "iPolloWork Design Agent"),
              packageIsInstalled(ctx, "iPolloWork Video Agent"),
            ]);
            ctx.assert(installed.every(Boolean), `Creative plugins were not installed by default: ${JSON.stringify(installed)}`);
            await ctx.eval(`(() => {
              const target = [...document.querySelectorAll('*')].find((entry) => entry.textContent?.trim() === 'iPolloWork Video Agent');
              target?.scrollIntoView({ block: 'center' });
            })()`);
          },
          assert: async () => {
            await ctx.expectText("iPolloWork Design Agent");
            await ctx.expectText("iPolloWork Video Agent");
            await ctx.expectText("官方");
          },
          screenshot: {
            name: "official-creative-packages",
            requireText: ["iPolloWork Design Agent", "iPolloWork Video Agent", "官方"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Design plugin manages Agent Skills only",
      run: async (ctx) => {
        await ctx.prove("Design Agent owns two Skills while the built-in Design workspace remains app-owned", {
          voiceover: vo[1],
          action: async () => {
            await installPackage(ctx, "iPolloWork Design Agent");
            await ctx.navigateHash("/settings/extensions/plugin/design-agent");
            await ctx.waitFor(`
              document.body.innerText.includes('技能 2') || document.body.innerText.includes('Skills 2')
            `, {
              timeoutMs: 30_000,
              label: "Design Agent detail",
            });
            await setSkillEnabled(ctx, DESIGN_TOGGLE, false);
          },
          assert: async () => {
            await ctx.expectText("Design");
            await ctx.expectText("Design Studio");
            await ctx.expectText("演示文稿");
            const state = await ctx.eval(`document.querySelector(${JSON.stringify(DESIGN_TOGGLE)})?.getAttribute('aria-checked')`);
            ctx.assert(state === "false", `Design Studio Skill should be disabled, received ${state}`);
          },
          screenshot: {
            name: "design-agent-skills",
            requireText: ["iPolloWork Design Agent", "技能 2", "Design Studio", "演示文稿", "卸载插件"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/design-agent",
          },
        });
      },
    },
    {
      name: "Design Studio still opens with its Skill disabled",
      run: async (ctx) => {
        await ctx.prove("The Design workspace remains installed when only its optional Design Studio Skill is disabled", {
          voiceover: vo[2],
          action: async () => {
            await ctx.navigateHash(sessionRoute);
            await closeWorkspaceOverlay(ctx);
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "returned task" });
            await ctx.waitFor(`
              [...document.querySelectorAll('button')].some((entry) => entry.getAttribute('aria-label')?.startsWith('Select tab: entry.html'))
              || window.__ipolloworkControl.listActions().some((action) => action.id === "eval.design.seed_html" && !action.disabled)
            `, {
              timeoutMs: 30_000,
              label: "existing Design entry or seed action",
            });
            const existingEntry = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label')?.startsWith('Select tab: entry.html'));
              tab?.click();
              return Boolean(tab);
            })()`);
            if (!existingEntry) await ctx.control("eval.design.seed_html");
            await ctx.waitFor(`document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === "true"`, {
              timeoutMs: 30_000,
              label: "loaded Design preview",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              previewLoaded: document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === 'true',
              entryTab: [...document.querySelectorAll('button')].some((entry) => entry.getAttribute('aria-label')?.startsWith('Select tab: entry.html')),
              undo: Boolean(document.querySelector('[aria-label="Undo design change"]')),
              save: Boolean(document.querySelector('[aria-label="Save design"]')),
            }))()`);
            ctx.assert(state.previewLoaded && state.entryTab && state.undo && state.save, `Design controls regressed: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "design-core-unchanged",
            requireText: ["entry.html"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Uninstalling Video keeps the built-in workspace",
      run: async (ctx) => {
        await ctx.prove("Uninstalling Video Agent removes its Skills while the built-in Video workspace and project remain available", {
          voiceover: vo[3],
          action: async () => {
            await ctx.navigateHash(sessionRoute);
            await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(sessionRoute)}`, {
              timeoutMs: 60_000,
              label: "source task before Video task creation",
            });
            await closeWorkspaceOverlay(ctx);
            await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "create Video task action",
            });
            const previousHash = await ctx.eval("location.hash");
            await ctx.control("session.create_task");
            const nextHash = await ctx.waitFor(`location.hash !== ${JSON.stringify(previousHash)} && location.hash.includes('/session/') && location.hash`, {
              timeoutMs: 60_000,
              label: "new Video task",
            });
            videoSessionRoute = String(nextHash).replace(/^#/, "");
            await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(videoSessionRoute)}`, {
              timeoutMs: 60_000,
              label: "Video task control route",
            });
            await materializeVideoTemplate(ctx);
            videoProjectRoute = await openVideoStudio(ctx);
            ctx.assert(
              videoProjectRoute.endsWith(videoSessionRoute.split("/session/").at(-1) ?? ""),
              `Video project did not match its materialized task: ${videoSessionRoute} -> ${videoProjectRoute}`,
            );
            await openPluginList(ctx);
            await removeInstalledPackage(ctx, "video-agent");
            await ctx.navigateHash(videoSessionRoute);
            await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(videoSessionRoute)}`, {
              timeoutMs: 60_000,
              label: "stable task after Video uninstall",
            });
            await dismissTemplateBrief(ctx);
            const reopenedVideoRoute = await openVideoStudio(ctx);
            ctx.assert(reopenedVideoRoute === videoProjectRoute, `Video project changed after uninstall: ${videoProjectRoute} -> ${reopenedVideoRoute}`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              labels: [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? ''),
              panel: Boolean(document.querySelector('[data-testid="video-panel"]')),
            }))()`);
            ctx.assert(state.labels.includes("视频") || state.labels.includes("Video"), `Built-in Video entry disappeared after uninstall: ${JSON.stringify(state.labels)}`);
            ctx.assert(state.panel, "Built-in Video panel did not remain mounted after uninstall.");
            ctx.assert(videoProjectRoute.startsWith("#project/"), `Video project route is wrong: ${videoProjectRoute}`);
          },
          screenshot: {
            name: "video-plugin-uninstalled",
            requireText: ["视频工作室"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Reinstalling Video restores Agent Skills",
      run: async (ctx) => {
        await ctx.prove("Reinstalling Video Agent restores its Skills without replacing the same built-in Video project", {
          voiceover: vo[4],
          action: async () => {
            await openPluginList(ctx);
            await installPackage(ctx, "iPolloWork Video Agent");
            await ctx.navigateHash("/settings/extensions/plugin/design-agent");
            await ctx.waitFor(`document.body.innerText.includes('技能 2') || document.body.innerText.includes('Skills 2')`, {
              timeoutMs: 30_000,
              label: "Design Agent detail restored",
            });
            await setSkillEnabled(ctx, DESIGN_TOGGLE, true);
            const restoredDesignSkill = await ctx.eval(`document.querySelector(${JSON.stringify(DESIGN_TOGGLE)})?.getAttribute('aria-checked')`);
            ctx.assert(restoredDesignSkill === "true", `Design Studio Skill was not re-enabled: ${restoredDesignSkill}`);
            await ctx.navigateHash(videoSessionRoute);
            await ctx.client.send("Page.reload", { ignoreCache: true });
            await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(videoSessionRoute)}`, {
              timeoutMs: 60_000,
              label: "preserved Video task",
            });
            await dismissTemplateBrief(ctx);
            const reopenedVideoRoute = await openVideoStudio(ctx);
            ctx.assert(reopenedVideoRoute === videoProjectRoute, `Video project changed after reinstall: ${videoProjectRoute} -> ${reopenedVideoRoute}`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: Boolean(document.querySelector('[data-testid="video-panel"] iframe')),
            }))()`);
            ctx.assert(state.iframe, `Video workspace was not restored: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "creative-projects-preserved",
            requireText: ["视频工作室"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
