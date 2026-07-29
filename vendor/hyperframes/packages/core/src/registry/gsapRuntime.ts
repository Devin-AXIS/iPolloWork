import type { RegistryItem, RegistryItemEngine } from "./types.js";

const GSAP_RUNTIME_PATTERN =
  /\bgsap\.(?:timeline|to|from|fromTo|set)\b|\/gsap@[\d.]+/i;

const GSAP_PLUGIN_PATTERNS = [
  ["ScrollTrigger", /\bScrollTrigger\b/],
  ["ScrollSmoother", /\bScrollSmoother\b/],
  ["ScrollToPlugin", /\bScrollToPlugin\b/],
  ["SplitText", /\bSplitText\b/],
  ["ScrambleTextPlugin", /\bScrambleTextPlugin\b/],
  ["TextPlugin", /\bTextPlugin\b/],
  ["DrawSVGPlugin", /\bDrawSVGPlugin\b/],
  ["MorphSVGPlugin", /\bMorphSVGPlugin\b/],
  ["MotionPathPlugin", /\bMotionPathPlugin\b/],
  ["MotionPathHelper", /\bMotionPathHelper\b/],
  ["Flip", /\bgsap\.registerPlugin\([^)]*\bFlip\b/],
  ["Draggable", /\bDraggable\b/],
  ["InertiaPlugin", /\bInertiaPlugin\b/],
  ["Observer", /\bObserver\b/],
  ["Physics2DPlugin", /\bPhysics2DPlugin\b/],
  ["PhysicsPropsPlugin", /\bPhysicsPropsPlugin\b/],
  ["GSDevTools", /\bGSDevTools\b/],
  ["EaselPlugin", /\bEaselPlugin\b/],
  ["PixiPlugin", /\bPixiPlugin\b/],
  ["RoughEase", /\bRoughEase\b/],
  ["ExpoScaleEase", /\bExpoScaleEase\b/],
  ["SlowMo", /\bSlowMo\b/],
  ["CustomEase", /\bCustomEase\b/],
  ["CustomBounce", /\bCustomBounce\b/],
  ["CustomWiggle", /\bCustomWiggle\b/],
] as const satisfies ReadonlyArray<readonly [string, RegExp]>;

/**
 * Enriches legacy registry items that predate the explicit `engine` contract.
 * New items should declare `engine` in their manifest; source detection is the
 * compatibility bridge for the existing bundled catalog.
 */
export function resolveGsapRegistryItemEngine(
  item: Pick<RegistryItem, "engine">,
  runtimeSources: readonly string[],
): RegistryItemEngine | undefined {
  if (item.engine) return item.engine;

  const runtime = runtimeSources.join("\n");
  if (!GSAP_RUNTIME_PATTERN.test(runtime)) return undefined;

  const version = runtime.match(/\/gsap@(?<version>\d+(?:\.\d+){1,2})/i)?.groups?.version;
  const plugins = GSAP_PLUGIN_PATTERNS.filter(([, pattern]) => pattern.test(runtime)).map(
    ([name]) => name,
  );

  return {
    name: "gsap",
    ...(version ? { version } : {}),
    seekable: /\bhf-seek\b|timeline\s*\(\s*\{\s*paused:\s*true/i.test(runtime),
    ...(plugins.length ? { plugins } : {}),
  };
}
