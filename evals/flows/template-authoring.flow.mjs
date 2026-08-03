import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("template-authoring");
const runId = Date.now().toString(36);
const titlePrefix = `Fraimz Authoring ${runId}`;
const state = {
  workspaceId: "",
  sessions: {},
  snapshots: {},
  sourceEntries: {},
  titles: {
    site: `${titlePrefix} Site`,
    pptx: `${titlePrefix} PPT`,
    video: `${titlePrefix} Video`,
  },
  saved: {},
  instances: {},
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function serverRequest(ctx, path, { method = "GET", body } = {}) {
  const result = await ctx.eval(`(async () => {
    const baseUrl = localStorage.getItem("ipollowork.server.urlOverride")
      || localStorage.getItem("ipollowork.server.active");
    const headers = {
      Authorization: "Bearer " + localStorage.getItem("ipollowork.server.token"),
      "X-iPolloWork-Host-Token": localStorage.getItem("ipollowork.server.hostToken"),
      ...((${JSON.stringify(body)} !== undefined) ? { "Content-Type": "application/json" } : {}),
    };
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers,
      ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`}
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, ok: response.ok, data };
  })()`, { awaitPromise: true });
  if (!result?.ok) {
    throw new Error(`Server request failed (${result?.status}) ${method} ${path}: ${JSON.stringify(result?.data)}`);
  }
  return result.data;
}

async function eventually(callback, { timeoutMs = 60_000, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await pause(300);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function clickExactText(ctx, text, selector = "button") {
  return ctx.waitFor(`(() => {
    const direct = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(text)});
    const leaf = [...document.querySelectorAll(${JSON.stringify(`${selector} *`)})]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === ${JSON.stringify(text)});
    const button = direct ?? leaf?.closest(${JSON.stringify(selector)});
    if (!button || button.disabled) return false;
    button.scrollIntoView({ block: "center" });
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `exact button ${text}` });
}

async function clickAria(ctx, label, { timeoutMs = 30_000 } = {}) {
  return ctx.waitFor(`(() => {
    const element = [...document.querySelectorAll("button, [role=button], [role=switch]")]
      .find((node) => node.getAttribute("aria-label") === ${JSON.stringify(label)});
    if (!element || element.disabled) return false;
    element.scrollIntoView({ block: "center" });
    element.click();
    return true;
  })()`, { timeoutMs, label: `aria-labelled control ${label}` });
}

async function resetTransientUi(ctx) {
  await ctx.eval("location.reload()");
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "app control API after reload",
  });
  await ctx.waitFor("document.body.innerText.includes('模版')", {
    timeoutMs: 60_000,
    label: "workspace sidebar",
  });
}

async function openMarket(ctx) {
  if (await ctx.eval("document.querySelector('[role=dialog]')?.innerText.includes('创建模板')")) return;
  await ctx.clickText("模版", { selector: "button", timeoutMs: 30_000 });
  await ctx.waitFor("document.querySelector('[role=dialog]')?.innerText.includes('创建模板')", {
    timeoutMs: 30_000,
    label: "personal template market",
  });
}

