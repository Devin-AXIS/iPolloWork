import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const managerSource = readFileSync(new URL("./manager.ts", import.meta.url), "utf8");
const studioServerSource = readFileSync(
  new URL("../server/studioServer.ts", import.meta.url),
  "utf8",
);

describe("Windows system browser fallback", () => {
  it("discovers per-user Chrome and installed Edge", () => {
    expect(managerSource).toContain("process.env.LOCALAPPDATA");
    expect(managerSource).toContain('"Microsoft", "Edge", "Application", "msedge.exe"');
    expect(managerSource).toContain('["chrome", "msedge", "chromium"]');
  });

  it("falls back to system Chrome when the managed download is unavailable", () => {
    expect(managerSource).toContain("options?.preferSystemBrowser");
    expect(studioServerSource).toContain("preferSystemBrowser: true");
    expect(studioServerSource).toContain("Managed thumbnail browser failed");
    expect(studioServerSource).toContain("chromePath: systemBrowser.executablePath");
  });
});
