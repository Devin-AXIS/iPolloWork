// @vitest-environment jsdom
import { resolveTimelineEditingMode } from "../components/timelineLayerPresentation";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ClipManifestClip } from "./playbackTypes";
import {
  collectDomClipChildren,
  readInlineScopeKind,
  createTimelineElementFromManifestClip,
  filterEditableTimelineManifestClips,
  findTimelineDomNodeForClip,
  parseTimelineFromDOM,
  mergeTimelineElementsPreservingDowngrades,
} from "./timelineDOM";
import {
  collectDomEditLayerItems,
  resolveDomEditSelection,
  refreshDomEditSelection,
} from "../../components/editor/domEditing";
import {
  buildStableSelector,
  setCompositionSourceMap,
} from "../../components/editor/domEditingDom";
import {
  findElementForTimelineElement,
  getDomLayerPatchTarget,
  getSelectionCandidate,
  getDomEditGroupMembers,
  resolveAllVisualDomEditTargets,
} from "../../components/editor/domEditingElement";
import { previewGroupScope } from "../../components/editor/domEditingGroups";

const MANIFEST_CLIP: ClipManifestClip = {
  id: "headline",
  label: "Headline",
  start: 1,
  duration: 3,
  track: 0,
  kind: "element",
  tagName: "h1",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  timelineRole: "title",
  timelineGroup: "intro-lockup",
};

