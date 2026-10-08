export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoRuntimeReview {
  valid: boolean;
  scope: "runtime-timing-and-layout-not-semantic-approval";
  sampledFrameCount: number;
  issues: { sceneId: string; code: string; time: number; detail: string }[];
  carrierReview: {
    scope: "tracked-dom-not-semantic-continuity-approval";
    boundaries: { sceneId: string; time: number; required: boolean; sharedVisibleCarriers: number; sampleGap: number; displacementPx: number | null; scaleRatio: number | null; velocityChangePxPerSecond: number | null }[];
  };
  deterministicSeek: { checkedSceneCount: number; valid: boolean };
}

/** Runs inside the existing capture page. Candidate values never reach project files. */
export async function reviewComponentVariables(input: { elementId: string; values: Record<string, string | number | boolean> }): Promise<VideoRuntimeReview> {
  const issues: VideoRuntimeReview["issues"] = [];
  try {
    const ready = await Promise.race([document.fonts.ready.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
    if (!ready) throw Error("Actual project fonts are not ready");
    const host = document.getElementById(input.elementId);
    const root = host?.querySelector("[data-hf-live-variables]") ?? host;
    const runtime = Reflect.get(window, "__hyperframes");
    if (!root || !runtime || typeof runtime.updateVariables !== "function" || !runtime.updateVariables(root, input.values)) throw Error("The component preview cannot validate these values");
    const candidateFonts = await Promise.race([document.fonts.ready.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
    if (!candidateFonts) throw Error("The candidate component fonts are not ready");
    if (!runtime.updateVariables(root, input.values)) throw Error("The component preview cannot validate these values with the actual fonts");
  } catch (error) {
    issues.push({ sceneId: input.elementId, code: "component-layout", time: 0, detail: error instanceof Error ? error.message : "Component validation failed" });
  }
  return { valid: !issues.length, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount: 1, issues,
    carrierReview: { scope: "tracked-dom-not-semantic-continuity-approval", boundaries: [] }, deterministicSeek: { checkedSceneCount: 0, valid: true } };
}

/** Serialized into the existing capture page; inspect the executed timeline, not source labels. */
export async function reviewVideoRuntime(): Promise<VideoRuntimeReview> {
  const fontsReady = await Promise.race([document.fonts.ready.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))]);
  const issues: VideoRuntimeReview["issues"] = [];
  const add = (sceneId: string, code: string, time: number, detail: string) => {
    if (!issues.some(issue => issue.sceneId === sceneId && issue.code === code && issue.detail === detail)) issues.push({ sceneId, code, time, detail });
  };
  if (!fontsReady) add("root", "fonts-not-ready", 0, "Actual fonts did not load within the review limit");
  const invoke = (owner: unknown, name: string, args: unknown[] = []): unknown => {
    if (!owner || typeof owner !== "object") return undefined;
    const fn = Reflect.get(owner, name);
    return typeof fn === "function" ? Reflect.apply(fn, owner, args) : undefined;
  };
  const timelines = Reflect.get(window, "__timelines");
  const registered = timelines && typeof timelines === "object" ? Object.values(timelines) : [];
  const real = (timeline: unknown) => timeline && typeof timeline === "object" && Reflect.get(timeline, "__hfReal") || timeline;
  const entries = registered.map(timeline => {
    const children = invoke(timeline, "getChildren", [true, true, false]);
    const nested = invoke(timeline, "getChildren", [true, false, true]);
    return { timeline, tweens: Array.isArray(children) ? children : [], nested: Array.isArray(nested) ? nested : [] };
  });
  const roots = entries.filter(entry => !entries.some(other => real(other.timeline) !== real(entry.timeline) && other.nested.includes(real(entry.timeline))));
  const clocks = new Map<unknown, unknown>();
  for (const root of roots) for (const tween of root.tweens) clocks.set(tween, root.timeline);
  const tweens = [...clocks.keys()].filter((tween): tween is object => tween !== null && typeof tween === "object");
  const tweenTime = (tween: unknown, time: number) => {
    const clock = real(clocks.get(tween));
    let node = tween, localTime = time;
    // Public timeScale retains paused children's authored rate; GSAP globalTime
    // uses 1 for those children. Stop at the registered composition's clock.
    for (let depth = 0; depth < 64 && node && typeof node === "object"; depth++) {
      if (real(node) === clock) return localTime;
      const offset = invoke(node, "startTime"), scale = invoke(node, "timeScale");
      if (typeof offset !== "number" || !Number.isFinite(offset) || typeof scale !== "number" || !Number.isFinite(scale) || scale === 0) break;
      localTime = offset + localTime / Math.abs(scale);
      node = Reflect.get(node, "parent");
    }
    const value = invoke(tween, "globalTime", [time]);
    const origin = invoke(clock, "globalTime", [0]), unitEnd = invoke(clock, "globalTime", [1]);
    // Composition transport seeks the registered root's local clock, not its
    // GSAP wall-clock placement. Nested registered children share that clock.
    return typeof value === "number" && typeof origin === "number" && typeof unitEnd === "number" && Number.isFinite(origin) && Number.isFinite(unitEnd) && unitEnd !== origin
      ? (value - origin) / (unitEnd - origin) : value;
  };
  const seek = async (time: number) => {
    const player = Reflect.get(window, "__player");
    if (player && typeof player.seek === "function") invoke(player, "seek", [time]);
    else for (const root of roots) invoke(root.timeline, "pause", [time]);
    // Capture pages may be backgrounded; rAF alone can suspend indefinitely.
    await new Promise<void>(resolve => { const timeout = setTimeout(resolve, 50); requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }); });
  };
  const scenes = Array.from(document.querySelectorAll(".scene.clip, [data-ipw-scene]"));
  if (!registered.length || !scenes.length || scenes.length > 48) add("root", "runtime-review-unavailable", 0, "Require registered timeline and 1–48 scenes");
  let sampledFrameCount = 0;
  let checkedSceneCount = 0;
  const visible = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < .1) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const carriers = Array.from(document.querySelectorAll("[data-ipw-carrier], .vc-carrier")).slice(0, 160);
  const carrierSnapshot = () => carriers.map((element, index) => {
    const rect = element.getBoundingClientRect();
    return { index, visible: visible(element) && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  });
  const geometry = (scene: Element) => JSON.stringify([...scene.querySelectorAll("h1,h2,p,img,[data-ipw-carrier],.vc-carrier"), ...carriers].slice(0, 160).map(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    return { visible: visible(element), text: element.textContent, rect: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100), opacity: style.opacity, transform: Array.from(matrix.toFloat64Array()).map(value => Math.round(value * 10000) / 10000), clip: style.clipPath, filter: style.filter };
  }));
  const windows: { scene: Element; id: string; start: number; duration: number; boundaries: number[]; states: { time: number; carriers: ReturnType<typeof carrierSnapshot> }[] }[] = [];
  for (const scene of scenes.slice(0, 48)) {
    const start = Number(scene.getAttribute("data-start"));
    const duration = Number(scene.getAttribute("data-duration") ?? scene.getAttribute("data-hf-authored-duration"));
    const id = scene.id || "unnamed-scene";
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
      add(id, "invalid-runtime-window", 0, "Missing finite scene timing");
      continue;
    }
    let beats: unknown;
    try { beats = JSON.parse(scene.getAttribute("data-ipw-beats") || "[]"); }
    catch { add(id, "invalid-runtime-beats", start, "Malformed beat map"); }
    const events = Array.isArray(beats) ? beats.slice(0, 12) : [];
    type MotionState = { spacing: number; x: number; y: number }[];
    const decorativeChecks: { from: number; to: number; time: number; snapshot: () => MotionState; before?: MotionState; after?: MotionState }[] = [];
    // A long Develop cannot be sustained solely by tiny tracking/scale changes.
    // Inspect executed scene tweens, including unlabelled child actions; unknown
    // animation forms remain subject to visual review, never an inferred failure.
    for (const beat of events) {
      const from = start + Number(beat?.motion?.end) - 3, to = start + Number(beat?.motion?.end);
      if (beat?.intent !== "Develop" || !beat?.animation?.startsWith("custom:") || !Number.isFinite(Number(beat?.motion?.start)) || Number(beat.motion.end) - Number(beat.motion.start) < 4 || !Number.isFinite(from) || to > start + duration) continue;
      const active = tweens.filter(tween => {
        const targets = invoke(tween, "targets"), begin = tweenTime(tween, 0);
        const length = invoke(tween, "totalDuration"), end = typeof length === "number" ? tweenTime(tween, length) : undefined;
        const vars = Reflect.get(tween, "vars");
        // Object-state adapters can move DOM/Canvas through callbacks; their effect is unknown here.
        return (Array.isArray(targets) && targets.some(target => target instanceof Element && (scene.contains(target) || target.contains(scene)))
          || (vars && typeof vars.onUpdate === "function"))
          && typeof begin === "number" && typeof end === "number" && begin < to && (length === 0 ? begin >= from : end > from);
      });
      const controls = new Set(["duration", "delay", "ease", "data", "id", "parent", "startAt", "immediateRender", "overwrite", "lazy", "runBackwards", "stagger"]);
      const decorative = active.length > 0 && active.every(tween => {
        const vars = Reflect.get(tween, "vars");
        if (!vars || typeof vars !== "object") return false;
        const keys = Object.keys(vars).filter(key => !controls.has(key));
        return keys.length > 0 && keys.every(key => ["letterSpacing", "scale", "scaleX", "scaleY"].includes(key));
      });
      if (!decorative) continue;
      const targets = [...new Set(active.flatMap(tween => {
        const values = invoke(tween, "targets");
        return Array.isArray(values) ? values.filter((value): value is Element => value instanceof Element && (scene.contains(value) || value.contains(scene))) : [];
      }))];
      if (targets.length > 160) continue;
      const snapshot = () => targets.map(target => {
        const style = getComputedStyle(target), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
        return { spacing: Number.parseFloat(style.letterSpacing) || 0, x: Math.hypot(matrix.m11, matrix.m12, matrix.m13), y: Math.hypot(matrix.m21, matrix.m22, matrix.m23) };
      });
      // Reuse the existing action samples; a strong move may legitimately ease into rest.
      decorativeChecks.push({ from: start + Math.min(Number(beat.motion.end), Number(beat.motion.start) + 1 / 30), to: start + Math.min(duration - 1 / 30, Number(beat.motion.end)), time: from, snapshot });
    }
    for (const beat of events) {
      if (!beat || typeof beat !== "object" || typeof beat.animation !== "string" || (!beat.animation.startsWith("custom:") && !beat.animation.startsWith("component:"))) continue;
      const targets: Element[] = [];
      for (const selector of Array.isArray(beat.targets) ? beat.targets : []) {
        if (typeof selector !== "string") continue;
        try { targets.push(...scene.querySelectorAll(selector)); } catch { /* Source gate owns malformed selectors. */ }
      }
      const matches = tweens.filter(tween => {
        if (!tween || typeof tween !== "object" || (beat.animation.startsWith("custom:") && Reflect.get(tween, "data") !== beat.animation)) return false;
        const actualTargets = invoke(tween, "targets");
        return Array.isArray(actualTargets) && actualTargets.some(target => target instanceof Element && targets.some(element => element === target || element.contains(target)));
      });
      const expected = start + Number(beat.motion?.start);
      if (!matches.length) add(id, "semantic-event-not-executed", expected, beat.animation);
      else if (beat.animation.startsWith("custom:")) {
        const expectedEnd = start + Number(beat.motion?.end), tolerance = 1 / 30 + .001;
        // Composition time includes nested offsets, timeScale and stagger/repeat duration.
        // Reused action tags outside this window do not extend its declaration;
        // pauses inside a correctly declared action remain valid reading time.
        const windows = matches.flatMap(tween => {
          const from = tweenTime(tween, 0), length = invoke(tween, "totalDuration");
          const to = typeof length === "number" ? tweenTime(tween, length) : undefined;
          return typeof from === "number" && Number.isFinite(from) && typeof to === "number" && Number.isFinite(to) && to > expected && from < expectedEnd ? [{ from, to }] : [];
        });
        if (!windows.length || Math.abs(Math.min(...windows.map(window => window.from)) - expected) > tolerance) add(id, "executed-event-time-mismatch", expected, beat.animation);
        else if (Math.abs(Math.max(...windows.map(window => window.to)) - expectedEnd) > tolerance) add(id, "executed-event-end-mismatch", expectedEnd, `${beat.animation}: declared end ${expectedEnd}, executed end ${Math.max(...windows.map(window => window.to))}`);
      } else if (!matches.some(tween => {
        const actual = tweenTime(tween, 0);
        return typeof actual === "number" && (Math.abs(actual - expected) <= 1 / 30 + .001 || (beat.animation.startsWith("component:") && Math.abs(actual + start - expected) <= 1 / 30 + .001));
      })) add(id, "executed-event-time-mismatch", expected, beat.animation);
    }
    // Short-lived event/transition defects can fall between fixed scene-percent samples.
    const eventTimes = events.flatMap(beat => {
      if (!beat || typeof beat !== "object") return [];
      const from = Number(beat.motion?.start), to = Number(beat.motion?.end);
      return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && to <= duration
        ? [start + Math.min(to, from + 1 / 30), start + (from + to) / 2, start + Math.min(duration - 1 / 30, to)] : [];
    });
    const transition = Number(scene.getAttribute("data-ipw-transition-duration"));
    const transitionTimes = transition > 0 && transition <= duration ? [start + 1 / 30, start + transition / 2, start + Math.min(duration - 1 / 30, transition + 1 / 30)] : [];
    const samples = [...new Set([...[.15, .5, .85].map(fraction => start + duration * fraction), ...eventTimes, ...transitionTimes])];
    const states: { time: number; carriers: ReturnType<typeof carrierSnapshot> }[] = [];
    const reviewWindow = { scene, id, start, duration, boundaries: events.slice(1).map(beat => start + Number(beat?.motion?.start)).filter(time => Number.isFinite(time) && time > start && time < start + duration), states };
    windows.push(reviewWindow);
    let firstGeometry = "";
    for (const time of samples) {
      await seek(time);
      sampledFrameCount++;
      if (carriers.length) states.push({ time, carriers: carrierSnapshot() });
      if (time === samples[0]) firstGeometry = geometry(scene);
      for (const check of decorativeChecks) {
        if (time === check.from) check.before = check.snapshot();
        if (time === check.to) check.after = check.snapshot();
      }
      const elements = [...scene.querySelectorAll("img, h1, h2, h3, p, [data-ipw-caption], [data-ipw-connector-from]"), ...document.querySelectorAll("[data-composition-id] > .brand-lockup img, [data-composition-id] > [data-ipw-caption]")].slice(0, 160).filter(visible);
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (element instanceof HTMLImageElement && (!element.complete || !element.naturalWidth)) add(id, "broken-visible-media", time, (element.getAttribute("src") || "image").slice(0, 160));
        if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) add(id, "content-outside-stage", time, element.id || String(element.className) || element.tagName);
      }
      const captions = elements.filter(element => element.matches("[data-ipw-caption], .narration-copy"));
      const bodies = Array.from(scene.querySelectorAll("[data-ipw-content], [class$='-stage'], [class$='-grid'], [class$='-workspace'], .vc-root")).filter(visible);
      for (const caption of captions) for (const body of bodies) {
        if (body.contains(caption)) continue;
        const a = caption.getBoundingClientRect(), b = body.getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) add(id, "caption-content-overlap", time, `${caption.id || caption.className} / ${body.id || body.className}`);
      }
      for (const connector of elements.filter(element => element.hasAttribute("data-ipw-connector-from"))) {
        const from = scene.querySelector(connector.getAttribute("data-ipw-connector-from") || ":not(*)");
        const to = scene.querySelector(connector.getAttribute("data-ipw-connector-to") || ":not(*)");
        if (!from || !to) add(id, "connector-endpoint-missing", time, connector.id || "connector");
        else {
          const line = connector.getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
          const gap = (rect: DOMRect) => Math.hypot(Math.max(rect.left - line.right, line.left - rect.right, 0), Math.max(rect.top - line.bottom, line.top - rect.bottom, 0));
          if (gap(a) > 16 || gap(b) > 16) add(id, "connector-detached", time, connector.id || "connector");
        }
      }
    }
    // One extra reverse seek reuses the first sampled state; a text/geometry
    // mismatch is a determinism defect, independently of motion or aesthetics.
    await seek(samples[0]!);
    sampledFrameCount++;
    checkedSceneCount++;
    if (geometry(scene) !== firstGeometry) add(id, "reverse-seek-state-mismatch", samples[0]!, "Direct and reverse seeking produce different visible text or geometry.");
    for (const check of decorativeChecks) {
      const after = check.after;
      if (after && check.before?.every((value, index) => Math.abs(value.spacing - after[index]!.spacing) <= 3
        && Math.abs(value.x - after[index]!.x) <= .03 && Math.abs(value.y - after[index]!.y) <= .03)) {
        add(id, "long-develop-only-decorative", check.time, "The last 3 seconds contain only small tracking/scale changes. Advance visible content, focus or state, or shorten the action and declare a reading hold.");
      }
    }
  }
  const boundaries: VideoRuntimeReview["carrierReview"]["boundaries"] = [];
  const ordered = windows.sort((a, b) => a.start - b.start);
  for (const [index, window] of ordered.entries()) {
    const previous = ordered[index - 1];
    const times = [...window.boundaries, ...(previous ? [window.start] : [])];
    const states = [...window.states, ...(previous?.states ?? [])].sort((a, b) => a.time - b.time).filter((state, i, list) => i === 0 || state.time !== list[i - 1]!.time);
    for (const time of [...new Set(times)]) {
      const before = states.filter(state => state.time < time), after = states.filter(state => state.time >= time);
      const a = before.at(-1), b = after[0];
      const required = window.scene.getAttribute("data-ipw-continuity") === "required";
      if (!a || !b) { if (required) add(window.id, "carrier-boundary-not-sampled", time, "The declared continuous boundary needs samples on both sides."); continue; }
      const shared = a.carriers.filter(value => value.visible && b.carriers[value.index]?.visible);
      const distance = shared.map(value => Math.hypot(value.x - b.carriers[value.index]!.x, value.y - b.carriers[value.index]!.y));
      const scale = shared.map(value => Math.max(value.width / b.carriers[value.index]!.width, b.carriers[value.index]!.width / value.width, value.height / b.carriers[value.index]!.height, b.carriers[value.index]!.height / value.height));
      const prior = before.at(-2), next = after[1];
      const velocities = prior && next ? shared.filter(value => prior.carriers[value.index]?.visible && next.carriers[value.index]?.visible).map(value => {
        const p = prior.carriers[value.index]!, n = next.carriers[value.index]!, end = b.carriers[value.index]!;
        return Math.hypot((value.x - p.x) / (a.time - prior.time) - (n.x - end.x) / (next.time - b.time), (value.y - p.y) / (a.time - prior.time) - (n.y - end.y) / (next.time - b.time));
      }) : [];
      boundaries.push({ sceneId: window.id, time, required, sharedVisibleCarriers: shared.length, sampleGap: b.time - a.time,
        displacementPx: distance.length ? Math.max(...distance) : null, scaleRatio: scale.length ? Math.max(...scale) : null,
        velocityChangePxPerSecond: velocities.length ? Math.max(...velocities) : null });
      if (required && !shared.length) add(window.id, "declared-carrier-discontinuity", time, "No identical visible DOM carrier survives the declared continuous boundary; matching names do not count as identity.");
    }
  }
  return { valid: issues.length === 0, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount, issues,
    carrierReview: { scope: "tracked-dom-not-semantic-continuity-approval", boundaries }, deterministicSeek: { checkedSceneCount, valid: !issues.some(issue => issue.code === "reverse-seek-state-mismatch") } };
}

export function getElementScreenshotClip(
  selector: string,
  selectorIndex?: number,
): ScreenshotClip | undefined {
  const matches = Array.from(document.querySelectorAll(selector)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const safeIndex = Math.max(0, Math.min(matches.length - 1, Math.floor(selectorIndex ?? 0)));
  const el = matches[safeIndex] ?? null;
  if (!(el instanceof HTMLElement)) return undefined;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return undefined;
  const pad = 8;
  const x = Math.max(0, rect.left - pad);
  const y = Math.max(0, rect.top - pad);
  const maxWidth = window.innerWidth - x;
  const maxHeight = window.innerHeight - y;
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width + pad * 2, maxWidth)),
    height: Math.max(1, Math.min(rect.height + pad * 2, maxHeight)),
  };
}
