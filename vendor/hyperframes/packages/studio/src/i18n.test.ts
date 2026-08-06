import { describe, expect, it } from "vitest";
import { translateStudioLiteral } from "./i18n";

describe("translateStudioLiteral", () => {
  it("keeps Studio labels unchanged in English", () => {
    expect(translateStudioLiteral("en", "Timing")).toBe("Timing");
  });

  it("translates layer editing labels and dynamic accessibility text", () => {
    expect(translateStudioLiteral("zh", "Timing")).toBe("时间");
    expect(translateStudioLiteral("zh", "3 effects")).toBe("3 个效果");
    expect(translateStudioLiteral("zh", "Lock Hero")).toBe("锁定 Hero");
    expect(translateStudioLiteral("zh", "Collapse Animation")).toBe("收起 动画");
  });

  it("falls back to the source text when a literal is not registered", () => {
    expect(translateStudioLiteral("zh", "Project-specific label")).toBe(
      "Project-specific label",
    );
  });
});