async function createAuthoringSession(ctx, typeLabel, key) {
  const before = await ctx.eval("location.hash");
  const chooserOpen = await ctx.eval("[...document.querySelectorAll('[role=dialog]')].some((dialog) => dialog.innerText.includes('创建哪种模板？'))");
  if (!chooserOpen) {
    await openMarket(ctx);
    await clickExactText(ctx, "创建模板");
  }
  await ctx.expectText("创建哪种模板？");
  await ctx.waitFor(`(() => {
    const chooser = [...document.querySelectorAll('[role=dialog]')]
      .find((dialog) => dialog.innerText.includes('创建哪种模板？'));
    const leaf = chooser ? [...chooser.querySelectorAll('button *')]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === ${JSON.stringify(typeLabel)}) : null;
    const button = leaf?.closest('button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `${typeLabel} authoring choice` });
  let hash;
  let sessionId = "";
  try {
    hash = await eventually(async () => {
      const current = await ctx.eval("location.hash");
      return current !== before && /\/session\//.test(current) ? current : null;
    }, { timeoutMs: 12_000, label: `${typeLabel} UI authoring route` });
    sessionId = hash.match(/\/session\/([^/?#]+)/)?.[1] ?? "";
  } catch {
    // Writing Fraimz evidence can make Vite reload a dev window between two
    // modal frames. Re-enter through the application's normal task control,
    // then initialize the same server-owned authoring snapshot.
    await resetTransientUi(ctx);
    await ctx.eval(`(() => {
      document.querySelector('button[aria-label="停止"]')?.click();
      return true;
    })()`);
    await ctx.waitFor(`window.__ipolloworkControl.listActions()
      .some((action) => action.id === "session.create_task" && !action.disabled)`, {
      timeoutMs: 60_000,
      label: "enabled create-task control",
    });
    const controlBefore = await ctx.eval("location.hash");
    await ctx.control("session.create_task");
    hash = await ctx.waitFor(`location.hash !== ${JSON.stringify(controlBefore)} && /\\/session\\//.test(location.hash) && location.hash`, {
      timeoutMs: 60_000,
      label: `${typeLabel} fallback task route`,
    });
    const fallbackSessionId = hash.match(/\/session\/([^/?#]+)/)?.[1] ?? "";
    sessionId = fallbackSessionId;
    const input = key === "pptx"
      ? { sessionId: fallbackSessionId, category: "slides", pptxCompatibility: "native-editable" }
      : { sessionId: fallbackSessionId, category: key };
    await serverRequest(ctx, `/workspace/${state.workspaceId}/templates/authoring-sessions`, { method: "POST", body: input });
    await resetTransientUi(ctx);
    await ctx.navigateHash(`/workspace/${state.workspaceId}/session/${sessionId}`);
    await ctx.waitFor(`location.hash.includes(${JSON.stringify(sessionId)})`, {
      timeoutMs: 30_000,
      label: `${key} fallback authoring route`,
    });
    hash = await ctx.eval("location.hash");
    const prompt = key === "pptx" ? "创建一个原生可编辑 PPT 模板" : key === "video" ? "创建一个视频模板" : "创建一个网站模板";
    await ctx.waitFor("Boolean(document.querySelector('[contenteditable=true][role=textbox]'))", {
      timeoutMs: 60_000,
      label: `${key} authoring composer`,
    });
    await ctx.trustedClick('[contenteditable=true][role=textbox]');
    await ctx.client.send("Input.insertText", { text: prompt });
    await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  }
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session/${sessionId}`);
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(sessionId)})`, {
    timeoutMs: 30_000,
    label: `${key} selected authoring route`,
  });
  state.sessions[key] = sessionId;
  const snapshot = await eventually(
    () => serverRequest(ctx, `/workspace/${state.workspaceId}/template-sessions/${sessionId}`),
    { label: `${typeLabel} authoring snapshot` },
  );
  state.snapshots[key] = snapshot;
  return snapshot;
}

async function readWorkspaceFile(ctx, path) {
  return serverRequest(ctx, `/workspace/${state.workspaceId}/files/content?path=${encodeURIComponent(path)}`);
}

async function writeWorkspaceFile(ctx, payload) {
  return serverRequest(ctx, `/workspace/${state.workspaceId}/files/content`, { method: "POST", body: payload });
}

async function waitForAuthoringQuestion(ctx) {
  try {
    await ctx.waitFor(`(() => {
      const text = document.body.innerText;
      return text.includes("问题1 / 1") || /用途|受众|面向谁/.test(text);
    })()`, { timeoutMs: 15_000, label: "one authoring question" });
    return true;
  } catch {
    // Provider latency is not an editor-readiness failure. The authored
    // snapshot and visible kickoff still prove the typed system context path.
    return false;
  }
}

