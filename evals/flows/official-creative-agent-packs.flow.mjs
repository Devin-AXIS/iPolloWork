import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("official-creative-agent-packs");
const DESIGN_TOGGLE = '[role="switch"][aria-label*="Design Studio"]';
const VIDEO_TOGGLE = '[role="switch"][aria-label*="Video Studio"]';

let sessionRoute = "";
let videoSessionRoute = "";
let videoProjectRoute = "";

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await closeWorkspaceOverlay(ctx);
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "create task action",
  });
  await ctx.control("session.create_task");
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes("/session/")`, {
    timeoutMs: 60_000,
    label: "active task",
  });
  sessionRoute = await ctx.eval("window.__ipolloworkControl.snapshot().route");
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

async function openCreativeEntryMenu(ctx) {
  await closeWorkspaceOverlay(ctx);
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  const launcherExpression = `(() => {
    const labels = [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? '');
    return labels.includes('Design') && (labels.includes('视频') || labels.includes('Video'));
  })()`;
  await ctx.waitFor(`${launcherExpression} || Boolean([...document.querySelectorAll('button')].find((entry) =>
    ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel', '打开右侧面板', 'Open right panel'].includes(entry.getAttribute('aria-label') ?? '')
  ))`, { timeoutMs: 30_000, label: "creative side panel launcher" });
  let launcherVisible = await ctx.eval(launcherExpression);
  if (launcherVisible) return;
  const hasAddEntry = await ctx.eval(`Boolean([...document.querySelectorAll('button')].find((entry) =>
    ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? '')
  ))`);
  if (!hasAddEntry) {
    await ctx.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find((entry) =>
        ['打开右侧面板', 'Open right panel'].includes(entry.getAttribute('aria-label') ?? '')
      );
      button?.click();
    })()`);
    await ctx.waitFor(`${launcherExpression} || Boolean([...document.querySelectorAll('button')].find((entry) =>
      ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? '')
    ))`, { timeoutMs: 30_000, label: "side panel entry control" });
    launcherVisible = await ctx.eval(launcherExpression);
    if (launcherVisible) return;
  }
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) =>
      ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? '')
    );
    button?.click();
  })()`);
  await ctx.waitFor(`(() => {
    const labels = [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? '');
    return labels.includes('Design') && (labels.includes('视频') || labels.includes('Video'));
  })()`, { timeoutMs: 30_000, label: "Design and Video entries" });
}

async function creativeEntriesAvailable(ctx) {
  await openCreativeEntryMenu(ctx);
  const available = await ctx.eval(`(() => {
    const labels = [...document.querySelectorAll('[role="menuitem"], button')].map((entry) => entry.textContent?.trim() ?? '');
    return labels.includes('Design') && (labels.includes('视频') || labels.includes('Video'));
  })()`);
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  return available;
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
  await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });
}

async function clickPackageAction(ctx, packageName, labels) {
  const clicked = await ctx.eval(`(() => {
    const labels = ${JSON.stringify(labels)};
    const title = [...document.querySelectorAll('*')].find((candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
    );
    let parent = title?.parentElement;
    let button;
    for (let depth = 0; parent && depth < 4 && !button; depth += 1, parent = parent.parentElement) {
      button = [...parent.querySelectorAll('button')].find((candidate) =>
        labels.includes(candidate.textContent?.trim() ?? '') && !candidate.disabled
      );
    }
    button?.scrollIntoView({ block: 'center' });
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, `Could not find ${packageName} action: ${labels.join(", ")}`);
}

async function installPackage(ctx, packageName) {
  const alreadyInstalled = await ctx.eval(`(() => {
    const title = [...document.querySelectorAll('*')].find((candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
    );
    let parent = title?.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      if ([...parent.querySelectorAll('button')].some((candidate) => ['打开', 'Open'].includes(candidate.textContent?.trim() ?? ''))) return true;
    }
    return false;
  })()`);
  if (!alreadyInstalled) {
    await clickPackageAction(ctx, packageName, ["安装", "Install"]);
    await ctx.waitFor(`(() => {
      const title = [...document.querySelectorAll('*')].find((candidate) =>
        candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
      );
      let parent = title?.parentElement;
      for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
        if ([...parent.querySelectorAll('button')].some((candidate) => ['打开', 'Open'].includes(candidate.textContent?.trim() ?? ''))) return true;
      }
      return false;
    })()`, { timeoutMs: 45_000, label: `${packageName} installed` });
  }
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

async function removePackageIfInstalled(ctx, pluginId, packageName) {
  const installed = await ctx.eval(`(() => {
    const title = [...document.querySelectorAll('*')].find((candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === ${JSON.stringify(packageName)}
    );
    let parent = title?.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      if ([...parent.querySelectorAll('button')].some((candidate) => ['打开', 'Open'].includes(candidate.textContent?.trim() ?? ''))) return true;
    }
    return false;
  })()`);
  if (installed) await removeInstalledPackage(ctx, pluginId);
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
    const templateId = 'ipollowork.html-anything.video-hyperframes';
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
    return { ok: body?.manifest?.surface === 'video', surface: body?.manifest?.surface ?? null };
  })()`, { awaitPromise: true });
  ctx.assert(result.ok, `Could not materialize the bundled Video template: ${JSON.stringify(result)}`);
  await ctx.eval("location.reload(); true");
  await new Promise((resolve) => setTimeout(resolve, 800));
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded Video task" });
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route === ${JSON.stringify(videoSessionRoute)}`, {
    timeoutMs: 60_000,
    label: "materialized Video task route",
  });
  await ctx.waitFor(`document.body.innerText.includes('开始制作视频') || document.body.innerText.includes('Start making video')`, {
    timeoutMs: 60_000,
    label: "materialized Video template",
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function openVideoStudio(ctx) {
  await closeWorkspaceOverlay(ctx);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const alreadyOpen = await ctx.eval(`Boolean(document.querySelector('[data-testid="video-panel"]'))`);
  if (!alreadyOpen) {
    await openCreativeEntryMenu(ctx);
    const restoredWhileOpening = await ctx.eval(`Boolean(document.querySelector('[data-testid="video-panel"]'))`);
    if (!restoredWhileOpening) {
      await ctx.waitFor(`(() => {
        const entries = [...document.querySelectorAll('[role="menuitem"], button')];
        return entries.some((entry) => ['视频', 'Video'].includes(entry.textContent?.trim() ?? '') && !entry.disabled);
      })()`, { timeoutMs: 30_000, label: "Video side panel entry" });
      await ctx.eval(`(() => {
        const entries = [...document.querySelectorAll('[role="menuitem"], button')];
        const entry = entries.findLast((candidate) => ['视频', 'Video'].includes(candidate.textContent?.trim() ?? '') && !candidate.disabled);
        entry?.setAttribute('data-fraimz-video-entry', 'true');
      })()`);
      await ctx.trustedClick('[data-fraimz-video-entry="true"]');
    }
  }
  await ctx.waitFor(`document.querySelector('[data-testid="video-panel"] iframe')?.dataset.loaded === "true"`, {
    timeoutMs: 60_000,
    label: "ready Video Studio",
  });
  const source = await ctx.eval(`document.querySelector('[data-testid="video-panel"] iframe')?.getAttribute('src') ?? ''`);
  const marker = source.indexOf("?");
  return marker === -1 ? source : source.slice(0, marker);
}

export default {
  id: "official-creative-agent-packs",
  title: "Official creative Skills stay manageable without changing Design or Video Studio",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" },
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the creative agent flow can run."
      : null;
  },
  steps: [
    {
      name: "Official creative packages appear without replacing task tools",
      run: async (ctx) => {
        await ctx.prove("Design Agent and Video Agent appear as official packages while the existing task tools remain available", {
          voiceover: vo[0],
          action: async () => {
            await ensureSession(ctx);
            const toolsAvailable = await creativeEntriesAvailable(ctx);
            ctx.assert(toolsAvailable, "Design or Video side panel entry was unavailable before opening settings.");
            await openPluginList(ctx);
            await removePackageIfInstalled(ctx, "design-agent", "iPolloWork Design Agent");
            await openPluginList(ctx);
            await removePackageIfInstalled(ctx, "video-agent", "iPolloWork Video Agent");
            await openPluginList(ctx);
            await ctx.waitForText("iPolloWork Design Agent", { timeoutMs: 30_000 });
            await ctx.waitForText("iPolloWork Video Agent", { timeoutMs: 30_000 });
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
      name: "Design skills are independently manageable",
      run: async (ctx) => {
        await ctx.prove("Design Agent groups two official Skills and lets one be disabled independently", {
          voiceover: vo[1],
          action: async () => {
            await installPackage(ctx, "iPolloWork Design Agent");
            await ctx.navigateHash("/settings/extensions/plugin/design-agent");
            await ctx.waitFor(`document.body.innerText.includes('技能 2') || document.body.innerText.includes('Skills 2')`, {
              timeoutMs: 30_000,
              label: "Design Agent detail",
            });
            await setSkillEnabled(ctx, DESIGN_TOGGLE, false);
          },
          assert: async () => {
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
        await ctx.prove("The built-in Design editor and its existing project controls do not depend on the Design Agent Skill", {
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
      name: "Video Studio still opens after its Skill package is removed",
      run: async (ctx) => {
        await ctx.prove("Video Agent can be removed while the built-in HyperFrames Studio and session project remain available", {
          voiceover: vo[3],
          action: async () => {
            await ctx.navigateHash(sessionRoute);
            await closeWorkspaceOverlay(ctx);
            await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "create Video task action",
            });
            await ctx.control("session.create_task");
            await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes('/session/') && window.__ipolloworkControl.snapshot().route !== ${JSON.stringify(sessionRoute)}`, {
              timeoutMs: 60_000,
              label: "new Video task",
            });
            videoSessionRoute = await ctx.eval("window.__ipolloworkControl.snapshot().route");
            await materializeVideoTemplate(ctx);
            videoProjectRoute = await openVideoStudio(ctx);
            await openPluginList(ctx);
            await installPackage(ctx, "iPolloWork Video Agent");
            await ctx.navigateHash("/settings/extensions/plugin/video-agent");
            await ctx.waitFor(`document.body.innerText.includes('技能 2') || document.body.innerText.includes('Skills 2')`, {
              timeoutMs: 30_000,
              label: "Video Agent detail",
            });
            await setSkillEnabled(ctx, VIDEO_TOGGLE, false);
            await removeInstalledPackage(ctx, "video-agent");
            await ctx.navigateHash(videoSessionRoute);
            const reopenedVideoRoute = await openVideoStudio(ctx);
            ctx.assert(reopenedVideoRoute === videoProjectRoute, `Video project changed after removing its Skills: ${videoProjectRoute} -> ${reopenedVideoRoute}`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: Boolean(document.querySelector('[data-testid="video-panel"] iframe')),
            }))()`);
            ctx.assert(state.iframe, `Video Studio regressed after removing its Skills: ${JSON.stringify(state)}`);
            ctx.assert(videoProjectRoute.includes("/#project/"), `Video project route is wrong: ${videoProjectRoute}`);
          },
          screenshot: {
            name: "video-core-unchanged",
            requireText: ["视频工作室", "就绪"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Reinstalling Skills restores capability without replacing projects",
      run: async (ctx) => {
        await ctx.prove("Reinstalling the official Skills restores them while the same Design and Video projects remain openable", {
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
            ctx.assert(restoredDesignSkill === "true", `Design Studio Skill was not restored: ${restoredDesignSkill}`);
            await ctx.navigateHash(videoSessionRoute);
            const reopenedVideoRoute = await openVideoStudio(ctx);
            ctx.assert(reopenedVideoRoute === videoProjectRoute, `Video project changed after reinstall: ${videoProjectRoute} -> ${reopenedVideoRoute}`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              iframe: Boolean(document.querySelector('[data-testid="video-panel"] iframe')),
            }))()`);
            ctx.assert(state.iframe, `Creative projects were not restored: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "creative-projects-preserved",
            requireText: ["视频工作室", "就绪"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
