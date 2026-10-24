import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findSystemBrowser } from "./manager";

vi.mock("node:fs", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs")>(), existsSync: vi.fn(),
}));
afterEach(() => vi.mocked(existsSync).mockReset());

const managerSource = readFileSync(new URL("./manager.ts", import.meta.url), "utf8");
const studioServerSource = readFileSync(
  new URL("../server/studioServer.ts", import.meta.url),
  "utf8",
);

describe("Windows system browser fallback", () => {
  it("discovers per-user Chrome and installed Edge", () => {
    expect(managerSource).toContain('process.env["LOCALAPPDATA"]');
    expect(managerSource).toContain('"Microsoft", "Edge", "Application", "msedge.exe"');
    expect(managerSource).toContain('["chrome", "msedge", "chromium"]');
  });

  it.skipIf(process.platform !== "win32")("uses installed Edge without a download when Chrome is absent", () => {
    const edge = join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
    vi.mocked(existsSync).mockImplementation(path => String(path) === edge);
    expect(findSystemBrowser()).toEqual({ executablePath: edge, source: "system" });
  });

  it("falls back to system Chrome when the managed download is unavailable", () => {
    expect(managerSource).toContain("findSystemBrowser()");
    expect(studioServerSource).toContain("const systemBrowser = findSystemBrowser()");
    expect(studioServerSource).toContain("Managed thumbnail browser failed");
    expect(studioServerSource).toContain("chromePath: systemBrowser.executablePath");
  });
});
