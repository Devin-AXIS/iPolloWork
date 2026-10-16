// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { parseGsapScript } from "@hyperframes/core/gsap-parser";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import { addKeyframeToScript } from "@hyperframes/core/gsap-writer-acorn";
import { clearKeyframeCacheForFile, updateKeyframeCacheFromParsed } from "./gsapKeyframeCacheHelpers";
import { usePlayerStore } from "../player/store/playerStore";
import { animatedProps } from "./useEnableKeyframes";
import { markManualKeyframe } from "./gsapShared";
import { deduplicateKeyframes } from "./gsapTweenSynth";
import {
  resolveGsapTimelineTargetKeys,
  resolveMotionTimelineTargetKeys,
  buildTimelinePropertyRows,
  buildTimelinePropertyPoints,
  canStartTimelinePropertyAnimation,
  resolveTimelinePropertyKeyframeTarget,
} from "./gsapTimelineSegmentCache";
import { collectTimelineTreeElements, resolveTimelineTreeSelectionKey } from "../player/lib/timelineTreeSelection";
import { getAnimationsForElement, resolveClipTimingBasis } from "./useGsapTweenCache";

test("property rows retain unmerged source identities and literal times", () => {
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#title",{duration:2,keyframes:{"0%":{x:0,opacity:0},"100%":{x:100,opacity:1}}},1);tl.to("#title",{duration:2,keyframes:{"0%":{x:50},"100%":{x:200}}},1);').animations;
  const element = {id:"title",key:"title",domId:"title",tag:"h1",start:0,duration:6,track:1};
  usePlayerStore.setState({elements:[element],keyframeCache:new Map()});
  updateKeyframeCacheFromParsed(animations,"index.html","title",{});
  const cached = usePlayerStore.getState().keyframeCache.get("index.html#title");
  expect(cached?.propertyAnimations).toEqual(animations);
  expect(cached?.propertyAnimations?.map((animation) => animation.id)).toEqual(animations.map((animation) => animation.id));
  const position = buildTimelinePropertyPoints(cached?.propertyAnimations ?? [],element,"x");
  expect(position).toHaveLength(4);
  expect(position.filter((point) => point.time === 1).map((point) => point.animation.id)).toEqual(animations.map((animation) => animation.id));
  expect(buildTimelinePropertyRows(animations).map((row) => row.label)).toEqual(["X","Opacity"]);
});

test("computed and shared channels remain read-only and points outside display survive", () => {
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to(".title",{duration:4,keyframes:{"0%":{opacity:0},"100%":{opacity:1}}},1);').animations;
  const points = buildTimelinePropertyPoints(animations,{id:"title",domId:"title",tag:"h1",start:2,duration:1,track:1},"opacity");
  expect(points.map((point) => point.time)).toEqual([1,5]);
  expect(points.every((point) => point.readOnly)).toBe(true);
});

test("empty property creation rejects authored aliases, raw transforms and shared targets", () => {
  const element={id:"title",domId:"title",tag:"h1",start:0,duration:6,track:1};
  const parse=(vars:string,target="#title") => parseGsapScriptAcorn(`const tl=gsap.timeline();tl.to(${JSON.stringify(target)},{duration:2,${vars}},1);`).animations;
  expect(canStartTimelinePropertyAnimation(parse("x:100"),element,"y")).toBe(true);
  expect(canStartTimelinePropertyAnimation(parse("y:100"),element,"y")).toBe(false);
  expect(canStartTimelinePropertyAnimation(parse("autoAlpha:1"),element,"opacity")).toBe(false);
  expect(canStartTimelinePropertyAnimation(parse("scaleX:2"),element,"scale")).toBe(false);
  expect(canStartTimelinePropertyAnimation(parse("rotationZ:30"),element,"rotation")).toBe(false);
  expect(canStartTimelinePropertyAnimation(parse('transform:"rotate(30deg)"'),element,"y")).toBe(false);
  expect(canStartTimelinePropertyAnimation(parse("x:100",".title"),element,"y")).toBe(false);
});

test("native writer and both parsers preserve point origin, ease, timing and position group", () => {
  const source = 'const tl = gsap.timeline(); tl.to("#title", {duration: 3, keyframes: {"0%": {x:0}, "100%": {x:120}, easeEach:"power2.out"}}, 2);';
  const before = parseGsapScriptAcorn(source).animations[0];
  if (!before) throw new Error("native animation parse failed");
  const mutation = markManualKeyframe({ type: "add-keyframe", properties: { x: 42 } });
  const changed = addKeyframeToScript(source, before.id, 50, { x: 42, data: "hf-manual-keyframe" });
  expect(mutation.properties).toEqual({ x: 42, data: "hf-manual-keyframe" });
  for (const parse of [parseGsapScriptAcorn, parseGsapScript]) {
    const anim = parse(changed).animations[0];
    expect(anim?.propertyGroup).toBe("position");
    expect(anim?.keyframes?.easeEach).toBe("power2.out");
    expect(anim?.keyframes?.keyframes.map((keyframe) => keyframe.percentage)).toEqual([0, 50, 100]);
    expect(animatedProps(anim ?? null)).toEqual(["x"]);
    usePlayerStore.setState({ elements: [{ id: "title", tag: "h1", start: 0, duration: 6, track: 1 }], keyframeCache: new Map() });
    if (!anim) throw new Error("round-trip animation missing");
    updateKeyframeCacheFromParsed([anim], "index.html", "title", { targetSelector: "#title" });
    const points = usePlayerStore.getState().keyframeCache.get("index.html#title")?.keyframes;
    expect(points?.map((keyframe) => keyframe.origin)).toEqual(["authored", "manual", "authored"]);
    expect(points?.map((keyframe) => keyframe.percentage)).toEqual([33.333, 58.333, 83.333]);
    expect(points?.[1]?.properties).toEqual({ x: 42 });
  }
});

