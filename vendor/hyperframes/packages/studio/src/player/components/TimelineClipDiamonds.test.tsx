import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";

const keyframesData = {
  format: "test",
  keyframes: [
    { percentage: 0, properties: { x: 0 } },
    { percentage: 50, properties: { x: 100 } },
  ],
};

function renderDiamonds(selectedKeyframes: Set<string>) {
  return renderToStaticMarkup(
    <TimelineClipDiamonds
      keyframesData={keyframesData}
      clipWidthPx={200}
      clipHeightPx={40}
      isSelected
      currentPercentage={0}
      elementId="layer"
      selectedKeyframes={selectedKeyframes}
    />,
  );
}

describe("TimelineClipDiamonds", () => {
  test("renders visible diamonds along the thumbnail top with a larger hit target", () => {
    const markup = renderDiamonds(new Set());

    expect(markup).toContain("width:16px;height:16px");
    expect(markup).toContain('width="12" height="12"');
    expect(markup).toContain("top:0;");
    expect(markup).not.toContain("stroke=");
  });

  test("uses yellow for selected keys and solid cyan for idle keys", () => {
    expect(renderDiamonds(new Set(["layer:50"]))).toContain('fill="#FED953"');
    expect(renderDiamonds(new Set())).toContain('fill="#19BAC2"');
  });
});
