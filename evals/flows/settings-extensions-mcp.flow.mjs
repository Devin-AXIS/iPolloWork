import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The MCP settings view renders the custom-app entry point, the My Extensions /
 * Marketplace tabs, and the quick-connect directory so app discovery works
 * without a cloud sign-in. Built-in iPolloWork MCPs are hidden by default and
 * revealed via Show hidden.
 */

const revealHidden = async (ctx) => {
  const showing = await ctx.eval("document.body.innerText.includes('Showing hidden')");
  if (!showing) await ctx.clickText("Show hidden", { timeoutMs: 30_000 });
};

const LOCALIZED_SKILL_NAME = "fraimz-i18n-chinese-skill";
const LOCALIZED_SKILL_DESCRIPTION = "用于验证英文界面不会显示中文技能描述。";
const ENGLISH_SKILL_FALLBACK = "English description unavailable.";
const ENGLISH_FIGMA_DESCRIPTION = "Complete Figma design-to-code, Code Connect, design system, and canvas authoring workflows.";
const CHINESE_FIGMA_DESCRIPTION = "完整的 Figma 设计到代码、Code Connect、设计系统和画布写入工作流。";
const ENGLISH_FIGMA_MCP_LABEL = "Official Figma Desktop MCP";
const CHINESE_FIGMA_MCP_LABEL = "Figma 官方 Desktop MCP";
const state = {
  originalHash: "#/welcome",
  originalLocale: null,
  originalResolvedLocale: "en",
  previousWorkspace: null,
  previousWorkspaceId: "",
  workspaceId: "",
  workspacePath: "",
};

function pluginCardActionExpression(name, labels, click = false) {
  return `(() => {
    const title = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find((entry) =>
      entry.children.length === 0 && entry.textContent?.trim() === ${JSON.stringify(name)}
    );
    let container = title?.parentElement;
    while (container && container !== document.body) {
      const button = [...container.querySelectorAll('button')].find((entry) =>
        ${JSON.stringify(labels)}.includes(entry.textContent?.trim() ?? '')
      );
      if (button) {
        ${click ? "button.click();" : ""}
        return true;
      }
      container = container.parentElement;
    }
    return false;
  })()`;
}