describe("timeline manifest translation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("removes a deleted component on Redo while retaining a real host omitted by a DOM scan", () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <div id="first" data-hf-id="hf-first" data-composition-id="first"></div>
      <div id="second" data-hf-id="hf-second" data-composition-id="second"></div>
      <div id="reference-start" data-hf-id="hf-reference" data-composition-id="reference-start"></div>
    </main>`;
    const element = (id: string, hfId: string) => ({ id, hfId, domId: id,
      key: `index.html#${id}`, tag: "div", start: 0, duration: 20, track: 1,
      compositionSrc: `compositions/${id}.html`, sourceFile: "index.html" });
    const first = element("first", "hf-first");
    const second = element("second", "hf-second");
    const referenceStart = element("reference-start", "hf-reference");
    const restored = [first, second, referenceStart];
    document.getElementById("second")?.remove();
    const afterRedo = mergeTimelineElementsPreservingDowngrades(restored, [first], 20, 20, document);
    expect(afterRedo).toEqual([first, referenceStart]);
  });

  test("preserves binding metadata when the host DOM node is unavailable", () => {
    const element = createTimelineElementFromManifestClip({
      clip: MANIFEST_CLIP,
      fallbackIndex: 0,
    });

    expect(element.timelineRole).toBe("title");
    expect(element.timelineGroupId).toBe("intro-lockup");
  });

  test("keeps the clip caption independent from the layer-tree label", () => {
    document.body.innerHTML = `
      <section
        id="headline"
        data-timeline-label="Tree label"
        data-timeline-clip-label="Clip label"
      ></section>
    `;
    const hostEl = document.getElementById("headline");
    expect(hostEl).not.toBeNull();

    const element = createTimelineElementFromManifestClip({
      clip: {
        ...MANIFEST_CLIP,
        label: "Tree label",
        timelineClipLabel: "Manifest clip label",
      },
      fallbackIndex: 0,
      doc: document,
      hostEl,
    });

    expect(element.label).toBe("Tree label");
    expect(element.clipLabel).toBe("Clip label");
  });

  test("binds runtime hf ids before consuming an authored scene fallback", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <img data-hf-id="hf-logo" data-start="0" data-duration="3" src="logo.svg" />
        <section id="scene-intro" data-start="0" data-duration="3"></section>
      </main>
    `;
    const logoClip = { ...MANIFEST_CLIP, id: "hf-logo", tagName: "img" };
    const sceneClip = {
      ...MANIFEST_CLIP,
      id: "scene-intro",
      tagName: "section",
    };
    const used = new Set<Element>();
    const logo = findTimelineDomNodeForClip(document, logoClip, 0, used);
    expect(logo?.getAttribute("data-hf-id")).toBe("hf-logo");
    if (logo) used.add(logo);

    expect(findTimelineDomNodeForClip(document, sceneClip, 1, used)?.id).toBe("scene-intro");
  });

  test("binds a composition clip to its timed host instead of a same-id inner root", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <div
          data-composition-id="opening-editorial-rise"
          data-start="10"
          data-duration="4.6"
          data-track-index="0"
        >
          <main
            id="opening-editorial-rise"
            data-composition-id="opening-editorial-rise"
            data-start="0"
            data-duration="4.6"
          ></main>
        </div>
      </main>
    `;
    const clip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "opening-editorial-rise",
      label: "Opening Editorial Rise",
      start: 10,
      duration: 4.6,
      kind: "composition",
      tagName: "div",
      compositionId: "opening-editorial-rise",
      compositionSrc: "compositions/opening-editorial-rise.html",
    };

    const host = findTimelineDomNodeForClip(document, clip, 0);
    expect(host?.tagName).toBe("DIV");
    expect(host?.getAttribute("data-start")).toBe("10");
  });

  test("keeps fallback bindings in DOM order after an earlier host was claimed", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section id="first" data-start="0"></section>
        <section id="second" data-start="1"></section>
        <section id="third" data-start="2"></section>
      </main>
    `;
    const first = document.getElementById("first");
    const used = new Set<Element>(first ? [first] : []);
    const unresolvedClip = {
      ...MANIFEST_CLIP,
      id: "runtime-only",
      start: 99,
      duration: 99,
      tagName: "article",
    };

    expect(findTimelineDomNodeForClip(document, unresolvedClip, 1, used)?.id).toBe("second");
  });

  test("keeps the original mounted clip when a prepended instance preserves its authored inner id", () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <div id="stage-stack_2" data-composition-id="stage-stack_2" data-composition-file="compositions/stage-stack.html" data-start="5" data-hf-authored-duration="10" data-track-index="2">
        <div id="stage-stack" data-composition-id="stage-stack" data-start="0" data-hf-authored-duration="10"></div>
      </div>
      <div id="stage-stack" data-hf-id="hf-original" data-composition-id="stage-stack" data-composition-file="compositions/stage-stack.html" data-start="0" data-hf-authored-duration="10" data-track-index="1"></div>
    </main>`;
    const original = document.querySelector('[data-hf-id="hf-original"]');
    const clip: ClipManifestClip = { ...MANIFEST_CLIP, id: "stage-stack", start: 0,
      duration: 10, track: 1, tagName: "div", kind: "composition", compositionId: "stage-stack" };
    const host = findTimelineDomNodeForClip(document, clip, 1);
    expect(host).toBe(original);
    const element = createTimelineElementFromManifestClip({ clip, doc: document, hostEl: host, fallbackIndex: 1 });
    expect(element.sourceFile).toBe("index.html");
    expect(element.key).toBe("index.html#stage-stack");
    expect(element.hfId).toBe("hf-original");
  });

  test("does not replace an already resolved composition host while recovering its source", () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <div data-composition-id="stage-stack_2" data-composition-file="compositions/stage-stack.html">
        <div id="stage-stack" data-composition-id="stage-stack" data-start="0"></div>
      </div>
      <div id="stage-stack" data-hf-id="hf-original" data-composition-id="stage-stack" data-composition-file="compositions/stage-stack.html" data-start="0" data-hf-authored-duration="10" data-track-index="1"></div>
    </main>`;
    const clip: ClipManifestClip = { ...MANIFEST_CLIP, id: "stage-stack", start: 0,
      duration: 10, track: 1, tagName: "div", kind: "composition", compositionId: "stage-stack" };
    const element = createTimelineElementFromManifestClip({ clip, doc: document,
      hostEl: document.querySelector('[data-hf-id="hf-original"]'), fallbackIndex: 1 });
    expect(element.sourceFile).toBe("index.html");
    expect(element.compositionSrc).toBe("compositions/stage-stack.html");
    expect(element.hfId).toBe("hf-original");
    const recovered = createTimelineElementFromManifestClip({ clip, doc: document, fallbackIndex: 1 });
    expect(recovered.sourceFile).toBe("index.html");
    expect(recovered.hfId).toBe("hf-original");
  });

  test("exposes an avatar cutout as one editable timeline element", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html" data-duration="10">
        <video
          id="person"
          data-start="0"
          data-duration="10"
          data-track-index="0"
          data-avatar-cutout="avatar-cutout-person"
        ></video>
        <video
          id="avatar-cutout-person"
          data-start="0"
          data-duration="10"
          data-track-index="4"
          data-avatar-source="person"
        ></video>
      </main>
    `;
    const sourceClip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "person",
      label: "Person",
      start: 0,
      duration: 10,
      track: 0,
      kind: "video",
      tagName: "video",
    };
    const foregroundClip: ClipManifestClip = {
      ...sourceClip,
      id: "avatar-cutout-person",
      label: "Avatar cutout foreground",
      track: 4,
    };

    expect(parseTimelineFromDOM(document, 10).map((element) => element.domId)).toEqual(["person"]);
    expect(
      filterEditableTimelineManifestClips(document, [sourceClip, foregroundClip]).map(
        (clip) => clip.id,
      ),
    ).toEqual(["person"]);
    expect(findTimelineDomNodeForClip(document, foregroundClip, 1)).toBeNull();
  });

  test("collects every untimed child below a timed scene for canvas/tree parity", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section id="scene-hook" data-start="0" data-duration="3.2">
          <div class="hero-copy" data-hidden>
            <div class="eyebrow">Introducing</div>
            <h1>Launch what matters</h1>
            <p>Move work forward.</p>
          </div>
        </section>
      </main>`;
    const scene = document.getElementById("scene-hook");
    expect(scene).not.toBeNull();
    const clip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "scene-hook",
      label: "Scene Hook",
      kind: "element",
      tagName: "section",
    };
    const hierarchy = collectDomClipChildren(document, [clip], new Map([[clip, scene!]]));
    const hero = hierarchy.children.find((child) => child.selector === ".hero-copy");
    const title = hierarchy.children.find((child) => child.selector === "h1");

    expect(hero).toBeDefined();
    expect(hero?.hidden).toBe(true);
    expect(title).toBeDefined();
    expect(hierarchy.parentMap.get(hero!.id)).toBe("scene-hook");
    expect(hierarchy.parentMap.get(title!.id)).toBe(hero!.id);
  });

  test("keeps timed children under their actual untimed parent group", () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <section id="scene" data-start="0" data-duration="10">
        <div data-hf-id="panel" class="panel"><p id="animated" data-start="0" data-duration="10">Animated caption</p></div>
      </section></main>`;
    const scene: ClipManifestClip = { ...MANIFEST_CLIP, id: "scene" };
    const animated: ClipManifestClip = { ...MANIFEST_CLIP, id: "animated" };
    const hierarchy = collectDomClipChildren(document, [scene, animated], new Map([
      [scene, document.getElementById("scene")!],
      [animated, document.getElementById("animated")!],
    ]));
    expect(hierarchy.parentMap.get("panel")).toBe("scene");
    expect(hierarchy.parentMap.get("animated")).toBe("panel");
    expect(hierarchy.children.some((child) => child.id === "animated")).toBe(false);
  });

  test("keeps descendants under their nearest resolved timed host", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section class="lfc-stream" data-start="6" data-duration="4" data-track-index="3">
          <article class="lfc-file"><small>MARKDOWN</small><b>interviews.md</b></article>
        </section>
      </main>
    `;
    const root = document.querySelector("main");
    const stream = document.querySelector(".lfc-stream");
    expect(root).not.toBeNull();
    expect(stream).not.toBeNull();
    const rootClip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "main",
      label: "Main",
      start: 0,
      duration: 13,
      track: 0,
      kind: "composition",
      tagName: "main",
      compositionId: "main",
    };
    const streamClip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "lfc-stream",
      label: "Lfc Stream",
      start: 6,
      duration: 4,
      track: 3,
      tagName: "section",
    };

    const hierarchy = collectDomClipChildren(
      document,
      [rootClip, streamClip],
      new Map([
        [rootClip, root!],
        [streamClip, stream!],
      ]),
    );
    const file = hierarchy.children.find((child) => child.selector === ".lfc-file");
    const small = hierarchy.children.find((child) => child.selector === "small");

    expect(file).toMatchObject({
      hostId: "lfc-stream",
      parentId: "lfc-stream",
    });
    expect(small).toMatchObject({ hostId: "lfc-stream", parentId: file?.id });
    expect(hierarchy.children.some((child) => child.selector === ".lfc-stream")).toBe(false);
  });

  test("namespaces an effect child whose hf id collides with its manifest root", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section data-composition-id="animated-card" data-start="0" data-duration="4">
          <article class="card" data-hf-id="animated-card">Card</article>
        </section>
      </main>
    `;
    const host = document.querySelector("section");
    expect(host).not.toBeNull();
    const clip: ClipManifestClip = {
      ...MANIFEST_CLIP,
      id: "animated-card",
      label: "Animated card",
      start: 0,
      duration: 4,
      kind: "composition",
      compositionId: "animated-card",
      compositionSrc: "compositions/effects/animated-card.html",
      tagName: "section",
    };

    const hierarchy = collectDomClipChildren(document, [clip], new Map([[clip, host!]]));
    const card = hierarchy.children.find((child) => child.selector === ".card");

    expect(card).toMatchObject({
      hfId: "animated-card",
      parentId: "animated-card",
      hostId: "animated-card",
      sourceFile: "compositions/effects/animated-card.html",
    });
    expect(card?.id).not.toBe("animated-card");
    expect(hierarchy.parentMap.get(card!.id)).toBe("animated-card");

    const sourceFile = card!.sourceFile!;
    setCompositionSourceMap(new Map([["animated-card", sourceFile]]));
    try {
      expect(
        findElementForTimelineElement(
          document,
          {
            id: card!.id,
            hfId: card!.hfId,
            selector: card!.selector,
            selectorIndex: card!.selectorIndex,
            sourceFile,
            previewHostId: card!.hostId,
          },
          { activeCompositionPath: "index.html", isMasterView: true },
        ),
      ).toBe(document.querySelector(".card"));
    } finally {
      setCompositionSourceMap(new Map());
    }
  });

  test("keeps plain text children inside a group directly inspectable", async () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="compositions/outro.html">
        <section data-hf-group="Outro Inner">
          <h2>Eyebrow</h2>
          <p>Caption</p>
        </section>
      </main>
    `;
    const heading = document.querySelector("h2");
    const group = document.querySelector<HTMLElement>("[data-hf-group]");
    expect(heading).toBeInstanceOf(HTMLElement);
    expect(group).toBeInstanceOf(HTMLElement);
    if (!(heading instanceof HTMLElement) || !group) return;

    expect(buildStableSelector(heading)).toBe("h2");
    const selection = await resolveDomEditSelection(heading, {
      activeCompositionPath: "index.html",
      isMasterView: false,
      activeGroupElement: group,
      skipSourceProbe: true,
    });
    expect(selection?.element).toBe(heading);
    expect(selection?.selector).toBe("h2");
    expect(selection?.sourceFile).toBe("compositions/outro.html");
  });

  test("indexes repeated selectors once per source and rebuilds after structural edits", () => {
    document.body.innerHTML = `<main data-composition-id="main"><section id="a" data-start="0" data-duration="5" data-composition-id="a" data-composition-file="a.html">${"<span>Value</span>".repeat(100)}</section><section id="b" data-start="5" data-duration="5" data-composition-id="b" data-composition-file="b.html"><span>Other</span></section></main>`;
    const a = document.getElementById("a");
    const b = document.getElementById("b");
    if (!a || !b) throw new Error("Missing fixture");
    const clips = [{ ...MANIFEST_CLIP, id: "a" }, { ...MANIFEST_CLIP, id: "b" }];
    const hosts = new Map([[clips[0], a], [clips[1], b]]);
    const query = vi.spyOn(document, "querySelectorAll");
    try {
      const first = collectDomClipChildren(document, clips, hosts);
      expect(first.children.filter(child => child.sourceFile === "a.html").map(child => child.selectorIndex)).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(first.children.find(child => child.sourceFile === "b.html")?.selectorIndex).toBe(0);
      expect(query.mock.calls.filter(([selector]) => selector === "span")).toHaveLength(2);
      a.prepend(document.createElement("span"));
      const second = collectDomClipChildren(document, clips, hosts);
      expect(second.children.filter(child => child.sourceFile === "a.html")).toHaveLength(101);
      expect(second.children.filter(child => child.sourceFile === "a.html").at(-1)?.selectorIndex).toBe(100);
    } finally { query.mockRestore(); }
  });

  test("the live layer panel also indexes repeated selectors once per source", () => {
    document.body.innerHTML = `<main data-composition-id="main"><section data-composition-id="a" data-composition-file="a.html">${"<span>Value</span>".repeat(10)}</section><section data-composition-id="b" data-composition-file="b.html">${"<span>Other</span>".repeat(10)}</section></main>`;
    const root = document.querySelector("main");
    if (!root) throw new Error("Missing fixture");
    const query = vi.spyOn(document, "querySelectorAll");
    try {
      const rows = collectDomEditLayerItems(root, { activeCompositionPath: "index.html", isMasterView: true });
      expect(rows.filter(row => row.sourceFile === "a.html").map(row => row.selectorIndex)).toEqual(Array.from({ length: 10 }, (_, i) => i));
      expect(rows.filter(row => row.sourceFile === "b.html").map(row => row.selectorIndex)).toEqual(Array.from({ length: 10 }, (_, i) => i));
      expect(query.mock.calls.filter(([selector]) => selector === "span")).toHaveLength(2);
      root.querySelector("section")?.prepend(document.createElement("span"));
      const updated = collectDomEditLayerItems(root, { activeCompositionPath: "index.html", isMasterView: true });
      expect(updated.filter(row => row.sourceFile === "a.html").at(-1)?.selectorIndex).toBe(10);
    } finally { query.mockRestore(); }
  });

  test("keeps repeated plain-tag children mapped to their exact timeline row", async () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <div class="meta">
          <span>htmlanything.dev</span>
          <span>·</span>
          <span>@htmlanything</span>
        </div>
      </main>
    `;
    const spans = Array.from(document.querySelectorAll<HTMLElement>("span"));
    const selections = await Promise.all(
      spans.map((span) =>
        resolveDomEditSelection(span, {
          activeCompositionPath: "index.html",
          isMasterView: false,
          skipSourceProbe: true,
        }),
      ),
    );

    expect(selections.map((selection) => selection?.selector)).toEqual(["span", "span", "span"]);
    expect(selections.map((selection) => selection?.selectorIndex)).toEqual([0, 1, 2]);
  });

  test("prefers the deepest hit regardless of child-parent result order", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section class="device-stage"><div class="screen"><span>3D</span></div></section>
      </main>
    `;
    const stage = document.querySelector<HTMLElement>(".device-stage");
    const screen = document.querySelector<HTMLElement>(".screen");
    const label = document.querySelector<HTMLElement>("span");
    expect(stage).toBeInstanceOf(HTMLElement);
    expect(screen).toBeInstanceOf(HTMLElement);
    expect(label).toBeInstanceOf(HTMLElement);
    if (!stage || !screen || !label) return;
    const box = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    };
    for (const element of [stage, screen, label]) {
      element.getBoundingClientRect = () => box;
    }

    expect(
      resolveAllVisualDomEditTargets([label, screen, stage], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([label]);
    expect(
      resolveAllVisualDomEditTargets([stage, screen, label], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([label]);
  });

  test("does not pick a transparent animation wrapper covering unrelated text", () => {
    document.body.innerHTML =
      '<main data-composition-id="main" data-composition-file="index.html"><span id="label">Title</span><div id="wrapper" style="pointer-events:none"><span>Other title</span></div></main>';
    const wrapper = document.getElementById("wrapper");
    const label = document.getElementById("label");
    if (!wrapper || !label) throw new Error("Fixture missing");
    for (const element of [wrapper, label]) {
      element.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 30,
        width: 100,
        height: 30,
        toJSON: () => ({}),
      });
    }
    expect(
      resolveAllVisualDomEditTargets([wrapper, label], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([label]);
    wrapper.setAttribute("data-hf-edit-as-unit", "");
    expect(
      resolveAllVisualDomEditTargets([wrapper, label], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([wrapper, label]);
  });

  test("picks painted vector artwork through an overlapping transparent outline viewport", () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <div id="card" data-hf-edit-as-unit><svg><rect id="fill" /></svg></div>
      <div id="corners" data-hf-edit-as-unit><svg><path id="outline" /></svg></div>
    </main>`;
    const card = document.getElementById("card")!;
    const corners = document.getElementById("corners")!;
    const fill = document.getElementById("fill")!;
    const outline = document.getElementById("outline")!;
    for (const element of [card, corners, card.firstElementChild!, corners.firstElementChild!]) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 190, 46);
    }
    const options = { activeCompositionPath: "index.html" };
    expect(
      resolveAllVisualDomEditTargets([corners.firstElementChild, corners, fill, card], options),
    ).toEqual([card]);
    expect(resolveAllVisualDomEditTargets([outline, corners, fill, card], options)).toEqual([
      corners,
      card,
    ]);
  });

  test("measures group content through full-stage animation wrappers", () => {
    document.body.innerHTML = `<div id="group" data-hf-group>
      <div style="width:1920px;height:1080px;pointer-events:none"><span id="label">Title</span></div>
      <div id="icon" data-hf-edit-as-unit><svg><path /></svg></div>
      <div style="display:none"><span>Hidden decoration</span></div>
    </div>`;
    expect(getDomEditGroupMembers(document.getElementById("group")!)).toEqual([
      document.getElementById("label"),
      document.getElementById("icon"),
    ]);
  });

  test("selects a graphic assembly together while allowing direct text and explicit drill-in", async () => {
    document.body.innerHTML = `<main data-composition-id="main" data-composition-file="index.html">
      <div id="card-group" data-hf-group>
        <div id="art" data-hf-edit-as-unit><svg><rect /></svg></div>
        <span id="caption">Card title</span>
      </div>
    </main>`;
    const group = document.getElementById("card-group")!;
    const art = document.getElementById("art")!;
    const caption = document.getElementById("caption")!;
    const select = (target: HTMLElement, active: HTMLElement | null) =>
      resolveDomEditSelection(target, {
        activeCompositionPath: "index.html",
        isMasterView: true,
        skipSourceProbe: true,
        activeGroupElement: previewGroupScope(target, active),
      });
    await expect(select(art, null)).resolves.toMatchObject({ element: group });
    await expect(select(caption, null)).resolves.toMatchObject({
      element: caption,
    });
    await expect(select(art, group)).resolves.toMatchObject({ element: art });
    await expect(
      resolveDomEditSelection(caption, {
        activeCompositionPath: "index.html",
        isMasterView: true,
        skipSourceProbe: true,
        exactTarget: true,
      }),
    ).resolves.toMatchObject({ element: caption });
    const selectedText = await select(caption, null);
    if (!selectedText) throw new Error("Text selection missing");
    await expect(refreshDomEditSelection(selectedText, "index.html")).resolves.toMatchObject({
      element: caption,
    });
  });

  test("treats structured motion spans as one selectable text layer", async () => {
    document.body.innerHTML = `
      <section id="caption-text" data-ipw-motion-structure="v1">
        <span data-ipw-motion-word data-ipw-motion-role="unit">
          <span id="animated-word" data-ipw-motion-role="text">Caption</span>
        </span>
      </section>`;
    const root = document.getElementById("caption-text") as HTMLElement;
    const word = document.getElementById("animated-word") as HTMLElement;
    const box = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    };
    root.getBoundingClientRect = () => box;
    word.getBoundingClientRect = () => box;

    expect(getDomLayerPatchTarget(word, "index.html")).toBeNull();
    expect(
      getSelectionCandidate(word, {
        activeCompositionPath: "index.html",
        isMasterView: true,
      }),
    ).toBe(root);
    expect(
      resolveAllVisualDomEditTargets([word, root], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([root]);
    await expect(
      resolveDomEditSelection(word, {
        activeCompositionPath: "index.html",
        isMasterView: true,
        exactTarget: true,
        skipSourceProbe: true,
      }),
    ).resolves.toMatchObject({ element: root, id: "caption-text" });
  });

  test("treats legacy split motion characters as one selectable text layer", async () => {
    document.body.innerHTML = `
      <h1 id="split-title" data-ipw-motion-split="v1" data-ipw-motion-source='"Motion"'>
        <span data-ipw-motion-word>
          <span id="animated-character" data-ipw-motion-char>M</span>
          <span data-ipw-motion-char>o</span>
        </span>
      </h1>`;
    const root = document.getElementById("split-title") as HTMLElement;
    const character = document.getElementById("animated-character") as HTMLElement;
    const box = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    };
    root.getBoundingClientRect = () => box;
    character.getBoundingClientRect = () => box;

    expect(getDomLayerPatchTarget(character, "index.html")).toBeNull();
    expect(
      getSelectionCandidate(character, {
        activeCompositionPath: "index.html",
        isMasterView: true,
      }),
    ).toBe(root);
    expect(
      resolveAllVisualDomEditTargets([character, root], {
        activeCompositionPath: "index.html",
      }),
    ).toEqual([root]);
    await expect(
      resolveDomEditSelection(character, {
        activeCompositionPath: "index.html",
        isMasterView: true,
        exactTarget: true,
        skipSourceProbe: true,
      }),
    ).resolves.toMatchObject({
      element: root,
      id: "split-title",
      textFields: [{ source: "self", value: "Motion" }],
    });
  });

  test("resolves a repeated authored selector inside the requested preview host", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section data-composition-id="file-one"><div data-hf-inner-root><small>One</small></div></section>
        <section data-composition-id="file-two"><div data-hf-inner-root><small>Two</small></div></section>
      </main>
    `;
    const second = document.querySelectorAll("small")[1];

    expect(
      findElementForTimelineElement(
        document,
        {
          id: "file-two-small",
          selector: "small",
          selectorIndex: 1,
          sourceFile: "index.html",
          previewHostId: "file-two",
        },
        { activeCompositionPath: "index.html", isMasterView: true },
      ),
    ).toBe(second);
  });

  test("resolves a runtime-generated media id through its data-hf-id", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <img data-hf-id="hf-logo" src="logo.svg" alt="Brand logo" />
      </main>
    `;
    const logo = document.querySelector("img");

    expect(
      findElementForTimelineElement(
        document,
        {
          id: "hf-logo",
          tag: "img",
          sourceFile: "index.html",
        },
        { activeCompositionPath: "index.html", isMasterView: true },
      ),
    ).toBe(logo);
  });

  test("recovers a timeline scene by authored timing when runtime host binding is missing", () => {
    document.body.innerHTML = `
      <main data-composition-id="local-file-cascade" data-composition-file="index.html">
        <section data-start="6" data-duration="4" data-track-index="3" class="lfc-stream">
          <article class="lfc-file">Document</article>
        </section>
      </main>
    `;
    const stream = document.querySelector(".lfc-stream");

    expect(
      findElementForTimelineElement(
        document,
        {
          id: "unbound-runtime-clip",
          tag: "section",
          start: 6,
          duration: 4,
          track: 3,
          sourceFile: "index.html",
        },
        { activeCompositionPath: "index.html", isMasterView: true },
      ),
    ).toBe(stream);
  });
});

 test("identifies same-file scene and group metadata without inferring from labels", () => {
   const scene=document.createElement("section");scene.className="scene clip";
   const group=document.createElement("div");group.setAttribute("data-hf-group","TitleGroup");
   const unrelated=document.createElement("div");unrelated.setAttribute("data-label","Scene Alpha");
   expect(readInlineScopeKind(scene)).toBe("scene");expect(readInlineScopeKind(group)).toBe("group");expect(readInlineScopeKind(unrelated)).toBeUndefined();
 });

 test("a discovered .scene.clip in one HTML selects the compact total timeline", () => {
   const host=document.createElement("section");host.id="headline";host.className="scene clip";document.body.append(host);
   const scene=createTimelineElementFromManifestClip({clip:MANIFEST_CLIP,hostEl:host,doc:document,fallbackIndex:0});
   expect(scene.inlineScopeKind).toBe("scene");expect(scene.compositionSrc).toBeUndefined();
   expect(resolveTimelineEditingMode(1,[scene])).toBe("master");
   expect(resolveTimelineEditingMode(2,[scene])).toBe("scene");
 });


