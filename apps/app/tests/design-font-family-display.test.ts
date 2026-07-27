import { describe, expect, test } from "bun:test";

import { displayFontFamily } from "../src/react-app/domains/session/design/font-family-display";

const desktopIpcUrl = new URL("../../../packages/types/src/desktop-ipc.ts", import.meta.url);
const desktopMainUrl = new URL("../../desktop/electron/main.mjs", import.meta.url);

describe("displayFontFamily", () => {
  test("shows only the primary font name from a quoted CSS stack", () => {
    expect(displayFontFamily('"Playfair Display", serif')).toBe("Playfair Display");
  });

  test("preserves a single unquoted font name", () => {
    expect(displayFontFamily("PingFang SC")).toBe("PingFang SC");
  });
});

test("declares and handles the system-font catalog command", async () => {
  expect(await Bun.file(desktopIpcUrl).text()).toContain('listSystemFontFamilies: { args: []; result: string[] }');
  expect(await Bun.file(desktopMainUrl).text()).toContain('"listSystemFontFamilies": async');
});
