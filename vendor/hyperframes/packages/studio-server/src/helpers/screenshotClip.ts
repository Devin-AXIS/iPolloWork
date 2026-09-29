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
  const tweens = registered.flatMap(timeline => {
    const children = invoke(timeline, "getChildren", [true, true, false]);
    return Array.isArray(children) ? children : [];
  });
  const scenes = Array.from(document.querySelectorAll(".scene.clip, [data-ipw-scene]"));
  if (!registered.length || !scenes.length || scenes.length > 48) add("root", "runtime-review-unavailable", 0, "Require registered timeline and 1–48 scenes");
  let sampledFrameCount = 0;
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
      else if (!matches.some(tween => {
        const actual = invoke(tween, "globalTime", [0]);
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
    for (const time of samples) {
      const player = Reflect.get(window, "__player");
      if (player && typeof player.seek === "function") invoke(player, "seek", [time]);
      else for (const timeline of registered) invoke(timeline, "pause", [time]);
      // Capture pages may be backgrounded; rAF alone can suspend indefinitely.
      await new Promise<void>(resolve => { const timeout = setTimeout(resolve, 50); requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }); });
      sampledFrameCount++;
      const visible = (element: Element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < .1) return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
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
  }
  return { valid: issues.length === 0, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount, issues };
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