async function settlePaint(ctx) {
  await ctx.client.send("Page.bringToFront");
  await ctx.eval(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 600))))`, {
    awaitPromise: true,
  });
}

async function scrollTextIntoView(ctx, text) {
  await settlePaint(ctx);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await ctx.eval(`(() => {
      const target = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find((entry) => {
        const rect = entry.getBoundingClientRect();
        const style = getComputedStyle(entry);
        return entry.children.length === 0
          && entry.textContent?.trim() === ${JSON.stringify(text)}
          && rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      });
      if (!target) return false;
      const scroller = target.closest('[data-settings-content]');
      if (scroller) {
        const targetRect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const previousScrollBehavior = scroller.style.scrollBehavior;
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollTop += targetRect.top - scrollerRect.top
          - ((scrollerRect.height - targetRect.height) / 2);
        scroller.style.scrollBehavior = previousScrollBehavior;
      } else {
        target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      }
      return true;
    })()`);
    ctx.assert(found, `Could not find visible text to scroll into view: ${text}`);
    await settlePaint(ctx);
  }
  const visible = await ctx.eval(`(() => {
    const target = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find((entry) => {
      const rect = entry.getBoundingClientRect();
      const style = getComputedStyle(entry);
      return entry.children.length === 0
        && entry.textContent?.trim() === ${JSON.stringify(text)}
        && rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
    if (!target) return false;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = target.closest('[data-settings-content]')?.getBoundingClientRect()
      ?? { top: 0, bottom: innerHeight };
    return targetRect.top >= Math.max(0, scrollerRect.top)
      && targetRect.bottom <= Math.min(innerHeight, scrollerRect.bottom);
  })()`);
  ctx.assert(visible, `Could not keep visible text in view after layout settled: ${text}`);
}

async function setLanguage(ctx, language) {
  const resolvedLanguage = language ?? state.originalResolvedLocale;
  const returnHash = await ctx.eval("location.hash || '#/welcome'");
  const workspaceId = await ctx.eval(`(location.hash.match(/\\/workspace\\/([^/]+)/) || [])[1]
    || localStorage.getItem("ipollowork.react.activeWorkspace") || ""`);
  ctx.assert(workspaceId, "Language switch requires an active workspace");
  await ctx.navigateHash(`/workspace/${workspaceId}/settings/appearance`);
  await ctx.waitFor("Boolean(document.querySelector('button[role=combobox]'))", {
    timeoutMs: 15_000,
    label: "language selector",
  });
  const opened = await ctx.eval(`(() => {
    const selector = document.querySelector('button[role=combobox]');
    selector?.click();
    return Boolean(selector);
  })()`);
  ctx.assert(opened, "Could not open the language selector");
  const languageLabel = resolvedLanguage === "zh" ? "简体中文" : "English";
  await ctx.waitFor(`(() => {
    const option = [...document.querySelectorAll('[role=option]')].find((entry) =>
      entry.textContent?.trim() === ${JSON.stringify(languageLabel)}
    );
    option?.setAttribute('data-fraimz-language-option', 'true');
    return Boolean(option);
  })()`, { timeoutMs: 10_000, label: `language option ${languageLabel}` });
  await ctx.trustedClick('[data-fraimz-language-option="true"]');
  await ctx.waitFor(
    `document.documentElement.lang === ${JSON.stringify(resolvedLanguage)}
      && localStorage.getItem("ipollowork.language") === ${JSON.stringify(resolvedLanguage)}`,
    { timeoutMs: 10_000, label: `app rendered in ${resolvedLanguage}` },
  );
  if (language === null) await ctx.eval('localStorage.removeItem("ipollowork.language")');
  await ctx.navigateHash(returnHash);
  await ctx.waitFor(`location.hash === ${JSON.stringify(returnHash)}`, {
    timeoutMs: 15_000,
    label: "return from language selector",
  });
  await settlePaint(ctx);
}

async function setupIsolatedWorkspace(ctx) {
  state.workspacePath = await mkdtemp(join(tmpdir(), "ipollowork-fraimz-extension-i18n-"));
  const result = await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    const hostToken = localStorage.getItem("ipollowork.server.hostToken");
    const previousWorkspaceId = (location.hash.match(/\\/workspace\\/([^/]+)/) || [])[1]
      || localStorage.getItem("ipollowork.react.activeWorkspace") || "";
    if (!port || !token || !hostToken) return { ok: false, status: 0, text: "missing local server context" };
    const base = "http://127.0.0.1:" + port;
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-ipollowork-host-token": hostToken,
    };
    const listed = await fetch(base + "/workspaces", { headers });
    const listedPayload = listed.ok ? await listed.json() : [];
    const workspaces = Array.isArray(listedPayload) ? listedPayload : listedPayload.items ?? listedPayload.workspaces ?? [];
    const previousWorkspaceSource = workspaces.find((workspace) => workspace.id === previousWorkspaceId) ?? null;
    const previousWorkspace = previousWorkspaceSource
      ? {
          id: previousWorkspaceSource.id,
          name: previousWorkspaceSource.name,
          path: previousWorkspaceSource.path,
          preset: previousWorkspaceSource.preset,
          workspaceType: previousWorkspaceSource.workspaceType,
        }
      : null;
    const created = await fetch(base + "/workspaces/local", {
      method: "POST",
      headers,
      body: JSON.stringify({
        folderPath: ${JSON.stringify(state.workspacePath)},
        name: "Extensions localization fraimz",
        preset: "starter",
      }),
    });
    const createdText = await created.text();
    if (!created.ok) return { ok: false, status: created.status, text: createdText };
    const payload = JSON.parse(createdText);
    const workspaceId = payload.activeId
      || payload.workspaces?.find((workspace) => workspace.path === ${JSON.stringify(state.workspacePath)})?.id;
    if (!workspaceId) return { ok: false, status: created.status, text: "workspace id missing" };
    const activated = await fetch(base + "/workspaces/" + encodeURIComponent(workspaceId) + "/activate?persist=true", {
      method: "POST",
      headers,
    });
    if (!activated.ok) return { ok: false, status: activated.status, text: await activated.text() };
    localStorage.setItem("ipollowork.react.activeWorkspace", workspaceId);
    return { ok: true, previousWorkspace, previousWorkspaceId, workspaceId };
  })()`, { awaitPromise: true });
  ctx.assert(result?.ok && result?.workspaceId, `Isolated workspace setup failed: ${result?.status ?? "?"} ${result?.text ?? ""}`);
  state.previousWorkspace = result.previousWorkspace;
  state.previousWorkspaceId = result.previousWorkspaceId;
  state.workspaceId = result.workspaceId;
}

