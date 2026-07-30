/**
 * Helpers for reading/writing the GSAP keyframe cache in the player store.
 * Extracted from useGsapScriptCommits to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type KeyframeCacheEntry } from "../player/store/playerStore";
import { toAbsoluteTime } from "./gsapShared";
import { buildTimelineAnimationSegments } from "../utils/timelineAnimationSegments";

export function updateKeyframeCacheFromParsed(
  animations: GsapAnimation[],
  targetPath: string,
  selectionId: string | undefined,
  mutation: Record<string, unknown>,
): void {
  const { setKeyframeCacheEntries, elements } = usePlayerStore.getState();
  const idsWithTimelineData = new Set<string>();
  const merged = new Map<string, KeyframeCacheEntry>();
  const segmentsByElement = new Map<
    string,
    NonNullable<KeyframeCacheEntry["animationSegments"]>
  >();
  for (const anim of animations) {
    const id = anim.targetSelector.match(/^#([\w-]+)/)?.[1];
    if (!id) continue;

    // Convert tween-relative percentages to clip-relative so diamonds
    // render at the correct position within the timeline clip.
    const timelineEl = elements.find(
      (el) => el.domId === id || (el.key ?? el.id) === `${targetPath}#${id}`,
    );
    const elStart = timelineEl?.start ?? 0;
    const elDuration = timelineEl?.duration ?? 1;
    const segments = buildTimelineAnimationSegments([anim], {
      start: elStart,
      duration: elDuration,
    });
    if (segments.length > 0) {
      idsWithTimelineData.add(id);
      segmentsByElement.set(id, [...(segmentsByElement.get(id) ?? []), ...segments]);
    }
    if (!anim.keyframes) continue;
    idsWithTimelineData.add(id);
    const tweenPos = anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
    const tweenDur = anim.duration ?? 1;
    const clipKeyframes = anim.keyframes.keyframes.map((kf) => {
      const absTime = toAbsoluteTime(tweenPos, tweenDur, kf.percentage);
      const clipPct =
        elDuration > 0 ? Math.round(((absTime - elStart) / elDuration) * 1000) / 10 : kf.percentage;
      return {
        ...kf,
        percentage: clipPct,
        tweenPercentage: kf.percentage,
        propertyGroup: anim.propertyGroup,
      };
    });

    const existing = merged.get(id);
    if (existing) {
      const byPct = new Map<number, (typeof existing.keyframes)[0]>();
      for (const kf of [...existing.keyframes, ...clipKeyframes]) {
        const prev = byPct.get(kf.percentage);
        if (prev) {
          prev.properties = { ...prev.properties, ...kf.properties };
          if (kf.ease) prev.ease = kf.ease;
        } else {
          byPct.set(kf.percentage, { ...kf, properties: { ...kf.properties } });
        }
      }
      existing.keyframes = Array.from(byPct.values()).sort((a, b) => a.percentage - b.percentage);
    } else {
      merged.set(id, { ...anim.keyframes, keyframes: clipKeyframes });
    }
  }
  const elementIds = new Set([...merged.keys(), ...segmentsByElement.keys()]);
  const cacheUpdates: Array<{
    elementId: string;
    data: KeyframeCacheEntry | undefined;
  }> = [];
  for (const id of elementIds) {
    const entry = merged.get(id) ?? { format: "percentage", keyframes: [] };
    const animationSegments = segmentsByElement.get(id);
    if (animationSegments) entry.animationSegments = animationSegments;
    cacheUpdates.push(
      { elementId: `${targetPath}#${id}`, data: entry },
      { elementId: id, data: entry },
      ...(targetPath !== "index.html"
        ? [{ elementId: `index.html#${id}`, data: entry }]
        : []),
    );
  }
  if (cacheUpdates.length > 0) setKeyframeCacheEntries(cacheUpdates);
  const targetId =
    (mutation as { targetSelector?: string }).targetSelector?.match(/^#([\w-]+)/)?.[1] ??
    selectionId;
  if (targetId && !idsWithTimelineData.has(targetId)) {
    clearKeyframeCacheForElement(targetPath, targetId);
  }
}

/**
 * Clear every keyframe-cache key variant written for an element: the
 * source-prefixed key, the index.html fallback, and the bare element id.
 * Writes set all three (see updateKeyframeCacheFromParsed and
 * usePopulateKeyframeCacheForFile). PropertyPanel's keyframe nav reads the bare
 * id directly (`element.id`), and other consumers (timeline diamonds, the
 * preview overlay) fall back to the bare id when an element has no
 * source-prefixed key — so a clear that drops only the prefixed keys leaves the
 * bare entry behind and those readers keep showing keyframes the element no
 * longer has. Each delete is guarded by `has` so an absent key doesn't allocate
 * a new cache map and re-render every subscriber.
 */
export function clearKeyframeCacheForElement(sourceFile: string, elementId: string): void {
  const { keyframeCache, setKeyframeCacheEntries } = usePlayerStore.getState();
  const keys =
    sourceFile === "index.html"
      ? [`index.html#${elementId}`, elementId]
      : [`${sourceFile}#${elementId}`, `index.html#${elementId}`, elementId];
  setKeyframeCacheEntries(
    keys
      .filter((key) => keyframeCache.has(key))
      .map((key) => ({ elementId: key, data: undefined })),
  );
}

/**
 * Clear every cached element of `sourceFile` before a full re-scan repopulates
 * it. Collects the element ids that currently have a prefixed or index.html
 * fallback key for the file and drops each through clearKeyframeCacheForElement
 * so the bare key goes too — an element whose keyframes were removed (and so is
 * absent from the re-scan) leaves no stale bare entry behind.
 */
export function clearKeyframeCacheForFile(sourceFile: string): void {
  const { keyframeCache, setKeyframeCacheEntries } = usePlayerStore.getState();
  const sfPrefix = `${sourceFile}#`;
  const fallbackPrefix = "index.html#";
  const ids = new Set<string>();
  for (const key of keyframeCache.keys()) {
    const matchesFile =
      key.startsWith(sfPrefix) || (sourceFile !== "index.html" && key.startsWith(fallbackPrefix));
    if (!matchesFile) continue;
    const hashIdx = key.indexOf("#");
    if (hashIdx !== -1) ids.add(key.slice(hashIdx + 1));
  }
  const keys = new Set<string>();
  for (const id of ids) {
    keys.add(`${sourceFile}#${id}`);
    keys.add(id);
    if (sourceFile !== "index.html") keys.add(`index.html#${id}`);
  }
  setKeyframeCacheEntries(
    Array.from(keys)
      .filter((key) => keyframeCache.has(key))
      .map((key) => ({ elementId: key, data: undefined })),
  );
}

function buildCacheKey(sourceFile: string, elementId: string): string {
  return `${sourceFile}#${elementId}`;
}

export function readKeyframeSnapshot(
  sourceFile: string,
  elementId: string | null | undefined,
): KeyframeCacheEntry | undefined {
  if (!elementId) return undefined;
  return usePlayerStore.getState().keyframeCache.get(buildCacheKey(sourceFile, elementId));
}

export function writeKeyframeCache(
  sourceFile: string,
  elementId: string | null | undefined,
  data: KeyframeCacheEntry | undefined,
): void {
  if (!elementId) return;
  usePlayerStore.getState().setKeyframeCache(buildCacheKey(sourceFile, elementId), data);
}
