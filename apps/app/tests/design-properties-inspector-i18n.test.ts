import { describe, expect, test } from "bun:test";

const inspectorUrl = new URL(
  "../src/react-app/domains/session/design/design-properties-inspector.tsx",
  import.meta.url,
);
const zhUrl = new URL("../src/i18n/locales/zh.ts", import.meta.url);
const enUrl = new URL("../src/i18n/locales/en.ts", import.meta.url);

describe("design properties inspector i18n", () => {
  test("uses app translations for the right panel labels shown in the inspector", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const zh = await Bun.file(zhUrl).text();
    const en = await Bun.file(enUrl).text();

    const keys = [
      "design.properties.tabs.element",
      "design.properties.tabs.design_system",
      "design.properties.layer.text",
      "design.properties.layer.element",
      "design.properties.layer.batch",
      "design.properties.section.position",
      "design.properties.section.size",
      "design.properties.section.fill",
      "design.properties.section.border",
      "design.properties.section.appearance",
      "design.properties.field.alignment",
      "design.properties.field.rotation",
      "design.properties.field.width",
      "design.properties.field.height",
      "design.properties.border.none",
    ];

    for (const key of keys) {
      expect(source).toContain(`t("${key}"`);
      expect(zh).toContain(`"${key}"`);
      expect(en).toContain(`"${key}"`);
    }

    expect(source).not.toContain(">Element</button>");
    expect(source).not.toContain(">Design System</button>");
    expect(source).not.toContain('title="Position"');
    expect(source).not.toContain('title="Border"');
    expect(zh).toContain('"design.properties.tabs.element": "元素"');
    expect(zh).toContain('"design.properties.tabs.design_system": "主题"');
    expect(zh).toContain('"design.properties.section.border": "边框"');
    expect(zh).toContain('"design.properties.field.width": "宽度"');
    expect(zh).toContain('"design.properties.border.none": "无"');
    expect(zh).toContain('"design.properties.layer.batch": "{count} 个元素 · 批量选择"');
  });
});