test("scene discovery distinguishes own painted content from layout-only ancestors", () => {
  document.body.innerHTML = `<section id="scene"><div id="layout"><div id="card" style="background-color:rgb(240,240,240)"><div id="text">Title</div></div><div id="border" style="border:1px solid black"></div></div></section>`;
  const clip: ClipManifestClip = { ...MANIFEST_CLIP, id: "scene" };
  const host = document.getElementById("scene");
  if (!host) throw new Error("Missing scene");
  const { children } = collectDomClipChildren(document, [clip], new Map([[clip, host]]));
  expect(children.find(child => child.domId === "layout")?.hasVisualContent).toBe(false);
  expect(children.find(child => child.domId === "card")?.hasVisualContent).toBe(true);
  expect(children.find(child => child.domId === "text")?.hasVisualContent).toBe(true);
  expect(children.find(child => child.domId === "border")?.hasVisualContent).toBe(true);
});


test("leaf fill previews retain white backgrounds and thin lines without capturing content groups", () => {
  document.body.innerHTML = `<div id="paper" style="background:white"></div><i id="line" style="display:block;height:3px;background:rgb(31,186,192)"></i><div id="card" style="background:white"><p>Real content</p></div>`;
  const read = (id: string) => createTimelineElementFromManifestClip({ clip: { ...MANIFEST_CLIP, id },
    fallbackIndex: 0, doc: document, hostEl: document.getElementById(id) }).timelinePaint;
  expect(read("paper")).toBe("rgb(255, 255, 255)");
  expect(read("line")).toBe("rgb(31, 186, 192)");
  expect(read("card")).toBeUndefined();
});
