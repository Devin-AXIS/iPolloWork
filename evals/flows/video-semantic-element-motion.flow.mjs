import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_ENTRY = join(REPO_ROOT, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs");
const PHASE_LABELS = new Set(["出现", "动作", "消失"]);

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startPreview(projectDir) {
  const port = await availablePort();
  if (!port) throw new Error("Could not reserve a preview port.");
  const output = [];
  const child = spawn(
    process.execPath,
    [CLI_ENTRY, "preview", projectDir, "--port", String(port), "--no-open"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`HyperFrames preview exited early (${child.exitCode}): ${output.join("").slice(-2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return { child, port, output };
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for HyperFrames preview: ${output.join("").slice(-2000)}`);
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function selectPhase(ctx, label) {
  const selected = await ctx.eval(`(() => {
    const panel = document.querySelector('[data-testid="semantic-motion-panel"]');
    const button = [...(panel?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(selected, `Motion phase ${label} is unavailable.`);
  await ctx.eval(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    { awaitPromise: true },
  );
}

async function assertPresetLabels(ctx, expected, rejected) {
  const state = await ctx.eval(`(() => {
    const phaseLabels = new Set(${JSON.stringify([...PHASE_LABELS])});
    const panel = document.querySelector('[data-testid="semantic-motion-panel"]');
    const labels = [...(panel?.querySelectorAll("button") ?? [])]
      .map((button) => button.innerText.trim().split("\\n", 1)[0])
      .filter((label) => label && !phaseLabels.has(label));
    return { exists: Boolean(panel), labels };
  })()`);
  ctx.assert(state.exists, "The semantic motion panel did not open for the selected element.");
  ctx.assert(
    JSON.stringify(state.labels) === JSON.stringify(expected),
    `Expected presets ${JSON.stringify(expected)}, received ${JSON.stringify(state.labels)}.`,
  );
  ctx.assert(
    rejected.every((label) => !state.labels.includes(label)),
    `Text-only presets leaked into the element catalog: ${JSON.stringify(state.labels)}.`,
  );
}

async function startHandoffObservation(ctx, storageKey) {
  const observed = await ctx.eval(`(() => {
    const storageKey = ${JSON.stringify(storageKey)};
    const entries = () => [...document.querySelectorAll("hyperframes-player")]
      .map((player) => ({
        frame: player.shadowRoot?.querySelector(".hfp-iframe"),
        wrapper: player.parentElement?.parentElement,
      }))
      .filter((entry) => entry.frame instanceof HTMLIFrameElement);
    const isVisible = (entry) => {
      if (!entry.frame.isConnected || entry.frame.style.visibility === "hidden") return false;
      const style = entry.wrapper instanceof HTMLElement ? getComputedStyle(entry.wrapper) : null;
      return !style || (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0
      );
    };
    const initial = entries().find(isVisible);
    if (!initial) return false;
    const proof = {
      initialFrame: initial.frame,
      hiddenSeen: false,
      noVisibleFrameSeen: false,
      visibleOverlaySeen: false,
      handoffSeen: false,
    };
    const sample = () => {
      const visible = entries().filter(isVisible);
      if (visible.length === 0) proof.noVisibleFrameSeen = true;
      if (proof.initialFrame.style.visibility === "hidden") proof.hiddenSeen = true;
      if (visible.some((entry) => entry.frame !== proof.initialFrame)) proof.handoffSeen = true;
      for (const overlay of document.querySelectorAll(
        '[data-testid="composition-refresh-loading-overlay"], [data-testid="composition-loading-overlay"]',
      )) {
        let node = overlay;
        let overlayVisible = true;
        while (node instanceof HTMLElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
            overlayVisible = false;
            break;
          }
          node = node.parentElement;
        }
        if (overlayVisible) proof.visibleOverlaySeen = true;
      }
    };
    const interval = setInterval(sample, 8);
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    sample();
    window[storageKey] = { proof, interval, observer };
    return true;
  })()`);
  ctx.assert(observed, `The visible composition could not be observed for ${storageKey}.`);
}

async function finishHandoffObservation(ctx, storageKey) {
  return ctx.eval(`(() => {
    const active = window[${JSON.stringify(storageKey)}];
    if (active?.interval) clearInterval(active.interval);
    active?.observer?.disconnect();
    const proof = active?.proof;
    return proof ? {
      hiddenSeen: proof.hiddenSeen,
      noVisibleFrameSeen: proof.noVisibleFrameSeen,
      visibleOverlaySeen: proof.visibleOverlaySeen,
      handoffSeen: proof.handoffSeen,
    } : null;
  })()`);
}

export default {
  id: "video-semantic-element-motion",
  title: "A selected video element gets a compact semantic appear, action, and disappear catalog",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_EVAL_VIDEO_PROJECT_FILE"],
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "iPolloWork control API",
    });
    ctx.appUrl = await ctx.eval("location.href");
    return null;
  },
  steps: [
    {
      name: "The selected element exposes the unified semantic motion catalog",
      run: async (ctx) => {
        const projectFile = ctx.env.IPOLLOWORK_EVAL_VIDEO_PROJECT_FILE;
        const projectDir = dirname(projectFile);
        const originalSource = await readFile(projectFile);
        const originalHash = contentHash(originalSource);
        let tempRoot = null;
        let preview = null;
        let sourceError = null;

        try {
          const closed = await ctx.eval(`(() => {
            const frame = document.querySelector('iframe[title="HyperFrames 视频工作室"], iframe[title="HyperFrames Video Studio"]');
            if (!frame) return true;
            const button = document.querySelector('button[aria-label="关闭视频工作室"], button[aria-label="Close Video Studio"]');
            button?.click();
            return Boolean(button);
          })()`);
          ctx.assert(closed, "The embedded Video Studio could not be closed before isolated proof setup.");
          await ctx.waitFor('!document.querySelector(\'iframe[title="HyperFrames 视频工作室"], iframe[title="HyperFrames Video Studio"]\')', {
            timeoutMs: 20_000,
            label: "embedded Studio to close",
          });

          tempRoot = await mkdtemp(join(tmpdir(), "ipw-motion-proof-"));
          const tempProject = join(tempRoot, basename(projectDir));
          await cp(projectDir, tempProject, { recursive: true });
          preview = await startPreview(tempProject);
          const studioUrl = `http://127.0.0.1:${preview.port}/#project/${encodeURIComponent(basename(tempProject))}?v=1&t=0&tab=design&locale=zh&ipolloworkTheme=light`;

          await ctx.eval(`location.assign(${JSON.stringify(studioUrl)})`);
          await ctx.waitFor('document.title === "HyperFrames Studio"', {
            timeoutMs: 60_000,
            label: "isolated Studio surface",
          });
          await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label^="选择 "]\'))', {
            timeoutMs: 60_000,
            label: "Studio timeline layers",
          });

          const layerName = ctx.env.IPOLLOWORK_EVAL_MOTION_LAYER?.trim() || "Timeline Fill";
          const selected = await ctx.eval(`(() => {
            const label = ${JSON.stringify(`选择 ${ctx.env.IPOLLOWORK_EVAL_MOTION_LAYER?.trim() || "Timeline Fill"}`)};
            const button = [...document.querySelectorAll("button")]
              .find((candidate) => candidate.getAttribute("aria-label") === label);
            button?.click();
            return Boolean(button);
          })()`);
          ctx.assert(selected, `The requested non-text layer ${layerName} was not available.`);
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="semantic-motion-panel"]\'))', {
            timeoutMs: 20_000,
            label: "semantic motion panel for selected element",
          });

          await ctx.prove("A normal element starts with a compact element-only entrance catalog", {
            claim: "Selecting a non-text video element opens three semantic appearance choices, without legacy controls or text-only effects.",
            voiceover: "选择视频里的普通元素后，动画直接显示出现、动作和消失。默认只给淡入、滑入和缩放进入三种清晰选择，不再出现旧版编辑器。",
            assert: async () => {
              await assertPresetLabels(ctx, ["淡入", "滑入", "缩放进入"], ["逐字出现", "字符解码"]);
            },
            screenshot: {
              name: "element-enter-presets",
              requireText: ["出现", "动作", "消失", "淡入", "滑入", "缩放进入"],
              rejectText: ["旧版", "新动画", "逐字出现", "字符解码", "Something went wrong"],
            },
          });

          await ctx.prove("Motion timing is simple, persistent, and does not flash the preview", {
            claim: "Applying an effect reveals only duration, speed, and effect-specific controls; adding it and changing duration persist without reloading or covering the preview.",
            voiceover: "选择滑入后，常用控制只有时长和慢、正常、快三档。首次添加和拖动时长都会直接更新当前画面，不会让视频预览闪白。",
            action: async () => {
              const observed = await ctx.eval(`(() => {
                const host = [...document.querySelectorAll("*")]
                  .find((element) => element.shadowRoot?.querySelector(".hfp-iframe"));
                const frame = host?.shadowRoot?.querySelector(".hfp-iframe");
                if (!(frame instanceof HTMLIFrameElement)) return false;
                const proof = { frame, loads: 0, hiddenSeen: false, overlaySeen: false, revealingSeen: false };
                frame.addEventListener("load", () => { proof.loads += 1; });
                const observer = new MutationObserver(() => {
                  const overlay = document.querySelector('[data-testid="composition-refresh-loading-overlay"]');
                  if (overlay) {
                    let visible = true;
                    for (let node = overlay; node instanceof HTMLElement; node = node.parentElement) {
                      const style = getComputedStyle(node);
                      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
                        visible = false;
                        break;
                      }
                    }
                    if (visible) proof.overlaySeen = true;
                  }
                  if (frame.style.visibility === "hidden") proof.hiddenSeen = true;
                  if (frame.closest(".preview-revealing")) proof.revealingSeen = true;
                });
                observer.observe(document.body, { attributes: true, childList: true, subtree: true });
                window.__ipwMotionProof = { proof, observer };
                return true;
              })()`);
              ctx.assert(observed, "The live composition iframe could not be observed before applying motion.");
              const applied = await ctx.eval(`(() => {
                const panel = document.querySelector('[data-testid="semantic-motion-panel"]');
                const button = [...(panel?.querySelectorAll("button") ?? [])]
                  .find((candidate) => candidate.innerText.trim().split("\\n", 1)[0] === "滑入");
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(applied, "The slide-in preset could not be applied.");
              await ctx.waitFor(
                'Boolean(document.querySelector(\'[role="slider"][aria-label="时长"]\'))',
                { timeoutMs: 20_000, label: "duration control after applying motion" },
              );
              await new Promise((resolve) => setTimeout(resolve, 500));
              const before = await ctx.eval(
                'Number(document.querySelector(\'[role="slider"][aria-label="时长"]\')?.getAttribute("aria-valuenow"))',
              );
              await ctx.eval(`(() => {
                const slider = document.querySelector('[role="slider"][aria-label="时长"]');
                slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
                return Boolean(slider);
              })()`);
              await ctx.waitFor(
                `Number(document.querySelector('[role="slider"][aria-label="时长"]')?.getAttribute("aria-valuenow")) > ${JSON.stringify(before)}`,
                { timeoutMs: 20_000, label: "duration mutation to persist" },
              );
              await new Promise((resolve) => setTimeout(resolve, 350));
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const proof = window.__ipwMotionProof?.proof;
                const host = [...document.querySelectorAll("*")]
                  .find((element) => element.shadowRoot?.querySelector(".hfp-iframe"));
                const frame = host?.shadowRoot?.querySelector(".hfp-iframe");
                return {
                  loads: proof?.loads ?? -1,
                  hiddenSeen: proof?.hiddenSeen ?? true,
                  overlaySeen: proof?.overlaySeen ?? true,
                  revealingSeen: proof?.revealingSeen ?? true,
                  sameFrame: frame === proof?.frame,
                  text: document.querySelector('[data-testid="semantic-motion-panel"]')?.innerText ?? "",
                };
              })()`);
              ctx.assert(state.loads === 0, `Adding or editing motion reloaded the preview ${state.loads} time(s).`);
              ctx.assert(!state.hiddenSeen, "Adding or editing motion hid the visible composition frame.");
              ctx.assert(!state.overlaySeen, "Adding or editing motion displayed the preview refresh overlay.");
              ctx.assert(!state.revealingSeen, "Adding or editing motion ran the iframe reload reveal animation.");
              ctx.assert(state.text.includes("时长") && state.text.includes("速度"), "Simple timing controls are missing.");
              ctx.assert(!state.text.includes("速度曲线") && !state.text.includes("旧版"), "Technical or legacy controls are still visible.");
              const source = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(
                source.includes("duration: 0.7") && source.includes('\\"duration\\":0.7'),
                "The duration change was not persisted to the semantic motion contract.",
              );
            },
            screenshot: {
              name: "element-motion-simple-controls",
              requireText: ["出现", "滑入", "时长", "速度", "慢", "正常", "快", "预览动画"],
              rejectText: ["旧版", "新动画", "速度曲线", "变化到", "从设定值进入", "Something went wrong"],
            },
          });

          await ctx.prove("Preview plays only the selected animation range", {
            claim: "Preview starts the real player at the selected effect and returns it to pause when that animation ends.",
            voiceover: "点击预览动画会真正播放这一段效果，并在动画结束后自动停下，不会假装进入播放状态。",
            action: async () => {
              const clicked = await ctx.eval(`(() => {
                const panel = document.querySelector('[data-testid="semantic-motion-panel"]');
                const button = [...(panel?.querySelectorAll("button") ?? [])]
                  .find((candidate) => candidate.innerText.trim() === "预览动画");
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(clicked, "Preview animation action is unavailable.");
              await ctx.waitFor(
                'document.querySelector(".hf-studio-play-control")?.getAttribute("aria-label") === "暂停"',
                { timeoutMs: 5_000, label: "motion preview to start playback" },
              );
            },
            assert: async () => {
              await ctx.waitFor(
                'document.querySelector(".hf-studio-play-control")?.getAttribute("aria-label") === "播放"',
                { timeoutMs: 5_000, label: "motion preview to stop at its end" },
              );
            },
            screenshot: {
              name: "element-motion-preview-complete",
              requireText: ["预览动画", "时长", "速度"],
              rejectText: ["旧版", "Something went wrong"],
            },
          });

          await ctx.prove("Switching effects keeps the current frame visible", {
            claim: "Replacing one effect with another keeps the previous frame visible until the updated composition is ready.",
            voiceover: "把滑入换成缩放进入时，系统只替换这一段动画。当前画面会一直保留，不会先空白再恢复。",
            action: async () => {
              const persistedBeforeSwitch = await readFile(join(tempProject, "index.html"), "utf8");
              const motionLine = persistedBeforeSwitch
                .split("\n")
                .find((line) => line.includes('tl.to(".timeline-fill"'));
              ctx.recordEvidence({
                type: "assertion",
                status: motionLine?.includes("motion:.timeline-fill:enter") ? "passed" : "failed",
                assertion: "The persisted semantic tween carries its stable runtime id",
                actual: motionLine ?? "missing motion line",
              });
              const observed = await ctx.eval(`(() => {
                const host = [...document.querySelectorAll("*")]
                  .find((element) => element.shadowRoot?.querySelector(".hfp-iframe"));
                const frame = host?.shadowRoot?.querySelector(".hfp-iframe");
                if (!(frame instanceof HTMLIFrameElement)) return false;
                const proof = {
                  frame,
                  loads: 0,
                  hiddenSeen: false,
                  revealingSeen: false,
                };
                frame.addEventListener("load", () => { proof.loads += 1; });
                const observer = new MutationObserver(() => {
                  if (frame.style.visibility === "hidden") proof.hiddenSeen = true;
                  if (frame.closest(".preview-revealing")) proof.revealingSeen = true;
                });
                observer.observe(document.body, { attributes: true, subtree: true });
                window.__ipwMotionSwitchProof = { proof, observer };
                return true;
              })()`);
              ctx.assert(observed, "The composition iframe could not be observed before replacing the effect.");
              const switched = await ctx.eval(`(() => {
                const button = document.querySelector('button[aria-label="动画效果"]');
                button?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
                return Boolean(button);
              })()`);
              ctx.assert(switched, "The applied animation selector could not be changed.");
              await ctx.waitFor(
                'document.querySelector(\'button[aria-label="动画效果"]\')?.textContent?.includes("缩放进入")',
                { timeoutMs: 20_000, label: "replacement effect to persist" },
              );
              await new Promise((resolve) => setTimeout(resolve, 700));
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const proof = window.__ipwMotionSwitchProof?.proof;
                return {
                  loads: proof?.loads ?? -1,
                  hiddenSeen: proof?.hiddenSeen ?? true,
                  revealingSeen: proof?.revealingSeen ?? true,
                };
              })()`);
              ctx.assert(state.loads === 0, `Switching effects reloaded the preview ${state.loads} time(s).`);
              ctx.assert(!state.hiddenSeen, "Switching effects hid the composition iframe.");
              ctx.assert(!state.revealingSeen, "Switching effects ran the iframe reload reveal animation.");
              const source = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(source.includes("element.enter.scale"), "The replacement preset was not persisted.");
            },
            screenshot: {
              name: "element-motion-switch-no-flash",
              requireText: ["出现", "缩放进入", "时长", "速度", "预览动画"],
              rejectText: ["旧版", "Something went wrong"],
            },
          });

          await ctx.prove("The same element switches to a separate emphasis vocabulary", {
            claim: "Action offers three reversible element motions using the same panel and semantic contract.",
            voiceover: "切到动作，仍然是同一套面板和同一套时间线，只出现浮起、呼吸和轻摆。效果执行完会回到元素原来的设计状态。",
            action: async () => selectPhase(ctx, "动作"),
            assert: async () => {
              await assertPresetLabels(ctx, ["浮起", "呼吸", "轻摆"], ["脉冲", "故障闪烁"]);
            },
            screenshot: {
              name: "element-emphasis-presets",
              requireText: ["动作", "浮起", "呼吸", "轻摆"],
              rejectText: ["脉冲", "故障闪烁", "Something went wrong"],
            },
          });

          await ctx.prove("Exit completes the same three-phase model without adding another editor", {
            claim: "Exit reuses the exact same controls and exposes only the three appropriate element departures.",
            voiceover: "切到消失，操作方式完全不变，只换成淡出、滑出和缩小退出。文字与普通元素共用结构，但各自拥有适合自己的动画词汇。",
            action: async () => selectPhase(ctx, "消失"),
            assert: async () => {
              await assertPresetLabels(ctx, ["淡出", "滑出", "缩小退出"], ["模糊消失", "擦除退出"]);
            },
            screenshot: {
              name: "element-exit-presets",
              requireText: ["消失", "淡出", "滑出", "缩小退出"],
              rejectText: ["模糊消失", "擦除退出", "Something went wrong"],
            },
          });

          await ctx.prove("Adding a component keeps the previous frame visible until the new composition is ready", {
            claim: "A structural project edit uses a staged player handoff instead of blanking or navigating the visible composition.",
            voiceover: "添加一个完整组件需要重新解析视频结构。刷新期间旧画面会继续显示，新画面在后台准备好后才接管，因此不会先白一下再恢复。",
            action: async () => {
              const openedCatalog = await ctx.eval(`(() => {
                const button = [...document.querySelectorAll("button")]
                  .find((candidate) => candidate.innerText.trim() === "动画");
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(openedCatalog, "The animation catalog tab could not be opened.");
              await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="block-catalog-search"]\'))', {
                timeoutMs: 20_000,
                label: "component catalog search",
              });
              await ctx.eval(`(() => {
                const input = document.querySelector('[data-testid="block-catalog-search"]');
                if (!(input instanceof HTMLInputElement)) return false;
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                setter?.call(input, "RoughEase Official Demo");
                input.dispatchEvent(new Event("input", { bubbles: true }));
                return true;
              })()`);
              await ctx.waitFor(
                'Boolean(document.querySelector(\'[data-testid="block-catalog-card"][data-block-name="gsap-rough-ease-official"]\'))',
                { timeoutMs: 20_000, label: "RoughEase component card" },
              );

              const observed = await ctx.eval(`(() => {
                const frames = () => [...document.querySelectorAll("hyperframes-player")]
                  .map((player) => ({
                    player,
                    frame: player.shadowRoot?.querySelector(".hfp-iframe"),
                    wrapper: player.parentElement?.parentElement,
                  }))
                  .filter((entry) => entry.frame instanceof HTMLIFrameElement);
                const isVisible = (entry) => {
                  if (!entry.frame.isConnected || entry.frame.style.visibility === "hidden") return false;
                  const wrapperStyle = entry.wrapper instanceof HTMLElement ? getComputedStyle(entry.wrapper) : null;
                  return !wrapperStyle || (
                    wrapperStyle.display !== "none" &&
                    wrapperStyle.visibility !== "hidden" &&
                    Number(wrapperStyle.opacity) !== 0
                  );
                };
                const current = frames().find(isVisible);
                if (!current) return false;
                const proof = {
                  frame: current.frame,
                  hiddenSeen: false,
                  noVisibleFrameSeen: false,
                  visibleOverlaySeen: false,
                  handoffSeen: false,
                };
                const sample = () => {
                  const entries = frames();
                  const visible = entries.filter(isVisible);
                  if (visible.length === 0) proof.noVisibleFrameSeen = true;
                  if (proof.frame.style.visibility === "hidden") proof.hiddenSeen = true;
                  if (visible.some((entry) => entry.frame !== proof.frame)) proof.handoffSeen = true;
                  const overlay = document.querySelector('[data-testid="composition-refresh-loading-overlay"], [data-testid="composition-loading-overlay"]');
                  if (overlay instanceof HTMLElement) {
                    let node = overlay;
                    let visibleOverlay = true;
                    while (node) {
                      const style = getComputedStyle(node);
                      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
                        visibleOverlay = false;
                        break;
                      }
                      node = node.parentElement;
                    }
                    if (visibleOverlay) proof.visibleOverlaySeen = true;
                  }
                };
                const interval = setInterval(sample, 8);
                const observer = new MutationObserver(sample);
                observer.observe(document.body, { attributes: true, childList: true, subtree: true });
                sample();
                window.__ipwStructuralRefreshProof = { proof, interval, observer };
                return true;
              })()`);
              ctx.assert(observed, "The visible composition could not be observed before adding a component.");

              const added = await ctx.eval(`(() => {
                const card = document.querySelector('[data-testid="block-catalog-card"][data-block-name="gsap-rough-ease-official"]');
                if (!(card instanceof HTMLElement)) return false;
                card.click();
                return true;
              })()`);
              ctx.assert(added, "The RoughEase component could not be added.");
              await ctx.waitFor(
                'window.__ipwStructuralRefreshProof?.proof?.handoffSeen === true',
                { timeoutMs: 30_000, label: "staged composition handoff" },
              );
              await ctx.waitFor(
                'document.querySelectorAll("hyperframes-player").length === 1',
                { timeoutMs: 20_000, label: "retiring player cleanup" },
              );
              await new Promise((resolve) => setTimeout(resolve, 500));
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const active = window.__ipwStructuralRefreshProof;
                if (active?.interval) clearInterval(active.interval);
                active?.observer?.disconnect();
                return active?.proof ?? null;
              })()`);
              ctx.assert(state?.handoffSeen, "The staged player handoff did not complete.");
              ctx.assert(!state?.hiddenSeen, "The previously visible composition iframe was hidden during component insertion.");
              ctx.assert(!state?.noVisibleFrameSeen, "Component insertion left the preview without a visible composition frame.");
              ctx.assert(!state?.visibleOverlaySeen, "Component insertion covered the visible composition with a loading overlay.");
              const source = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(
                source.includes('data-composition-src="compositions/gsap-rough-ease-official.html"'),
                "The added component was not persisted to the isolated video project.",
              );
              const composition = await readFile(
                join(tempProject, "compositions/gsap-rough-ease-official.html"),
                "utf8",
              );
              ctx.assert(composition.includes("RoughEase"), "The installed component source is incomplete.");
            },
            screenshot: {
              name: "component-add-staged-refresh",
              requireText: ["动画", "RoughEase Official Demo", "添加"],
              rejectText: ["Something went wrong"],
            },
          });

          await ctx.prove("Undo, redo, and reload preserve the animation without flashing", {
            claim: "Repeated structural history operations use the same staged handoff, and a full Studio reload restores the saved semantic animation.",
            voiceover: "继续撤销和重做新增组件时，画面仍然不会空白。随后完整重载工作室，刚才设置的缩放进入动画和新增组件都会从保存结果中恢复。",
            action: async () => {
              await startHandoffObservation(ctx, "__ipwUndoRefreshProof");
              const undone = await ctx.eval(`(() => {
                const button = document.querySelector('button[aria-label="撤销"]');
                button?.click();
                return Boolean(button && !button.disabled);
              })()`);
              ctx.assert(undone, "Undo was unavailable after adding the component.");
              await ctx.waitFor('window.__ipwUndoRefreshProof?.proof?.handoffSeen === true', {
                timeoutMs: 30_000,
                label: "undo staged composition handoff",
              });
              await ctx.waitFor('document.querySelectorAll("hyperframes-player").length === 1', {
                timeoutMs: 20_000,
                label: "undo retiring player cleanup",
              });
              const undoState = await finishHandoffObservation(ctx, "__ipwUndoRefreshProof");
              ctx.assert(undoState?.handoffSeen, "Undo did not complete the staged player handoff.");
              ctx.assert(!undoState?.hiddenSeen, "Undo hid the previously visible composition.");
              ctx.assert(!undoState?.noVisibleFrameSeen, "Undo left the preview without a visible frame.");
              ctx.assert(!undoState?.visibleOverlaySeen, "Undo covered the visible frame with a loading overlay.");
              const sourceAfterUndo = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(
                !sourceAfterUndo.includes('data-composition-src="compositions/gsap-rough-ease-official.html"'),
                "Undo did not remove the inserted component from source.",
              );

              await startHandoffObservation(ctx, "__ipwRedoRefreshProof");
              const redone = await ctx.eval(`(() => {
                const button = document.querySelector('button[aria-label="重做"]');
                button?.click();
                return Boolean(button && !button.disabled);
              })()`);
              ctx.assert(redone, "Redo was unavailable after undoing the component.");
              await ctx.waitFor('window.__ipwRedoRefreshProof?.proof?.handoffSeen === true', {
                timeoutMs: 30_000,
                label: "redo staged composition handoff",
              });
              await ctx.waitFor('document.querySelectorAll("hyperframes-player").length === 1', {
                timeoutMs: 20_000,
                label: "redo retiring player cleanup",
              });
              const redoState = await finishHandoffObservation(ctx, "__ipwRedoRefreshProof");
              ctx.assert(redoState?.handoffSeen, "Redo did not complete the staged player handoff.");
              ctx.assert(!redoState?.hiddenSeen, "Redo hid the previously visible composition.");
              ctx.assert(!redoState?.noVisibleFrameSeen, "Redo left the preview without a visible frame.");
              ctx.assert(!redoState?.visibleOverlaySeen, "Redo covered the visible frame with a loading overlay.");
              const sourceAfterRedo = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(
                sourceAfterRedo.includes('data-composition-src="compositions/gsap-rough-ease-official.html"'),
                "Redo did not restore the inserted component to source.",
              );

              const played = await ctx.eval(`(() => {
                const button = document.querySelector('.hf-studio-play-control');
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(played, "Playback was unavailable after the redo handoff.");
              await ctx.waitFor(
                'document.querySelector(".hf-studio-play-control")?.getAttribute("aria-label") === "暂停"',
                { timeoutMs: 5_000, label: "playback after redo" },
              );
              await ctx.eval('document.querySelector(".hf-studio-play-control")?.click()');
              await ctx.waitFor(
                'document.querySelector(".hf-studio-play-control")?.getAttribute("aria-label") === "播放"',
                { timeoutMs: 5_000, label: "pause after redo" },
              );

              await ctx.eval("location.reload(); true").catch(() => undefined);
              await ctx.waitFor('document.title === "HyperFrames Studio"', {
                timeoutMs: 60_000,
                label: "Studio after full reload",
              });
              await ctx.waitFor('document.body.innerText.includes("Gsap Rough Ease")', {
                timeoutMs: 60_000,
                label: "saved component after full reload",
              });
              const selectedAgain = await ctx.eval(`(() => {
                const button = [...document.querySelectorAll("button")]
                  .find((candidate) => candidate.getAttribute("aria-label")?.includes("Timeline Fill"));
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(selectedAgain, "The animated element could not be selected after a full reload.");
              await ctx.waitFor(
                'document.querySelector(\'button[aria-label="动画效果"]\')?.textContent?.includes("缩放进入")',
                { timeoutMs: 20_000, label: "saved semantic motion after full reload" },
              );
            },
            assert: async () => {
              const source = await readFile(join(tempProject, "index.html"), "utf8");
              ctx.assert(source.includes("element.enter.scale"), "The semantic animation was lost after reload.");
              ctx.assert(
                source.includes('data-composition-src="compositions/gsap-rough-ease-official.html"'),
                "The redone component was lost after reload.",
              );
            },
            screenshot: {
              name: "undo-redo-reload-stable",
              requireText: ["Timeline Fill", "缩放进入", "时长", "速度", "预览动画"],
              rejectText: ["Something went wrong"],
            },
          });
        } catch (error) {
          sourceError = error;
          throw error;
        } finally {
          await ctx.eval(`location.assign(${JSON.stringify(ctx.appUrl)})`).catch(() => undefined);
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
            timeoutMs: 60_000,
            label: "iPolloWork after isolated Studio proof",
          }).catch((restoreError) => {
            if (!sourceError) throw restoreError;
          });
          await stopPreview(preview?.child);
          if (tempRoot) await rm(tempRoot, { recursive: true, force: true });

          const projectSourceAfter = await readFile(projectFile);
          const projectHashAfter = contentHash(projectSourceAfter);
          const unchanged = projectHashAfter === originalHash;
          if (!unchanged) await writeFile(projectFile, originalSource);
          ctx.recordEvidence({
            type: "assertion",
            status: unchanged ? "passed" : "failed",
            assertion: "The isolated animation proof leaves the real video project source unchanged.",
            actual: unchanged ? projectHashAfter : `${projectHashAfter}; restored to ${originalHash}`,
          });
          if (!unchanged && !sourceError) {
            throw new Error(`Real video project changed during isolated proof and was restored: ${projectHashAfter} -> ${originalHash}`);
          }
        }
      },
    },
  ],
};
