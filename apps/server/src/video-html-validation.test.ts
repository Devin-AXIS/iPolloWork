import { describe, expect, test } from "bun:test";
import { Script, createContext } from "node:vm";
import { repairVideoTimelineRegistry, validateVideoHtmlScripts } from "./video-html-validation.js";

const dependency = '<script src="assets/gsap.min.js"></script>';
const animation = '<script>const tl = gsap.timeline({paused:true}); window.__timelines["main"] = tl;</script>';

describe("video HTML delivery scripts", () => {
  test("reports both defects in the generated iPhone composition", () => {
    expect(validateVideoHtmlScripts(animation).map((issue) => issue.code)).toEqual([
      "missing_video_gsap", "missing_video_timeline_registry",
    ]);
  });
  test("safely initializes the registry without masking the missing dependency", () => {
    const repaired = repairVideoTimelineRegistry(animation);
    expect(validateVideoHtmlScripts(repaired).map((issue) => issue.code)).toEqual(["missing_video_gsap"]);
    expect(repairVideoTimelineRegistry(repaired)).toBe(repaired);
  });
  test("repaired animation registers the paused timeline when its dependency is available", () => {
    const repaired = repairVideoTimelineRegistry(dependency + animation);
    expect(validateVideoHtmlScripts(repaired)).toEqual([]);
    const timeline = { paused: true };
    const context = createContext({ window: {}, gsap: { timeline: () => timeline } });
    for (const script of repaired.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Script(script[1] ?? "").runInContext(context);
    expect(new Script('window.__timelines.main').runInContext(context)).toBe(timeline);
  });
  test.each(["async", "defer", "type=\"module\""])("rejects %s dependencies ahead of classic inline calls", (attribute) => {
    expect(validateVideoHtmlScripts(dependency.replace("src=", `${attribute} src=`) + animation)[0]?.code).toBe("missing_video_gsap");
  });
  test("rejects a dependency placed after the animation", () => {
    expect(validateVideoHtmlScripts(animation + dependency)[0]?.code).toBe("missing_video_gsap");
  });
  test("does not trust inert templates or comments as dependencies", () => {
    expect(validateVideoHtmlScripts(`<!--${dependency}--><template>${dependency}</template>${animation}`)[0]?.code).toBe("missing_video_gsap");
  });
  test("repairs the active script rather than an identical script inside a comment", () => {
    const inert = `<!--${animation}-->`;
    const repaired = repairVideoTimelineRegistry(inert + dependency + animation);
    expect(repaired.startsWith(inert)).toBe(true);
    expect(validateVideoHtmlScripts(repaired)).toEqual([]);
  });
  test("reports malformed JavaScript without executing it", () => {
    expect(validateVideoHtmlScripts('<script>throw new Error("never execute");</script>')).toEqual([]);
    expect(validateVideoHtmlScripts('<script>const tl = ;</script>')[0]?.code).toBe("invalid_video_script");
  });
  test("preserves static video, JSON data and already initialized animations", () => {
    const staticHtml = '<main data-composition-id="main"></main><script type="application/json">{"gsap":"not code"}</script>';
    expect(validateVideoHtmlScripts(staticHtml)).toEqual([]);
    expect(repairVideoTimelineRegistry(staticHtml)).toBe(staticHtml);
    const valid = dependency + animation.replace("const tl", "window.__timelines = window.__timelines || {}; const tl");
    expect(validateVideoHtmlScripts(valid)).toEqual([]);
    expect(repairVideoTimelineRegistry(valid)).toBe(valid);
  });
  test("repairs initialization that was placed after registration", () => {
    const html = dependency + animation.replace("</script>", "window.__timelines = window.__timelines || {}; </script>");
    expect(validateVideoHtmlScripts(html)[0]?.code).toBe("missing_video_timeline_registry");
    expect(validateVideoHtmlScripts(repairVideoTimelineRegistry(html))).toEqual([]);
  });
});
