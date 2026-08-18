import { describe, expect, it } from "vitest";
import {
  createIllustrationAssetPath,
  ILLUSTRATION_EFFECTS,
  ILLUSTRATION_EFFECT_SAMPLE,
  renderIllustrationEffectHtml,
  selectIllustrationTextCandidates,
} from "./illustrationEffect";
import {
  buildTimelineAssetInsertHtml,
  insertTimelineAssetIntoSource,
  resolveAvailableVisualTrack,
} from "./timelineAssetDrop";
import { getCategory } from "../components/sidebar/assetHelpers";

function styleBlock(html: string): string {
  return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
}

describe("local illustration effects", () => {
  it("keeps all six effect styles in one renderer catalog", () => {
    expect(ILLUSTRATION_EFFECTS.map((effect) => effect.id)).toEqual([
      "ian-xiaohei-illustrations",
      "html-infographic",
      "html-concept-explainer",
      "html-kinetic-typography",
      "html-svg-path",
      "html-3d-space",
    ]);
  });

  it.each(ILLUSTRATION_EFFECTS)(
    "uses the same self-contained renderer for $id preview and output",
    ({ id }) => {
      const preview = renderIllustrationEffectHtml(id, ILLUSTRATION_EFFECT_SAMPLE);
      const output = renderIllustrationEffectHtml(id, {
        ...ILLUSTRATION_EFFECT_SAMPLE,
        title: "选中片段标题",
        subtitle: "选中片段正文",
        sourceLabel: "scene-02",
      });

      expect(styleBlock(output)).toBe(styleBlock(preview));
      expect(output).toContain(`data-ipollowork-illustration="${id}"`);
      expect(output).toContain('data-ipollowork-renderer="local-v1"');
      expect(output).toContain("选中片段标题");
      expect(output).not.toContain(ILLUSTRATION_EFFECT_SAMPLE.title);
      expect(output).not.toMatch(/<script\b|https?:\/\//i);
    },
  );

  it("escapes selected clip content before writing HTML", () => {
    const html = renderIllustrationEffectHtml("html-infographic", {
      ...ILLUSTRATION_EFFECT_SAMPLE,
      title: '<img src=x onerror="alert(1)">',
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });

  it("ignores decorative punctuation before choosing clip copy", () => {
    expect(
      selectIllustrationTextCandidates([
        "?",
        "  →  ",
        "恒生银行 · 手机理财转账，可以有多快？从排队等待到手机完成。?const transfer = true;",
      ]),
    ).toEqual([
      "恒生银行 · 手机理财转账，可以有多快？",
      "从排队等待到手机完成。",
      "const transfer = true;",
    ]);
  });

  it("creates a new material path without overwriting prior illustrations", () => {
    const first = createIllustrationAssetPath(
      "html-svg-path",
      { ...ILLUSTRATION_EFFECT_SAMPLE, title: "客户旅程" },
      [],
    );
    const second = createIllustrationAssetPath(
      "html-svg-path",
      { ...ILLUSTRATION_EFFECT_SAMPLE, title: "客户旅程" },
      [first],
    );

    expect(first).toBe("assets/video-illustrations/svg-path-客户旅程.html");
    expect(second).toBe("assets/video-illustrations/svg-path-客户旅程-2.html");
  });

  it("keeps the generated material and playhead clip on the same HTML asset", () => {
    const assetPath = createIllustrationAssetPath(
      "html-concept-explainer",
      ILLUSTRATION_EFFECT_SAMPLE,
      [],
    );
    const material = renderIllustrationEffectHtml(
      "html-concept-explainer",
      ILLUSTRATION_EFFECT_SAMPLE,
    );
    const clip = buildTimelineAssetInsertHtml({
      id: "concept-explainer",
      hfId: "hf-concept-explainer",
      assetPath,
      kind: "html",
      start: 7.25,
      duration: 4,
      track: 0,
      zIndex: 3,
      geometry: { left: 0, top: 0, width: 1600, height: 900 },
    });
    const composition = insertTimelineAssetIntoSource(
      '<main data-composition-id="main" data-width="1600" data-height="900" data-duration="12"></main>',
      clip,
    );

    expect(material).toContain('data-ipollowork-renderer="local-v1"');
    expect(getCategory(assetPath)).toBe("illustrations");
    expect(composition).toContain(`src="${assetPath}"`);
    expect(composition).toContain('data-hf-asset-kind="html"');
    expect(composition).toContain('data-start="7.25"');
    expect(composition).toContain('data-duration="4"');
    expect(composition).toContain('data-hf-lock-aspect-ratio="16:9"');
  });

  it("places a generated illustration on a visual track without time overlap", () => {
    const elements = [
      { track: 0, start: 0, duration: 18, tag: "div" },
      { track: 1, start: 1.6, duration: 3.2, tag: "section" },
      { track: 2, start: 4.8, duration: 3.2, tag: "section" },
      { track: 3, start: 0, duration: 18, tag: "audio", src: "assets/music.mp3" },
    ];

    expect(resolveAvailableVisualTrack(elements, 1.6, 3.2)).toBe(2);
    expect(resolveAvailableVisualTrack(elements, 0, 18)).toBe(4);
  });
});
