// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import type { ClipManifestClip } from "./playbackTypes";
import { collectDomClipChildren, createTimelineElementFromManifestClip } from "./timelineDOM";
import { resolveDomEditSelection } from "../../components/editor/domEditing";
import { buildStableSelector } from "../../components/editor/domEditingDom";
import { resolveAllVisualDomEditTargets } from "../../components/editor/domEditingElement";

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
});
