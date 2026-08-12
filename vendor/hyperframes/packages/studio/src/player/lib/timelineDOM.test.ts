// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import type { ClipManifestClip } from "./playbackTypes";
import {
  collectDomClipChildren,
  createTimelineElementFromManifestClip,
  findTimelineDomNodeForClip,
} from "./timelineDOM";
import { resolveDomEditSelection } from "../../components/editor/domEditing";
import {
  buildStableSelector,
  setCompositionSourceMap,
} from "../../components/editor/domEditingDom";
import {
  findElementForTimelineElement,
  resolveAllVisualDomEditTargets,
} from "../../components/editor/domEditingElement";

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
      clip: { ...MANIFEST_CLIP, label: "Tree label", timelineClipLabel: "Manifest clip label" },
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
    const sceneClip = { ...MANIFEST_CLIP, id: "scene-intro", tagName: "section" };
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

  test("collects every untimed child below a timed scene for canvas/tree parity", () => {
    document.body.innerHTML = `
      <main data-composition-id="main" data-composition-file="index.html">
        <section id="scene-hook" data-start="0" data-duration="3.2">
          <div class="hero-copy">
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
    const hierarchy = collectDomClipChildren(
      document,
      [clip],
      new Map([[clip, scene!]]),
    );
    const hero = hierarchy.children.find((child) => child.selector === ".hero-copy");
    const title = hierarchy.children.find((child) => child.selector === "h1");

    expect(hero).toBeDefined();
    expect(title).toBeDefined();
    expect(hierarchy.parentMap.get(hero!.id)).toBe("scene-hook");
    expect(hierarchy.parentMap.get(title!.id)).toBe(hero!.id);
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

    expect(file).toMatchObject({ hostId: "lfc-stream", parentId: "lfc-stream" });
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

    expect(resolveAllVisualDomEditTargets([label, screen, stage], { activeCompositionPath: "index.html" })).toEqual([
      label,
    ]);
    expect(resolveAllVisualDomEditTargets([stage, screen, label], { activeCompositionPath: "index.html" })).toEqual([
      label,
    ]);
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
