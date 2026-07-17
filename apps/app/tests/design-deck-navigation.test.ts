import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design deck navigation", () => {
  test("keeps the slide controls available in preview mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toMatch(/\{deck \? \(\s*<div[^>]*data-testid="design-deck-navigation"/);
  });
});
