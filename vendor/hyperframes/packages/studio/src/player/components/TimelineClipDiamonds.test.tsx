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
  test("renders diamonds at half size while preserving the original hit target", () => {
    const markup = renderDiamonds(new Set());

    expect(markup).toContain("width:32px;height:32px");
    expect(markup).toContain('width="16" height="16"');
  });

  test("uses yellow for selected keyframes and light gray for idle keyframes", () => {
    expect(renderDiamonds(new Set(["layer:50"]))).toContain('fill="#FED953"');
    expect(renderDiamonds(new Set())).toContain('fill="#D9DDE3"');
  });
});