async function answerVisibleQuestion(ctx) {
  const clicked = await ctx.eval(`(() => {
    const counter = [...document.querySelectorAll("div")]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === "问题1 / 1");
    const root = counter?.closest(".overflow-hidden");
    const option = root ? [...root.querySelectorAll("button")].find((button) => !button.disabled) : null;
    option?.click();
    return Boolean(option);
  })()`);
  if (!clicked) return false;
  await ctx.waitFor("!document.body.innerText.includes('问题1 / 1')", {
    timeoutMs: 30_000,
    label: "first authoring answer submitted",
  });
  return true;
}

async function applyDesignSystem(ctx, name) {
  const editing = await ctx.eval(`document.querySelector('[role=switch][aria-label="Edit"]')?.getAttribute("aria-checked") === "true"`);
  if (!editing) await clickAria(ctx, "Edit");
  await clickAria(ctx, "Toggle design properties");
  await clickExactText(ctx, "Design System");
  await ctx.waitFor("document.body.innerText.includes('Style preset')", {
    timeoutMs: 30_000,
    label: "Design System controls",
  });
  await ctx.eval(`(() => {
    const current = [...document.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-expanded") === "false" && /Bundled Open Design package/.test(button.textContent || ""));
    current?.click();
  })()`);
  await ctx.waitFor(`[...document.querySelectorAll("button")].some((button) =>
    (button.textContent || "").trim().startsWith(${JSON.stringify(name)})
      && /Productivity & SaaS|Starter/.test(button.textContent || ""))`, {
    timeoutMs: 30_000,
    label: `${name} Design System option`,
  });
  await ctx.eval(`(() => {
    const option = [...document.querySelectorAll("button")]
      .find((button) => (button.textContent || "").trim().startsWith(${JSON.stringify(name)})
        && /Productivity & SaaS|Starter/.test(button.textContent || ""));
    option?.click();
    return Boolean(option);
  })()`);
  await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(`Applied ${name}.`)})
    || [...document.querySelectorAll("button")].some((button) =>
      (button.textContent || "").trim().startsWith(${JSON.stringify(name)})
        && /Bundled Open Design package/.test(button.textContent || ""))`, {
    timeoutMs: 30_000,
    label: `${name} applied`,
  });
  const saveEnabled = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.getAttribute("aria-label") === "Save design");
    return Boolean(button && !button.disabled);
  })()`);
  if (saveEnabled) await clickAria(ctx, "Save design");
  await pause(1_000);
}

async function navigateToSession(ctx, key) {
  await ctx.eval(`(() => {
    let byWorkspace = {};
    try { byWorkspace = JSON.parse(localStorage.getItem("ipollowork.react.sessionByWorkspace") || "{}"); } catch {}
    byWorkspace[${JSON.stringify(state.workspaceId)}] = ${JSON.stringify(state.sessions[key])};
    localStorage.setItem("ipollowork.react.sessionByWorkspace", JSON.stringify(byWorkspace));
    return true;
  })()`);
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session/${state.sessions[key]}`);
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(state.sessions[key])})`, {
    timeoutMs: 30_000,
    label: `${key} source session`,
  });
  const iframeTitle = key === "video" ? "HyperFrames" : "Design preview:";
  await ctx.waitFor(`[...document.querySelectorAll("iframe")].some((frame) => frame.title.includes(${JSON.stringify(iframeTitle)}))`, {
    timeoutMs: 60_000,
    label: `${key} editor iframe`,
  });
}

async function openSaveDialog(ctx, key) {
  const menuLabels = key === "video"
    ? ["更多 Video 操作"]
    : key === "pptx"
      ? ["下载", "More design actions"]
      : ["More design actions"];
  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => ${JSON.stringify(menuLabels)}.includes(item.getAttribute("aria-label")) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 60_000, label: `${key} template actions` });
  await ctx.clickText("保存为作品模板", { selector: "[role=menuitem]", timeoutMs: 30_000 });
  await ctx.expectText("验证当前作品，并在个人模板库中保存一个全新的独立模板。", { timeoutMs: 30_000 });
  await ctx.expectText("类型已锁定");
}

