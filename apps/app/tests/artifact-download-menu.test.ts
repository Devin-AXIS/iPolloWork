import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/artifacts/artifact-panel.tsx", import.meta.url);

describe("Artifact download menu", () => {
  test("offers PDF and PPTX downloads for slide HTML artifacts", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("const isPresentationHtml = target.kind === \"file\" && target.preview === \"html\"");
    expect(source).toContain("hasPresentationSlides(draft)");
    expect(source).toContain("downloadPresentationPdf");
    expect(source).toContain("downloadPresentationPptx");
    expect(source).toContain("t(\"design.export.download_pdf\")");
    expect(source).toContain("t(\"design.export.download_pptx\")");
  });
});
