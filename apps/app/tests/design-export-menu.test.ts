import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design export menu", () => {
  test("keeps deck downloads and webpage publishing behind one compact menu", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("<DropdownMenu>");
    expect(source).toContain('t("design.download_pptx")');
    expect(source).toContain('t("design.download_pdf")');
    expect(source).toContain('t("design.publish_web")');
    expect(source).not.toContain('title="Export PPTX"');
    expect(source).not.toContain('title="Export PDF"');
  });
});