async function cleanupIsolatedWorkspace(ctx) {
  const result = await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    const hostToken = localStorage.getItem("ipollowork.server.hostToken");
    if (!port || !token || !hostToken) return { ok: false, status: 0, text: "missing local server context" };
    const base = "http://127.0.0.1:" + port;
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-ipollowork-host-token": hostToken,
    };
    const previousWorkspace = ${JSON.stringify(state.previousWorkspace)};
    let previousWorkspaceId = ${JSON.stringify(state.previousWorkspaceId)};
    if (previousWorkspace?.workspaceType === "local" && previousWorkspace.path) {
      const recreated = await fetch(base + "/workspaces/local", {
        method: "POST",
        headers,
        body: JSON.stringify({
          folderPath: previousWorkspace.path,
          name: previousWorkspace.name,
          preset: previousWorkspace.preset || "starter",
        }),
      });
      if (!recreated.ok) return { ok: false, status: recreated.status, text: await recreated.text() };
      const recreatedPayload = await recreated.json();
      previousWorkspaceId = recreatedPayload.activeId || previousWorkspaceId;
    }
    if (previousWorkspaceId) {
      const activated = await fetch(base + "/workspaces/" + encodeURIComponent(previousWorkspaceId) + "/activate?persist=true", {
        method: "POST",
        headers,
      });
      if (!activated.ok) return { ok: false, status: activated.status, text: await activated.text() };
      localStorage.setItem("ipollowork.react.activeWorkspace", previousWorkspaceId);
    } else {
      localStorage.removeItem("ipollowork.react.activeWorkspace");
    }
    const removed = await fetch(base + "/workspaces/" + encodeURIComponent(${JSON.stringify(state.workspaceId)}), {
      method: "DELETE",
      headers,
    });
    return { ok: removed.ok, status: removed.status, text: await removed.text() };
  })()`, { awaitPromise: true });
  try {
    ctx.assert(result?.ok, `Isolated workspace cleanup failed: ${result?.status ?? "?"} ${result?.text ?? ""}`);
  } finally {
    await rm(state.workspacePath, { recursive: true, force: true });
  }
  await ctx.navigateHash(state.originalHash.replace(/^#/, ""));
  await setLanguage(ctx, state.originalLocale);
}

async function mutateLocalizedSkill(ctx, method) {
  const payload = method === "POST"
    ? {
        name: LOCALIZED_SKILL_NAME,
        description: LOCALIZED_SKILL_DESCRIPTION,
        content: `---\nname: ${LOCALIZED_SKILL_NAME}\ndescription: ${LOCALIZED_SKILL_DESCRIPTION}\n---\n\n# 本地化验证技能\n`,
      }
    : null;
  const result = await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    const workspaceId = ${JSON.stringify(state.workspaceId)};
    if (!port || !token || !workspaceId) return { ok: false, status: 0, text: "missing local server context" };
    const suffix = ${JSON.stringify(method === "POST" ? "" : `/${LOCALIZED_SKILL_NAME}`)};
    const response = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId) + "/skills" + suffix,
      {
        method: ${JSON.stringify(method)},
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        ${payload ? `body: ${JSON.stringify(JSON.stringify(payload))},` : ""}
      },
    );
    return { ok: response.ok, status: response.status, text: await response.text() };
  })()`, { awaitPromise: true });
  ctx.assert(result?.ok || (method === "DELETE" && result?.status === 404), `Skill ${method} failed: ${result?.status ?? "?"} ${result?.text ?? ""}`);
}

export default {
  id: "settings-extensions-mcp",
  title: "MCP settings view renders apps and entry points",
  spec: "evals/browser-extension-flows.md",
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        state.originalHash = await ctx.eval("location.hash || '#/welcome'");
        state.originalLocale = await ctx.eval("localStorage.getItem('ipollowork.language')");
        state.originalResolvedLocale = await ctx.eval("document.documentElement.lang || 'en'");
        await setLanguage(ctx, "en");
      },
    },
    {
      name: "Navigate to Settings -> Extensions -> MCP",
      run: async (ctx) => {
        await ctx.navigateHash("/settings/extensions/mcp");
        await ctx.expectHashIncludes("/settings/extensions/mcp");
      },
    },
    {
      name: "Extensions surface renders tabs and custom app entry",
      run: async (ctx) => {
        await ctx.expectText("My Extensions", { timeoutMs: 30_000 });
        await ctx.expectText("Marketplace");
        await ctx.expectText("Add Custom App");
      },
    },
    {
      name: "Available apps section renders",
      run: async (ctx) => {
        // CSS text-transform can change innerText casing; compare lowercased.
        await ctx.waitFor(
          "document.body.innerText.toLowerCase().includes('available apps')",
          { timeoutMs: 15_000, label: "available apps section" },
        );
      },
    },
    {
      name: "Default view keeps directory apps discoverable and hides built-in iPolloWork MCPs",
      run: async (ctx) => {
        const directoryEntry = await ctx.hasText("Notion")
          ? "Notion"
          : await ctx.hasText("Linear")
            ? "Linear"
            : "iPolloWork Browser";
        const hasDirectoryEntry = await ctx.hasText(directoryEntry);
        ctx.assert(hasDirectoryEntry, "Expected at least one user-facing app entry in quick connect.");
        await ctx.expectNoText("iPolloWork Cloud Control");
        await ctx.expectNoText("iPolloWork UI Control");
        await scrollTextIntoView(ctx, directoryEntry);
        await ctx.screenshot("mcp-view-default-hidden", {
          claim: "MCP settings shows public directory apps while built-in iPolloWork MCPs are hidden by default.",
          voiceover: "Settings shows the extension directory with the public apps, while iPolloWork's internal control entries stay out of the default list.",
          requireText: [directoryEntry],
          rejectText: ["iPolloWork Cloud Control", "iPolloWork UI Control", "Something went wrong"],
          hashIncludes: "/settings/extensions/mcp",
        });
      },
    },
    {
      name: "English locale replaces a Chinese-only Skill description",
      run: async (ctx) => {
        await setupIsolatedWorkspace(ctx);
        await mutateLocalizedSkill(ctx, "POST");
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/mcp`);
        await ctx.waitFor(
          `location.hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/settings/extensions/mcp`)})`,
          { timeoutMs: 30_000, label: "isolated workspace loaded" },
        );
        await setLanguage(ctx, "en");
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/mcp`);
        await ctx.waitFor(
          `location.hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/settings/extensions/mcp`)})`,
          { timeoutMs: 30_000, label: "isolated Extensions route" },
        );
        await ctx.waitForText("WeChat Official Account", { timeoutMs: 30_000 });
        await ctx.waitForText(LOCALIZED_SKILL_NAME, { timeoutMs: 30_000 });
        await ctx.expectText(ENGLISH_SKILL_FALLBACK);
        await ctx.expectNoText(LOCALIZED_SKILL_DESCRIPTION);
        await scrollTextIntoView(ctx, LOCALIZED_SKILL_NAME);
        await ctx.screenshot("mcp-skill-description-english-fallback", {
          claim: "English Extensions replaces a Chinese-only third-party Skill description with a clear English fallback.",
          voiceover: "A third-party skill without English metadata stays readable in the English interface without leaking its Chinese description into the card.",
          requireText: [LOCALIZED_SKILL_NAME, ENGLISH_SKILL_FALLBACK],
          rejectText: [LOCALIZED_SKILL_DESCRIPTION, "Something went wrong"],
          hashIncludes: "/settings/extensions/mcp",
        });
      },
    },
    {
      name: "Skill detail uses the same English description fallback",
      run: async (ctx) => {
        const opened = await ctx.eval(`(() => {
          const title = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find((entry) =>
            entry.children.length === 0 && entry.textContent?.trim() === ${JSON.stringify(LOCALIZED_SKILL_NAME)}
          );
          const button = title?.closest('button');
          button?.click();
          return Boolean(button);
        })()`);
        ctx.assert(opened, "Could not open the localized Skill detail");
        await ctx.waitFor("document.querySelector('[role=dialog]')?.innerText.includes('English description unavailable.')", {
          timeoutMs: 15_000,
          label: "localized Skill detail",
        });
        await ctx.expectNoText(LOCALIZED_SKILL_DESCRIPTION);
        await settlePaint(ctx);
        await ctx.screenshot("mcp-skill-detail-english-fallback", {
          claim: "Skill cards and details share the same English fallback for a Chinese-only description.",
          voiceover: "Opening the skill shows the same English fallback in its detail view, while the authored skill body remains untouched.",
          requireText: [LOCALIZED_SKILL_NAME, ENGLISH_SKILL_FALLBACK],
          rejectText: [LOCALIZED_SKILL_DESCRIPTION, "Something went wrong"],
        });
        const closed = await ctx.eval(`(() => {
          const dialog = document.querySelector('[role=dialog]');
          const button = [...(dialog?.querySelectorAll('button') ?? [])].find((entry) =>
            entry.textContent?.trim() === 'Close' || entry.getAttribute('aria-label') === 'Close'
          );
          button?.click();
          return Boolean(button);
        })()`);
        ctx.assert(closed, "Could not close the localized Skill detail");
      },
    },
    {
      name: "Show hidden reveals built-in iPolloWork MCPs",
      run: async (ctx) => {
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/mcp`);
        await revealHidden(ctx);
        await ctx.expectText("iPolloWork Cloud Control", { timeoutMs: 15_000 });
        await ctx.expectText("iPolloWork UI Control", { timeoutMs: 15_000 });
        await scrollTextIntoView(ctx, "iPolloWork Cloud Control");
        await ctx.screenshot("mcp-view-built-ins-revealed", {
          claim: "Show hidden reveals the built-in iPolloWork MCP entries.",
          voiceover: "Choosing Show hidden brings back iPolloWork Cloud Control and iPolloWork UI Control for anyone who wants to manage them.",
          requireText: ["iPolloWork Cloud Control", "iPolloWork UI Control"],
          rejectText: ["Something went wrong"],
          hashIncludes: "/settings/extensions/mcp",
        });
      },
    },
    {
      name: "Official plugin package list uses English display metadata",
      run: async (ctx) => {
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions`);
        await ctx.waitForText("Plugin packages", { timeoutMs: 30_000 });
        await ctx.expectText(ENGLISH_FIGMA_DESCRIPTION);
        await ctx.expectNoText(CHINESE_FIGMA_DESCRIPTION);
        const hanText = await ctx.eval(`(() => {
          const heading = [...document.querySelectorAll('h2')].find((entry) => entry.textContent?.trim() === 'Plugin packages');
          return heading?.closest('section')?.innerText.match(/[\\u3400-\\u9fff]/)?.[0] ?? '';
        })()`);
        ctx.assert(!hanText, `English Plugin packages still contains Chinese text: ${hanText}`);
        await scrollTextIntoView(ctx, "Plugin packages");
        await ctx.screenshot("plugin-packages-english-metadata", {
          claim: "Official plugin packages use English manifest metadata throughout the English catalog.",
          voiceover: "The official plugin catalog now follows the app language, including every package description sourced from the manifest.",
          requireText: ["Plugin packages", "Figma", ENGLISH_FIGMA_DESCRIPTION],
          rejectText: [CHINESE_FIGMA_DESCRIPTION, "Something went wrong"],
          hashIncludes: "/settings/extensions",
        });
      },
    },
    {
      name: "Official plugin package detail uses English nested metadata",
      run: async (ctx) => {
        const installed = await ctx.eval(pluginCardActionExpression("Figma", ["Install"], true));
        ctx.assert(installed, "Could not find the Figma install action");
        await ctx.waitFor(pluginCardActionExpression("Figma", ["Connect", "Open"]), {
          timeoutMs: 45_000,
          label: "Figma installed in isolated workspace",
        });
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/plugin/figma`);
        await ctx.waitForText(ENGLISH_FIGMA_MCP_LABEL, { timeoutMs: 30_000 });
        await ctx.waitForText("Figma Plugin API", { timeoutMs: 30_000 });
        await ctx.expectText(ENGLISH_FIGMA_DESCRIPTION);
        await ctx.expectNoText(CHINESE_FIGMA_DESCRIPTION);
        await ctx.expectNoText(CHINESE_FIGMA_MCP_LABEL);
        await scrollTextIntoView(ctx, ENGLISH_FIGMA_DESCRIPTION);
        await ctx.screenshot("plugin-package-detail-english-metadata", {
          claim: "The official plugin detail uses localized nested resource and setup metadata without changing package behavior.",
          voiceover: "The Figma detail view carries the English description into its nested app, skill, setup, and metadata sections.",
          requireText: ["Figma", ENGLISH_FIGMA_DESCRIPTION, ENGLISH_FIGMA_MCP_LABEL, "Design to Code"],
          rejectText: [CHINESE_FIGMA_DESCRIPTION, CHINESE_FIGMA_MCP_LABEL, "Something went wrong"],
          hashIncludes: "/settings/extensions/plugin/figma",
        });
      },
    },
    {
      name: "Chinese locale keeps official package metadata",
      run: async (ctx) => {
        await setLanguage(ctx, "zh");
        await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/plugin/figma`);
        await ctx.waitForText(CHINESE_FIGMA_DESCRIPTION, { timeoutMs: 30_000 });
        await ctx.expectText(CHINESE_FIGMA_MCP_LABEL);
        await scrollTextIntoView(ctx, CHINESE_FIGMA_DESCRIPTION);
        await ctx.screenshot("plugin-package-detail-chinese-metadata", {
          claim: "Switching back to Chinese restores the official package's authored Chinese metadata.",
          voiceover: "Switching back to Chinese restores the official Chinese package and resource descriptions from the same manifest.",
          requireText: ["Figma", CHINESE_FIGMA_DESCRIPTION, CHINESE_FIGMA_MCP_LABEL],
          rejectText: ["Something went wrong"],
          hashIncludes: "/settings/extensions/plugin/figma",
        });
      },
    },
    {
      name: "Restore the original app state",
      run: async (ctx) => {
        await mutateLocalizedSkill(ctx, "DELETE");
        await cleanupIsolatedWorkspace(ctx);
      },
    },
  ],
};
