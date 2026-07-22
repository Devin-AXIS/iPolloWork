import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design preview height", () => {
  test("fills the panel for ordinary previews without changing the presentation canvas", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('? "h-full w-full rounded-lg shadow-sm"');
    expect(source).toContain(': "h-full w-[390px] max-w-full shrink-0 rounded-[26px] shadow-xl shadow-black/15"');
    expect(source).toContain('? "absolute left-1/2 top-1/2 h-[900px] w-[1600px] origin-center rounded-lg shadow-sm"');
  });
});
