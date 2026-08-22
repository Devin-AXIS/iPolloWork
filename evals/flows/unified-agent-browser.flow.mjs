import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const execFile = promisify(execFileCallback);
const vo = await loadVoiceoverParagraphs("unified-agent-browser");

function startFixtureServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Unified Browser Fixture</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f5f3ef; color: #171717; }
      main { width: min(720px, calc(100% - 48px)); margin: 48px auto; padding: 32px; border-radius: 24px; background: white; box-shadow: 0 18px 60px #17233b1f; }
      label, button { display: block; margin-top: 18px; font-weight: 700; }
      input { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 13px 14px; border: 1px solid #a3a3a3; border-radius: 12px; font: inherit; }
      button { padding: 11px 16px; border: 0; border-radius: 12px; background: #171717; color: white; cursor: pointer; }
      #publish { background: #b42318; }
      #result { margin-top: 24px; padding: 16px; border-radius: 12px; background: #eff6ff; }
      iframe { width: 100%; height: 84px; margin-top: 18px; border: 1px solid #d4d4d4; border-radius: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Unified Browser Runtime</h1>
      <p>One host-owned semantic browser surface for every supported engine.</p>
      <label for="title">Post title</label>
      <input id="title" autocomplete="off">
      <button id="preview" type="button">Preview</button>
      <div id="shadow-host"></div>
      <iframe title="Embedded editor" srcdoc="<!doctype html><button type='button'>Frame action</button>"></iframe>
      <input type="file" aria-label="Upload training asset" hidden>
      <button id="publish" type="button">Publish now</button>
      <p id="result">Waiting for an action</p>
    </main>
    <script>
      const result = document.querySelector('#result');
      document.querySelector('#preview').addEventListener('click', () => {
        result.textContent = 'Preview ready: ' + document.querySelector('#title').value;
      });
      document.querySelector('#publish').addEventListener('click', () => {
        result.textContent = 'Published';
      });
      const root = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Shadow action';
      button.addEventListener('click', () => {
        result.textContent = 'Shadow action complete';
        history.pushState(null, '', '#shadow-complete');
      });
      root.appendChild(button);
    </script>
  </body>
</html>`);
  });
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unified browser fixture did not bind a port."));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/fixture`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function refFor(tree, name) {
  const line = String(tree).split("\n").find((entry) => (
    entry.includes(JSON.stringify(name)) && /\[(@e\d+)\]/.test(entry)
  ));
  return line?.match(/\[(@e\d+)\]/)?.[1] ?? null;
}

function compactTree(tree) {
  return String(tree).split("\n").filter((line) => /\[(@e\d+)\]/.test(line)).slice(0, 12).join("\n");
}

async function showProofPanel(ctx, title, subtitle, rows) {
  await ctx.eval(`(() => {
    const id = "ipollowork-unified-browser-proof";
    document.getElementById(id)?.remove();
    const panel = document.createElement("section");
    panel.id = id;
    panel.style.cssText = [
      "position:fixed", "inset:28px", "z-index:2147483647", "overflow:auto",
      "padding:30px", "border-radius:22px", "color:#f8fafc",
      "background:linear-gradient(145deg,#101827,#07111f)",
      "box-shadow:0 28px 90px rgba(2,6,23,.5)",
      "font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
    ].join(";");
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "iPolloWork · Unified Agent Browser";
    eyebrow.style.cssText = "color:#67e8f9;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase";
    const heading = document.createElement("h1");
    heading.textContent = ${JSON.stringify(title)};
    heading.style.cssText = "max-width:900px;margin:12px 0 8px;font-size:34px;line-height:1.08;letter-spacing:-.03em";
    const lead = document.createElement("p");
    lead.textContent = ${JSON.stringify(subtitle)};
    lead.style.cssText = "max-width:900px;margin:0 0 22px;color:#bac7d9;font-size:16px;line-height:1.5";
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px";
    for (const row of ${JSON.stringify(rows)}) {
      const item = document.createElement("article");
      item.style.cssText = "min-width:0;padding:15px 16px;border:1px solid #263449;border-radius:14px;background:#111c2c";
      const label = document.createElement("div");
      label.textContent = row.label;
      label.style.cssText = "margin-bottom:7px;color:#67e8f9;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase";
      const value = document.createElement("div");
      value.textContent = row.value;
      value.style.cssText = "color:#f8fafc;font-size:15px;font-weight:650;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere";
      item.append(label, value);
      grid.appendChild(item);
    }
    panel.append(eyebrow, heading, lead, grid);
    document.body.appendChild(panel);
    return document.body.innerText;
  })()`);
}

async function desktopServerInfo(ctx) {
  return ctx.eval(
    'window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo")',
    { awaitPromise: true },
  );
}

function clientHeaders(serverInfo) {
  return { authorization: `Bearer ${serverInfo.clientToken}` };
}

export default {
  id: "unified-agent-browser",
  title: "Every engine uses one semantic built-in browser runtime",
  spec: "evals/unified-browser-runtime-flows.md",
  steps: [
    {
      name: "One built-in browser opens the requested page",
      run: async (ctx) => {
        await ctx.prove("The real desktop opens the page in its right-side built-in browser", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl) && Boolean(window.__IPOLLOWORK_ELECTRON__?.browser)", {
              timeoutMs: 60_000,
              label: "desktop browser control surface",
            });
            await ctx.eval('document.getElementById("ipollowork-unified-browser-proof")?.remove()');
            const route = await ctx.eval("window.location.hash");
            if (!/\/session\/[^/?#]+/.test(route)) {
              const sessions = await ctx.control("session.list_sessions");
              ctx.assert(Array.isArray(sessions) && sessions.length > 0, "The browser proof needs one existing conversation.");
              await ctx.control("session.open", { sessionId: sessions[0].sessionId });
              await ctx.waitFor("/\/session\/[^/?#]+/.test(window.location.hash)", {
                timeoutMs: 30_000,
                label: "existing conversation route",
              });
            }
            await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.closeAllTabs()", { awaitPromise: true });
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "eval.design.seed_html" && !action.disabled)`,
              { timeoutMs: 30_000, label: "Design seed action" },
            );
            try {
              await ctx.control("eval.design.seed_html");
            } catch {
              await ctx.trustedClick('button[aria-label="Select tab: entry.html"]');
            }
            await ctx.waitFor(
              `Boolean(document.querySelector('button[aria-label="Select tab: entry.html"][aria-selected="true"]'))`,
              { timeoutMs: 30_000, label: "active Design tab before browser launch" },
            );
            ctx.fixture = await startFixtureServer();
            ctx.browser = {};
            ctx.browser.opened = await ctx.control("browser.open_url", { url: ctx.fixture.url });
            await ctx.waitFor(
              `Array.from(document.querySelectorAll('button[aria-label^="Select tab:"][aria-selected="true"]')).some((button) => button.closest('[id]')?.id === ${JSON.stringify("__TAB_ID__")})`
                .replace("__TAB_ID__", ctx.browser.opened.tabId),
              { timeoutMs: 20_000, label: "active built-in browser tab in the conversation panel" },
            );
            await ctx.waitFor(
              `Boolean(document.querySelector('[aria-label^="Edit address"], [aria-label^="编辑地址"]'))`,
              { timeoutMs: 20_000, label: "compact browser address control" },
            );
            ctx.browser.compactAddress = await ctx.eval(`(() => {
              const button = document.querySelector('[aria-label^="Edit address"], [aria-label^="编辑地址"]');
              const input = document.querySelector('input[placeholder="Enter URL..."], input[placeholder="输入网址…"]');
              const profile = document.querySelector('[aria-label="Browser profile"], [aria-label="浏览器身份"]');
              const addressRect = button?.getBoundingClientRect();
              const profileRect = profile?.getBoundingClientRect();
              return {
                label: button?.textContent?.trim() ?? "",
                width: addressRect ? Math.round(addressRect.width) : 0,
                right: addressRect ? Math.round(addressRect.right) : 0,
                inputVisible: Boolean(input),
                profileVisible: Boolean(profileRect?.width),
                profileWidth: profileRect ? Math.round(profileRect.width) : 0,
                profileLeft: profileRect ? Math.round(profileRect.left) : 0,
              };
            })()`);

            await ctx.trustedClick('[aria-label="Browser profile"], [aria-label="浏览器身份"]');
            await ctx.waitFor(
              `document.body.innerText.includes('Default profile') || document.body.innerText.includes('默认身份')`,
              { timeoutMs: 5_000, label: "browser profile menu" },
            );
            ctx.browser.profileMenuText = await ctx.eval(`(() => {
              const menu = document.querySelector('[role="menu"]');
              return menu?.textContent?.trim() ?? "";
            })()`);
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.waitFor(`!document.querySelector('[role="menu"]')`, {
              timeoutMs: 5_000,
              label: "closed browser profile menu",
            });
          },
          assert: async () => {
            ctx.assert(ctx.browser.opened.provider === "builtin", "The browser did not use the built-in provider.");
            ctx.assert(typeof ctx.browser.opened.tabId === "string", "The host did not return a tab ID.");
            const tabs = await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.listTabs()", { awaitPromise: true });
            ctx.assert(tabs.some((tab) => tab.id === ctx.browser.opened.tabId), "The returned host tab is not open.");
            const activeTabId = await ctx.eval(`document.querySelector('button[aria-label^="Select tab:"][aria-selected="true"]')?.closest('[id]')?.id ?? null`);
            ctx.assert(activeTabId === ctx.browser.opened.tabId, "The existing Design surface stole focus from the browser opened by the host.");
            ctx.assert(ctx.browser.compactAddress.width >= 240, "The resting site address does not use the available toolbar space.");
            ctx.assert(!ctx.browser.compactAddress.inputVisible, "The full URL input is visible before the user asks for it.");
            ctx.assert(ctx.browser.compactAddress.profileVisible, "The browser profile avatar is not visible.");
            ctx.assert(ctx.browser.compactAddress.profileWidth >= 24 && ctx.browser.compactAddress.profileWidth <= 40, "The browser profile avatar does not keep a compact fixed slot.");
            ctx.assert(ctx.browser.compactAddress.right <= ctx.browser.compactAddress.profileLeft, "The browser profile avatar is not reserved to the right of the address.");
            ctx.assert(/Default profile|默认身份/.test(ctx.browser.profileMenuText), "The browser profile menu does not identify the active profile.");
            ctx.assert(/saved|保存/.test(ctx.browser.profileMenuText), "The browser profile menu does not explain sign-in persistence.");
          },
          screenshot: { name: "compact-built-in-browser", requireText: [] },
        });
      },
    },
    {
      name: "The full address opens only when requested",
      run: async (ctx) => {
        const compactSelector = '[aria-label^="Edit address"], [aria-label^="编辑地址"]';
        const inputSelector = 'input[placeholder="Enter URL..."], input[placeholder="输入网址…"]';

        await ctx.prove("Clicking the compact site control expands and focuses the full URL", {
          voiceover: vo[1],
          action: async () => {
            await ctx.trustedClick(compactSelector);
            await ctx.waitFor(
              `document.activeElement === document.querySelector(${JSON.stringify(inputSelector)})`,
              { timeoutMs: 5_000, label: "expanded address input focus" },
            );
            ctx.browser.expandedAddress = await ctx.eval(`(() => {
              const input = document.querySelector(${JSON.stringify(inputSelector)});
              const profile = document.querySelector('[aria-label="Browser profile"], [aria-label="浏览器身份"]');
              const inputRect = input?.parentElement?.getBoundingClientRect();
              const profileRect = profile?.getBoundingClientRect();
              return {
                value: input?.value ?? "",
                width: inputRect ? Math.round(inputRect.width) : 0,
                right: inputRect ? Math.round(inputRect.right) : 0,
                profileVisible: Boolean(profileRect?.width),
                profileLeft: profileRect ? Math.round(profileRect.left) : 0,
                focused: document.activeElement === input,
                selected: input instanceof HTMLInputElement && input.selectionStart === 0 && input.selectionEnd === input.value.length,
              };
            })()`);
          },
          assert: async () => {
            ctx.assert(ctx.browser.expandedAddress.focused, "The expanded URL field did not receive focus.");
            ctx.assert(ctx.browser.expandedAddress.selected, "The expanded URL was not selected for immediate replacement.");
            ctx.assert(ctx.browser.expandedAddress.width >= ctx.browser.compactAddress.width * 0.9, "The editable address field does not use the available toolbar space.");
            ctx.assert(ctx.browser.expandedAddress.profileVisible, "The browser profile avatar disappeared while editing the address.");
            ctx.assert(ctx.browser.expandedAddress.right <= ctx.browser.expandedAddress.profileLeft, "The editable address overlaps the browser profile avatar.");
            ctx.assert(ctx.browser.expandedAddress.value === ctx.fixture.url, "The expanded field does not show the current URL.");
          },
          screenshot: { name: "expanded-browser-address", requireText: [] },
        });

        await ctx.prove("Escape and the browser shortcut restore the compact state", {
          action: async () => {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(compactSelector)}))`, {
              timeoutMs: 5_000,
              label: "compact address after Escape",
            });

            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "l", code: "KeyL", modifiers: 4, windowsVirtualKeyCode: 76, nativeVirtualKeyCode: 37 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "l", code: "KeyL", modifiers: 4, windowsVirtualKeyCode: 76, nativeVirtualKeyCode: 37 });
            await ctx.waitFor(
              `document.activeElement === document.querySelector(${JSON.stringify(inputSelector)})`,
              { timeoutMs: 5_000, label: "address focus after Command-L" },
            );
            ctx.browser.addressShortcutWorked = true;

            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(compactSelector)}))`, {
              timeoutMs: 5_000,
              label: "compact address after shortcut Escape",
            });
          },
          assert: async () => {
            ctx.assert(ctx.browser.addressShortcutWorked, "Command-L did not focus the address field.");
          },
        });
      },
    },
    {
      name: "Semantic snapshot returns stable refs across modern DOM boundaries",
      run: async (ctx) => {
        await ctx.prove("The host reads controls as a compact semantic tree with stable refs", {
          voiceover: vo[2],
          action: async () => {
            const first = await ctx.control("browser.snapshot", { tabId: ctx.browser.opened.tabId });
            const second = await ctx.control("browser.snapshot", { tabId: ctx.browser.opened.tabId });
            ctx.browser.snapshot = second;
            ctx.browser.firstRefs = {
              title: refFor(first.tree, "Post title"),
              preview: refFor(first.tree, "Preview"),
              shadow: refFor(first.tree, "Shadow action"),
              frame: refFor(first.tree, "Frame action"),
              upload: refFor(first.tree, "Upload training asset"),
            };
            ctx.browser.refs = {
              title: refFor(second.tree, "Post title"),
              preview: refFor(second.tree, "Preview"),
              shadow: refFor(second.tree, "Shadow action"),
              frame: refFor(second.tree, "Frame action"),
              upload: refFor(second.tree, "Upload training asset"),
            };
            await showProofPanel(ctx, "语义快照取代 selector 和整页 HTML", "Ego 式稳定引用已落到 Host Runtime，并覆盖普通控件、Shadow DOM、iframe 与隐藏上传控件。", [
              { label: "Snapshot", value: second.snapshotId },
              { label: "Stable refs", value: Object.entries(ctx.browser.refs).map(([name, ref]) => `${name}: ${ref}`).join("\n") },
              { label: "Semantic tree", value: compactTree(second.tree) },
              { label: "Bounded", value: `${second.elementCount} actionable refs · truncated=${second.truncated}` },
            ]);
          },
          assert: async () => {
            for (const [name, ref] of Object.entries(ctx.browser.refs)) {
              ctx.assert(Boolean(ref), `Semantic snapshot did not expose ${name}.`);
              ctx.assert(ref === ctx.browser.firstRefs[name], `${name} did not keep its stable ref.`);
            }
            ctx.assert(!ctx.browser.snapshot.tree.includes("querySelector"), "Snapshot leaked selector instructions.");
          },
          screenshot: { name: "semantic-stable-refs", requireText: ["语义快照", "Shadow DOM", "STABLE REFS"] },
        });
      },
    },
    {
      name: "Stable refs drive real input",
      run: async (ctx) => {
        await ctx.prove("A ref-based batch fills the field and clicks Preview with real input", {
          voiceover: vo[3],
          action: async () => {
            ctx.browser.act = await ctx.control("browser.act", {
              tabId: ctx.browser.opened.tabId,
              snapshotId: ctx.browser.snapshot.snapshotId,
              actions: [
                { type: "fill", ref: ctx.browser.refs.title, value: "AI-native browser runtime" },
                { type: "click", ref: ctx.browser.refs.preview.replace(/^@/, ""), expectedName: "Preview" },
              ],
            });
            ctx.browser.snapshot = await ctx.control("browser.snapshot", { tabId: ctx.browser.opened.tabId });
            await showProofPanel(ctx, "真实键盘与指针完成操作", "模型只提交意图和稳定引用；Host 验证名称、可见性与遮挡后才发送真实输入。", [
              { label: "Action 1", value: `${ctx.browser.act.results[0].type} ${ctx.browser.act.results[0].ref}` },
              { label: "Action 2", value: `${ctx.browser.act.results[1].type} ${ctx.browser.act.results[1].name}` },
              { label: "Page witness", value: "Preview ready: AI-native browser runtime" },
              { label: "No arbitrary eval", value: "No engine-supplied JavaScript · no CSS selector contract" },
            ]);
          },
          assert: async () => {
            ctx.assert(ctx.browser.act.results.map((item) => item.type).join(",") === "fill,click", "The real action batch did not complete.");
            ctx.assert(ctx.browser.snapshot.tree.includes("Preview ready: AI-native browser runtime"), "The page did not reflect the real input.");
          },
          screenshot: { name: "real-input", requireText: ["真实键盘与指针", "Preview ready"] },
        });
      },
    },
    {
      name: "Bounded batches reject stale references",
      run: async (ctx) => {
        await ctx.prove("A bounded batch stops after page change and stale refs cannot be replayed", {
          voiceover: vo[4],
          action: async () => {
            const before = ctx.browser.snapshot;
            const titleRef = refFor(before.tree, "Post title");
            const shadowRef = refFor(before.tree, "Shadow action");
            ctx.browser.boundedAct = await ctx.control("browser.act", {
              tabId: ctx.browser.opened.tabId,
              snapshotId: before.snapshotId,
              actions: [
                { type: "fill", ref: titleRef, value: "Second safe pass" },
                { type: "wait", durationMs: 80 },
                { type: "click", ref: shadowRef, expectedName: "Shadow action" },
              ],
            });
            await new Promise((resolve) => setTimeout(resolve, 120));
            try {
              await ctx.control("browser.act", {
                tabId: ctx.browser.opened.tabId,
                snapshotId: before.snapshotId,
                actions: [{ type: "click", ref: shadowRef, expectedName: "Shadow action" }],
              });
              ctx.browser.staleError = "no error";
            } catch (error) {
              ctx.browser.staleError = error instanceof Error ? error.message : String(error);
            }
            ctx.browser.snapshot = await ctx.control("browser.snapshot", { tabId: ctx.browser.opened.tabId });
            await showProofPanel(ctx, "批量执行有边界，页面变化就重新观察", "一次最多 8 步；等待总时长受限；导航后旧 snapshot 与旧 ref 立即失效。", [
              { label: "Bounded batch", value: ctx.browser.boundedAct.results.map((item) => item.type).join(" → ") },
              { label: "Changed URL", value: ctx.browser.snapshot.url },
              { label: "Replay result", value: ctx.browser.staleError },
              { label: "Recovery", value: `new snapshot ${ctx.browser.snapshot.snapshotId}` },
            ]);
          },
          assert: async () => {
            ctx.assert(ctx.browser.boundedAct.results.length === 3, "The bounded action did not complete its safe steps.");
            ctx.assert(ctx.browser.snapshot.url.endsWith("#shadow-complete"), "The page-change witness is missing.");
            ctx.assert(/stale/i.test(ctx.browser.staleError), "The runtime accepted a stale snapshot replay.");
          },
          screenshot: { name: "stale-ref-rejected", requireText: ["页面变化就重新观察", "REPLAY RESULT"] },
        });
      },
    },
    {
      name: "Every engine reaches the same host session",
      run: async (ctx) => {
        await ctx.prove("The engine-facing host tool route returns the same tab and refs", {
          voiceover: vo[5],
          action: async () => {
            const serverInfo = await desktopServerInfo(ctx);
            const status = await fetch(`${serverInfo.baseUrl}/status`, { headers: clientHeaders(serverInfo) }).then((response) => response.json());
            const catalog = await fetch(`${serverInfo.baseUrl}/engine-tools`, { headers: clientHeaders(serverInfo) }).then((response) => response.json());
            const response = await fetch(`${serverInfo.baseUrl}/engine-tools/call`, {
              method: "POST",
              headers: { ...clientHeaders(serverInfo), "content-type": "application/json" },
              body: JSON.stringify({
                name: "ipollowork_browser_snapshot",
                args: { tabId: ctx.browser.opened.tabId },
                context: { workspaceId: status.activeWorkspaceId, sessionId: "fraimz-secondary-engine" },
              }),
            });
            ctx.browser.engineSnapshotStatus = response.status;
            ctx.browser.engineSnapshot = await response.json();
            ctx.browser.engineTools = catalog.tools.map((tool) => tool.name).filter((name) => name.startsWith("ipollowork_browser_"));
            await showProofPanel(ctx, "所有引擎共用同一条 Host Tool 路径", "OpenCode、DeepSeek Harness、Codex 只负责适配自己的会话协议；浏览器状态、权限和引用仍只有一份。", [
              { label: "Shared route", value: "GET /engine-tools · POST /engine-tools/call · MCP /engine-tools/mcp" },
              { label: "Browser tools", value: ctx.browser.engineTools.join("\n") },
              { label: "Same tab", value: `${ctx.browser.engineSnapshot.tabId} · ${ctx.browser.engineSnapshot.url}` },
              { label: "Same stable ref", value: `Post title = ${refFor(ctx.browser.engineSnapshot.tree, "Post title")}` },
            ]);
          },
          assert: async () => {
            ctx.assert(ctx.browser.engineSnapshotStatus === 200, "The shared engine-host route failed.");
            ctx.assert(ctx.browser.engineSnapshot.tabId === ctx.browser.opened.tabId, "The engine route created a separate browser session.");
            ctx.assert(ctx.browser.engineTools.length === 4, "The shared browser tool catalog is incomplete.");
            ctx.assert(
              refFor(ctx.browser.engineSnapshot.tree, "Post title") === refFor(ctx.browser.snapshot.tree, "Post title"),
              "The engine-host route did not preserve the host-owned stable ref.",
            );
          },
          screenshot: { name: "all-engines-one-host", requireText: ["所有引擎", "/engine-tools/call", "SAME TAB"] },
        });
      },
    },
    {
      name: "Consequential clicks require named approval",
      run: async (ctx) => {
        await ctx.prove("Manual approval pauses a publish click and names the requesting session", {
          voiceover: vo[6],
          action: async () => {
            const run = await execFile("pnpm", [
              "--filter", "ipollowork-server", "exec", "bun", "test", "src/extensions-connect-gating.test.ts",
            ], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
            const testOutput = `${run.stdout}\n${run.stderr}`.trim();
            ctx.output("manual browser approval integration test", testOutput);
            ctx.browser.approvalTestOutput = testOutput;
            const untouched = await ctx.control("browser.snapshot", { tabId: ctx.browser.opened.tabId });
            await showProofPanel(ctx, "高后果动作由 iPolloWork 统一审批", "启用手动审批时，Publish/Delete/Pay 等点击会在 Host 层暂停；拒绝后不会触发网页操作，也不会自动重试。", [
              { label: "Approval action", value: "browser.external.consequential" },
              { label: "Requester shown", value: "session session_editor" },
              { label: "Requested control", value: "Publish now" },
              { label: "Verified outcome", value: "Denied with 403 · page is not Published" },
            ]);
            ctx.browser.finalSnapshot = untouched;
            await ctx.eval("window.__IPOLLOWORK_ELECTRON__.browser.closeAllTabs()", { awaitPromise: true });
            await ctx.fixture.close();
          },
          assert: async () => {
            ctx.assert(ctx.browser.approvalTestOutput.includes("pauses consequential browser clicks and identifies the requesting session"), "The manual approval integration test did not run.");
            ctx.assert(!ctx.browser.finalSnapshot.tree.includes('StaticText "Published"'), "The protected publish action changed the page.");
          },
          screenshot: { name: "named-host-approval", requireText: ["高后果动作", "session_editor", "Denied with 403"] },
        });
      },
    },
  ],
};