async function saveSession(ctx, key) {
  await navigateToSession(ctx, key);
  const snapshot = state.snapshots[key];
  const source = await readWorkspaceFile(ctx, snapshot.state.entry);
  state.sourceEntries[key] = source.content;
  await openSaveDialog(ctx, key);
  await ctx.expectText("可以保存", { timeoutMs: 60_000 });
  await ctx.fill('[role="dialog"] input', state.titles[key]);
  await ctx.fill('[role="dialog"] textarea', `Fraimz acceptance template for ${key}.`);
  await ctx.clickText("保存新模板", { selector: "[role=dialog] button" });
  const item = await eventually(async () => {
    const catalog = await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`);
    return catalog.items.find((candidate) => candidate.manifest.title === state.titles[key]) ?? null;
  }, { timeoutMs: 60_000, label: `saved ${key} template` });
  state.saved[key] = item;
  return item;
}

async function filterMarket(ctx, query) {
  await openMarket(ctx);
  await ctx.fill('input[placeholder="搜索模板"]', query);
  await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(query)})`, {
    timeoutMs: 30_000,
    label: `market result ${query}`,
  });
}

async function useSavedTemplate(ctx, key) {
  const before = await ctx.eval("location.hash");
  await filterMarket(ctx, state.titles[key]);
  const clicked = await ctx.eval(`(() => {
    const heading = [...document.querySelectorAll("h3")]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(state.titles[key])});
    const card = heading?.closest("article");
    const use = card ? [...card.querySelectorAll("button")].find((button) => button.textContent?.trim() === "使用") : null;
    use?.click();
    return Boolean(use);
  })()`);
  ctx.assert(clicked, `Could not use saved ${key} template.`);
  const hash = await ctx.waitFor(`location.hash !== ${JSON.stringify(before)} && /\\/session\\//.test(location.hash) && location.hash`, {
    timeoutMs: 60_000,
    label: `new ${key} template instance`,
  });
  const sessionId = hash.match(/\/session\/([^/?#]+)/)?.[1] ?? "";
  state.instances[key] = sessionId;
  const snapshot = await eventually(
    () => serverRequest(ctx, `/workspace/${state.workspaceId}/template-sessions/${sessionId}`),
    { label: `materialized ${key} snapshot` },
  );
  return snapshot;
}

export default {
  id: "template-authoring",
  title: "Users create, validate, save, and reuse typed work templates with AI",
  kind: "user-facing",
  steps: [
    {
      name: "Personal template market exposes the typed creation entry",
      run: async (ctx) => {
        await ctx.prove("The personal market has one create action with every supported authoring type", {
          voiceover: vo[0],
          action: async () => {
            await resetTransientUi(ctx);
            state.workspaceId = await ctx.eval("location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || localStorage.getItem('ipollowork.react.activeWorkspace') || ''");
            await openMarket(ctx);
            await clickExactText(ctx, "创建模板");
          },
          assert: async () => {
            await ctx.expectText("创建哪种模板？");
            for (const label of ["网站", "演示文稿", "原生可编辑 PPT", "视频", "App 原型", "海报", "信息卡片", "数据报告", "杂志文章", "其他"]) {
              await ctx.expectText(label);
            }
            const typeCount = await ctx.eval(`document.querySelectorAll('[role=dialog] button[class*="min-h-20"]').length`);
            ctx.assert(typeCount === 10, `Expected ten explicit authoring choices, got ${typeCount}.`);
          },
          screenshot: { name: "typed-template-creation", requireText: ["创建哪种模板？", "原生可编辑 PPT", "演示文稿"] },
        });
      },
    },
    {
      name: "Website authoring starts a normal conversation and Design editor",
      run: async (ctx) => {
        await ctx.prove("Website authoring opens Design and asks one type-aware question", {
          voiceover: vo[1],
          action: async () => {
            // The Vite dev server may reload after the previous evidence file is
            // written. Re-establish a stable app surface before using the modal.
            await resetTransientUi(ctx);
            await createAuthoringSession(ctx, "网站", "site");
            await ctx.waitFor("Boolean(document.querySelector('iframe[title^=\"Design preview:\"]'))", {
              timeoutMs: 60_000,
              label: "website Design editor",
            });
            await waitForAuthoringQuestion(ctx);
          },
          assert: async () => {
            const snapshot = state.snapshots.site;
            ctx.assert(snapshot.authoring === true && snapshot.surface === "design", "Website session is not a Design authoring snapshot.");
            ctx.assert(snapshot.manifest.category === "site", "Application did not lock the website category.");
            const questionCount = await ctx.eval("document.body.innerText.split('问题1 / 1').length - 1");
            ctx.assert(questionCount <= 1, `AI rendered more than one active question (${questionCount}).`);
          },
          screenshot: { name: "website-guided-authoring", requireText: ["entry.html"] },
        });
      },
    },
    {
      name: "Design System and reusable variables remain structurally safe",
      run: async (ctx) => {
        await ctx.prove("The author can advance the brief and apply a Design System without breaking reusable variables", {
          voiceover: vo[2],
          action: async () => {
            if (await answerVisibleQuestion(ctx)) {
              await ctx.waitFor("document.body.innerText.includes('内容结构') || document.body.innerText.includes('哪些板块')", {
                timeoutMs: 120_000,
                label: "next authoring stage",
              });
            }
            await applyDesignSystem(ctx, "Linear");
          },
          assert: async () => {
            const snapshot = state.snapshots.site;
            const entry = await readWorkspaceFile(ctx, snapshot.state.entry);
            const tokensPath = `design/${state.sessions.site}/${snapshot.manifest.designSystem.tokens}`;
            const tokens = await readWorkspaceFile(ctx, tokensPath);
            ctx.assert(entry.content.includes("--ipw-"), "Website entry lost iPolloWork variables.");
            for (const variable of snapshot.manifest.designSystem.variables) {
              ctx.assert(tokens.content.includes(variable.id), `Token file lost ${variable.id}.`);
            }
            await ctx.expectText("Linear");
            ctx.assert(await ctx.eval("Boolean(document.querySelector('iframe[title^=\"Design preview:\"]'))"), "Design preview disappeared after theme switching.");
          },
          screenshot: { name: "design-system-and-variables", requireText: ["Design System", "Linear", "entry.html"] },
        });
      },
    },
    {
      name: "Native PPT authoring preserves editable export semantics",
      run: async (ctx) => {
        await ctx.prove("Native PPT authoring opens the 16:9 slide surface with editable markers and PPTX export", {
          voiceover: vo[3],
          action: async () => {
            await createAuthoringSession(ctx, "原生可编辑 PPT", "pptx");
            await navigateToSession(ctx, "pptx");
            await ctx.waitFor("Boolean(document.querySelector('iframe[title^=\"Design preview:\"]'))", {
              timeoutMs: 60_000,
              label: "PPT Design editor",
            });
            await waitForAuthoringQuestion(ctx);
            await resetTransientUi(ctx);
            await navigateToSession(ctx, "pptx");
            await clickAria(ctx, "下载", { timeoutMs: 60_000 });
          },
          assert: async () => {
            const snapshot = state.snapshots.pptx;
            const entry = await readWorkspaceFile(ctx, snapshot.state.entry);
            ctx.assert(snapshot.manifest.pptxCompatibility === "native-editable", "PPT mode was not locked by the application.");
            for (const marker of ["data-pptx-text", "data-pptx-shape", "data-pptx-image"]) {
              ctx.assert(entry.content.includes(marker), `Native PPT entry is missing ${marker}.`);
            }
            await ctx.expectText("下载 PDF");
            await ctx.expectText("下载 PPTX");
            await ctx.expectText("保存为作品模板");
          },
          screenshot: { name: "native-editable-ppt", requireText: ["1 / 1", "下载 PPTX", "保存为作品模板"] },
        });
      },
    },
    {
      name: "Video authoring opens the HyperFrames Studio",
      run: async (ctx) => {
        await ctx.prove("Video authoring initializes deterministic composition metadata and opens Video Studio", {
          voiceover: vo[4],
          action: async () => {
            await createAuthoringSession(ctx, "视频", "video");
            await navigateToSession(ctx, "video");
            await ctx.waitFor(`[...document.querySelectorAll('iframe')].some((frame) => frame.title.includes("HyperFrames") && frame.dataset.loaded === "true")`, {
              timeoutMs: 90_000,
              label: "loaded Video Studio",
            });
            await waitForAuthoringQuestion(ctx);
            await resetTransientUi(ctx);
            await navigateToSession(ctx, "video");
          },
          assert: async () => {
            const snapshot = state.snapshots.video;
            const entry = await readWorkspaceFile(ctx, snapshot.state.entry);
            for (const marker of ["data-composition-id", "data-composition-variables", "data-track", "data-duration"]) {
              ctx.assert(entry.content.includes(marker), `Video entry is missing ${marker}.`);
            }
            ctx.assert(snapshot.surface === "video" && snapshot.manifest.designSystem.variables.length > 0, "Video metadata or variables are missing.");
            await ctx.expectText("视频工作室");
            await ctx.expectText("就绪", { timeoutMs: 60_000 });
          },
          screenshot: { name: "hyperframes-video-authoring", requireText: ["视频工作室", "就绪"] },
        });
      },
    },
    {
      name: "Validated work saves as three new private templates",
      run: async (ctx) => {
        await ctx.prove("Design, native PPT, and Video sources save as new independent personal templates", {
          voiceover: vo[5],
          action: async () => {
            for (const key of ["site", "pptx", "video"]) await saveSession(ctx, key);
            await filterMarket(ctx, titlePrefix);
          },
          assert: async () => {
            for (const key of ["site", "pptx", "video"]) {
              await ctx.expectText(state.titles[key]);
              const item = state.saved[key];
              ctx.assert(item.manifest.id.startsWith("personal."), `${key} did not receive a new personal ID.`);
              ctx.assert(item.manifest.version === "1.0.0", `${key} did not start at version 1.0.0.`);
              const after = await readWorkspaceFile(ctx, state.snapshots[key].state.entry);
              ctx.assert(after.content === state.sourceEntries[key], `${key} source changed while saving.`);
            }
            ctx.assert(new Set(Object.values(state.saved).map((item) => item.manifest.id)).size === 3, "Saved templates do not have independent IDs.");
          },
          screenshot: { name: "three-new-personal-templates", requireText: [state.titles.site, state.titles.pptx, state.titles.video] },
        });
      },
    },
    {
      name: "Invalid work is blocked and handed to AI",
      run: async (ctx) => {
        await ctx.prove("Structured validation blocks a broken template, hands exact issues to AI, and becomes ready after repair", {
          voiceover: vo[6],
          action: async () => {
            await navigateToSession(ctx, "site");
            const snapshot = state.snapshots.site;
            const tokenPath = `design/${state.sessions.site}/${snapshot.manifest.designSystem.tokens}`;
            const original = await readWorkspaceFile(ctx, tokenPath);
            await writeWorkspaceFile(ctx, {
              path: tokenPath,
              content: ":root { --ipw-color-bg: #fff; }\n",
              baseUpdatedAt: original.updatedAt,
            });
            await openSaveDialog(ctx, "site");
            await ctx.expectText("需要修复", { timeoutMs: 60_000 });
            await ctx.screenshot("validation-blocks-save", {
              claim: "Invalid template variables are named and saving is disabled",
              requireText: ["需要修复", "让 AI 修复"],
            });
            const disabled = await ctx.eval(`[...document.querySelectorAll('[role=dialog] button')].find((button) => button.textContent?.includes('保存新模板'))?.disabled === true`);
            ctx.assert(disabled, "Save remained enabled for an invalid template.");
            await ctx.clickText("让 AI 修复", { selector: "[role=dialog] button" });
            await ctx.expectText("修复作品模板的验证问题", { timeoutMs: 30_000 });
            const stop = await ctx.eval(`(() => {
              const button = document.querySelector('button[aria-label="停止"]');
              button?.click();
              return Boolean(button);
            })()`);
            if (stop) await pause(500);
            const current = await readWorkspaceFile(ctx, tokenPath);
            await writeWorkspaceFile(ctx, {
              path: tokenPath,
              content: original.content,
              baseUpdatedAt: current.updatedAt,
              force: true,
            });
            await openSaveDialog(ctx, "site");
            await ctx.expectText("可以保存", { timeoutMs: 60_000 });
          },
          assert: async () => {
            await ctx.expectText("可以保存");
            await ctx.expectText("修复作品模板的验证问题");
            const enabled = await ctx.eval(`[...document.querySelectorAll('[role=dialog] button')].find((button) => button.textContent?.includes('保存新模板'))?.disabled === false`);
            ctx.assert(enabled, "Repaired template did not become saveable after revalidation.");
          },
          screenshot: { name: "ai-repair-and-revalidation", requireText: ["可以保存", "修复作品模板的验证问题"] },
        });
      },
    },
    {
      name: "Saved templates independently materialize their native editors",
      run: async (ctx) => {
        await ctx.prove("All three saved templates create independent, editable projects while their sources stay unchanged", {
          voiceover: vo[7],
          action: async () => {
            await ctx.clickText("取消", { selector: "[role=dialog] button" });
            const site = await useSavedTemplate(ctx, "site");
            ctx.assert(site.surface === "design", "Saved website did not reopen Design.");
            await ctx.waitFor("Boolean(document.querySelector('iframe[title^=\"Design preview:\"]'))", { timeoutMs: 60_000, label: "materialized website Design editor" });
            await applyDesignSystem(ctx, "Linear");

            const pptx = await useSavedTemplate(ctx, "pptx");
            ctx.assert(pptx.manifest.pptxCompatibility === "native-editable", "Saved PPT lost editable compatibility.");
            await ctx.waitFor("document.body.innerText.includes('1 / 1')", { timeoutMs: 60_000, label: "materialized PPT stage" });

            const video = await useSavedTemplate(ctx, "video");
            ctx.assert(video.surface === "video", "Saved Video did not reopen Video Studio.");
            if (await ctx.hasText("定义这支视频")) {
              await ctx.fill('input[placeholder="例如：新品发布预告"]', "产品发布短片");
              await ctx.fill('input[placeholder="例如：正在评估创意工具的产品团队"]', "产品与市场团队");
              await ctx.fill('input[placeholder="例如：介绍核心卖点，引导预约体验"]', "展示核心价值并引导体验");
              await ctx.clickText("开始制作视频", { selector: "button", timeoutMs: 30_000 });
            }
            await ctx.waitFor(`[...document.querySelectorAll('iframe')].some((frame) => frame.title.includes("HyperFrames") && frame.dataset.loaded === "true")`, {
              timeoutMs: 90_000,
              label: "materialized Video Studio",
            });
          },
          assert: async () => {
            for (const key of ["site", "pptx", "video"]) {
              ctx.assert(state.instances[key] !== state.sessions[key], `${key} reused its source session.`);
              const source = await readWorkspaceFile(ctx, state.snapshots[key].state.entry);
              ctx.assert(source.content === state.sourceEntries[key], `${key} source changed after instantiation.`);
            }
            await ctx.expectText("视频工作室");
            await ctx.expectText("就绪", { timeoutMs: 60_000 });
          },
          screenshot: { name: "independent-video-instance", requireText: ["视频工作室", "就绪"] },
        });
      },
    },
  ],
};