test("merged property groups retain a manually recorded origin", () => {
  expect(deduplicateKeyframes([
    { percentage: 50, properties: { x: 42 }, origin: "authored" },
    { percentage: 50, properties: { opacity: 0.7 }, origin: "manual" },
  ])).toEqual([{ percentage: 50, properties: { x: 42, opacity: 0.7 }, origin: "manual" }]);
});

describe("resolveMotionTimelineTargetKeys", () => {
  test("maps selector-only semantic motion to the timeline row key", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".status", hfId: "hf-status" },
        "index.html",
        [
          {
            id: "index.html:.status:0",
            key: "index.html:.status:0",
            hfId: "hf-status",
            selector: ".status",
            sourceFile: "index.html",
          },
        ],
      ),
    ).toEqual(["index.html:.status:0"]);
  });

  test("does not attach a same-named selector from another source file", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".title" },
        "index.html",
        [
          {
            id: "nested.html:.title:0",
            key: "nested.html:.title:0",
            selector: ".title",
            sourceFile: "nested.html",
          },
        ],
      ),
    ).toEqual([]);
  });
});

describe("resolveGsapTimelineTargetKeys", () => {
  test("maps a selector-only tween to the exact timeline row key", () => {
    expect(
      resolveGsapTimelineTargetKeys(".status", "index.html", [
        {
          id: "hf-status",
          key: "index.html:.status:0",
          hfId: "hf-status",
          selector: ".status",
          sourceFile: "index.html",
        },
      ]),
    ).toEqual(["index.html:.status:0"]);
  });

  test("maps a data-hf-id tween without requiring a DOM id", () => {
    expect(
      resolveGsapTimelineTargetKeys('[data-hf-id="hf-card"]', "index.html", [
        {
          id: "hf-card",
          key: "index.html:[data-hf-id=hf-card]:0",
          hfId: "hf-card",
          selector: "[data-hf-id=hf-card]",
          sourceFile: "index.html",
        },
      ]),
    ).toEqual(["index.html:[data-hf-id=hf-card]:0"]);
  });

  test("falls back to a bare id before timeline discovery", () => {
    expect(resolveGsapTimelineTargetKeys("#headline", "index.html", [])).toEqual(["headline"]);
  });

  test("reconstructs the expanded DOM-child row key used by TimelineLanes", () => {
    expect(
      resolveGsapTimelineTargetKeys(".metric", "compositions/scene.html", [
        {
          id: "hf-metric",
          hfId: "hf-metric",
          selector: ".metric",
          selectorIndex: 0,
          sourceFile: "compositions/scene.html",
          hostId: "scene-host",
        },
      ]),
    ).toEqual(["scene-host::compositions/scene.html:.metric:0"]);
  });

  test("uses the host clip timing for an expanded selector-only child", () => {
    expect(
      resolveClipTimingBasis(
        "scene-host::compositions/scene.html:.metric:0",
        "compositions/scene.html",
        [{ id: "scene-host", domId: "scene-host", start: 4, duration: 6 }],
        [
          {
            id: "hf-metric",
            hostId: "scene-host",
            selector: ".metric",
            selectorIndex: 0,
            sourceFile: "compositions/scene.html",
          },
        ],
      ),
    ).toEqual({ elStart: 4, elDuration: 6 });
  });
});


test("default property rows omit setup values and empty groups; explicit reveal is inert", () => {
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();gsap.set("#title",{x:0,y:0,rotation:0});tl.to("#title",{scale:1.2,opacity:1,duration:2},1);').animations;
  const before = JSON.stringify(animations);
  expect(buildTimelinePropertyRows(animations).map((row) => row.property)).toEqual(["scale","opacity"]);
  expect(buildTimelinePropertyRows(animations,["y"]).map((row) => row.property)).toEqual(["y","scale","opacity"]);
  expect(buildTimelinePropertyRows([])).toEqual([]);
  expect(JSON.stringify(animations)).toBe(before);
});


