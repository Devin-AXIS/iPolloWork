import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopClient = readFileSync(resolve(import.meta.dir, "../src/app/lib/desktop.ts"), "utf8");
const electronMain = readFileSync(resolve(import.meta.dir, "../../desktop/electron/main.mjs"), "utf8");
const ipcTypes = readFileSync(resolve(import.meta.dir, "../../../packages/types/src/desktop-ipc.ts"), "utf8");

describe("desktop fetch binary transport", () => {
  test("keeps template ZIP bytes intact across Electron IPC", () => {
    expect(ipcTypes).toContain("body?: string | Uint8Array");
    expect(ipcTypes).toContain("body: Uint8Array");
    expect(electronMain).toContain("new Uint8Array(await response.arrayBuffer())");
    expect(electronMain).not.toContain("body: await response.text()");
    expect(desktopClient).toContain("Uint8Array.from(result.body).buffer");
  });
});
