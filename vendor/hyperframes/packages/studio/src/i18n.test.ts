import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import { translateStudioLiteral } from "./i18n";
import { buildTweenSummary } from "./components/editor/gsapAnimationHelpers";

describe("translateStudioLiteral", () => {
  it("keeps Studio labels unchanged in English", () => {
    expect(translateStudioLiteral("en", "Timing")).toBe("Timing");
  });

  it("translates layer editing labels and dynamic accessibility text", () => {
    expect(translateStudioLiteral("zh", "Timing")).toBe("时间");
    expect(translateStudioLiteral("zh", "3 effects")).toBe("3 个效果");
    expect(translateStudioLiteral("zh", "Lock Hero")).toBe("锁定 Hero");
    expect(translateStudioLiteral("zh", "Collapse Animation")).toBe("收起 动画");
    expect(translateStudioLiteral("zh", "Post-processing")).toBe("后处理");
    expect(translateStudioLiteral("zh", "Mask rectangle")).toBe("蒙层矩形");
    expect(translateStudioLiteral("zh", "Mask circle")).toBe("蒙层圆形");
    expect(translateStudioLiteral("zh", "Split clip at playhead")).toBe(
      "当前片段时刻分割",
    );
    expect(translateStudioLiteral("zh", "Add keyframe")).toBe("添加关键");
    expect(translateStudioLiteral("zh", "Add keyframe at playhead")).toBe(
      "当前片段时刻添加关键帧",
    );
  });

  it("uses the approved AI video-editing warning copy", () => {
    const source = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");
    expect(source).toContain(
      '"header.aiEditingWarning": "AI 修改视频中，建议不要手动修改"',
    );
  });

  it("translates the existing animation editor controls", () => {
    expect(translateStudioLiteral("zh", "Animate")).toBe("变化到");
    expect(translateStudioLiteral("zh", "Animate In")).toBe("从设定值进入");
    expect(translateStudioLiteral("zh", "From → To")).toBe("起始 → 结束");
    expect(translateStudioLiteral("zh", "Set Instantly")).toBe("立即设置");
    expect(translateStudioLiteral("zh", "Move X")).toBe("水平移动");
    expect(translateStudioLiteral("zh", "Speed curve")).toBe("速度曲线");
    expect(translateStudioLiteral("zh", "Arc Motion")).toBe("弧线运动");
    expect(translateStudioLiteral("zh", "Delete All Keyframes")).toBe("删除全部关键帧");
    expect(translateStudioLiteral("zh", "Animation 02")).toBe("动画 02");
    expect(translateStudioLiteral("zh", "Convert Opacity to keyframes")).toBe(
      "将不透明度转换为关键帧",
    );
    expect(translateStudioLiteral("zh", "Drag to move entrance animation")).toBe(
      "拖动以移动入场动画",
    );
  });

  it("keeps animation summaries in the selected Studio language", () => {
    const animation: GsapAnimation = {
      id: "hero-enter",
      targetSelector: "#hero",
      method: "from",
      position: 0,
      duration: 0.6,
      ease: "power2.out",
      properties: { opacity: 0, y: 24 },
    };

    expect(buildTweenSummary(animation, "en")).toBe(
      "Starting at 0s, over 0.6s, #hero enters from opacity to 0%, move y to 24px using a power2.out curve.",
    );
    expect(buildTweenSummary(animation, "zh")).toBe(
      "从 0 秒开始，#hero 在 0.6 秒内从 [不透明度：0%，垂直移动：24px] 进入正常状态，缓动为 power2.out。",
    );
  });

  it("falls back to the source text when a literal is not registered", () => {
    expect(translateStudioLiteral("zh", "Project-specific label")).toBe(
      "Project-specific label",
    );
  });
});