test("semantic effect metadata ids never create property rows", () => {
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#subtitle",{id:"hf-motion-enter",duration:1,keyframes:{"0%":{opacity:0},"100%":{opacity:1}}},0);').animations;
  expect(buildTimelinePropertyRows(animations).map((row) => row.property)).toEqual(["opacity"]);
});

test("refresh replaces source property channels atomically while removing obsolete file entries", () => {
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#title",{opacity:1,duration:2},10);').animations;
  const current = {format:"percentage",keyframes:[],propertyAnimations:animations};
  usePlayerStore.setState({keyframeCache:new Map([["index.html#title",current],["title",current],["index.html#removed",current],["removed",current]])});
  const observations: number[] = [];
  const unsubscribe = usePlayerStore.subscribe((state) => observations.push(state.keyframeCache.get("title")?.propertyAnimations?.length ?? 0));
  try {
    clearKeyframeCacheForFile("index.html", [{elementId:"index.html#title",data:current},{elementId:"title",data:current}]);
    expect(observations).toEqual([1]);
    expect(usePlayerStore.getState().keyframeCache.has("removed")).toBe(false);
    expect(usePlayerStore.getState().keyframeCache.has("index.html#removed")).toBe(false);
  } finally {unsubscribe();}
});

test("flat scene children share animation cache identity with selection, including repeated class targets", () => {
  const elements = [{ id: "scene", domId: "scene", key: "index.html#scene", tag: "section", sourceFile: "index.html", start: 2, duration: 6, track: 1 }];
  const children = ["chip-a", "chip-b"].map((hfId, selectorIndex) => ({
    id: hfId, hfId, hostId: "scene", selector: ".chip", selectorIndex, sourceFile: "index.html",
  }));
  const targets = collectTimelineTreeElements(elements, [], children);
  const animations = parseGsapScriptAcorn('const tl=gsap.timeline();tl.fromTo(".chip",{y:20,opacity:0},{y:0,opacity:1,duration:1,stagger:0.1},2);').animations;
  const keys = resolveGsapTimelineTargetKeys(".chip", "index.html", targets);
  expect(keys).toEqual(["index.html#chip-a", "index.html#chip-b"]);
  for (const child of children) {
    const key = resolveTimelineTreeSelectionKey({ hfId: child.hfId, sourceFile: "index.html", elements, manifest: [], domClipChildren: children });
    expect(keys).toContain(key);
    expect(resolveClipTimingBasis(key, "index.html", targets, children)).toEqual({ elStart: 2, elDuration: 6 });
    const element = targets.find(target => target.key === key);
    if (!element) throw new Error("Missing flattened child");
    expect(buildTimelinePropertyRows(animations).map(row => row.property)).toEqual(["y", "opacity"]);
    expect(buildTimelinePropertyPoints(animations, element, "opacity").every(point => point.readOnly)).toBe(true);
  }
});

test("toolbar recording selects existing keys, creates one independent channel, and rejects shared or ambiguous writes", () => {
  const element = { id:"title",domId:"title",tag:"h1",start:0,duration:6,track:1 };
  const parse = (target:string) => parseGsapScriptAcorn(`const tl=gsap.timeline();tl.fromTo("${target}",{x:0},{x:100,duration:2},1);`).animations;
  const animations = parse("#title");
  expect(resolveTimelinePropertyKeyframeTarget(animations,element,"x",1).kind).toBe("existing");
  expect(resolveTimelinePropertyKeyframeTarget(animations,element,"x",2)).toEqual({kind:"add",animationId:animations[0].id,percentage:50});
  expect(resolveTimelinePropertyKeyframeTarget(animations,element,"y",2)).toEqual({kind:"add",animationId:"",percentage:(2/6)*100});
  expect(resolveTimelinePropertyKeyframeTarget(animations,element,"x",5).kind).toBe("blocked");
  expect(resolveTimelinePropertyKeyframeTarget(parse(".title"),element,"x",2).kind).toBe("blocked");
  const overlap=[...animations,{...animations[0],id:"other"}];
  expect(resolveTimelinePropertyKeyframeTarget(overlap,element,"x",2).kind).toBe("blocked");
  expect(resolveTimelinePropertyKeyframeTarget(overlap,element,"x",2,"other")).toEqual({kind:"add",animationId:"other",percentage:50});
  expect(resolveTimelinePropertyKeyframeTarget(animations,{...element,timelineLocked:true},"y",2).kind).toBe("blocked");
  expect(resolveTimelinePropertyKeyframeTarget(animations,element,"y",7).kind).toBe("blocked");
});

test("live element matching never borrows another scene's animation through a shared leaf class", () => {
 const doc=new DOMParser().parseFromString('<section id="first"><p class="copy"></p></section><section id="second"><p class="copy"></p></section>',"text/html");
 const parsed=parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#first .copy",{opacity:1,duration:1},0);tl.to("#second .copy",{opacity:0,duration:1},3);');
 const selected=getAnimationsForElement(parsed.animations,{selector:".copy"},doc.querySelector('#first .copy'));
 expect(selected.map(a=>a.targetSelector)).toEqual(["#first .copy"]);
});
